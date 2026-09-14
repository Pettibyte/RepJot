// Merge properties: no array drift, stability, the `needsUpload` rule, and a
// seeded randomized pass over both families.
// REQUIREMENTS 4.8, 4.9, 4.10, 22.4.

import { describe, expect, test } from 'bun:test';
import {
  conflictUnitsFor,
  mergeDocuments,
  unitsTouchedBy,
  type MergeFamily
} from '../src/sync/merge-documents';
import { patcher } from '../src/sync/patcher';
import {
  RESULTS,
  baseShard,
  clone,
  hasAt,
  keyNames,
  leafPaths,
  preferencesDoc,
  PREFERENCES,
  resultsShard,
  session
} from './fixtures/merge';

/** Small deterministic generator, so a failure reproduces exactly. */
function makeRandom(seed: number): () => number {
  let state = seed % 2147483647;
  if (state <= 0) state += 2147483646;
  return () => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
}

function pick<T>(random: () => number, items: readonly T[]): T {
  return items[Math.floor(random() * items.length)];
}

/** The document path of one conflict unit. */
function unitPath(family: MergeFamily, unit: string): string[] {
  if (family === RESULTS) {
    return ['sessions', unit];
  }
  const separator = unit.lastIndexOf('/');
  return ['exerciseUnits', unit.slice(0, separator), unit.slice(separator + 1)];
}

describe('array-drift guard', () => {
  test('a delete on one side and an append on the other shift nothing', () => {
    const base = resultsShard({ s1: session('s1'), s2: session('s2'), s3: session('s3') });
    const local = clone(base);
    const remote = clone(base);

    // The local device removes the first session. The remote device appends one.
    delete local.sessions.s1;
    remote.sessions.s4 = session('s4', { notes: 'appended remotely' });

    const result = mergeDocuments({ family: RESULTS, base, local, remote });
    const merged = result.merged as { sessions: Record<string, Record<string, unknown>> };

    expect(Object.keys(merged.sessions).sort()).toEqual(['s2', 's3', 's4']);
    expect(merged.sessions.s2).toEqual(base.sessions.s2);
    expect(merged.sessions.s3).toEqual(base.sessions.s3);
    expect(merged.sessions.s4).toEqual(remote.sessions.s4);
  });

  test('a nested result map keeps its keys when one side removes and appends', () => {
    const base = baseShard();
    const local = clone(base);
    const remote = clone(base);

    const localSession = local.sessions.a.exerciseResults as Record<string, unknown>;
    delete localSession['squat-1|both|1'];
    localSession['new-1|both|1'] = {
      workoutId: 'full-body',
      executionPath: [{ nodeId: 'new-1' }],
      exerciseId: 'back-squat',
      side: 'both',
      attempt: 1,
      status: 'completed'
    };

    const remoteSession = remote.sessions.b.exerciseResults as Record<string, unknown>;
    remoteSession['new-2|both|1'] = {
      workoutId: 'full-body',
      executionPath: [{ nodeId: 'new-2' }],
      exerciseId: 'back-squat',
      side: 'both',
      attempt: 1,
      status: 'completed'
    };

    const result = mergeDocuments({ family: RESULTS, base, local, remote });
    const merged = result.merged as {
      sessions: Record<string, { exerciseResults: Record<string, unknown> }>;
    };

    expect(Object.keys(merged.sessions.a.exerciseResults)).toEqual(['new-1|both|1']);
    expect(merged.sessions.b.exerciseResults['squat-1|both|1']).toEqual(
      base.sessions.b.exerciseResults['squat-1|both|1']
    );
    expect(merged.sessions.b.exerciseResults['new-2|both|1']).toEqual(
      remote.sessions.b.exerciseResults['new-2|both|1']
    );
  });
});

