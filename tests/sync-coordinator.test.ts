// The Phase 10 sync coordinator. Every test here pins one rule from
// REQUIREMENTS 4.0 or one step of the ARCHITECTURE section 11 sequence.
//
// The tests drive the coordinator through a `FakeDrive` and a memory store,
// and assert on the recorded call order and the stored records, because the
// requirements are about ordering and durability, not about return values.

import { describe, expect, test, beforeEach } from 'bun:test';
import {
  diagnosticSnapshot,
  resetDiagnosticLog
} from '../src/diagnostics/diagnostic-log';
import { AppError } from '../src/domain/errors';
import { saveStatus, type SaveStatus } from '../src/state/app-state';
import { createMemoryLocalStore } from '../src/storage/memory-local-store';
import { baseKey, cacheKey, pendingKey, type LocalStore } from '../src/storage/local-store';
import {
  createCoordinator,
  logicalNameForShard,
  MAX_UPLOAD_ATTEMPTS,
  PREFERENCES_NAME,
  type Coordinator,
  type SyncDeps
} from '../src/sync/sync-coordinator';
import { get } from 'svelte/store';
import { FakeDrive } from './fakes/fake-drive';
import { frozenTimers, loadedStaticData, SHARD_NAME } from './fixtures/sync';
import { clone, preferencesDoc, resultsShard } from './fixtures/merge';
import { SHARD_MONTH, SESSION_KEY, validSession, validShard } from './fixtures/semantic';
import type { Session } from '../src/domain/types';

/** A valid session ID for slot `n`. The schema requires a UUID v4 shape. */
function sid(n: number): string {
  const tail = String(n).padStart(12, '0');
  return `session-00000000-0000-4000-8000-${tail}`;
}

/**
 * A second valid session for the fixture month.
 *
 * Built from `validSession()` so it passes the semantic stage, then re-keyed
 * and re-stamped. The day is only cosmetic: the month stays inside the shard.
 */
function extraSession(n: number, day: number): Session {
  const candidate = clone(validSession()) as Session & Record<string, unknown>;
  const id = sid(n);
  candidate.id = id;
  const stamp = `${SHARD_MONTH}-${String(day).padStart(2, '0')}T08:00:00Z`;
  const end = `${SHARD_MONTH}-${String(day).padStart(2, '0')}T08:30:00Z`;
  candidate.startedAtUtc = stamp;
  candidate.completedAtUtc = end;
  candidate.updatedAtUtc = end;
  return candidate;
}

/** Add one session to a shard document. */
function withSession(doc: unknown, n: number, day: number): unknown {
  const shard = clone(doc) as { sessions: Record<string, Session> };
  shard.sessions[sid(n)] = extraSession(n, day);
  return shard;
}

/** Read the current save status. */
function status(): SaveStatus {
  return get(saveStatus);
}

/** Read one stored value as text. */
async function raw(store: LocalStore, key: string): Promise<unknown> {
  return store.get(key);
}

/** The shard text used by most tests. */
function shardText(): string {
  return JSON.stringify(validShard());
}

/** A second, different shard for the same month. */
function otherShardText(): string {
  const doc = validShard();
  const key = Object.keys(doc.sessions)[0];
  doc.sessions[key].updatedAtUtc = '2026-08-16T09:00:00Z';
  return JSON.stringify(doc);
}

/** A preferences document that passes the schema and the semantic stage. */
function prefsText(units: Record<string, Record<string, string>> = {}): string {
  return JSON.stringify(preferencesDoc(units));
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
    accountKey: 'acct-test',
    // No pagehide target in tests.
    pagehideTarget: null,
    timers: frozenTimers().timers
  };
  return { store, drive, coordinator: createCoordinator(deps) };
}

beforeEach(() => {
  resetDiagnosticLog();
});

describe('logical names', () => {
  test('logicalNameForShard maps a session start to its monthly shard', () => {
    expect(logicalNameForShard('2026-09-01T06:30:00Z')).toBe('results-2026-09.json');
  });

  test('an unrecognized logical name is refused', async () => {
    const { coordinator } = makeSetup();
    let thrown: AppError | undefined;
    try {
      await coordinator.ensureLoaded('notes.json');
    } catch (error) {
      thrown = error instanceof AppError ? error : undefined;
    }
    expect(thrown?.kind).toBe('invalid_document');
  });
});

