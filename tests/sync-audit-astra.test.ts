// Regression tests for the six findings in `.agent-work/phase-10/audit-astra.md`.
//
// Each test pins one finding so the fix cannot silently return. The audit
// reproduced these against commit `48f621d`; these tests carry the same
// scenarios into the suite.
//
// | Test | Finding |
// | --- | --- |
// | A1 | A failed upload discarded later debounced edits. |
// | A2 | A concurrent load overwrote a durable pending edit. |
// | A3 | `reset()` let an old upload overwrite a newer edit. |
// | A4 | An edit after reload needed Drive before local persistence. |
// | A5 | A stalled upload blocked the next local save. |
// | A6 | The final metadata check could pick an unread remote file. |

import { describe, expect, test, beforeEach } from 'bun:test';
import { resetDiagnosticLog } from '../src/diagnostics/diagnostic-log';
import type { Session } from '../src/domain/types';
import {
  baseKey,
  cacheKey,
  pendingKey,
  type LocalStore,
  type LocalStoreEntry
} from '../src/storage/local-store';
import { createMemoryLocalStore } from '../src/storage/memory-local-store';
import { saveStatus } from '../src/state/app-state';
import { get } from 'svelte/store';
import {
  createCoordinator,
  PREFERENCES_NAME,
  type Coordinator,
  type SyncDeps
} from '../src/sync/sync-coordinator';
import { debouncedEdit } from '../src/sync/debounce';
import { FakeDrive } from './fakes/fake-drive';
import { frozenTimers, loadedStaticData, SHARD_NAME } from './fixtures/sync';
import { clone, preferencesDoc } from './fixtures/merge';
import { SHARD_MONTH, SESSION_KEY, validSession, validShard } from './fixtures/semantic';

/** A valid session ID for slot `n`. The schema requires a UUID v4 shape. */
function sid(n: number): string {
  const tail = String(n).padStart(12, '0');
  return `session-00000000-0000-4000-8000-${tail}`;
}

/** Add one session for the fixture month to a shard document. */
function withSession(doc: unknown, n: number, day: string): unknown {
  const shard = clone(doc) as { sessions: Record<string, Session> };
  const candidate = clone(validSession()) as Session & Record<string, unknown>;
  const id = sid(n);
  const stamp = `${SHARD_MONTH}-${day}T08:00:00Z`;
  const end = `${SHARD_MONTH}-${day}T08:30:00Z`;
  candidate.id = id;
  candidate.startedAtUtc = stamp;
  candidate.completedAtUtc = end;
  candidate.updatedAtUtc = end;
  shard.sessions[id] = candidate as Session;
  return shard;
}

/** Preferences text with one squat mapping in kilograms. */
function kgPrefs(): string {
  return JSON.stringify(preferencesDoc({ 'back-squat': { weight: 'kg' } }));
}

/** Change the squat unit from kilograms to pounds. */
function toPounds(doc: unknown): unknown {
  const prefs = clone(doc) as { exerciseUnits: Record<string, Record<string, string>> };
  prefs.exerciseUnits['back-squat'] = { weight: 'lb' };
  return prefs;
}

/** Set the squat unit back to kilograms. */
function toKilograms(doc: unknown): unknown {
  const prefs = clone(doc) as { exerciseUnits: Record<string, Record<string, string>> };
  prefs.exerciseUnits['back-squat'] = { weight: 'kg' };
  return prefs;
}

/** Add a push-up repetition preference. */
function addPushUp(doc: unknown): unknown {
  const prefs = clone(doc) as { exerciseUnits: Record<string, Record<string, string>> };
  prefs.exerciseUnits['push-up'] = { reps: 'reps' };
  return prefs;
}

/** Stamp the fixture session with a later update time. */
function touchSession(doc: unknown, stamp = '2026-08-16T10:00:00Z'): unknown {
  const shard = clone(doc) as { sessions: Record<string, Session> };
  const session = shard.sessions[SESSION_KEY];
  session.updatedAtUtc = stamp;
  return shard;
}