describe('stability', () => {
  test('re-applying the merge to its own result changes nothing', () => {
    const base = baseShard();
    const local = clone(base);
    const remote = clone(base);
    local.sessions.a.notes = 'local';
    delete local.sessions.b;
    remote.sessions.c = session('c');
    remote.sessions.a.status = 'aborted';

    const first = mergeDocuments({ family: RESULTS, base, local, remote });
    const second = mergeDocuments({
      family: RESULTS,
      base,
      local: clone(first.merged),
      remote
    });

    // The merged document already carries the local-wins decision, so a second
    // pass over the same remote selects the same document.
    expect(second.merged).toEqual(first.merged);
    expect(second.needsUpload).toBe(true);
  });

  test('merging a document with itself needs no upload', () => {
    const base = baseShard();
    const local = clone(base);
    const remote = clone(base);
    local.sessions.a.notes = 'local';
    remote.sessions.b.notes = 'remote';

    const merged = mergeDocuments({ family: RESULTS, base, local, remote }).merged;
    const again = mergeDocuments({
      family: RESULTS,
      base: merged,
      local: clone(merged),
      remote: clone(merged)
    });

    expect(again.needsUpload).toBe(false);
    expect(again.conflictedUnits).toEqual([]);
  });
});

describe('needsUpload', () => {
  test('is false when the local side has no delta', () => {
    const base = baseShard();
    const remote = clone(base);
    remote.sessions.c = session('c');

    const result = mergeDocuments({ family: RESULTS, base, local: clone(base), remote });

    expect(result.needsUpload).toBe(false);
    expect(result.merged).toEqual(remote);
    expect(result.conflictedUnits).toEqual([]);
  });

  test('is true when the local side has a delta and the remote side has none', () => {
    const base = baseShard();
    const local = clone(base);
    local.sessions.a.notes = 'local only';

    const result = mergeDocuments({ family: RESULTS, base, local, remote: clone(base) });

    expect(result.needsUpload).toBe(true);
    expect(result.merged).toEqual(local);
  });

  test('is true when both sides changed', () => {
    const base = baseShard();
    const local = clone(base);
    const remote = clone(base);
    local.sessions.a.notes = 'local';
    remote.sessions.a.notes = 'remote';

    expect(mergeDocuments({ family: RESULTS, base, local, remote }).needsUpload).toBe(true);
  });

  test('the result shares no node with any input on any path', () => {
    const base = baseShard();
    const local = clone(base);
    const remote = clone(base);
    local.sessions.a.notes = 'local';
    remote.sessions.b.notes = 'remote';

    const noLocalDelta = mergeDocuments({ family: RESULTS, base, local: clone(base), remote });
    const noRemoteDelta = mergeDocuments({ family: RESULTS, base, local, remote: clone(base) });
    const bothDeltas = mergeDocuments({ family: RESULTS, base, local, remote });

    for (const result of [noLocalDelta, noRemoteDelta, bothDeltas]) {
      const merged = result.merged as { sessions: Record<string, { notes?: string }> };
      merged.sessions.a.notes = 'written after merge';
      expect(local.sessions.a.notes).toBe('local');
      expect(remote.sessions.a.notes).toBeUndefined();
    }
  });
});

