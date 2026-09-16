// In-memory Drive adapter for the sync tests. Phase 10.
//
// The coordinator's interesting behavior is not what it computes on a happy
// path. It is what it does when a call pauses, fails, or answers after the
// world changed. This fake makes each of those a switch the test turns on:
//
// | Control | Effect |
// | --- | --- |
// | `blockUpload()` | The next `updateFile`/`createFile` waits until `release()`. |
// | `blockReadBack()` | The next `readFile` after a write waits until `release()`. |
// | `loseResponse()` | The write commits, then the call rejects as a lost response. |
// | `rejectWith(kind)` | The next call rejects with `AppError(kind)`. |
// | `remoteWrites(name, text)` | Another device changes the file out of band. |
//
// Every call is recorded in `calls`, so a test asserts the order the
// coordinator produced rather than guessing from the end state.

import { AppError, type AppErrorKind } from '../../src/domain/errors';
import { decodeUtf8, encodeUtf8 } from '../../src/bytes/utf8';
import type {
  DriveAccountProfile,
  DriveAdapter,
  DriveFileContent,
  DriveFileMeta
} from '../../src/drive/drive-interface';

/** One stored file in the fake Drive. */
interface FakeFile {
  id: string;
  name: string;
  /**
   * The stored content, as bytes.
   *
   * Bytes rather than text, because the real adapter hands bytes up and the
   * export path must be testable against a file that is not valid UTF-8.
   * `textOf` decodes for the tests that only ever hold JSON.
   */
  bytes: Uint8Array;
  /** Bumped on every write, so the version marker always changes. */
  version: number;
  modifiedTime: string;
  md5: string | null;
  size: number;
}

/** A gate the test opens by hand. */
interface Gate {
  promise: Promise<void>;
  release: () => void;
}

function makeGate(): Gate {
  let release: () => void = () => undefined;
  const promise = new Promise<void>((resolve: () => void) => {
    release = resolve;
  });
  return { promise, release };
}

/** The kinds a test can force onto the next call. */
type FailableMethod =
  | 'listCatalog'
  | 'readFile'
  | 'createFile'
  | 'updateFile'
  | 'deleteFile';

/**
 * The fake Drive.
 *
 * `files` is keyed by file ID. `byName` maps a name to its IDs, which lets a
 * test create a duplicate group even though Phase 10 assumes one file per
 * name.
 */
export class FakeDrive implements DriveAdapter {
  /** Every call in order, as `'method:arg'` strings. */
  readonly calls: string[] = [];

  /** Files by stable ID. */
  readonly files = new Map<string, FakeFile>();

  /**
   * When set, the next write of this kind commits and then the call rejects
   * as a lost response. The coordinator must resolve it by reading Drive.
   */
  loseResponseOnNextWrite = false;

  /** Method → error kind, consumed by the next matching call. */
  private failures = new Map<FailableMethod, AppErrorKind>();

  /** Methods that reject on every call, with the kind each one rejects as. */
  private alwaysFail = new Map<FailableMethod, AppErrorKind>();

  /** When true, the next write returns metadata but changes no bytes. */
  private silentDrop = false;

  /** Gate held before a write. */
  private uploadGate: Gate | null = null;

  /** Gate held before the read-back after a write. */
  private readBackGate: Gate | null = null;

  /** True between a write and its read-back, so only that read blocks. */
  private awaitingReadBack = false;

  private nextId = 1;

  /** Seed one file from text. Returns its ID. */
  addFile(name: string, text: string, id?: string): string {
    return this.addBytes(name, encodeUtf8(text), id);
  }

  /**
   * Seed one file from raw bytes. Returns its ID.
   *
   * The byte-level entry point. A test that needs a file the app cannot decode
   * starts here, because `addFile` cannot express one.
   */
  addBytes(name: string, bytes: Uint8Array, id?: string): string {
    const fileId = id ?? `f${String(this.nextId++)}`;
    this.files.set(fileId, {
      id: fileId,
      name,
      bytes,
      version: 1,
      modifiedTime: '2026-08-15T00:00:00Z',
      md5: `md5-${fileId}-1`,
      size: bytes.byteLength
    });
    return fileId;
  }

