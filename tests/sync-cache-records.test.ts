// Typed record helpers over the Phase 06 key scheme. REQUIREMENTS 3.13, 3.14,
// 4.5, 4.15.
//
// The rule these tests pin: a stored value either proves its shape and comes
// back typed, or it reads as absent. A half-readable row never reaches the
// merge.

import { describe, expect, test } from 'bun:test';
import { createMemoryLocalStore } from '../src/storage/memory-local-store';
import { baseKey, cacheKey, pendingKey, type LocalStore } from '../src/storage/local-store';
import {
  applyPendingDelta,
  computePendingDelta,
  isBaseRecord,
  isCachedRecord,
  isPendingDelta,
  isPendingRecord,
  listLocalLogicalNames,
  makeBaseRecord,
  makeCachedRecord,
  makePendingRecord,
  readBase,
  readCached,
  readPending,
  readRecords,
  remoteMarker
} from '../src/sync/cache-records';
import { applyDelta, clone, patcher } from '../src/sync/patcher';
import type { DriveFileMeta } from '../src/drive/drive-interface';

function meta(overrides: Partial<DriveFileMeta> = {}): DriveFileMeta {
  return {
    id: 'file-1',
    name: 'preferences.json',
    modifiedTime: '2026-08-15T00:00:00Z',
    version: '7',
    md5Checksum: 'abc123',
    size: 10,
    ...overrides
  };
}

describe('shape guards', () => {
  test('a well-formed cached record passes', () => {
    expect(
      isCachedRecord(
        makeCachedRecord('preferences.json', 'file-1', 'abc123', '{}', 1, '2026-08-15T00:00:00Z')
      )
    ).toBe(true);
  });

  test('a cached record missing a field fails', () => {
    const broken = {
      logicalName: 'preferences.json',
      driveFileId: null,
      remoteEtag: null,
      contentText: '{}'
      // schemaVersion and cachedAtUtc missing
    };
    expect(isCachedRecord(broken)).toBe(false);
  });

  test('a base record needs text and a nullable id', () => {
    expect(isBaseRecord(makeBaseRecord('{}', null))).toBe(true);
    expect(isBaseRecord(makeBaseRecord('{}', 'file-1'))).toBe(true);
    expect(isBaseRecord({ contentText: 5, driveFileId: null })).toBe(false);
  });

  test('a pending record needs a delta envelope and a timestamp', () => {
    expect(isPendingRecord(makePendingRecord({ kind: 'patch', delta: {} }, '2026-08-15T00:00:00Z'))).toBe(
      true
    );
    expect(isPendingRecord({ delta: { kind: 'nope' }, updatedAtUtc: 'x' })).toBe(false);
    expect(isPendingRecord({ delta: {}, updatedAtUtc: 'x' })).toBe(false);
  });

  test('the delta envelope accepts patch and replace only', () => {
    expect(isPendingDelta({ kind: 'patch', delta: [1, 2] })).toBe(true);
    expect(isPendingDelta({ kind: 'replace', document: { a: 1 } })).toBe(true);
    expect(isPendingDelta({ kind: 'other' })).toBe(false);
    expect(isPendingDelta('nope')).toBe(false);
  });
});

describe('reads', () => {
  test('a missing key reads as null', async () => {
    const store = createMemoryLocalStore();
    expect(await readCached(store, 'preferences.json')).toBeNull();
    expect(await readBase(store, 'preferences.json')).toBeNull();
    expect(await readPending(store, 'preferences.json')).toBeNull();
  });

  test('a malformed stored value reads as null, not as a broken record', async () => {
    const store = createMemoryLocalStore();
    await store.set(cacheKey('preferences.json'), { nonsense: true });
    expect(await readCached(store, 'preferences.json')).toBeNull();
  });

  test('a cleared pending row reads as null', async () => {
    const store = createMemoryLocalStore();
    await store.set(pendingKey('preferences.json'), null);
    expect(await readPending(store, 'preferences.json')).toBeNull();
  });

  test('readRecords returns all three at once', async () => {
    const store = createMemoryLocalStore();
    await store.set(
      cacheKey('preferences.json'),
      makeCachedRecord('preferences.json', 'file-1', 'abc', '{}', 1, '2026-08-15T00:00:00Z')
    );
    await store.set(baseKey('preferences.json'), makeBaseRecord('{}', 'file-1'));

    const set = await readRecords(store, 'preferences.json');
    expect(set.cached?.driveFileId).toBe('file-1');
    expect(set.base?.contentText).toBe('{}');
    expect(set.pending).toBeNull();
  });
});

describe('the remote marker', () => {
  test('md5 wins when Drive supplies one', () => {
    expect(remoteMarker(meta({ md5Checksum: 'md5-value', version: '9' }))).toBe('md5-value');
  });

  test('version is the fallback', () => {
    expect(remoteMarker(meta({ md5Checksum: null, version: '9' }))).toBe('9');
  });
});

describe('the pending delta', () => {
  test('an equal base and local produce no delta', () => {
    const doc = { a: 1 };
    expect(computePendingDelta(doc, clone(doc), (a, b) => patcher.diff(a, b))).toBeNull();
  });

  test('a changed local produces a patch envelope', () => {
    const base = { sessions: { a: { v: 1 } } };
    const local = { sessions: { a: { v: 2 } } };
    const delta = computePendingDelta(base, local, (a, b) => patcher.diff(a, b));
    expect(delta?.kind).toBe('patch');
  });

  test('a missing base produces a replace envelope', () => {
    const local = { sessions: { a: { v: 1 } } };
    const delta = computePendingDelta(undefined, local, (a, b) => patcher.diff(a, b));
    expect(delta?.kind).toBe('replace');
  });

  test('a patch envelope replays onto the base', () => {
    const base = { sessions: { a: { v: 1 } } };
    const local = { sessions: { a: { v: 2 }, b: { v: 3 } } };
    const record = makePendingRecord(
      computePendingDelta(base, local, (a, b) => patcher.diff(a, b)) as never,
      '2026-08-15T00:00:00Z'
    );
    const restored = applyPendingDelta(
      clone(base),
      record,
      (b, d) => applyDelta(b, d),
      (v) => clone(v)
    );
    expect(restored).toEqual(local);
  });

  test('a replace envelope ignores the base', () => {
    const record = makePendingRecord(
      { kind: 'replace', document: { fresh: true } },
      '2026-08-15T00:00:00Z'
    );
    expect(
      applyPendingDelta({ old: true }, record, (b, d) => applyDelta(b, d), (v) => clone(v))
    ).toEqual({ fresh: true });
  });
});

describe('local logical names', () => {
  test('the union of the three prefixes, deduped and sorted', async () => {
    const store: LocalStore = createMemoryLocalStore();
    await store.set(cacheKey('preferences.json'), 1);
    await store.set(baseKey('results-2026-09.json'), 1);
    await store.set(pendingKey('preferences.json'), 1);
    await store.set('unrelated:key', 1);

    expect(await listLocalLogicalNames(store)).toEqual([
      'preferences.json',
      'results-2026-09.json'
    ]);
  });

  test('an empty store lists nothing', async () => {
    expect(await listLocalLogicalNames(createMemoryLocalStore())).toEqual([]);
  });
});
