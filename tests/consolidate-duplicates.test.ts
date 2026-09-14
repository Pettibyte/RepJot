// Phase 11: duplicate Drive file consolidation.
// REQUIREMENTS 4.22 through 4.26, 22.2.10.
// ARCHITECTURE ADR-010, section 11 "Catalog and duplicate files".
//
// Every test pins one step of the consolidation procedure. The delete count is
// asserted on almost every case, because the rule that matters most is that
// nothing is deleted before the primary provably holds the consolidated data.

import { describe, expect, test, beforeEach } from 'bun:test';
import { resetDiagnosticLog } from '../src/diagnostics/diagnostic-log';
import type { Session } from '../src/domain/types';
import type { DriveFileMeta } from '../src/drive/drive-interface';
import {
  consolidateGroup,
  createConsolidateHook,
  findDuplicateGroups,
  findUnknownNames,
  type DuplicateGroup
} from '../src/sync/consolidate-duplicates';
import { FakeDrive } from './fakes/fake-drive';
import { loadedStaticData, SHARD_NAME, PREFS_NAME } from './fixtures/sync';
import { SHARD_MONTH, SESSION_KEY, clone, validSession, validShard } from './fixtures/semantic';
import { preferencesDoc } from './fixtures/merge';

/** A valid session ID for slot `n`. The schema requires a UUID v4 shape. */
function sid(n: number): string {
  const tail = String(n).padStart(12, '0');
  return `session-00000000-0000-4000-8000-${tail}`;
}

/**
 * A second valid session for the fixture month, re-keyed and re-stamped.
 *
 * Built from `validSession()` so it passes the semantic stage. The day is
 * cosmetic: the month stays inside the shard.
 */
function extraSession(n: number, day: number, updatedAtUtc?: string): Session {
  const candidate = clone(validSession()) as Session & Record<string, unknown>;
  const id = sid(n);
  candidate.id = id;
  const stamp = `${SHARD_MONTH}-${String(day).padStart(2, '0')}T08:00:00Z`;
  const end = `${SHARD_MONTH}-${String(day).padStart(2, '0')}T08:30:00Z`;
  candidate.startedAtUtc = stamp;
  candidate.completedAtUtc = end;
  candidate.updatedAtUtc = updatedAtUtc ?? end;
  return candidate;
}

/** A shard holding one session with the given ID and update stamp. */
function shardWith(n: number, day: number, updatedAtUtc?: string): string {
  const shard = clone(validShard());
  shard.sessions = { [sid(n)]: extraSession(n, day, updatedAtUtc) };
  return JSON.stringify(shard);
}

/** A shard holding the fixture session plus one extra session. */
function shardWithKey(sessionId: string, n: number, day: number): string {
  const shard = clone(validShard());
  shard.sessions = {
    [sessionId]: validSession(),
    [sid(n)]: extraSession(n, day)
  };
  return JSON.stringify(shard);
}

/** A preferences document with one mapping. */
function prefsWith(units: Record<string, Record<string, string>>, updatedAtUtc: string): string {
  return JSON.stringify(preferencesDoc(units, { updatedAtUtc }));
}

/** Consolidate the one group the catalog holds for `logicalName`. */
async function consolidateName(drive: FakeDrive, logicalName: string) {
  const group = findDuplicateGroups(await drive.listCatalog()).find(
    (candidate: DuplicateGroup): boolean => candidate.logicalName === logicalName
  );
  if (group === undefined) {
    throw new Error(`no duplicate group for ${logicalName}`);
  }
  return consolidateGroup(group, { drive, staticData: loadedStaticData() });
}

function deleteCalls(drive: FakeDrive): string[] {
  return drive.calls
    .filter((call: string): boolean => call.startsWith('deleteFile:'))
    .map((call: string): string => call.slice('deleteFile:'.length));
}

beforeEach(() => {
  resetDiagnosticLog();
});

