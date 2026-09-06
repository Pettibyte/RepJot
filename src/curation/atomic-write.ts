/**
 * P8-T01 — One-file atomic replacement for the trusted single-operator curation workflow.
 *
 * Authority: recorded user decision 2026-09-05 (one invocation per output path; same-path
 * multi-process concurrency is unsupported; the local workspace and operator are trusted against
 * hostile concurrent filesystem mutation). No locks, journals, rollback protocols, or
 * multi-process coordination exist here by design.
 *
 * A file is replaced by writing a temporary file in the destination directory, fsyncing it, and
 * renaming it over the target. rename(2) replaces the directory entry atomically, so a failed or
 * interrupted write never publishes a partial file: the previous complete file (if any) stays
 * unchanged. Crash guarantees are exactly what the platform provides for rename; no stronger
 * durability is claimed.
 */
import { lstat, open, rename, rm } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

/** Error thrown by the atomic write path. `code` is a stable diagnostic code. */
export class OutputWriteError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "OutputWriteError";
    this.code = code;
  }
}

function errnoCode(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null) {
    const code = (error as NodeJS.ErrnoException).code;
    if (typeof code === "string") {
      return code;
    }
  }
  return undefined;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }
  return String(error);
}

/** Returns null when the target is absent or a regular file; otherwise an actionable message. */
async function inspectTarget(target: string): Promise<string | null> {
  let details;
  try {
    details = await lstat(target);
  } catch (error) {
    if (errnoCode(error) === "ENOENT") {
      return null;
    }
    return 'target "' + target + '" could not be inspected: ' + errorMessage(error);
  }
  if (!details.isFile()) {
    return 'target "' + target + '" exists and is not a regular file; refusing to write through it';
  }
  return null;
}

export interface AtomicWriteHooks {
  readonly inspectTarget?: (target: string) => Promise<string | null>;
  readonly open?: (path: string, flags: string) => Promise<FileHandle>;
  readonly writeFile?: (handle: FileHandle, bytes: Uint8Array) => Promise<void>;
  readonly sync?: (handle: FileHandle) => Promise<void>;
  readonly close?: (handle: FileHandle) => Promise<void>;
  readonly rename?: (source: string, target: string) => Promise<void>;
}

async function removeOwnedTemporary(path: string): Promise<void> {
  try {
    await rm(path, { force: true });
  } catch (_error) {
    // Preserve the original write error. The supported workspace is trusted, and cleanup is
    // best-effort when the filesystem itself refuses the removal.
  }
}

/**
 * Atomically replace `targetPath` with `bytes`: same-directory, exclusive temporary file,
 * fsync, close, and rename. Ownership starts when exclusive open succeeds. Every handled
 * failure after that point removes the invocation-owned path; an unowned EEXIST collision is
 * the only temporary-file error that advances to another name.
 */
export async function writeAtomicFile(
  targetPath: string,
  bytes: Uint8Array,
  errorCode: string,
  hooks: AtomicWriteHooks = {}
): Promise<void> {
  const dir = dirname(targetPath);
  const inspect = hooks.inspectTarget === undefined ? inspectTarget : hooks.inspectTarget;
  const openFile = hooks.open === undefined ? (path: string, flags: string) => open(path, flags) : hooks.open;
  const writeFile = hooks.writeFile === undefined ? (handle: FileHandle, data: Uint8Array) => handle.writeFile(data) : hooks.writeFile;
  const syncFile = hooks.sync === undefined ? (handle: FileHandle) => handle.sync() : hooks.sync;
  const closeFile = hooks.close === undefined ? (handle: FileHandle) => handle.close() : hooks.close;
  const renameFile = hooks.rename === undefined ? rename : hooks.rename;

  const precheck = await inspect(targetPath);
  if (precheck !== null) {
    throw new OutputWriteError("output-path-unsafe", precheck);
  }
  const base = basename(targetPath);
  let tmpPath: string | null = null;
  for (let n = 0; n < 8 && tmpPath === null; n += 1) {
    const candidate = join(dir, "." + base + ".tmp-" + process.pid + "-" + n);
    let ownedPath: string | null = null;
    let handle: FileHandle | null = null;
    try {
      handle = await openFile(candidate, "wx");
      // Set ownership immediately. Write, sync, and close can all fail after open succeeds.
      ownedPath = candidate;
      await writeFile(handle, bytes);
      await syncFile(handle);
      await closeFile(handle);
      handle = null;
      tmpPath = candidate;
    } catch (error) {
      if (handle !== null) {
        try {
          await closeFile(handle);
        } catch (_closeError) {
          // The original failure is the useful diagnostic; cleanup below still runs.
        }
      }
      if (ownedPath !== null) {
        await removeOwnedTemporary(ownedPath);
        throw new OutputWriteError(errorCode, 'could not create a temporary file in "' + dir + '" for "' + targetPath + '": ' + errorMessage(error));
      }
      if (errnoCode(error) === "EEXIST") {
        continue; // The exclusive open failed before this invocation owned the path.
      }
      throw new OutputWriteError(errorCode, 'could not create a temporary file in "' + dir + '" for "' + targetPath + '": ' + errorMessage(error));
    }
  }
  if (tmpPath === null) {
    throw new OutputWriteError(errorCode, 'could not allocate a unique temporary name in "' + dir + '" for "' + targetPath + '"');
  }
  const ownedTempPath = tmpPath;
  try {
    const atWriteCheck = await inspect(targetPath);
    if (atWriteCheck !== null) {
      throw new OutputWriteError("output-path-unsafe", atWriteCheck + " (re-checked at write time)");
    }
    await renameFile(ownedTempPath, targetPath);
  } catch (error) {
    await removeOwnedTemporary(ownedTempPath);
    if (error instanceof OutputWriteError) {
      throw error;
    }
    throw new OutputWriteError(errorCode, 'could not replace "' + targetPath + '" atomically: ' + errorMessage(error));
  }
}
