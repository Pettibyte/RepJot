// Phase 11 coordinator integration: duplicate consolidation wired into the
// sync path. REQUIREMENTS 4.22 through 4.26, 22.2.10.
//
// These tests drive the real `Coordinator` over `FakeDrive` with a duplicate
// group present, so they prove the wiring and not just the module.

import { describe, expect, test, beforeEach } from 'bun:test';
import { resetDiagnosticLog } from '../src/diagnostics/diagnostic-log';
import { AppError } from '../src/domain/errors';
import type { Session } from '../src/domain/types';
import { saveStatus } from '../src/state/app-state';
import { baseKey, cacheKey, pendingKey } from '../src/storage/local-store';
import { createMemoryLocalStore } from '../src/storage/memory-local-store';
import { createCoordinator, PREFERENCES_NAME, type Coordinator } from '../src/sync/sync-coordinator';
import { get } from 'svelte/store';
import { FakeDrive } from './fakes/fake-drive';
import { frozenTimers, loadedStaticData, SHARD_NAME } from './fixtures/sync';
import { SHARD_MONTH, clone, validSession, validShard } from './fixtures/semantic';
import { preferencesDoc } from './fixtures/merge';

/** A valid session ID for slot `n`. The schema requires a UUID v4 shape. */
function sid(n: number): string {
  const tail = String(n).padStart(12, '0');
  return `session-00000000-0000-4000-8000-${tail}`;
}

/** A second valid session for the fixture month, re-keyed and re-stamped. */
function extraSession(n: number, day: number): Session {
  const candidate = clone(validSession()) as Session & Record<string, unknown>;
  const stamp = `${SHARD_MONTH}-${String(day).padStart(2, '0')}T08:00:00Z`;
  const end = `${SHARD_MONTH}-${String(day).padStart(2, '0')}T08:30:00Z`;
  candidate.id = sid(n);
  candidate.startedAtUtc = stamp;
  candidate.completedAtUtc = end;
  candidate.updatedAtUtc = end;
  return candidate;
}

/** A shard holding one session with the given slot and day. */
function shardWith(n: number, day: number): string {
  const shard = clone(validShard());
  shard.sessions = { [sid(n)]: extraSession(n, day) };
  return JSON.stringify(shard);
}

/** A preferences document with one mapping. */
function prefsWith(units: Record<string, Record<string, string>>, updatedAtUtc: string): string {
  return JSON.stringify(preferencesDoc(units, { updatedAtUtc }));
}

function setup(): {
  store: ReturnType<typeof createMemoryLocalStore>;
  drive: FakeDrive;
  coordinator: Coordinator;
} {
  const store = createMemoryLocalStore();
  const drive = new FakeDrive();
  const coordinator = createCoordinator({
    store,
    drive,
    staticData: loadedStaticData(),
    accountKey: 'acct-phase11',
    pagehideTarget: null,
    timers: frozenTimers().timers
  });
  return { store, drive, coordinator };
}

function deleteCalls(drive: FakeDrive): string[] {
  return drive.calls
    .filter((call: string): boolean => call.startsWith('deleteFile:'))
    .map((call: string): string => call.slice('deleteFile:'.length));
}

beforeEach(() => {
  resetDiagnosticLog();
});

describe('a duplicate shard clears during a normal sync', () => {
  test('ensureLoaded consolidates the group before any write', async () => {
    const { drive, coordinator } = setup();
    const keepId = drive.addFile(SHARD_NAME, shardWith(1, 2), 'a-keep');
    drive.addFile(SHARD_NAME, shardWith(2, 3), 'z-drop');

    const doc = (await coordinator.ensureLoaded(SHARD_NAME)) as {
      sessions: Record<string, unknown>;
    };

    expect(doc.sessions[sid(1)]).toBeDefined();
    expect(doc.sessions[sid(2)]).toBeDefined();
    expect(drive.idsOf(SHARD_NAME)).toEqual([keepId]);
    expect(deleteCalls(drive)).toEqual(['z-drop']);
  });

  test('an edit after a consolidation writes the surviving file', async () => {
    const { drive, coordinator } = setup();
    const keepId = drive.addFile(SHARD_NAME, shardWith(1, 2), 'a-keep');
    drive.addFile(SHARD_NAME, shardWith(2, 3), 'z-drop');

    const handle = await coordinator.edit(SHARD_NAME, (doc: unknown): unknown => {
      const shard = doc as { sessions: Record<string, Session> };
      shard.sessions[sid(30)] = extraSession(30, 20);
      return shard;
    });
    await handle.synced;

    expect(drive.idsOf(SHARD_NAME)).toEqual([keepId]);
    const onDrive = JSON.parse(drive.textOf(SHARD_NAME) ?? '{}') as {
      sessions: Record<string, unknown>;
    };
    expect(onDrive.sessions[sid(1)]).toBeDefined();
    expect(onDrive.sessions[sid(2)]).toBeDefined();
    expect(onDrive.sessions[sid(30)]).toBeDefined();
  });
});