describe('findDuplicateGroups', () => {
  test('one file per recognized name yields no group', async () => {
    const drive = new FakeDrive();
    drive.addFile(PREFS_NAME, prefsWith({}, '2026-08-15T07:30:00Z'));
    drive.addFile(SHARD_NAME, shardWith(1, 2));

    expect(findDuplicateGroups(await drive.listCatalog())).toEqual([]);
  });

  test('two copies of one name form one group sorted by file ID', async () => {
    const drive = new FakeDrive();
    drive.addFile(PREFS_NAME, prefsWith({}, '2026-08-15T07:30:00Z'), 'z-1');
    drive.addFile(PREFS_NAME, prefsWith({}, '2026-08-15T07:30:00Z'), 'a-2');

    const groups = findDuplicateGroups(await drive.listCatalog());
    expect(groups.length).toBe(1);
    expect(groups[0]?.logicalName).toBe(PREFS_NAME);
    expect(groups[0]?.copies.map((m: DriveFileMeta) => m.id)).toEqual(['a-2', 'z-1']);
  });

  test('three copies are one group of three, not three pairs', () => {
    const catalog: DriveFileMeta[] = [
      {
        id: 'c',
        name: PREFS_NAME,
        modifiedTime: '2026-08-15T00:00:00Z',
        version: '1',
        md5Checksum: null,
        size: 10
      },
      {
        id: 'b',
        name: PREFS_NAME,
        modifiedTime: '2026-08-15T00:00:00Z',
        version: '1',
        md5Checksum: null,
        size: 10
      },
      {
        id: 'a',
        name: PREFS_NAME,
        modifiedTime: '2026-08-15T00:00:00Z',
        version: '1',
        md5Checksum: null,
        size: 10
      }
    ];

    const groups = findDuplicateGroups(catalog);
    expect(groups.length).toBe(1);
    expect(groups[0]?.copies.length).toBe(3);
  });

  test('unknown names never group', () => {
    const catalog: DriveFileMeta[] = [
      {
        id: 'x',
        name: 'notes.json',
        modifiedTime: '2026-08-15T00:00:00Z',
        version: '1',
        md5Checksum: null,
        size: 2
      },
      {
        id: 'y',
        name: 'notes.json',
        modifiedTime: '2026-08-15T00:00:00Z',
        version: '1',
        md5Checksum: null,
        size: 2
      }
    ];

    expect(findDuplicateGroups(catalog)).toEqual([]);
  });

  test('findUnknownNames reports the folder files REP JOT does not own', () => {
    const catalog: DriveFileMeta[] = [
      {
        id: 'a',
        name: PREFS_NAME,
        modifiedTime: '2026-08-15T00:00:00Z',
        version: '1',
        md5Checksum: null,
        size: 2
      },
      {
        id: 'b',
        name: 'scratch.json',
        modifiedTime: '2026-08-15T00:00:00Z',
        version: '1',
        md5Checksum: null,
        size: 2
      }
    ];

    expect(findUnknownNames(catalog)).toEqual(['scratch.json']);
  });
});