  /** Current text of the file with this name. `undefined` when absent. */
  textOf(name: string): string | undefined {
    for (const file of this.files.values()) {
      if (file.name === name) return decodeUtf8(file.bytes);
    }
    return undefined;
  }

  /** Current bytes of the file with this name. `undefined` when absent. */
  bytesOf(name: string): Uint8Array | undefined {
    for (const file of this.files.values()) {
      if (file.name === name) return file.bytes;
    }
    return undefined;
  }

  /** IDs of every file with this name. More than one is a duplicate group. */
  idsOf(name: string): string[] {
    return Array.from(this.files.values())
      .filter((file: FakeFile): boolean => file.name === name)
      .map((file: FakeFile): string => file.id);
  }

  /** Another device writes this file. Bumps the version marker. */
  remoteWrite(name: string, text: string): void {
    this.remoteWriteBytes(name, encodeUtf8(text));
  }

  /** Another device writes raw bytes into this file. */
  remoteWriteBytes(name: string, bytes: Uint8Array): void {
    for (const file of this.files.values()) {
      if (file.name !== name) continue;
      file.bytes = bytes;
      file.version += 1;
      file.md5 = `md5-${file.id}-${String(file.version)}`;
      file.size = bytes.byteLength;
      return;
    }
    this.addBytes(name, bytes);
  }

  /** Make the next write wait until `release()` is called. */
  blockUpload(): Gate {
    const gate = makeGate();
    this.uploadGate = gate;
    return gate;
  }

  /** Make the read-back after the next write wait until `release()`. */
  blockReadBack(): Gate {
    const gate = makeGate();
    this.readBackGate = gate;
    return gate;
  }

  /** The next `updateFile` or `createFile` commits, then rejects as lost. */
  loseResponse(): void {
    this.loseResponseOnNextWrite = true;
  }

  /** The next call to `method` rejects with `AppError(kind)`. */
  rejectWith(method: FailableMethod, kind: AppErrorKind): void {
    this.failures.set(method, kind);
  }

  /** Every call to `method` rejects with `AppError(kind)` until cleared. */
  rejectAlways(method: FailableMethod, kind: AppErrorKind): void {
    this.alwaysFail.set(method, kind);
  }

  /** Stop the persistent rejection for `method`. */
  clearAlways(method: FailableMethod): void {
    this.alwaysFail.delete(method);
  }

  /** Make the next `updateFile` answer as if it wrote, but change nothing.
   *
   * This models a write that silently failed: the call returns metadata, the
   * read-back comes back with the old bytes, and the coordinator must
   * re-read, merge, and upload again. REQUIREMENTS 4.19.
   */
  silentlyDropNextWrite(): void {
    this.silentDrop = true;
  }

  /** Forget every pending failure and gate. */
  resetControls(): void {
    this.failures.clear();
    this.alwaysFail.clear();
    this.uploadGate = null;
    this.readBackGate = null;
    this.silentDrop = false;
    this.loseResponseOnNextWrite = false;
    this.awaitingReadBack = false;
  }

  /** Consume a queued failure for `method`. Throws when one is set. */
  private async fail(method: FailableMethod): Promise<void> {
    const always = this.alwaysFail.get(method);
    if (always !== undefined) {
      throw new AppError(always, { reason: 'forced_always', method });
    }
    const kind = this.failures.get(method);
    if (kind === undefined) return;
    this.failures.delete(method);
    throw new AppError(kind, { reason: 'forced', method });
  }

  /** Wait out the gate for the write path. */
  private async waitUploadGate(): Promise<void> {
    const gate = this.uploadGate;
    if (gate === null) return;
    this.uploadGate = null;
    await gate.promise;
  }