describe('a blocked duplicate group stops its logical file only', () => {
  test('ensureLoaded refuses a blocked shard with duplicate_drive_file', async () => {
    const { drive, coordinator } = setup();
    drive.addFile(SHARD_NAME, shardWith(1, 2), 'a-good');
    drive.addFile(SHARD_NAME, 'not json at all', 'z-corrupt');

    let thrown: AppError | undefined;
    try {
      await coordinator.ensureLoaded(SHARD_NAME);
    } catch (error: unknown) {
      thrown = error instanceof AppError ? error : undefined;
    }

    expect(thrown?.kind).toBe('duplicate_drive_file');
    expect(thrown?.detail.reason).toBe('corrupt_copy');
    expect(thrown?.detail.fileId).toBe('z-corrupt');
    expect(deleteCalls(drive)).toEqual([]);
  });

  test('an edit to a blocked shard fails and keeps the pending delta durable', async () => {
    const { store, drive, coordinator } = setup();
    drive.addFile(SHARD_NAME, shardWith(1, 2), 'a-good');
    drive.addFile(SHARD_NAME, 'not json at all', 'z-corrupt');

    const handle = await coordinator.edit(SHARD_NAME, (doc: unknown): unknown => {
      const shard = doc as { sessions: Record<string, Session> };
      shard.sessions[sid(40)] = extraSession(40, 22);
      return shard;
    });

    // The local write is durable, so `edit` resolved. The sync half fails.
    expect(handle.localDurable).toBe(true);
    await expect(handle.synced).rejects.toBeInstanceOf(AppError);

    const pending = await store.get(pendingKey(SHARD_NAME));
    expect(pending).toBeTruthy();
    const cached = await store.get(cacheKey(SHARD_NAME));
    expect(JSON.stringify(cached)).toContain(sid(40));
    expect(get(saveStatus)).toBe('sync_failed');
    expect(deleteCalls(drive)).toEqual([]);
  });

  test('a blocked shard does not stop a healthy preferences file', async () => {
    const { drive, coordinator } = setup();
    drive.addFile(SHARD_NAME, shardWith(1, 2), 's-good');
    drive.addFile(SHARD_NAME, 'not json at all', 's-corrupt');
    drive.addFile(PREFERENCES_NAME, prefsWith({ 'back-squat': { weight: 'kg' } }, '2026-08-10T00:00:00Z'), 'p-1');
    drive.addFile(PREFERENCES_NAME, prefsWith({ 'push-up': { reps: 'reps' } }, '2026-08-20T00:00:00Z'), 'p-2');

    const prefs = (await coordinator.ensureLoaded(PREFERENCES_NAME)) as {
      exerciseUnits: Record<string, Record<string, string>>;
    };

    expect(prefs.exerciseUnits['back-squat']?.weight).toBe('kg');
    expect(prefs.exerciseUnits['push-up']?.reps).toBe('reps');
    expect(drive.idsOf(PREFERENCES_NAME).length).toBe(1);
    // The blocked shard is still a duplicate pair, untouched.
    expect(drive.idsOf(SHARD_NAME).length).toBe(2);
  });
});