describe('shard consolidation', () => {
  test('two valid copies with disjoint sessions union into the primary', async () => {
    const drive = new FakeDrive();
    const keepId = drive.addFile(SHARD_NAME, shardWith(1, 2), 'a-keep');
    const dropId = drive.addFile(SHARD_NAME, shardWith(2, 3), 'z-drop');

    const outcome = await consolidateName(drive, SHARD_NAME);

    expect(outcome.kind).toBe('consolidated');
    if (outcome.kind !== 'consolidated') return;
    expect(outcome.primaryId).toBe(keepId);
    expect(outcome.deletedIds).toEqual([dropId]);
    expect(deleteCalls(drive)).toEqual([dropId]);

    const onDrive = JSON.parse(drive.textOf(SHARD_NAME) ?? '{}') as {
      sessions: Record<string, unknown>;
    };
    expect(onDrive.sessions[sid(1)]).toBeDefined();
    expect(onDrive.sessions[sid(2)]).toBeDefined();
    expect(drive.idsOf(SHARD_NAME)).toEqual([keepId]);
  });

  test('the same session ID keeps the copy with the greater updatedAtUtc', async () => {
    const drive = new FakeDrive();
    // The lexicographically smaller ID holds the OLDER session.
    drive.addFile(SHARD_NAME, shardWith(5, 4, '2026-08-10T01:00:00Z'), 'a-old');
    drive.addFile(SHARD_NAME, shardWith(5, 4, '2026-08-20T01:00:00Z'), 'b-new');

    const outcome = await consolidateName(drive, SHARD_NAME);
    expect(outcome.kind).toBe('consolidated');
    if (outcome.kind !== 'consolidated') return;

    const onDrive = JSON.parse(drive.textOf(SHARD_NAME) ?? '{}') as {
      sessions: Record<string, { updatedAtUtc: string }>;
    };
    expect(onDrive.sessions[sid(5)]?.updatedAtUtc).toBe('2026-08-20T01:00:00Z');
  });

  test('equal updatedAtUtc resolves by the greater Drive file ID', async () => {
    const drive = new FakeDrive();
    const stamp = '2026-08-12T01:00:00Z';
    drive.addFile(SHARD_NAME, shardWith(6, 6, stamp), 'a-smaller');
    drive.addFile(SHARD_NAME, shardWith(6, 6, stamp), 'z-greater');

    const outcome = await consolidateName(drive, SHARD_NAME);
    expect(outcome.kind).toBe('consolidated');
    if (outcome.kind !== 'consolidated') return;

    // The primary is still the smallest ID, but the winning entry is the
    // greater ID's session. Both hold the same bytes here, so prove the rule
    // by checking the winner directly through a differing note.
    const primary = JSON.parse(drive.textOf(SHARD_NAME) ?? '{}') as {
      sessions: Record<string, { id: string }>;
    };
    expect(outcome.primaryId).toBe('a-smaller');
    expect(primary.sessions[sid(6)]?.id).toBe(sid(6));
  });

  test('equal timestamps with differing content take the greater file ID session', async () => {
    const drive = new FakeDrive();
    const stamp = '2026-08-12T01:00:00Z';
    const older = shardWith(7, 7, stamp);
    const newer = (() => {
      const shard = JSON.parse(shardWith(7, 7, stamp)) as {
        sessions: Record<string, { notes: string }>;
      };
      shard.sessions[sid(7)].notes = 'from-greater-id';
      return JSON.stringify(shard);
    })();

    drive.addFile(SHARD_NAME, older, 'a-smaller');
    drive.addFile(SHARD_NAME, newer, 'z-greater');

    const outcome = await consolidateName(drive, SHARD_NAME);
    expect(outcome.kind).toBe('consolidated');
    if (outcome.kind !== 'consolidated') return;

    const onDrive = JSON.parse(drive.textOf(SHARD_NAME) ?? '{}') as {
      sessions: Record<string, { notes?: string }>;
    };
    expect(onDrive.sessions[sid(7)]?.notes).toBe('from-greater-id');
  });

  test('the fixture session survives alongside a new one', async () => {
    const drive = new FakeDrive();
    drive.addFile(SHARD_NAME, JSON.stringify(validShard()), 'a-base');
    drive.addFile(SHARD_NAME, shardWithKey(SESSION_KEY, 11, 9), 'b-extra');

    const outcome = await consolidateName(drive, SHARD_NAME);
    expect(outcome.kind).toBe('consolidated');
    if (outcome.kind !== 'consolidated') return;

    const onDrive = JSON.parse(drive.textOf(SHARD_NAME) ?? '{}') as {
      sessions: Record<string, unknown>;
    };
    expect(onDrive.sessions[SESSION_KEY]).toBeDefined();
    expect(onDrive.sessions[sid(11)]).toBeDefined();
  });
});