describe('randomized merge properties', () => {
  /** One nested exercise result the generator can add inside a session. */
  function nestedResult(tag: string, id: string): Record<string, unknown> {
    return {
      workoutId: 'full-body',
      executionPath: [{ nodeId: `${tag}-${id}-new` }],
      exerciseId: 'back-squat',
      side: 'both',
      attempt: 1,
      status: 'completed'
    };
  }

  /** Apply one random edit set to the sessions map. */
  function mutateSessions(
    base: Record<string, Record<string, unknown>>,
    random: () => number,
    tag: string
  ): Record<string, Record<string, unknown>> {
    const sessions = clone(base);
    for (const id of Object.keys(sessions)) {
      const action = pick(random, ['keep', 'edit', 'nested', 'nested', 'delete'] as const);
      if (action === 'delete') {
        delete sessions[id];
        continue;
      }
      if (action === 'edit') {
        sessions[id] = { ...sessions[id], notes: `${tag}-${id}` };
        continue;
      }
      // A nested edit inside one result map. This is where the delta-path to
      // conflict-unit mapping does its work.
      const target = sessions[id];
      const exerciseResults = { ...(target.exerciseResults as Record<string, unknown>) };
      const keys = Object.keys(exerciseResults);
      if (keys.length > 0 && random() < 0.5) {
        delete exerciseResults[keys[0]];
      } else {
        exerciseResults[`${tag}-${id}-new|both|1`] = nestedResult(tag, id);
      }
      sessions[id] = { ...target, exerciseResults };
    }
    if (random() < 0.5) {
      const id = `new-${tag}`;
      sessions[id] = session(id, { notes: `added by ${tag}` });
    }
    return sessions;
  }

  /** Apply one random edit set to the exercise unit preferences map. */
  function mutatePreferences(
    base: Record<string, Record<string, string>>,
    random: () => number,
    tag: string
  ): Record<string, Record<string, string>> {
    const map = clone(base);
    for (const exerciseId of Object.keys(map)) {
      const action = pick(
        random,
        ['keep', 'edit', 'addDimension', 'removeDimension', 'deleteExercise'] as const
      );
      if (action === 'deleteExercise') {
        delete map[exerciseId];
        continue;
      }
      const dimensions = { ...map[exerciseId] };
      if (action === 'edit') {
        const keys = Object.keys(dimensions);
        if (keys.length > 0) {
          dimensions[keys[0]] = dimensions[keys[0]] === 'kg' ? 'lb' : 'kg';
        }
      }
      if (action === 'addDimension') {
        dimensions.distance = random() < 0.5 ? 'm' : 'km';
      }
      if (action === 'removeDimension') {
        const keys = Object.keys(dimensions);
        if (keys.length > 0) delete dimensions[keys[0]];
      }
      map[exerciseId] = dimensions;
    }
    if (random() < 0.5) {
      map[`new-${tag}`] = { weight: 'kg' };
    }
    return map;
  }

  /** One round of three documents for one family. */
  interface Round {
    base: Record<string, unknown>;
    local: Record<string, unknown>;
    remote: Record<string, unknown>;
  }

  /** Build one random document pair for one family. */
  function buildRound(family: MergeFamily, random: () => number): Round {
    if (family === RESULTS) {
      const base = resultsShard({ s1: session('s1'), s2: session('s2'), s3: session('s3') });
      const baseSessions = base.sessions as Record<string, Record<string, unknown>>;
      return {
        base,
        local: resultsShard(mutateSessions(baseSessions, random, 'L')),
        remote: resultsShard(mutateSessions(baseSessions, random, 'R'))
      };
    }
    const base = preferencesDoc({
      'back-squat': { weight: 'kg', distance: 'm' },
      'bench-press': { weight: 'lb' }
    });
    const baseUnits = base.exerciseUnits as Record<string, Record<string, string>>;
    const local = preferencesDoc(mutatePreferences(baseUnits, random, 'L'), { revision: 4 });
    const remote = preferencesDoc(mutatePreferences(baseUnits, random, 'R'), { revision: 5 });
    return { base, local, remote };
  }

  test('every unit resolves by the conflict rules, in both families', () => {
    for (const family of [RESULTS, PREFERENCES] as const) {
      for (let round = 0; round < 150; round += 1) {
        const random = makeRandom(round + 1);
        const { base, local, remote } = buildRound(family, random);
        const result = mergeDocuments({ family, base, local, remote });
        const merged = result.merged as Record<string, unknown>;

        const localTouched = unitsTouchedBy(family, patcher.diff(base, local));
        const remoteTouched = unitsTouchedBy(family, patcher.diff(base, remote));

        const allUnits = new Set([
          ...conflictUnitsFor(family, base),
          ...conflictUnitsFor(family, local),
          ...conflictUnitsFor(family, remote)
        ]);

        for (const unit of allUnits) {
          const path = unitPath(family, unit);
          const inLocal = hasAt(local, path);
          const inRemote = hasAt(remote, path);
          const inMerged = hasAt(merged, path);
          const localTouchedThis = localTouched.has(unit);
          const remoteTouchedThis = remoteTouched.has(unit);

          if (!localTouchedThis && !remoteTouchedThis) {
            // Untouched on both sides: the base value stands.
            expect(inMerged).toBe(inLocal && inRemote);
            if (inMerged) {
              expect(valueAt(merged, path)).toEqual(valueAt(base, path));
            }
            continue;
          }
          if (localTouchedThis) {
            if (inLocal) {
              // The local side holds the unit, so the local content wins in full.
              expect(inMerged).toBe(true);
              expect(valueAt(merged, path)).toEqual(valueAt(local, path));
              continue;
            }
            // The local side deleted the unit. A remote edit beats that delete, so
            // the remote content stands. A remote delete keeps it deleted.
            expect(inMerged).toBe(remoteTouchedThis && inRemote);
            if (inMerged) expect(valueAt(merged, path)).toEqual(valueAt(remote, path));
            continue;
          }
          // Remote-only touch: the remote value stands, including a remote delete.
          expect(inMerged).toBe(inRemote);
          if (inMerged) expect(valueAt(merged, path)).toEqual(valueAt(remote, path));
        }
      }
    }
  });

  test('no merged leaf path holds a value that no input holds', () => {
    for (const family of [RESULTS, PREFERENCES] as const) {
      for (let round = 0; round < 150; round += 1) {
        const random = makeRandom(round + 7);
        const { base, local, remote } = buildRound(family, random);
        const { merged } = mergeDocuments({ family, base, local, remote });

        for (const path of leafPaths(merged)) {
          const present =
            hasAt(base, path) || hasAt(local, path) || hasAt(remote, path);
          expect(
            present,
            `merged path ${path.join('/')} exists in no input`
          ).toBe(true);
        }
      }
    }
  });

  test('a top-level field outside the unit namespace resolves to the local value', () => {
    // The unit tests cover the unit namespace. This covers step 5, the loose
    // paths, in both families, with the field edited, untouched, or deleted on
    // either side. The rule is the same one the phase states for the last
    // synchronizer: the local side decides a field outside the unit namespace.
    const actions = [
      'none',
      'localEdit',
      'remoteEdit',
      'bothEdit',
      'localDelete',
      'remoteDelete',
      'bothDelete'
    ] as const;

    for (const family of [RESULTS, PREFERENCES] as const) {
      const field = family === RESULTS ? 'yearMonthUtc' : 'revision';
      for (let round = 0; round < 200; round += 1) {
        const random = makeRandom(round + 3);
        const action = pick(random, actions);

        const base =
          family === RESULTS
            ? resultsShard({ s1: session('s1'), s2: session('s2') })
            : preferencesDoc({ 'back-squat': { weight: 'kg' } });
        const local = clone(base);
        const remote = clone(base);

        if (action === 'localEdit' || action === 'bothEdit') {
          local[field] = family === RESULTS ? '2026-09' : 6;
        }
        if (action === 'remoteEdit' || action === 'bothEdit') {
          remote[field] = family === RESULTS ? '2026-10' : 7;
        }
        if (action === 'localDelete' || action === 'bothDelete') {
          delete local[field];
        }
        if (action === 'remoteDelete' || action === 'bothDelete') {
          delete remote[field];
        }
        // Touch one unit on each side so both deltas exist and the merge runs the
        // full path instead of returning early.
        if (family === RESULTS) {
          (local.sessions as Record<string, unknown>).s1 = session('s1', { notes: 'L' });
          (remote.sessions as Record<string, unknown>).s2 = session('s2', { notes: 'R' });
        } else {
          const localUnits = local.exerciseUnits as Record<string, Record<string, string>>;
          const remoteUnits = remote.exerciseUnits as Record<string, Record<string, string>>;
          localUnits['back-squat'] = { weight: 'lb' };
          remoteUnits['bench-press'] = { weight: 'kg' };
        }

        const { merged } = mergeDocuments({ family, base, local, remote });

        if (hasAt(local, [field])) {
          expect(valueAt(merged, [field])).toEqual(local[field]);
        } else {
          expect(hasAt(merged, [field])).toBe(false);
        }
      }
    }
  });

  test('no merge mints an ID or a sync copy', () => {
    for (const family of [RESULTS, PREFERENCES] as const) {
      for (let round = 0; round < 50; round += 1) {
        const random = makeRandom(round + 11);
        const { base, local, remote } = buildRound(family, random);
        const { merged } = mergeDocuments({ family, base, local, remote });

        const names = Array.from(keyNames(merged));
        expect(names.filter((name) => name.startsWith('conflictOf'))).toEqual([]);
        expect(names.filter((name) => /copy/i.test(name))).toEqual([]);
      }
    }
  });
});

/** Read the value at a path. Assumes the path exists. */
function valueAt(root: unknown, path: string[]): unknown {
  let node: unknown = root;
  for (const key of path) {
    node = (node as Record<string, unknown>)[key];
  }
  return node;
}