describe('the surviving file ID is recorded locally', () => {
  test('a cached row pointing at a deleted copy is repointed, not dropped', async () => {
    const { store, drive, coordinator } = setup();
    const keepId = drive.addFile(PREFERENCES_NAME, prefsWith({ 'back-squat': { weight: 'kg' } }, '2026-08-10T00:00:00Z'), 'a-keep');
    drive.addFile(PREFERENCES_NAME, prefsWith({ 'push-up': { reps: 'reps' } }, '2026-08-20T00:00:00Z'), 'z-drop');

    await coordinator.ensureLoaded(PREFERENCES_NAME);

    const cached = (await store.get(cacheKey(PREFERENCES_NAME))) as { driveFileId: string };
    expect(cached.driveFileId).toBe(keepId);
    const base = (await store.get(baseKey(PREFERENCES_NAME))) as { driveFileId: string };
    expect(base.driveFileId).toBe(keepId);
  });

  test('F-1: the repointed row carries the primary marker, never the deleted file marker', async () => {
    const { store, drive, coordinator } = setup();
    const dropId = drive.addFile(PREFERENCES_NAME, prefsWith({ 'push-up': { reps: 'reps' } }, '2026-08-20T00:00:00Z'), 'z-drop');

    // Load with only the copy that will be deleted present, so the cached row
    // holds that file's marker.
    await coordinator.ensureLoaded(PREFERENCES_NAME);
    const before = (await store.get(cacheKey(PREFERENCES_NAME))) as {
      driveFileId: string;
      remoteEtag: string;
    };
    expect(before.driveFileId).toBe(dropId);
    const deletedFileMarker = before.remoteEtag;

    // The surviving copy appears with a smaller ID and different content.
    const keepId = drive.addFile(PREFERENCES_NAME, prefsWith({ 'back-squat': { weight: 'kg' } }, '2026-08-10T00:00:00Z'), 'a-keep');
    await coordinator.ensureLoaded(PREFERENCES_NAME);

    const cached = (await store.get(cacheKey(PREFERENCES_NAME))) as {
      driveFileId: string;
      remoteEtag: string;
      contentText: string;
    };
    const primaryNow = drive.files.get(keepId)!;

    expect(cached.driveFileId).toBe(keepId);
    // The marker is the primary's own, read back from the write. It is not
    // the deleted file's marker carried across.
    expect(cached.remoteEtag).not.toBe(deletedFileMarker);
    expect(cached.remoteEtag).toBe(primaryNow.md5 ?? primaryNow.version);

    // The cached content is the consolidated document the primary now holds.
    const cachedUnits = Object.keys(
      (JSON.parse(cached.contentText) as { exerciseUnits: Record<string, unknown> }).exerciseUnits
    ).sort();
    const primaryUnits = Object.keys(
      (JSON.parse(primaryNow.text) as { exerciseUnits: Record<string, unknown> }).exerciseUnits
    ).sort();
    expect(cachedUnits).toEqual(primaryUnits);
    expect(cachedUnits).toEqual(['back-squat', 'push-up']);
  });

  test('F-1: a later load shows the consolidated content, not the deleted copy view', async () => {
    const { drive, coordinator } = setup();
    drive.addFile(PREFERENCES_NAME, prefsWith({ 'push-up': { reps: 'reps' } }, '2026-08-20T00:00:00Z'), 'z-drop');
    drive.addFile(PREFERENCES_NAME, prefsWith({ 'back-squat': { weight: 'kg' } }, '2026-08-10T00:00:00Z'), 'a-keep');

    await coordinator.ensureLoaded(PREFERENCES_NAME);
    const second = (await coordinator.ensureLoaded(PREFERENCES_NAME)) as {
      exerciseUnits: Record<string, unknown>;
    };

    expect(Object.keys(second.exerciseUnits).sort()).toEqual(['back-squat', 'push-up']);
  });

  test('G-1: a pending local edit survives the repoint and reaches Drive', async () => {
    const { store, drive, coordinator } = setup();
    drive.addFile(
      PREFERENCES_NAME,
      prefsWith({ 'back-squat': { weight: 'kg' } }, '2026-08-01T00:00:00Z'),
      'z-drop'
    );
    await coordinator.ensureLoaded(PREFERENCES_NAME);

    // A local edit that cannot upload, so the pending delta stays behind and the
    // cached row holds text Drive has never seen.
    drive.rejectAlways('updateFile', 'network');
    const handle = await coordinator.edit(PREFERENCES_NAME, (doc: unknown): unknown => {
      const prefs = doc as { exerciseUnits: Record<string, Record<string, string>> };
      prefs.exerciseUnits['sit-up'] = { reps: 'reps' };
      return prefs;
    });
    await handle.synced.catch((): undefined => undefined);
    drive.clearAlways('updateFile');

    // The duplicate appears and consolidation deletes the file the cached row
    // points at.
    drive.addFile(
      PREFERENCES_NAME,
      prefsWith({ 'push-up': { reps: 'reps' } }, '2026-08-03T00:00:00Z'),
      'a-keep'
    );
    await coordinator.syncAll();

    // The edit survives locally and lands on Drive on top of the merged content.
    const cached = (await store.get(cacheKey(PREFERENCES_NAME))) as { contentText: string };
    const cachedUnits = Object.keys(
      (JSON.parse(cached.contentText) as { exerciseUnits: Record<string, unknown> }).exerciseUnits
    ).sort();
    expect(cachedUnits).toContain('sit-up');

    const onDrive = JSON.parse(drive.textOf(PREFERENCES_NAME) ?? '{}') as {
      exerciseUnits: Record<string, unknown>;
    };
    expect(Object.keys(onDrive.exerciseUnits).sort()).toEqual(['back-squat', 'push-up', 'sit-up']);
    expect(drive.idsOf(PREFERENCES_NAME).length).toBe(1);
  });
});