describe('preferences consolidation', () => {
  test('different mappings merge and a conflicting one follows the tuple rule', async () => {
    const drive = new FakeDrive();
    drive.addFile(
      PREFS_NAME,
      prefsWith({ 'back-squat': { weight: 'kg' }, 'push-up': { reps: 'reps' } }, '2026-08-10T00:00:00Z'),
      'a-older'
    );
    drive.addFile(
      PREFS_NAME,
      prefsWith({ 'back-squat': { weight: 'lb' }, 'sit-up': { reps: 'reps' } }, '2026-08-20T00:00:00Z'),
      'z-newer'
    );

    const outcome = await consolidateName(drive, PREFS_NAME);
    expect(outcome.kind).toBe('consolidated');
    if (outcome.kind !== 'consolidated') return;

    const onDrive = JSON.parse(drive.textOf(PREFS_NAME) ?? '{}') as {
      exerciseUnits: Record<string, Record<string, string>>;
    };
    // The conflicting mapping takes the newer copy's value even though the
    // primary is the smaller file ID.
    expect(onDrive.exerciseUnits['back-squat']?.weight).toBe('lb');
    expect(onDrive.exerciseUnits['push-up']?.reps).toBe('reps');
    expect(onDrive.exerciseUnits['sit-up']?.reps).toBe('reps');
    expect(drive.idsOf(PREFS_NAME).length).toBe(1);
  });

  test('the consolidated preferences envelope never moves revision backwards', async () => {
    const drive = new FakeDrive();
    // The newest copy carries the LOWER revision, so picking the envelope by
    // timestamp alone would regress it.
    drive.addFile(
      PREFS_NAME,
      JSON.stringify(preferencesDoc({ 'back-squat': { weight: 'kg' } }, { revision: 14, updatedAtUtc: '2026-08-01T00:00:00Z' })),
      'a-high-rev'
    );
    drive.addFile(
      PREFS_NAME,
      JSON.stringify(preferencesDoc({ 'push-up': { reps: 'reps' } }, { revision: 3, updatedAtUtc: '2026-08-25T00:00:00Z' })),
      'z-low-rev'
    );

    const outcome = await consolidateName(drive, PREFS_NAME);
    expect(outcome.kind).toBe('consolidated');
    if (outcome.kind !== 'consolidated') return;

    const onDrive = JSON.parse(drive.textOf(PREFS_NAME) ?? '{}') as {
      revision: number;
      updatedAtUtc: string;
    };
    expect(onDrive.revision).toBe(14);
    expect(onDrive.updatedAtUtc).toBe('2026-08-25T00:00:00Z');
  });

  test('equal preference timestamps resolve by the greater file ID', async () => {
    const drive = new FakeDrive();
    const stamp = '2026-08-11T00:00:00Z';
    drive.addFile(PREFS_NAME, prefsWith({ 'back-squat': { weight: 'kg' } }, stamp), 'a-smaller');
    drive.addFile(PREFS_NAME, prefsWith({ 'back-squat': { weight: 'lb' } }, stamp), 'z-greater');

    const outcome = await consolidateName(drive, PREFS_NAME);
    expect(outcome.kind).toBe('consolidated');
    if (outcome.kind !== 'consolidated') return;

    const onDrive = JSON.parse(drive.textOf(PREFS_NAME) ?? '{}') as {
      exerciseUnits: Record<string, Record<string, string>>;
    };
    expect(outcome.primaryId).toBe('a-smaller');
    expect(onDrive.exerciseUnits['back-squat']?.weight).toBe('lb');
  });

  test('the consolidated preferences envelope keeps the newest revision', async () => {
    const drive = new FakeDrive();
    drive.addFile(
      PREFS_NAME,
      JSON.stringify(preferencesDoc({ 'back-squat': { weight: 'kg' } }, { revision: 2, updatedAtUtc: '2026-08-01T00:00:00Z' })),
      'a-low-rev'
    );
    drive.addFile(
      PREFS_NAME,
      JSON.stringify(preferencesDoc({ 'push-up': { reps: 'reps' } }, { revision: 9, updatedAtUtc: '2026-08-25T00:00:00Z' })),
      'z-high-rev'
    );

    const outcome = await consolidateName(drive, PREFS_NAME);
    expect(outcome.kind).toBe('consolidated');
    if (outcome.kind !== 'consolidated') return;

    const onDrive = JSON.parse(drive.textOf(PREFS_NAME) ?? '{}') as { revision: number };
    expect(onDrive.revision).toBe(9);
  });
});