  /** Wait out the gate for the read-back path. */
  private async waitReadBackGate(): Promise<void> {
    const gate = this.readBackGate;
    if (gate === null) return;
    this.readBackGate = null;
    await gate.promise;
  }

  private meta(file: FakeFile): DriveFileMeta {
    return {
      id: file.id,
      name: file.name,
      modifiedTime: file.modifiedTime,
      version: String(file.version),
      md5Checksum: file.md5,
      size: file.size
    };
  }

  /** Apply one write to the stored file and return its metadata. */
  private commit(file: FakeFile, text: string): DriveFileMeta {
    if (this.silentDrop) {
      this.silentDrop = false;
      // Answer with a fresh marker but leave the bytes alone.
      file.version += 1;
      file.md5 = `md5-${file.id}-${String(file.version)}`;
      return this.meta(file);
    }
    const bytes = encodeUtf8(text);
    file.bytes = bytes;
    file.version += 1;
    file.md5 = `md5-${file.id}-${String(file.version)}`;
    file.size = bytes.byteLength;
    return this.meta(file);
  }

  async getAccountKey(): Promise<string> {
    this.calls.push('getAccountKey');
    return 'fake-account';
  }

  async getAccountProfile(): Promise<DriveAccountProfile> {
    this.calls.push('getAccountProfile');
    return { accountKey: 'fake-account', displayName: 'Fake Account' };
  }

  async listCatalog(): Promise<DriveFileMeta[]> {
    this.calls.push('listCatalog');
    await this.fail('listCatalog');
    return Array.from(this.files.values()).map((file: FakeFile): DriveFileMeta => this.meta(file));
  }

  async readFile(id: string): Promise<DriveFileContent> {
    this.calls.push(`readFile:${id}`);
    await this.fail('readFile');
    const file = this.files.get(id);
    if (file === undefined) {
      throw new AppError('invalid_document', { reason: 'not_found' }, 'No such file.');
    }
    if (this.awaitingReadBack) {
      this.awaitingReadBack = false;
      await this.waitReadBackGate();
    }
    return { bytes: file.bytes, meta: this.meta(file) };
  }

  async createFile(name: string, text: string): Promise<DriveFileMeta> {
    this.calls.push(`createFile:${name}`);
    await this.fail('createFile');
    await this.waitUploadGate();
    const bytes = encodeUtf8(text);
    const file: FakeFile = {
      id: `f${String(this.nextId++)}`,
      name,
      bytes,
      version: 1,
      modifiedTime: '2026-08-15T00:00:00Z',
      md5: `md5-new-${name}`,
      size: bytes.byteLength
    };
    this.files.set(file.id, file);
    if (this.loseResponseOnNextWrite) {
      this.loseResponseOnNextWrite = false;
      this.awaitingReadBack = true;
      throw new AppError('network', { reason: 'response_lost' }, 'The response was lost.');
    }
    this.awaitingReadBack = true;
    return this.meta(file);
  }

  async updateFile(id: string, text: string): Promise<DriveFileMeta> {
    this.calls.push(`updateFile:${id}`);
    await this.fail('updateFile');
    await this.waitUploadGate();
    const file = this.files.get(id);
    if (file === undefined) {
      throw new AppError('invalid_document', { reason: 'not_found' }, 'No such file.');
    }
    const meta = this.commit(file, text);
    if (this.loseResponseOnNextWrite) {
      this.loseResponseOnNextWrite = false;
      this.awaitingReadBack = true;
      throw new AppError('network', { reason: 'response_lost' }, 'The response was lost.');
    }
    this.awaitingReadBack = true;
    return meta;
  }

  async deleteFile(id: string): Promise<void> {
    this.calls.push(`deleteFile:${id}`);
    await this.fail('deleteFile');
    this.files.delete(id);
  }

  async probeRejected(_accessToken: string): Promise<boolean> {
    this.calls.push('probeRejected');
    return false;
  }

  async revokeToken(_accessToken: string): Promise<void> {
    this.calls.push('revokeToken');
  }
}