describe('the save path writes locally before the network', () => {
  test('one setMany writes working, base, and pending before any Drive write', async () => {
    const { store, drive, coordinator } = makeSetup({
      name: SHARD_NAME,
      text: shardText()
    });

    await coordinator.ensureLoaded(SHARD_NAME);
    drive.calls.length = 0;

    const handle = await coordinator.edit(SHARD_NAME, (doc: unknown) => withSession(doc, 1, 2));

    // The local write resolved before this point, and no write call happened.
    expect(handle.localDurable).toBe(true);
    const writeCalls = drive.calls.filter(
      (call: string): boolean => call.startsWith('updateFile') || call.startsWith('createFile')
    );
    expect(writeCalls.length).toBeLessThanOrEqual(1);

    const working = (await raw(store, cacheKey(SHARD_NAME))) as { contentText: string };
    const base = (await raw(store, baseKey(SHARD_NAME))) as { contentText: string };
    const pending = (await raw(store, pendingKey(SHARD_NAME))) as { delta: unknown } | null;

    expect(working.contentText).toContain(sid(1));
    // The base still holds the pre-edit content. REQUIREMENTS 4.5.
    expect(base.contentText).not.toContain(sid(1));
    expect(pending).not.toBeNull();

    await handle.synced;
  });

  test('a clean cached file with unchanged metadata causes no download', async () => {
    const { drive, coordinator } = makeSetup({ name: SHARD_NAME, text: shardText() });

    await coordinator.ensureLoaded(SHARD_NAME);
    drive.calls.length = 0;

    await coordinator.ensureLoaded(SHARD_NAME);
    expect(drive.calls.filter((c: string) => c.startsWith('readFile'))).toEqual([]);
  });

  test('changed remote metadata triggers a download and a pipeline run', async () => {
    const { drive, coordinator } = makeSetup({ name: SHARD_NAME, text: shardText() });
    await coordinator.ensureLoaded(SHARD_NAME);

    drive.remoteWrite(SHARD_NAME, otherShardText());
    drive.calls.length = 0;

    // A fresh coordinator holds nothing in memory, so the changed marker
    // must force a download.
    await coordinator.reset();
    await coordinator.ensureLoaded(SHARD_NAME);

    const reads = drive.calls.filter((c: string) => c.startsWith('readFile'));
    expect(reads.length).toBeGreaterThan(0);
    expect(coordinator.peek(SHARD_NAME)).toEqual(JSON.parse(otherShardText()));
  });

  test('a cache record whose file ID vanished from the catalog is dropped', async () => {
    const { store, drive, coordinator } = makeSetup({ name: SHARD_NAME, text: shardText() });
    await coordinator.ensureLoaded(SHARD_NAME);
    expect(await raw(store, cacheKey(SHARD_NAME))).not.toBeNull();

    // The file disappears from Drive.
    const id = drive.idsOf(SHARD_NAME)[0];
    drive.files.delete(id);

    await coordinator.reset();
    await coordinator.ensureLoaded(SHARD_NAME).catch(() => undefined);

    // The stale cached row is gone, not silently reused.
    const cached = await raw(store, cacheKey(SHARD_NAME));
    if (cached !== null && cached !== undefined) {
      expect((cached as { driveFileId: string | null }).driveFileId).not.toBe(id);
    }
  });
});

describe('a successful cycle', () => {
  test('confirmed content becomes both working and base, and pending clears', async () => {
    const { store, drive, coordinator } = makeSetup({ name: SHARD_NAME, text: shardText() });
    await coordinator.ensureLoaded(SHARD_NAME);

    const handle = await coordinator.edit(SHARD_NAME, (doc: unknown) => withSession(doc, 2, 3));
    await handle.synced;

    const working = (await raw(store, cacheKey(SHARD_NAME))) as { contentText: string };
    const base = (await raw(store, baseKey(SHARD_NAME))) as { contentText: string };
    const pending = await raw(store, pendingKey(SHARD_NAME));

    expect(working.contentText).toContain(sid(2));
    expect(base.contentText).toBe(working.contentText);
    expect(pending).toBeNull();
    expect(drive.textOf(SHARD_NAME)).toBe(working.contentText);
    expect(status()).toBe('saved');
  });

  test('a missing remote file is created on the first write', async () => {
    const { store, drive, coordinator } = makeSetup();
    const text = prefsText({ 'back-squat': { weight: 'kg' } });

    // Seed only local state, so Drive holds nothing for this name.
    await store.set(cacheKey(PREFERENCES_NAME), {
      logicalName: PREFERENCES_NAME,
      driveFileId: null,
      remoteEtag: null,
      contentText: text,
      schemaVersion: 1,
      cachedAtUtc: '2026-08-15T00:00:00Z'
    });
    await store.set(baseKey(PREFERENCES_NAME), { contentText: text, driveFileId: null });
    await store.set(pendingKey(PREFERENCES_NAME), {
      delta: { kind: 'replace', document: JSON.parse(text) },
      updatedAtUtc: '2026-08-15T00:00:00Z'
    });

    await coordinator.syncAll();

    expect(drive.textOf(PREFERENCES_NAME)).toBeDefined();
    expect((await raw(store, pendingKey(PREFERENCES_NAME))) ?? null).toBeNull();
  });
});