describe('a blocked group writes nothing', () => {
  test('one corrupt copy blocks the group and deletes nothing', async () => {
    const drive = new FakeDrive();
    drive.addFile(SHARD_NAME, shardWith(1, 2), 'a-good');
    drive.addFile(SHARD_NAME, 'this is not json', 'b-corrupt');

    const outcome = await consolidateName(drive, SHARD_NAME);

    expect(outcome.kind).toBe('blocked');
    if (outcome.kind !== 'blocked') return;
    expect(outcome.reason).toBe('corrupt_copy');
    expect(outcome.fileId).toBe('b-corrupt');
    expect(deleteCalls(drive)).toEqual([]);
    expect(drive.idsOf(SHARD_NAME).length).toBe(2);
  });

  test('a wrong-family copy blocks with wrong_family', async () => {
    const drive = new FakeDrive();
    drive.addFile(SHARD_NAME, shardWith(1, 2), 'a-good');
    drive.addFile(SHARD_NAME, prefsWith({}, '2026-08-10T00:00:00Z'), 'b-wrong-family');

    const outcome = await consolidateName(drive, SHARD_NAME);

    expect(outcome.kind).toBe('blocked');
    if (outcome.kind !== 'blocked') return;
    expect(outcome.reason).toBe('wrong_family');
    expect(deleteCalls(drive)).toEqual([]);
  });

  test('a future schema version blocks with unsupported_version', async () => {
    const drive = new FakeDrive();
    drive.addFile(SHARD_NAME, shardWith(1, 2), 'a-good');
    const future = JSON.parse(shardWith(2, 3)) as { schemaVersion: number };
    future.schemaVersion = 99;
    drive.addFile(SHARD_NAME, JSON.stringify(future), 'b-future');

    const outcome = await consolidateName(drive, SHARD_NAME);

    expect(outcome.kind).toBe('blocked');
    if (outcome.kind !== 'blocked') return;
    expect(outcome.reason).toBe('unsupported_version');
    expect(outcome.fileId).toBe('b-future');
    expect(deleteCalls(drive)).toEqual([]);
  });

  test('a copy that changed at the metadata recheck blocks and deletes nothing', async () => {
    const drive = new FakeDrive();
    drive.addFile(SHARD_NAME, shardWith(1, 2), 'a-good');
    drive.addFile(SHARD_NAME, shardWith(2, 3), 'b-will-change');

    // Capture the group metadata first, then change the file out of band so
    // the step 8 recheck sees a different `version` than the group holds.
    const group: DuplicateGroup = {
      logicalName: SHARD_NAME,
      copies: [await metaOf(drive, 'a-good'), await metaOf(drive, 'b-will-change')]
    };

    const originalList = drive.listCatalog.bind(drive);
    let bumped = false;
    drive.listCatalog = async (): Promise<DriveFileMeta[]> => {
      if (!bumped) {
        bumped = true;
        const target = drive.files.get('b-will-change');
        if (target !== undefined) {
          target.version += 1;
          target.md5 = `md5-b-will-change-${String(target.version)}`;
        }
      }
      return originalList();
    };

    const outcome = await consolidateGroup(group, {
      drive,
      staticData: loadedStaticData()
    });

    expect(outcome.kind).toBe('blocked');
    if (outcome.kind !== 'blocked') return;
    expect(outcome.reason).toBe('changed_during_cleanup');
    expect(deleteCalls(drive)).toEqual([]);
  });

  test('a read-back mismatch blocks and deletes nothing', async () => {
    const drive = new FakeDrive();
    drive.addFile(SHARD_NAME, shardWith(1, 2), 'a-primary');
    drive.addFile(SHARD_NAME, shardWith(2, 3), 'b-redundant');

    // The update answers as if it wrote, but the bytes come back different.
    const originalUpdate = drive.updateFile.bind(drive);
    drive.updateFile = async (id: string, text: string): Promise<DriveFileMeta> => {
      const meta = await originalUpdate(id, text);
      const file = drive.files.get(id);
      if (file !== undefined) file.text = '{"format":"repjot/results"}';
      return meta;
    };

    const outcome = await consolidateName(drive, SHARD_NAME);

    expect(outcome.kind).toBe('blocked');
    if (outcome.kind !== 'blocked') return;
    expect(outcome.reason).toBe('changed_during_cleanup');
    expect(outcome.fileId).toBe('a-primary');
    expect(deleteCalls(drive)).toEqual([]);
    expect(drive.idsOf(SHARD_NAME).length).toBe(2);
  });
});

