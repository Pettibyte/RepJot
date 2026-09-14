// Phase 10 regression tests. Each test pins one defect the Phase 10 audit
// confirmed, so the fix cannot silently return.
//
// | Test | Defect |
// | --- | --- |
// | F1 | The base slot held local text, so the merge dropped the local edit. |
// | F2 | A brand-new logical file threw instead of starting from an empty document. |
// | F3 | A pending `patch` whose base vanished could never commit. |
// | F4 | A rejected `edit` left `saveStatus` stuck at `saving`. |
// | F5 | `reset()` detached the `pagehide` flush for good. |
// | F6 | `reset()` discarded queued edits that were not yet durable. |
// | F7 | Every upload error was relabeled `ambiguous_upload`. |

import { describe, expect, test, beforeEach } from 'bun:test';
import {
  diagnosticSnapshot,
  resetDiagnosticLog
} from '../src/diagnostics/diagnostic-log';
import { AppError, type AppErrorKind } from '../src/domain/errors';
import type { Session } from '../src/domain/types';
import { saveStatus, type SaveStatus } from '../src/state/app-state';
import { baseKey, cacheKey, pendingKey, type LocalStore } from '../src/storage/local-store';
import { createMemoryLocalStore } from '../src/storage/memory-local-store';
import {
  createCoordinator,
  PREFERENCES_NAME,
  type Coordinator,
  type SyncDeps
} from '../src/sync/sync-coordinator';
import { get } from 'svelte/store';
import { FakeDrive } from './fakes/fake-drive';
import { frozenTimers, loadedStaticData, SHARD_NAME } from './fixtures/sync';
import { clone, preferencesDoc } from './fixtures/merge';
import { SHARD_MONTH, validSession, validShard } from './fixtures/semantic';

/** A valid session ID for slot `n`. The schema requires a UUID v4 shape. */
function sid(n: number): string {
  const tail = String(n).padStart(12, '0');
  return `session-00000000-0000-4000-8000-${tail}`;
}

/** Add one session for the fixture month to a shard document. */
function withSession(doc: unknown, n: number, day: number): unknown {
  const shard = clone(doc) as { sessions: Record<string, Session> };
  const candidate = clone(validSession()) as Session & Record<string, unknown>;
  const id = sid(n);
  candidate.id = id;
  const stamp = `${SHARD_MONTH}-${String(day).padStart(2, '0')}T08:00:00Z`;
  const end = `${SHARD_MONTH}-${String(day).padStart(2, '0')}T08:30:00Z`;
  candidate.startedAtUtc = stamp;
  candidate.completedAtUtc = end;
  candidate.updatedAtUtc = end;
  shard.sessions[id] = candidate as Session;
  return shard;
}

/** One preferences document that passes the schema and the semantic stage. */
function prefsDoc(units: Record<string, Record<string, string>>): string {
  return JSON.stringify(preferencesDoc(units));
}

/** A `pagehide` target that counts its listeners and can fire the event. */
class FakePagehideTarget {
  readonly listeners: Array<(event: unknown) => void> = [];

  addEventListener(type: string, listener: (event: unknown) => void): void {
    if (type === 'pagehide') this.listeners.push(listener);
  }

  removeEventListener(type: string, listener: (event: unknown) => void): void {
    if (type !== 'pagehide') return;
    const index = this.listeners.indexOf(listener);
    if (index >= 0) this.listeners.splice(index, 1);
  }

  /** Fire `pagehide` and let the flush start. */
  fire(): void {
    for (const listener of [...this.listeners]) listener({});
  }

  count(): number {
    return this.listeners.length;
  }
}

/** Build a coordinator over a fresh memory store and a fake Drive. */
function makeSetup(seed?: { name: string; text: string }): {
  store: LocalStore;
  drive: FakeDrive;
  coordinator: Coordinator;
  page: FakePagehideTarget;
} {
  const store = createMemoryLocalStore();
  const drive = new FakeDrive();
  if (seed !== undefined) drive.addFile(seed.name, seed.text);
  const page = new FakePagehideTarget();
  const deps: SyncDeps = {
    store,
    drive,
    staticData: loadedStaticData(),
    accountKey: 'acct-fix',
    pagehideTarget: page,
    timers: frozenTimers().timers
  };
  return { store, drive, coordinator: createCoordinator(deps), page };
}