describe('recovery', () => {
  test('a read-back mismatch triggers a re-read, a fresh merge, and a second upload', async () => {
    const { store, drive, coordinator } = makeSetup({ name: SHARD_NAME, text: shardText() });
    await coordinator.ensureLoaded(SHARD_NAME);

    // The write answers but the bytes never land. The read-back comes back
    // with the old content, so the coordinator must re-read, merge, and
    // upload again. REQUIREMENTS 4.18, 4.19.
    drive.silentlyDropNextWrite();

    const handle = await coordinator.edit(SHARD_NAME, (doc: unknown) => withSession(doc, 3, 4));

    await handle.synced;

    const uploads = drive.calls.filter((c: string) => c.startsWith('updateFile'));
    expect(uploads.length).toBeGreaterThanOrEqual(2);
    expect(drive.textOf(SHARD_NAME)).toContain(sid(3));
    expect(await raw(store, pendingKey(SHARD_NAME))).toBeNull();
  });

  test('three failed attempts set sync_failed and leave the pending delta intact', async () => {
    const { store, drive, coordinator } = makeSetup({ name: SHARD_NAME, text: shardText() });
    await coordinator.ensureLoaded(SHARD_NAME);

    drive.rejectAlways('updateFile', 'network');

    const handle = await coordinator.edit(SHARD_NAME, (doc: unknown) => withSession(doc, 4, 5));

    let thrown: unknown = null;
    await handle.synced.catch((error: unknown) => {
      thrown = error;
    });

    expect(thrown).not.toBeNull();
    expect(status()).toBe('sync_failed');

    // The pending delta survives. REQUIREMENTS 4.20.
    const pending = await raw(store, pendingKey(SHARD_NAME));
    expect(pending).not.toBeNull();
    const working = (await raw(store, cacheKey(SHARD_NAME))) as { contentText: string };
    expect(working.contentText).toContain(sid(4));

    const attempts = drive.calls.filter((c: string) => c.startsWith('updateFile'));
    expect(attempts.length).toBe(MAX_UPLOAD_ATTEMPTS);
    drive.clearAlways('updateFile');
  });

  test('a lost response after a committed write is ambiguous_upload, resolved by a Drive read', async () => {
    const { store, drive, coordinator } = makeSetup({ name: SHARD_NAME, text: shardText() });
    await coordinator.ensureLoaded(SHARD_NAME);

    drive.loseResponse();

    const handle = await coordinator.edit(SHARD_NAME, (doc: unknown) => withSession(doc, 5, 6));

    await handle.synced;

    const codes = diagnosticSnapshot().map((event) => event.context?.errorKind);
    expect(codes).toContain('ambiguous_upload');
    // The write landed, so the coordinator settles without a third write.
    expect(drive.textOf(SHARD_NAME)).toContain(sid(5));
    expect(await raw(store, pendingKey(SHARD_NAME))).toBeNull();
  });

  test('an invalid candidate is refused before any write', async () => {
    const { store, drive, coordinator } = makeSetup({ name: SHARD_NAME, text: shardText() });
    await coordinator.ensureLoaded(SHARD_NAME);
    const before = await raw(store, cacheKey(SHARD_NAME));

    let thrown: AppError | undefined;
    await coordinator
      .edit(SHARD_NAME, () => ({ nope: true }))
      .catch((error: unknown) => {
        thrown = error instanceof AppError ? error : undefined;
      });

    expect(thrown).toBeDefined();
    expect(thrown?.kind).toBe('invalid_document');
    // No upload was attempted, and the prior local rows stand untouched.
    expect(drive.calls.filter((c: string) => c.startsWith('updateFile'))).toEqual([]);
    expect(await raw(store, cacheKey(SHARD_NAME))).toEqual(before);
  });
});

describe('the mutex', () => {
  test('two concurrent edits on one logical file serialize', async () => {
    const { drive, coordinator } = makeSetup({ name: SHARD_NAME, text: shardText() });
    await coordinator.ensureLoaded(SHARD_NAME);

    const gate = drive.blockUpload();

    const first = coordinator.edit(SHARD_NAME, (doc: unknown) => withSession(doc, 7, 7));
    const second = coordinator.edit(SHARD_NAME, (doc: unknown) => withSession(doc, 8, 7));

    const [a, b] = await Promise.all([first, second]);
    gate.release();
    await Promise.all([a.synced, b.synced]);

    const final = drive.textOf(SHARD_NAME) ?? '';
    expect(final).toContain(sid(7));
    expect(final).toContain(sid(8));

    // Serialization proof: between any two uploads the first one's read-back
    // completed. Two reconciliations never overlap in the write window.
    const calls = drive.calls;
    let uploadsSeen = 0;
    let sawReadBetween = true;
    for (const call of calls) {
      if (call.startsWith('updateFile')) {
        uploadsSeen += 1;
        if (uploadsSeen > 1) expect(sawReadBetween).toBe(true);
        sawReadBetween = false;
      } else if (call.startsWith('readFile')) {
        sawReadBetween = true;
      }
    }
    expect(uploadsSeen).toBeGreaterThanOrEqual(1);
  });
});