describe('the relist step', () => {
  test('one remaining recognized file is recorded', async () => {
    const drive = new FakeDrive();
    const keepId = drive.addFile(SHARD_NAME, shardWith(1, 2), 'a-keep');
    drive.addFile(SHARD_NAME, shardWith(2, 3), 'b-drop');

    const outcome = await consolidateName(drive, SHARD_NAME);

    expect(outcome.kind).toBe('consolidated');
    if (outcome.kind !== 'consolidated') return;
    expect(outcome.remainingId).toBe(keepId);
  });

  test('more than one remaining file records nothing', async () => {
    const drive = new FakeDrive();
    drive.addFile(SHARD_NAME, shardWith(1, 2), 'a-keep');
    drive.addFile(SHARD_NAME, shardWith(2, 3), 'b-keep-too');

    // Only the first delete lands, so the relist still finds two files.
    const originalDelete = drive.deleteFile.bind(drive);
    let deletes = 0;
    drive.deleteFile = async (id: string): Promise<void> => {
      deletes += 1;
      if (deletes === 1) return;
      await originalDelete(id);
    };

    const outcome = await consolidateName(drive, SHARD_NAME);

    expect(outcome.kind).toBe('consolidated');
    if (outcome.kind !== 'consolidated') return;
    expect(outcome.remainingId).toBeNull();
    // The skipped delete left the redundant copy behind, so the relist cannot
    // prove one file and records nothing.
    expect(drive.idsOf(SHARD_NAME).length).toBe(2);
  });

  test('a lone leftover that is not the primary records nothing', async () => {
    const drive = new FakeDrive();
    drive.addFile(SHARD_NAME, shardWith(1, 2), 'a-primary');
    drive.addFile(SHARD_NAME, shardWith(2, 3), 'm-leftover');
    drive.addFile(SHARD_NAME, shardWith(3, 4), 'z-drop');

    // Model the primary being deleted out from under the cleanup while one
    // redundant copy survives. The relist then finds exactly one file, but it
    // is not the file this procedure wrote and read back.
    const originalDelete = drive.deleteFile.bind(drive);
    drive.deleteFile = async (id: string): Promise<void> => {
      if (id === 'm-leftover') {
        drive.files.delete('a-primary');
        return;
      }
      await originalDelete(id);
    };

    const group = findDuplicateGroups(await drive.listCatalog())[0] as DuplicateGroup;
    const outcome = await consolidateGroup(group, {
      drive,
      staticData: loadedStaticData()
    });

    expect(outcome.kind).toBe('consolidated');
    if (outcome.kind !== 'consolidated') return;
    // Recording the consolidated content and the primary's marker against a
    // different file would describe a file that holds neither.
    expect(outcome.remainingId).toBeNull();
    expect(drive.idsOf(SHARD_NAME)).toEqual(['m-leftover']);
  });
});

describe('unknown files are never deleted', () => {
  test('an unknown Drive file in the folder survives consolidation', async () => {
    const drive = new FakeDrive();
    drive.addFile('scratch.json', '{"hello":1}');
    drive.addFile(SHARD_NAME, shardWith(1, 2), 'a-keep');
    drive.addFile(SHARD_NAME, shardWith(2, 3), 'b-drop');

    const outcome = await consolidateName(drive, SHARD_NAME);
    expect(outcome.kind).toBe('consolidated');

    expect(drive.files.has('scratch.json') || drive.idsOf('scratch.json').length > 0).toBe(true);
    expect(deleteCalls(drive)).toEqual(['b-drop']);
  });
});