/** Read the current save status. */
function status(): SaveStatus {
  return get(saveStatus);
}

/** Read one stored value. */
async function raw(store: LocalStore, key: string): Promise<unknown> {
  return store.get(key);
}

/** True when a pending row exists. `null` and `undefined` both read absent. */
async function pendingExists(store: LocalStore, name: string): Promise<boolean> {
  const value = await raw(store, pendingKey(name));
  return value !== null && value !== undefined;
}

/** The shard text used by most tests. */
function shardText(): string {
  return JSON.stringify(validShard());
}

beforeEach(() => {
  resetDiagnosticLog();
});

describe('F1: the base slot holds only synchronized content', () => {
  test('an edit with a pending row and no base row reaches Drive with both edits', async () => {
    const { store, drive, coordinator } = makeSetup({
      name: PREFERENCES_NAME,
      text: prefsDoc({ 'back-squat': { weight: 'kg' } })
    });

    // A prior edit left a pending `replace` and a local working row, but no
    // base row, because nothing has synchronized since.
    const localText = prefsDoc({
      'back-squat': { weight: 'kg' },
      'push-up': { reps: 'reps' }
    });
    await store.set(cacheKey(PREFERENCES_NAME), {
      logicalName: PREFERENCES_NAME,
      driveFileId: drive.idsOf(PREFERENCES_NAME)[0],
      remoteEtag: null,
      contentText: localText,
      schemaVersion: 1,
      cachedAtUtc: '2026-08-15T00:00:00Z'
    });
    await store.set(pendingKey(PREFERENCES_NAME), {
      delta: { kind: 'replace', document: JSON.parse(localText) },
      updatedAtUtc: '2026-08-15T00:00:00Z'
    });
    expect(await raw(store, baseKey(PREFERENCES_NAME))).toBeUndefined();

    const handle = await coordinator.edit(PREFERENCES_NAME, (doc: unknown) => {
      const prefs = clone(doc) as { exerciseUnits: Record<string, Record<string, string>> };
      prefs.exerciseUnits['dead-lift'] = { weight: 'kg' };
      return prefs;
    });
    await handle.synced;

    const onDrive = JSON.parse(drive.textOf(PREFERENCES_NAME) ?? '{}') as {
      exerciseUnits: Record<string, Record<string, string>>;
    };
    // Both the pre-existing pending edit and the new one survive.
    expect(onDrive.exerciseUnits['push-up']).toEqual({ reps: 'reps' });
    expect(onDrive.exerciseUnits['dead-lift']).toEqual({ weight: 'kg' });
  });
});

describe('F2: a brand-new logical file starts from an empty document', () => {
  test('an edit to a name unknown to Drive and local storage creates the file', async () => {
    const { store, drive, coordinator } = makeSetup();
    const name = 'results-2026-10.json';

    const handle = await coordinator.edit(name, (doc: unknown) => {
      const shard = clone(doc) as { sessions: Record<string, Session> };
      const candidate = clone(validSession()) as Session & Record<string, unknown>;
      candidate.id = sid(1);
      candidate.startedAtUtc = '2026-10-05T08:00:00Z';
      candidate.completedAtUtc = '2026-10-05T08:30:00Z';
      candidate.updatedAtUtc = '2026-10-05T08:30:00Z';
      shard.sessions[sid(1)] = candidate as Session;
      return shard;
    });
    await handle.synced;

    expect(drive.idsOf(name)).toHaveLength(1);
    expect(drive.textOf(name)).toContain(sid(1));
    expect(await pendingExists(store, name)).toBe(false);
  });
});