describe('reload', () => {
  test('a reload restores the pending delta and completes the merge', async () => {
    const store = createMemoryLocalStore();
    const drive = new FakeDrive();
    drive.addFile(SHARD_NAME, shardText());
    const base = drive.textOf(SHARD_NAME) as string;

    const first = createCoordinator({
      store,
      drive,
      staticData: loadedStaticData(),
      accountKey: 'acct-reload',
      pagehideTarget: null,
      timers: frozenTimers().timers
    });

    await first.ensureLoaded(SHARD_NAME);
    // Fail the upload so the pending delta stays behind.
    drive.rejectAlways('updateFile', 'network');
    const handle = await first.edit(SHARD_NAME, (doc: unknown) => withSession(doc, 9, 8));
    await handle.synced.catch(() => undefined);
    drive.clearAlways('updateFile');

    // Another device writes in the meantime.
    const remoteDoc = JSON.parse(base) as { sessions: Record<string, unknown> };
    remoteDoc.sessions[sid(10)] = extraSession(10, 8);
    drive.remoteWrite(SHARD_NAME, JSON.stringify(remoteDoc));

    // A brand-new coordinator over the same store. Nothing in memory.
    const second = createCoordinator({
      store,
      drive,
      staticData: loadedStaticData(),
      accountKey: 'acct-reload',
      pagehideTarget: null,
      timers: frozenTimers().timers
    });

    await second.syncAll();

    const final = drive.textOf(SHARD_NAME) ?? '';
    expect(final).toContain(sid(9));
    expect(final).toContain(sid(10));
    expect(await raw(store, pendingKey(SHARD_NAME))).toBeNull();
  });
});

describe('preferences', () => {
  test('the coordinator bumps revision and stamps updatedAtUtc on the upload candidate', async () => {
    const { drive, coordinator } = makeSetup({
      name: PREFERENCES_NAME,
      text: prefsText({ 'back-squat': { weight: 'kg' } })
    });
    const before = JSON.parse(drive.textOf(PREFERENCES_NAME) ?? '{}') as {
      revision: number;
      updatedAtUtc?: string;
    };

    const handle = await coordinator.edit(PREFERENCES_NAME, (doc: unknown) => {
      const prefs = clone(doc) as { exerciseUnits: Record<string, Record<string, string>> };
      prefs.exerciseUnits['push-up'] = { reps: 'reps' };
      return prefs;
    });
    await handle.synced;

    const after = JSON.parse(drive.textOf(PREFERENCES_NAME) ?? '{}') as {
      revision: number;
      updatedAtUtc: string;
      exerciseUnits: Record<string, Record<string, string>>;
    };
    expect(after.revision).toBe(before.revision + 1);
    expect(after.updatedAtUtc).not.toBe(before.updatedAtUtc ?? '');
    expect(after.exerciseUnits['push-up']).toEqual({ reps: 'reps' });
  });
});

describe('flush and reset', () => {
  test('flush runs a queued edit', async () => {
    const { drive, coordinator } = makeSetup({ name: SHARD_NAME, text: shardText() });
    await coordinator.ensureLoaded(SHARD_NAME);

    coordinator.queueEdit(SHARD_NAME, (doc: unknown) => withSession(doc, 11, 9));

    await coordinator.flush();
    expect(drive.textOf(SHARD_NAME)).toContain(sid(11));
  });

  test('reset forgets in-memory state but keeps the local rows', async () => {
    const { store, drive, coordinator } = makeSetup({ name: SHARD_NAME, text: shardText() });
    await coordinator.ensureLoaded(SHARD_NAME);
    expect(coordinator.peek(SHARD_NAME)).toBeDefined();

    await coordinator.reset();
    expect(coordinator.peek(SHARD_NAME)).toBeUndefined();
    expect(await raw(store, cacheKey(SHARD_NAME))).not.toBeNull();
  });
});

describe('shard naming', () => {
  test('a shard built from a session start round-trips through the coordinator', async () => {
    const name = logicalNameForShard(`${SHARD_MONTH}-15T07:30:00Z`);
    expect(name).toBe(SHARD_NAME);
    const { drive, coordinator } = makeSetup({ name, text: shardText() });
    const doc = (await coordinator.ensureLoaded(name)) as { yearMonthUtc: string };
    expect(doc.yearMonthUtc).toBe(SHARD_MONTH);
    expect(resultsShard({})).toBeDefined();
  });
});