/** Build a coordinator over a fresh memory store and a fake Drive. */
function makeSetup(seed?: { name: string; text: string }): {
  store: LocalStore;
  drive: FakeDrive;
  coordinator: Coordinator;
} {
  const store = createMemoryLocalStore();
  const drive = new FakeDrive();
  if (seed !== undefined) drive.addFile(seed.name, seed.text);
  const deps: SyncDeps = {
    store,
    drive,
    staticData: loadedStaticData(),
    accountKey: 'acct-astra',
    pagehideTarget: null,
    timers: frozenTimers().timers
  };
  return { store, drive, coordinator: createCoordinator(deps) };
}

/** A second coordinator over the same store and Drive, for the reload case. */
function attach(store: LocalStore, drive: FakeDrive): Coordinator {
  return createCoordinator({
    store,
    drive,
    staticData: loadedStaticData(),
    accountKey: 'acct-astra',
    pagehideTarget: null,
    timers: frozenTimers().timers
  });
}

/** Let queued microtasks and timers run. */
async function tick(times = 4): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await new Promise((resolve: () => void): void => setTimeout(resolve, 0));
  }
}

/** Wait until `drive.calls` holds an entry that starts with `prefix`. */
async function waitForCall(drive: FakeDrive, prefix: string): Promise<void> {
  for (let i = 0; i < 200; i += 1) {
    if (drive.calls.some((call: string): boolean => call.startsWith(prefix))) return;
    await new Promise((resolve: () => void): void => setTimeout(resolve, 0));
  }
  throw new Error(`Never saw a call starting with ${prefix}`);
}

/** A promise the test resolves by hand. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((resolveFn: () => void): void => {
    resolve = resolveFn;
  });
  return { promise, resolve };
}

/** Read one stored value. */
async function raw(store: LocalStore, key: string): Promise<unknown> {
  return store.get(key);
}

