// Tests for the result-shard warm.
// PHASE-16: bootstrap loads the shards the chooser needs, newest first, and one
// bad shard never stops the walk.

import { describe, expect, test } from 'bun:test';

import type { ResultsShard } from '../src/domain/types';
import {
  planShardLoad,
  warmResultShards
} from '../src/sync/warm-result-shards';
import type { DriveAdapter, DriveFileMeta } from '../src/drive/drive-interface';
import type { Coordinator } from '../src/sync/sync-coordinator';
import type { LookupService } from '../src/indexes/lookup-service';

const NOW = '2026-09-15T12:00:00Z';

function meta(name: string): DriveFileMeta {
  return {
    id: `id-${name}`,
    name,
    modifiedTime: NOW,
    version: '1',
    md5Checksum: null,
    size: 10
  };
}

/** A coordinator that serves a fixed shard per name, or throws. */
function fakeCoordinator(
  byName: Map<string, ResultsShard>,
  failNames: string[] = []
): { coordinator: Coordinator; loaded: string[] } {
  const loaded: string[] = [];
  const coordinator = {
    ensureLoaded: async (name: string): Promise<unknown> => {
      loaded.push(name);
      if (failNames.includes(name)) throw new Error(`cannot read ${name}`);
      return byName.get(name) ?? { sessions: {} };
    }
  } as unknown as Coordinator;
  return { coordinator, loaded };
}

/** A lookup that records every shard folded in. */
function fakeLookup(): { lookup: LookupService; folded: ResultsShard[] } {
  const folded: ResultsShard[] = [];
  const lookup = {
    extendHistory: (shards: ResultsShard[]): void => {
      folded.push(...shards);
    }
  } as unknown as LookupService;
  return { lookup, folded };
}

describe('planShardLoad', () => {
  test('the current month leads, then older months newest first', () => {
    const plan = planShardLoad(
      [
        'results-2026-06.json',
        'results-2026-09.json',
        'results-2026-08.json',
        'results-2026-07.json'
      ],
      NOW
    );

    expect(plan).toEqual([
      'results-2026-09.json',
      'results-2026-08.json',
      'results-2026-07.json',
      'results-2026-06.json'
    ]);
  });

  test('a non-shard name is never loaded', () => {
    const plan = planShardLoad(
      ['preferences.json', 'notes.txt', 'results-2026-08.json', 'results-2026-13.json'],
      NOW
    );

    expect(plan).toEqual(['results-2026-08.json']);
  });

  test('a catalog with no shards plans nothing', () => {
    expect(planShardLoad(['preferences.json'], NOW)).toEqual([]);
  });

  test('the current month is not planned when the catalog does not hold it', () => {
    // The warm is read-only. A shard that does not exist yet is not created
    // here; `SessionService.start` creates it when the user starts a workout.
    const plan = planShardLoad(['results-2026-08.json'], NOW);
    expect(plan).toEqual(['results-2026-08.json']);
    expect(plan).not.toContain('results-2026-09.json');
  });

  test('a duplicated catalog entry loads once', () => {
    const plan = planShardLoad(['results-2026-08.json', 'results-2026-08.json'], NOW);
    expect(plan).toEqual(['results-2026-08.json']);
  });
});

describe('warmResultShards', () => {
  test('every planned shard reaches the lookup', async () => {
    const drive = {
      listCatalog: async () => [
        meta('results-2026-09.json'),
        meta('results-2026-08.json'),
        meta('preferences.json')
      ]
    } as unknown as DriveAdapter;

    const byName = new Map<string, ResultsShard>([
      ['results-2026-09.json', { format: 'repjot/results', schemaVersion: 1, sessions: {} }],
      ['results-2026-08.json', { format: 'repjot/results', schemaVersion: 1, sessions: {} }]
    ]);

    const { coordinator } = fakeCoordinator(byName);
    const { lookup, folded } = fakeLookup();

    const result = await warmResultShards({ drive, coordinator, lookup, nowUtc: NOW });

    expect(result.shardNames).toEqual(['results-2026-09.json', 'results-2026-08.json']);
    expect(result.loaded).toEqual(result.shardNames);
    expect(folded.length).toBe(2);
    expect(result.failed).toEqual([]);
  });

  test('a shard that fails is recorded and the walk continues', async () => {
    const drive = {
      listCatalog: async () => [
        meta('results-2026-09.json'),
        meta('results-2026-08.json'),
        meta('results-2026-07.json')
      ]
    } as unknown as DriveAdapter;

    const byName = new Map<string, ResultsShard>([
      ['results-2026-09.json', { format: 'repjot/results', schemaVersion: 1, sessions: {} }],
      ['results-2026-07.json', { format: 'repjot/results', schemaVersion: 1, sessions: {} }]
    ]);

    const { coordinator, loaded } = fakeCoordinator(byName, ['results-2026-08.json']);
    const { lookup, folded } = fakeLookup();

    const result = await warmResultShards({ drive, coordinator, lookup, nowUtc: NOW });

    expect(result.failed).toEqual(['results-2026-08.json']);
    expect(result.loaded).toEqual(['results-2026-09.json', 'results-2026-07.json']);
    // The walk reached the last shard, so one bad month hid nothing.
    expect(loaded.length).toBe(3);
    expect(folded.length).toBe(2);
  });

  test('onShardLoaded runs after each shard lands, in load order', async () => {
    const drive = {
      listCatalog: async () => [meta('results-2026-08.json'), meta('results-2026-09.json')]
    } as unknown as DriveAdapter;

    const byName = new Map<string, ResultsShard>();
    const { coordinator } = fakeCoordinator(byName);
    const { lookup } = fakeLookup();

    const seen: string[] = [];
    await warmResultShards({
      drive,
      coordinator,
      lookup,
      nowUtc: NOW,
      onShardLoaded: (name: string): void => {
        seen.push(name);
      }
    });

    expect(seen).toEqual(['results-2026-09.json', 'results-2026-08.json']);
  });

  test('shards load one at a time, never in parallel', async () => {
    const drive = {
      listCatalog: async () => [
        meta('results-2026-09.json'),
        meta('results-2026-08.json'),
        meta('results-2026-07.json')
      ]
    } as unknown as DriveAdapter;

    let inFlight = 0;
    let peak = 0;
    const coordinator = {
      ensureLoaded: async (): Promise<unknown> => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await Promise.resolve();
        inFlight -= 1;
        return { sessions: {} };
      }
    } as unknown as Coordinator;
    const { lookup } = fakeLookup();

    await warmResultShards({ drive, coordinator, lookup, nowUtc: NOW });

    expect(peak).toBe(1);
  });
});