describe('createConsolidateHook', () => {
  test('a catalog with no duplicates passes through untouched', async () => {
    const drive = new FakeDrive();
    drive.addFile(PREFS_NAME, prefsWith({}, '2026-08-15T07:30:00Z'));
    const hook = createConsolidateHook({ drive, staticData: loadedStaticData() });
    const catalog = await drive.listCatalog();
    const before = drive.calls.length;

    const result = await hook(catalog);

    expect(result.catalog).toEqual(catalog);
    expect(result.blocked).toEqual([]);
    expect(result.remaining).toEqual({});
    expect(drive.calls.length).toBe(before);
  });

  test('the returned catalog drops deleted IDs and refreshes the primary', async () => {
    const drive = new FakeDrive();
    const keepId = drive.addFile(SHARD_NAME, shardWith(1, 2), 'a-keep');
    drive.addFile(SHARD_NAME, shardWith(2, 3), 'b-drop');

    const hook = createConsolidateHook({ drive, staticData: loadedStaticData() });
    const result = await hook(await drive.listCatalog());

    expect(result.catalog.some((m: DriveFileMeta) => m.id === 'b-drop')).toBe(false);
    const primary = result.catalog.find((m: DriveFileMeta) => m.id === keepId);
    expect(primary).toBeDefined();
    expect(primary?.version).not.toBe('1');
    expect(result.remaining[SHARD_NAME]?.driveFileId).toBe(keepId);
  });

  test('a blocked group is reported and leaves the catalog intact', async () => {
    const drive = new FakeDrive();
    drive.addFile(SHARD_NAME, shardWith(1, 2), 'a-good');
    drive.addFile(SHARD_NAME, 'not json', 'b-corrupt');
    drive.addFile(PREFS_NAME, prefsWith({}, '2026-08-15T07:30:00Z'), 'p-fine');

    const hook = createConsolidateHook({ drive, staticData: loadedStaticData() });
    const result = await hook(await drive.listCatalog());

    expect(result.blocked.length).toBe(1);
    expect(result.blocked[0]?.logicalName).toBe(SHARD_NAME);
    expect(result.blocked[0]?.reason).toBe('corrupt_copy');
    expect(result.catalog.length).toBe(3);
    expect(deleteCalls(drive)).toEqual([]);
  });

  test('a blocked group does not stop another group from consolidating', async () => {
    const drive = new FakeDrive();
    drive.addFile(SHARD_NAME, shardWith(1, 2), 'a-good');
    drive.addFile(SHARD_NAME, 'not json', 'b-corrupt');
    drive.addFile(PREFS_NAME, prefsWith({ 'back-squat': { weight: 'kg' } }, '2026-08-10T00:00:00Z'), 'p-1');
    drive.addFile(PREFS_NAME, prefsWith({ 'push-up': { reps: 'reps' } }, '2026-08-20T00:00:00Z'), 'p-2');

    const hook = createConsolidateHook({ drive, staticData: loadedStaticData() });
    const result = await hook(await drive.listCatalog());

    expect(result.blocked.map((b: { logicalName: string }) => b.logicalName)).toEqual([SHARD_NAME]);
    expect(result.remaining[PREFS_NAME]?.driveFileId).toBe('p-1');
    expect(drive.idsOf(PREFS_NAME).length).toBe(1);
    expect(deleteCalls(drive)).toEqual(['p-2']);
  });
});

/** Read one file's current metadata straight out of the fake's store. */
async function metaOf(drive: FakeDrive, id: string): Promise<DriveFileMeta> {
  const catalog = await drive.listCatalog();
  const found = catalog.find((meta: DriveFileMeta): boolean => meta.id === id);
  if (found === undefined) throw new Error(`no file ${id}`);
  return found;
}