describe('F3: a pending patch survives a vanished base file', () => {
  test('a later syncAll creates the missing file and lands the edit', async () => {
    const { store, drive, coordinator } = makeSetup({ name: SHARD_NAME, text: shardText() });
    await coordinator.ensureLoaded(SHARD_NAME);

    // The upload fails, so the edit stays pending.
    drive.rejectAlways('updateFile', 'network');
    const handle = await coordinator.edit(SHARD_NAME, (doc: unknown) => withSession(doc, 2, 3));
    await handle.synced.catch(() => undefined);
    drive.clearAlways('updateFile');
    expect(await pendingExists(store, SHARD_NAME)).toBe(true);

    // The Drive file disappears between attempts.
    const vanishedId = drive.idsOf(SHARD_NAME)[0];
    drive.files.delete(vanishedId);

    drive.calls.length = 0;
    await coordinator.syncAll();

    // The coordinator reached the create step instead of stalling.
    expect(drive.calls.some((call: string): boolean => call.startsWith('createFile'))).toBe(true);
    expect(drive.textOf(SHARD_NAME)).toContain(sid(2));
    expect(await pendingExists(store, SHARD_NAME)).toBe(false);
  });
});

describe('F4: a rejected edit reaches a terminal status', () => {
  test('saveStatus is not saving after a rejected edit', async () => {
    const { drive, coordinator } = makeSetup({ name: SHARD_NAME, text: shardText() });

    let thrown: AppError | undefined;
    await coordinator
      .edit(SHARD_NAME, () => ({ nope: true }))
      .catch((error: unknown) => {
        thrown = error instanceof AppError ? error : undefined;
      });

    expect(thrown?.kind).toBe('invalid_document');
    expect(status()).not.toBe('saving');
    // A local failure is not a sync failure: nothing ever reached Drive.
    expect(status()).toBe('idle');
    expect(drive.calls.filter((c: string) => c.startsWith('updateFile'))).toEqual([]);
  });
});

describe('F5: the pagehide flush outlives reset', () => {
  test('the pagehide listener count stays one across reset', async () => {
    const { coordinator, page } = makeSetup({ name: SHARD_NAME, text: shardText() });
    expect(page.count()).toBe(1);

    await coordinator.reset();
    expect(page.count()).toBe(1);
  });

  test('a post-reset pagehide still flushes a queued edit', async () => {
    const { drive, coordinator, page } = makeSetup({ name: SHARD_NAME, text: shardText() });

    await coordinator.reset();
    await coordinator.ensureLoaded(SHARD_NAME);
    coordinator.queueEdit(SHARD_NAME, (doc: unknown) => withSession(doc, 4, 5));

    page.fire();
    await coordinator.flush();

    expect(drive.textOf(SHARD_NAME)).toContain(sid(4));
  });
});

describe('F6: reset keeps queued edits', () => {
  test('reset persists a queued edit to local storage', async () => {
    const { store, drive, coordinator } = makeSetup({ name: SHARD_NAME, text: shardText() });
    await coordinator.ensureLoaded(SHARD_NAME);

    // The upload fails, so the only copy of the edit is the local one.
    drive.rejectAlways('updateFile', 'network');
    // The frozen timer never fires, so the edit is queued but not durable.
    coordinator.queueEdit(SHARD_NAME, (doc: unknown) => withSession(doc, 6, 7));

    await coordinator.reset();
    drive.clearAlways('updateFile');

    const cached = (await raw(store, cacheKey(SHARD_NAME))) as { contentText: string };
    expect(cached.contentText).toContain(sid(6));
    expect(await pendingExists(store, SHARD_NAME)).toBe(true);
  });
});

describe('F7: the adapter error kind survives', () => {
  const kinds: AppErrorKind[] = ['authentication', 'drive_quota', 'authorization'];

  for (const kind of kinds) {
    test(`a forced ${kind} surfaces unchanged`, async () => {
      const { drive, coordinator } = makeSetup({ name: SHARD_NAME, text: shardText() });
      await coordinator.ensureLoaded(SHARD_NAME);

      drive.rejectAlways('updateFile', kind);
      const handle = await coordinator.edit(SHARD_NAME, (doc: unknown) => withSession(doc, 8, 9));

      let thrown: AppError | undefined;
      await handle.synced.catch((error: unknown) => {
        thrown = error instanceof AppError ? error : undefined;
      });
      drive.clearAlways('updateFile');

      // The real kind reaches the caller, so the UI can pick the right
      // recovery path instead of guessing.
      expect(thrown?.kind).toBe(kind);
      const codes = diagnosticSnapshot().map(
        (event: { context?: Record<string, unknown> }): unknown => event.context?.errorKind
      );
      expect(codes).toContain(kind);
      expect(codes).not.toContain('ambiguous_upload');
    });
  }
});