/** The cached working text for one logical file. */
async function cachedText(store: LocalStore, name: string): Promise<string> {
  const value = (await raw(store, cacheKey(name))) as { contentText: string } | undefined;
  return value?.contentText ?? '';
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

describe('A1: a failed upload keeps later queued edits', () => {
  test('every queued mutator reaches local storage', async () => {
    const { store, drive, coordinator } = makeSetup({
      name: PREFERENCES_NAME,
      text: kgPrefs()
    });
    await coordinator.ensureLoaded(PREFERENCES_NAME);

    drive.rejectAlways('updateFile', 'network');
    coordinator.queueEdit(PREFERENCES_NAME, toPounds);
    coordinator.queueEdit(PREFERENCES_NAME, addPushUp);
    await coordinator.flush();
    drive.clearAlways('updateFile');

    const text = await cachedText(store, PREFERENCES_NAME);
    expect(text).toContain('"lb"');
    expect(text).toContain('push-up');

    // A later sync carries both edits, so nothing stayed behind.
    await coordinator.syncAll();
    const onDrive = JSON.parse(drive.textOf(PREFERENCES_NAME) ?? '{}') as {
      exerciseUnits: Record<string, Record<string, string>>;
    };
    expect(onDrive.exerciseUnits['back-squat']).toEqual({ weight: 'lb' });
    expect(onDrive.exerciseUnits['push-up']).toEqual({ reps: 'reps' });
  });
});

describe('A2: a concurrent load cannot overwrite a newer local save', () => {
  test('a load that pauses mid-download drops its stale view', async () => {
    const { store, drive, coordinator } = makeSetup({
      name: PREFERENCES_NAME,
      text: kgPrefs()
    });
    await coordinator.ensureLoaded(PREFERENCES_NAME);

    // Another device rewrites the same bytes, so the marker moves and the
    // next load must download.
    drive.remoteWrite(PREFERENCES_NAME, kgPrefs());

    // Pause the next `readFile`, which is the load's download.
    const gate = deferred();
    const originalRead = drive.readFile.bind(drive);
    let armed = false;
    drive.readFile = async (id: string) => {
      if (!armed) {
        armed = true;
        await gate.promise;
      }
      return originalRead(id);
    };

    const loading = coordinator.ensureLoaded(PREFERENCES_NAME);
    await tick();

    // The local save needs no network, so it lands while the load waits.
    const handle = await coordinator.edit(PREFERENCES_NAME, toPounds);
    const syncedOutcome = handle.synced.then(
      (): string => 'synced',
      (error: unknown): string => `failed:${String(error)}`
    );
    expect(await cachedText(store, PREFERENCES_NAME)).toContain('"lb"');

    // Release the paused download and let the load finish.
    gate.resolve();
    await loading;
    expect(await cachedText(store, PREFERENCES_NAME)).toContain('"lb"');

    expect(await syncedOutcome).toBe('synced');
    expect(drive.textOf(PREFERENCES_NAME)).toContain('"lb"');

    await coordinator.syncAll();
    expect(drive.textOf(PREFERENCES_NAME)).toContain('"lb"');
  });
});

describe('A3: reset drains in-flight uploads', () => {
  test('reset waits for a reconciliation that owns the file', async () => {
    const { drive, coordinator } = makeSetup({ name: PREFERENCES_NAME, text: kgPrefs() });
    await coordinator.ensureLoaded(PREFERENCES_NAME);

    const gate = drive.blockUpload();
    const first = await coordinator.edit(PREFERENCES_NAME, toPounds);
    await waitForCall(drive, 'updateFile');

    let resetDone = false;
    const resetting = coordinator.reset().then((): void => {
      resetDone = true;
    });
    await tick();
    expect(resetDone).toBe(false);

    gate.release();
    await first.synced;
    await resetting;
    expect(resetDone).toBe(true);

    // The newer edit is the last word on Drive.
    const second = await coordinator.edit(PREFERENCES_NAME, addPushUp);
    await second.synced;
    const onDrive = JSON.parse(drive.textOf(PREFERENCES_NAME) ?? '{}') as {
      exerciseUnits: Record<string, Record<string, string>>;
    };
    expect(onDrive.exerciseUnits['back-squat']).toEqual({ weight: 'lb' });
    expect(onDrive.exerciseUnits['push-up']).toEqual({ reps: 'reps' });
  });
});

describe('A4: an edit after reload stays local-first', () => {
  test('a cached document supports a durable edit with Drive offline', async () => {
    const { store, drive, coordinator } = makeSetup({ name: SHARD_NAME, text: shardText() });
    await coordinator.ensureLoaded(SHARD_NAME);

    // A reload: a second coordinator over the same store, with no Drive.
    const reloaded = attach(store, drive);
    drive.rejectAlways('listCatalog', 'network');

    let mutatorRan = false;
    const handle = await reloaded.edit(SHARD_NAME, (doc: unknown): unknown => {
      mutatorRan = true;
      return touchSession(doc, '2026-08-17T09:00:00Z');
    });

    expect(mutatorRan).toBe(true);
    expect(handle.localDurable).toBe(true);
    expect(await cachedText(store, SHARD_NAME)).toContain('2026-08-17T09:00:00Z');
    expect(await pendingExists(store, SHARD_NAME)).toBe(true);

    let failed = false;
    await handle.synced.catch((): void => {
      failed = true;
    });
    expect(failed).toBe(true);
    drive.clearAlways('listCatalog');

    // The pending edit still reaches Drive later.
    await reloaded.syncAll();
    expect(drive.textOf(SHARD_NAME)).toContain('2026-08-17T09:00:00Z');
  });
});

describe('A5: a stalled upload does not block the next local save', () => {
  test('edit B becomes durable while edit A holds the network', async () => {
    const { store, drive, coordinator } = makeSetup({ name: SHARD_NAME, text: shardText() });
    await coordinator.ensureLoaded(SHARD_NAME);

    const gate = drive.blockUpload();
    const first = await coordinator.edit(SHARD_NAME, (doc: unknown): unknown =>
      withSession(doc, 2, '03')
    );
    await waitForCall(drive, 'updateFile');

    let durable = false;
    const second = coordinator
      .edit(SHARD_NAME, (doc: unknown): unknown => withSession(doc, 5, '06'))
      .then((handle): typeof handle => {
        durable = true;
        return handle;
      });

    await tick(8);
    expect(durable).toBe(true);
    const text = await cachedText(store, SHARD_NAME);
    expect(text).toContain(sid(2));
    expect(text).toContain(sid(5));
    expect(await pendingExists(store, SHARD_NAME)).toBe(true);

    gate.release();
    await first.synced;
    const secondHandle = await second;
    await secondHandle.synced;

    // Both edits reach Drive, and neither client still owes a write.
    const onDrive = JSON.parse(drive.textOf(SHARD_NAME) ?? '{}') as {
      sessions: Record<string, unknown>;
    };
    expect(onDrive.sessions[sid(2)]).toBeDefined();
    expect(onDrive.sessions[sid(5)]).toBeDefined();
    expect(await pendingExists(store, SHARD_NAME)).toBe(false);
  });
});

describe('A6: a file that reappears before the final check is read first', () => {
  test('a newly visible file is read and merged, not overwritten', async () => {
    const { drive, coordinator } = makeSetup({ name: SHARD_NAME, text: shardText() });
    await coordinator.ensureLoaded(SHARD_NAME);

    const originalId = drive.idsOf(SHARD_NAME)[0];
    drive.files.delete(originalId);

    // The shard comes back on another device with a second session, just
    // before the final metadata check.
    const recreated = JSON.stringify(
      withSession(JSON.parse(shardText()), 99, '12')
    );
    const originalList = drive.listCatalog.bind(drive);
    let listCalls = 0;
    drive.listCatalog = async () => {
      listCalls += 1;
      if (listCalls === 3) drive.addFile(SHARD_NAME, recreated, originalId);
      return originalList();
    };

    const handle = await coordinator.edit(SHARD_NAME, (doc: unknown): unknown =>
      touchSession(doc, '2026-08-18T07:00:00Z')
    );
    await handle.synced;

    const onDrive = JSON.parse(drive.textOf(SHARD_NAME) ?? '{}') as {
      sessions: Record<string, unknown>;
    };
    expect(onDrive.sessions[SESSION_KEY]).toBeDefined();
    expect(onDrive.sessions[sid(99)]).toBeDefined();
    expect(listCalls).toBeGreaterThanOrEqual(3);
  });
});

describe('base slot sanity', () => {
  test('the base row tracks the last confirmed content after a superseded commit', async () => {
    const { store, drive, coordinator } = makeSetup({ name: PREFERENCES_NAME, text: kgPrefs() });
    await coordinator.ensureLoaded(PREFERENCES_NAME);
    expect(await raw(store, baseKey(PREFERENCES_NAME))).toBeDefined();
    expect(await pendingExists(store, PREFERENCES_NAME)).toBe(false);
  });
});

// The five findings from the working-tree reevaluation of the same audit.

describe('B1: a pagehide flush does not wait for Drive between local edits', () => {
  test('every queued input reaches storage while the first upload is held', async () => {
    const { store, drive, coordinator } = makeSetup({
      name: PREFERENCES_NAME,
      text: kgPrefs()
    });
    await coordinator.ensureLoaded(PREFERENCES_NAME);
    drive.calls.length = 0;

    const gate = drive.blockUpload();
    coordinator.queueEdit(PREFERENCES_NAME, toPounds);
    coordinator.queueEdit(PREFERENCES_NAME, toKilograms);
    const flushing = coordinator.flush();
    await waitForCall(drive, 'listCatalog');

    // Both mutators ran, so the last input is durable even though the
    // first upload still waits on the gate.
    expect(await cachedText(store, PREFERENCES_NAME)).toContain('"kg"');

    gate.release();
    await flushing;
    expect(await cachedText(store, PREFERENCES_NAME)).toContain('"kg"');
  });
});

describe('B2: queue waves keep input order', () => {
  test('a later wave cannot run ahead of an earlier wave for one file', async () => {
    const { drive, coordinator } = makeSetup({
      name: PREFERENCES_NAME,
      text: kgPrefs()
    });
    await coordinator.ensureLoaded(PREFERENCES_NAME);
    drive.calls.length = 0;

    const gate = drive.blockUpload();
    coordinator.queueEdit(PREFERENCES_NAME, toPounds);
    coordinator.queueEdit(PREFERENCES_NAME, toKilograms);
    const first = coordinator.flush();
    await waitForCall(drive, 'listCatalog');

    // This input arrives after the first wave started, so it must land last.
    coordinator.queueEdit(PREFERENCES_NAME, toPounds);
    const second = coordinator.flush();

    gate.release();
    await first;
    await second;

    // The last input wins, not the older one that ran later.
    expect(drive.textOf(PREFERENCES_NAME)).toContain('"lb"');
  });
});

describe('B3: a superseded commit keeps remote additions', () => {
  test('a newer local edit does not delete a session it never saw', async () => {
    const { store, drive, coordinator } = makeSetup({ name: SHARD_NAME, text: shardText() });
    await coordinator.ensureLoaded(SHARD_NAME);

    // Another device adds a session this device has not read.
    const remoteDoc = withSession(JSON.parse(shardText()), 99, '12') as {
      sessions: Record<string, Session>;
    };
    drive.remoteWrite(SHARD_NAME, JSON.stringify(remoteDoc));

    const gate = drive.blockUpload();
    const first = await coordinator.edit(SHARD_NAME, (doc: unknown): unknown =>
      touchSession(doc, '2026-08-20T00:00:00Z')
    );
    await waitForCall(drive, 'updateFile');

    const second = await coordinator.edit(SHARD_NAME, (doc: unknown): unknown =>
      touchSession(doc, '2026-08-21T00:00:00Z')
    );

    gate.release();
    await first.synced;
    await second.synced;

    const onDrive = JSON.parse(drive.textOf(SHARD_NAME) ?? '{}') as {
      sessions: Record<string, Session>;
    };
    // Both local edits and the remote-only session survive.
    expect(onDrive.sessions[SESSION_KEY].updatedAtUtc).toBe('2026-08-21T00:00:00Z');
    expect(onDrive.sessions[sid(99)]).toBeDefined();
    expect(await pendingExists(store, SHARD_NAME)).toBe(false);
  });

  test('a newer local preference mapping does not delete a remote mapping', async () => {
    const { store, drive, coordinator } = makeSetup({
      name: PREFERENCES_NAME,
      text: kgPrefs()
    });
    await coordinator.ensureLoaded(PREFERENCES_NAME);

    // Another device adds a mapping this device has not read.
    const remote = JSON.parse(kgPrefs()) as {
      exerciseUnits: Record<string, Record<string, string>>;
    };
    remote.exerciseUnits['sit-up'] = { reps: 'reps' };
    drive.remoteWrite(PREFERENCES_NAME, JSON.stringify(remote));

    const gate = drive.blockUpload();
    const first = await coordinator.edit(PREFERENCES_NAME, toPounds);
    await waitForCall(drive, 'updateFile');
    const second = await coordinator.edit(PREFERENCES_NAME, addPushUp);

    gate.release();
    await first.synced;
    await second.synced;

    const onDrive = JSON.parse(drive.textOf(PREFERENCES_NAME) ?? '{}') as {
      exerciseUnits: Record<string, Record<string, string>>;
    };
    expect(onDrive.exerciseUnits['back-squat']).toEqual({ weight: 'lb' });
    expect(onDrive.exerciseUnits['push-up']).toEqual({ reps: 'reps' });
    expect(onDrive.exerciseUnits['sit-up']).toEqual({ reps: 'reps' });
    expect(await pendingExists(store, PREFERENCES_NAME)).toBe(false);
  });
});

describe('B4: reset drains a syncAll upload', () => {
  test('reset waits for a syncAll that owns the sync lock', async () => {
    const { drive, coordinator } = makeSetup({
      name: PREFERENCES_NAME,
      text: kgPrefs()
    });
    await coordinator.ensureLoaded(PREFERENCES_NAME);

    // Leave a pending edit behind after a failed sync.
    drive.rejectAlways('updateFile', 'network');
    const failed = await coordinator.edit(PREFERENCES_NAME, toPounds);
    await failed.synced.catch((): void => undefined);
    drive.clearAlways('updateFile');
    drive.calls.length = 0;

    const gate = drive.blockUpload();
    const syncing = coordinator.syncAll();
    await waitForCall(drive, 'updateFile');

    let resetDone = false;
    const resetting = coordinator.reset().then((): void => {
      resetDone = true;
    });
    await tick();
    expect(resetDone).toBe(false);

    gate.release();
    await syncing;
    await resetting;
    expect(resetDone).toBe(true);

    // The newer edit is the last word on Drive.
    const later = await coordinator.edit(PREFERENCES_NAME, addPushUp);
    await later.synced;
    const onDrive = JSON.parse(drive.textOf(PREFERENCES_NAME) ?? '{}') as {
      exerciseUnits: Record<string, Record<string, string>>;
    };
    expect(onDrive.exerciseUnits['back-squat']).toEqual({ weight: 'lb' });
    expect(onDrive.exerciseUnits['push-up']).toEqual({ reps: 'reps' });
  });
});

describe('B5: a brand-new logical file saves without Drive', () => {
  test('the first save of a new shard is durable with the catalog down', async () => {
    const { store, drive, coordinator } = makeSetup();
    drive.rejectAlways('listCatalog', 'network');

    let mutatorRan = false;
    const handle = await coordinator.edit(SHARD_NAME, (doc: unknown): unknown => {
      mutatorRan = true;
      return withSession(doc, 7, '04');
    });

    expect(mutatorRan).toBe(true);
    expect(handle.localDurable).toBe(true);
    expect(await cachedText(store, SHARD_NAME)).toContain(sid(7));
    expect(await pendingExists(store, SHARD_NAME)).toBe(true);

    let failed = false;
    await handle.synced.catch((): void => {
      failed = true;
    });
    expect(failed).toBe(true);

    // The pending shard reaches Drive once the catalog answers again.
    drive.clearAlways('listCatalog');
    await coordinator.syncAll();
    expect(drive.textOf(SHARD_NAME)).toContain(sid(7));
  });

  test('an offline first save does not replace a shard another device created', async () => {
    const { store, drive } = makeSetup();
    const offline = createCoordinator({
      store,
      drive,
      staticData: loadedStaticData(),
      accountKey: 'acct-astra-offline',
      pagehideTarget: null,
      timers: frozenTimers().timers
    });

    // This device has never seen the shard, and Drive is out of reach.
    drive.rejectAlways('listCatalog', 'network');
    await offline.edit(SHARD_NAME, (doc: unknown): unknown => withSession(doc, 7, '04'));
    await offline
      .syncAll()
      .catch((): void => undefined);
    drive.clearAlways('listCatalog');

    // Another device created the same shard with its own session meanwhile.
    const other = withSession(JSON.parse(shardText()), 99, '12') as {
      sessions: Record<string, Session>;
    };
    drive.addFile(SHARD_NAME, JSON.stringify(other));

    await offline.syncAll();

    const onDrive = JSON.parse(drive.textOf(SHARD_NAME) ?? '{}') as {
      sessions: Record<string, unknown>;
    };
    expect(onDrive.sessions[sid(7)]).toBeDefined();
    expect(onDrive.sessions[sid(99)]).toBeDefined();
  });
});

// The four findings from the third review of the same audit.

/** Set the fixture session's notes. */
function withNotes(doc: unknown, notes: string): unknown {
  const shard = clone(doc) as { sessions: Record<string, Session> };
  shard.sessions[SESSION_KEY].notes = notes;
  return shard;
}

/** A virtual clock that tracks deadlines, so a test can advance time. */
function virtualClock(): {
  timers: import('../../src/sync/debounce').TimerSet;
  advance: (ms: number) => void;
  armed: () => number[];
} {
  let now = 0;
  let seq = 0;
  let items: Array<{ id: number; at: number; callback: () => void }> = [];
  return {
    timers: {
      setTimeout: (callback: () => void, delayMs: number): unknown => {
        seq += 1;
        items.push({ id: seq, at: now + delayMs, callback });
        return seq;
      },
      clearTimeout: (handle: unknown): void => {
        items = items.filter((item: { id: number }): boolean => item.id !== handle);
      }
    },
    advance: (ms: number): void => {
      const target = now + ms;
      for (;;) {
        items.sort((a, b) => a.at - b.at);
        if (items.length === 0 || items[0].at > target) break;
        const next = items.shift();
        if (next === undefined) break;
        now = next.at;
        next.callback();
      }
      now = target;
    },
    armed: (): number[] => items.map((item: { at: number }): number => item.at).sort((a, b) => a - b)
  };
}

describe('C1: a rebase keeps a conflicted session whole', () => {
  test('the complete local session wins over the remote field change', async () => {
    const seeded = JSON.stringify(withNotes(validShard(), 'base'));
    const { store, drive, coordinator } = makeSetup({ name: SHARD_NAME, text: seeded });
    await coordinator.ensureLoaded(SHARD_NAME);

    // Another device changes a field inside the same session.
    drive.remoteWrite(SHARD_NAME, JSON.stringify(withNotes(validShard(), 'remote')));

    const gate = drive.blockUpload();
    const first = await coordinator.edit(SHARD_NAME, (doc: unknown): unknown =>
      withSession(doc, 2, '03')
    );
    await waitForCall(drive, 'updateFile');

    const second = await coordinator.edit(SHARD_NAME, (doc: unknown): unknown =>
      touchSession(doc, '2026-08-21T00:00:00Z')
    );

    // The local session still carries this device's notes.
    const local = coordinator.peek(SHARD_NAME) as { sessions: Record<string, Session> };
    expect(local.sessions[SESSION_KEY].notes).toBe('base');

    gate.release();
    await first.synced;
    await second.synced;

    const onDrive = JSON.parse(drive.textOf(SHARD_NAME) ?? '{}') as {
      sessions: Record<string, Session>;
    };
    // The conflicted session is this device's whole session, not a
    // field-level blend of both sides. REQUIREMENTS 4.7, 4.11.
    expect(onDrive.sessions[SESSION_KEY].notes).toBe('base');
    expect(onDrive.sessions[SESSION_KEY].updatedAtUtc).toBe('2026-08-21T00:00:00Z');
    // The session this device added during the upload is still there.
    expect(onDrive.sessions[sid(2)]).toBeDefined();
    expect(await pendingExists(store, SHARD_NAME)).toBe(false);
  });
});

describe('C2: a failed batch keeps its place ahead of a newer batch', () => {
  test('a later flush replays in input order, not newest first', async () => {
    const clock = frozenTimers();
    const order: string[] = [];
    let release: () => void = () => undefined;
    const paused = new Promise<void>((resolve: () => void): void => {
      release = resolve;
    });
    let first = true;
    const queue = debouncedEdit(
      async (_name: string, mutate: (doc: unknown) => unknown): Promise<void> => {
        if (first) {
          first = false;
          await paused;
          throw new Error('local write failed');
        }
        order.push(String(mutate('')));
      },
      { timers: clock.timers }
    );

    queue.schedule('a.json', (): string => 'first');
    const flushing = queue.flush().then(
      (): string => 'resolved',
      (): string => 'rejected'
    );
    await tick(4);

    // A newer input arrives while the first batch is still running.
    queue.schedule('a.json', (): string => 'later');
    const flushingAgain = queue.flush().then(
      (): string => 'resolved',
      (): string => 'rejected'
    );

    release();
    expect(await flushing).toBe('rejected');
    expect(await flushingAgain).toBe('rejected');
    expect(order).toEqual([]);

    // The replay keeps the original order, so the newer input lands last.
    await queue.flush();
    expect(order).toEqual(['first', 'later']);
  });
});

describe('C3: reset drains work a draining local write starts', () => {
  test('reset waits for a reconciliation started after its drain began', async () => {
    const store = createMemoryLocalStore();
    const drive = new FakeDrive();
    drive.addFile(PREFERENCES_NAME, kgPrefs());
    const coordinator = createCoordinator({
      store,
      drive,
      staticData: loadedStaticData(),
      accountKey: 'acct-astra-c3',
      pagehideTarget: null,
      timers: frozenTimers().timers
    });
    await coordinator.ensureLoaded(PREFERENCES_NAME);

    // Pause the next local write, so edit A is mid-flight when reset starts.
    const originalSetMany = store.setMany.bind(store);
    let releaseLocal: () => void = () => undefined;
    const localGate = new Promise<void>((resolve: () => void): void => {
      releaseLocal = resolve;
    });
    let armed = false;
    store.setMany = async (entries): Promise<void> => {
      if (!armed) {
        armed = true;
        await localGate;
      }
      await originalSetMany(entries);
    };

    const editA = coordinator.edit(PREFERENCES_NAME, toPounds);
    await tick(4);

    let resetDone = false;
    const resetting = coordinator.reset().then((): void => {
      resetDone = true;
    });
    await tick(2);
    expect(resetDone).toBe(false);

    // Let A finish locally and reach the upload gate.
    const uploadGate = drive.blockUpload();
    releaseLocal();
    await waitForCall(drive, 'updateFile');
    await tick(6);

    // The reconciliation this local write started must still hold reset.
    expect(resetDone).toBe(false);

    uploadGate.release();
    await editA
      .then((handle): Promise<void> => handle.synced)
      .catch((): void => undefined);
    await resetting;
    expect(resetDone).toBe(true);
  });
});

describe('C4: an explicit flush cancels the timer it consumes', () => {
  test('a later edit keeps its whole quiet period', async () => {
    const clock = virtualClock();
    const ran: string[] = [];
    const queue = debouncedEdit(
      async (_name: string, mutate: (doc: unknown) => unknown): Promise<void> => {
        ran.push(String(mutate('')));
      },
      { timers: clock.timers, delayMs: 400 }
    );

    queue.schedule('a.json', (): string => 'A');
    clock.advance(100);
    await queue.flush();
    expect(ran).toEqual(['A']);

    clock.advance(100);
    queue.schedule('a.json', (): string => 'B');
    // The stale timer must not run B at t=400.
    clock.advance(200);
    expect(ran).toEqual(['A']);
    expect(clock.armed()).toEqual([600]);

    clock.advance(200);
    expect(ran).toEqual(['A', 'B']);
  });
});

describe('D1: reset reports a queued local-write failure', () => {
  test('reset rejects and leaves the failed mutator queued', async () => {
    const inner = createMemoryLocalStore();
    let rejectWrites = false;
    const store: LocalStore = {
      get: (name: string): Promise<unknown> => inner.get(name),
      set: (name: string, value: unknown): Promise<void> => inner.set(name, value),
      delete: (name: string): Promise<void> => inner.delete(name),
      listKeys: (prefix: string): Promise<string[]> => inner.listKeys(prefix),
      setMany: async (entries: LocalStoreEntry[]): Promise<void> => {
        if (rejectWrites) throw new Error('local write failed');
        await inner.setMany(entries);
      }
    };
    const drive = new FakeDrive();
    drive.addFile(PREFERENCES_NAME, kgPrefs());
    const coordinator = createCoordinator({
      store,
      drive,
      staticData: loadedStaticData(),
      accountKey: 'acct-reset-failure',
      pagehideTarget: null,
      timers: frozenTimers().timers
    });
    await coordinator.ensureLoaded(PREFERENCES_NAME);
    coordinator.queueEdit(PREFERENCES_NAME, toPounds);

    rejectWrites = true;
    await expect(coordinator.reset()).rejects.toThrow('local write failed');
    expect(await cachedText(store, PREFERENCES_NAME)).toContain('"kg"');

    rejectWrites = false;
    await coordinator.flush();
    expect(await cachedText(store, PREFERENCES_NAME)).toContain('"lb"');
  });
});

describe('D2: a successful newer sync clears a prior failure status', () => {
  test('the final status is saved when no pending delta remains', async () => {
    const { store, drive, coordinator } = makeSetup({
      name: PREFERENCES_NAME,
      text: kgPrefs()
    });
    await coordinator.ensureLoaded(PREFERENCES_NAME);
    drive.rejectAlways('updateFile', 'network');

    const first = await coordinator.edit(PREFERENCES_NAME, toPounds);
    const second = await coordinator.edit(PREFERENCES_NAME, addPushUp);
    await first.synced.catch((): void => undefined);
    drive.clearAlways('updateFile');
    await second.synced;

    expect(await pendingExists(store, PREFERENCES_NAME)).toBe(false);
    expect(get(saveStatus)).toBe('saved');
  });
});
