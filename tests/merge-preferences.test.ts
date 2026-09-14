// Merge behaviour for the preferences family: one `(exerciseId, dimension)` pair
// is one conflict unit. REQUIREMENTS 4.7, 4.8, 12.8, 12.9, 22.4.2.

import { describe, expect, test } from 'bun:test';
import {
  conflictUnitsFor,
  mergeDocuments,
  unitsTouchedBy,
  type MergeConflictEvent
} from '../src/sync/merge-documents';
import { PREFERENCES, basePreferences, clone, preferencesDoc } from './fixtures/merge';

/** Read `exerciseUnits` out of a merged document. */
function unitsOf(merged: unknown): Record<string, Record<string, string>> {
  return (merged as { exerciseUnits: Record<string, Record<string, string>> }).exerciseUnits;
}

describe('different exercise and dimension mappings', () => {
  const base = basePreferences();
  const local = clone(base);
  const remote = clone(base);
  local.exerciseUnits['back-squat'].weight = 'lb';
  remote.exerciseUnits['back-squat'].distance = 'm';
  remote.exerciseUnits['bench-press'] = { weight: 'kg' };

  const result = mergeDocuments({ family: PREFERENCES, base, local, remote });

  test('both sides keep their own mappings', () => {
    expect(unitsOf(result.merged)).toEqual({
      'back-squat': { weight: 'lb', distance: 'm' },
      'bench-press': { weight: 'kg' }
    });
  });

  test('different mappings never conflict', () => {
    expect(result.conflictedUnits).toEqual([]);
    expect(result.needsUpload).toBe(true);
  });
});

describe('the same mapping changed on both sides', () => {
  const base = preferencesDoc({ 'back-squat': { weight: 'kg', distance: 'm' } });
  const local = clone(base);
  const remote = clone(base);
  local.exerciseUnits['back-squat'].distance = 'km';
  remote.exerciseUnits['back-squat'].distance = 'ft';

  const result = mergeDocuments({ family: PREFERENCES, base, local, remote });

  test('the local value wins', () => {
    expect(unitsOf(result.merged)['back-squat'].distance).toBe('km');
  });

  test('the mapping is the conflict unit', () => {
    expect(result.conflictedUnits).toEqual(['back-squat/distance']);
  });

  test('the untouched mapping keeps the base value', () => {
    expect(unitsOf(result.merged)['back-squat'].weight).toBe('kg');
  });
});

describe('a whole exercise map replaced locally', () => {
  test('a remote edit to another dimension of that exercise survives', () => {
    const base = preferencesDoc({ 'back-squat': { weight: 'kg' } });
    const local = clone(base);
    const remote = clone(base);

    // The local device rewrites the whole exercise entry.
    local.exerciseUnits['back-squat'] = { weight: 'lb', duration: 'second' };
    // The remote device adds a different dimension.
    remote.exerciseUnits['back-squat'].distance = 'm';

    const result = mergeDocuments({ family: PREFERENCES, base, local, remote });

    expect(unitsOf(result.merged)['back-squat']).toEqual({
      weight: 'lb',
      duration: 'second',
      distance: 'm'
    });
    expect(result.conflictedUnits).toEqual([]);
  });

  test('a remote edit to the same dimension loses to the local rewrite', () => {
    const base = preferencesDoc({ 'back-squat': { weight: 'kg', distance: 'm' } });
    const local = clone(base);
    const remote = clone(base);
    local.exerciseUnits['back-squat'] = { weight: 'lb', distance: 'km' };
    remote.exerciseUnits['back-squat'].distance = 'ft';

    const result = mergeDocuments({ family: PREFERENCES, base, local, remote });

    expect(unitsOf(result.merged)['back-squat'].distance).toBe('km');
    expect(result.conflictedUnits).toEqual(['back-squat/distance']);
  });
});

describe('a mapping deleted on one side and edited on the other', () => {
  test('a local delete against a remote edit keeps the remote value', () => {
    const base = preferencesDoc({ 'back-squat': { weight: 'kg', distance: 'm' } });
    const local = clone(base);
    const remote = clone(base);
    delete local.exerciseUnits['back-squat'].distance;
    remote.exerciseUnits['back-squat'].distance = 'km';

    const result = mergeDocuments({ family: PREFERENCES, base, local, remote });

    expect(unitsOf(result.merged)['back-squat'].distance).toBe('km');
    expect(result.conflictedUnits).toEqual(['back-squat/distance']);
  });

  test('a local edit against a remote delete keeps the local value', () => {
    const base = preferencesDoc({ 'back-squat': { weight: 'kg', distance: 'm' } });
    const local = clone(base);
    const remote = clone(base);
    local.exerciseUnits['back-squat'].distance = 'km';
    delete remote.exerciseUnits['back-squat'].distance;

    const result = mergeDocuments({ family: PREFERENCES, base, local, remote });

    expect(unitsOf(result.merged)['back-squat'].distance).toBe('km');
    expect(result.conflictedUnits).toEqual(['back-squat/distance']);
  });

  test('a mapping deleted on both sides stays deleted', () => {
    const base = preferencesDoc({ 'back-squat': { weight: 'kg', distance: 'm' } });
    const local = clone(base);
    const remote = clone(base);
    delete local.exerciseUnits['back-squat'].distance;
    delete remote.exerciseUnits['back-squat'].distance;

    const result = mergeDocuments({ family: PREFERENCES, base, local, remote });

    expect(unitsOf(result.merged)['back-squat']).toEqual({ weight: 'kg' });
  });

  test('removing the last dimension removes the exercise entry', () => {
    const base = preferencesDoc({ 'back-squat': { weight: 'kg' }, 'bench-press': { weight: 'kg' } });
    const local = clone(base);
    const remote = clone(base);
    delete local.exerciseUnits['back-squat'].weight;
    remote.exerciseUnits['bench-press'].distance = 'm';

    const result = mergeDocuments({ family: PREFERENCES, base, local, remote });

    expect(Object.keys(unitsOf(result.merged)).sort()).toEqual(['bench-press']);
    expect(unitsOf(result.merged)['bench-press']).toEqual({ weight: 'kg', distance: 'm' });
  });
});

describe('an exercise ID that breaks the ID rule', () => {
  // REQUIREMENTS 22.4.6 forbids `/` in an ID, and the schema enforces it. The
  // merge still must not corrupt a document that carries one, because the merge
  // runs before validation on some paths.
  test('the unit key round-trips on the last slash', () => {
    const base = preferencesDoc({ 'a/b': { weight: 'kg' } });
    const local = clone(base);
    const remote = clone(base);
    const localUnits = local.exerciseUnits as Record<string, Record<string, string>>;
    const remoteUnits = remote.exerciseUnits as Record<string, Record<string, string>>;
    localUnits['a/b'].weight = 'lb';
    remoteUnits['deadlift'] = { weight: 'kg' };

    const result = mergeDocuments({ family: PREFERENCES, base, local, remote });
    const merged = unitsOf(result.merged);

    expect(merged['a/b']).toEqual({ weight: 'lb' });
    expect(merged['deadlift']).toEqual({ weight: 'kg' });
    expect(Object.keys(merged).sort()).toEqual(['a/b', 'deadlift']);
    expect(result.conflictedUnits).toEqual([]);
  });

  test('a local delete of such a unit is applied', () => {
    const base = preferencesDoc({ 'a/b': { weight: 'kg' } });
    const local = preferencesDoc({});
    const remote = preferencesDoc({ 'a/b': { weight: 'kg' }, 'deadlift': { weight: 'kg' } });

    const result = mergeDocuments({ family: PREFERENCES, base, local, remote });

    expect(Object.keys(unitsOf(result.merged)).sort()).toEqual(['deadlift']);
  });
});

describe('conflict unit reporting for preferences', () => {
  test('conflictUnitsFor returns every exercise and dimension pair', () => {
    const doc = preferencesDoc({
      'back-squat': { weight: 'kg', distance: 'm' },
      'bench-press': { weight: 'lb' }
    });
    expect(conflictUnitsFor(PREFERENCES, doc).sort()).toEqual([
      'back-squat/distance',
      'back-squat/weight',
      'bench-press/weight'
    ]);
    expect(conflictUnitsFor(PREFERENCES, null)).toEqual([]);
  });

  test('unitsTouchedBy reads a nested dimension path', () => {
    const delta = { exerciseUnits: { 'back-squat': { weight: ['kg', 'lb'] } } };
    expect(Array.from(unitsTouchedBy(PREFERENCES, delta))).toEqual(['back-squat/weight']);
  });

  test('unitsTouchedBy expands an exercise-level operation', () => {
    const delta = {
      exerciseUnits: { 'back-squat': [{ weight: 'kg', distance: 'm' }, { weight: 'kg' }] }
    };
    expect(Array.from(unitsTouchedBy(PREFERENCES, delta)).sort()).toEqual([
      'back-squat/distance',
      'back-squat/weight'
    ]);
  });

  test('unitsTouchedBy expands a whole-map operation', () => {
    const delta = {
      exerciseUnits: [
        { 'back-squat': { weight: 'kg' } },
        { 'bench-press': { weight: 'lb' } }
      ]
    };
    expect(Array.from(unitsTouchedBy(PREFERENCES, delta)).sort()).toEqual([
      'back-squat/weight',
      'bench-press/weight'
    ]);
  });

  test('the observer reports the family and the unit key', () => {
    const base = preferencesDoc({ 'back-squat': { weight: 'kg', distance: 'm' } });
    const local = clone(base);
    const remote = clone(base);
    local.exerciseUnits['back-squat'].distance = 'km';
    remote.exerciseUnits['back-squat'].distance = 'ft';

    const events: MergeConflictEvent[] = [];
    mergeDocuments({ family: PREFERENCES, base, local, remote }, (event) => {
      events.push(event);
    });

    expect(events).toEqual([{ family: PREFERENCES, unit: 'back-squat/distance' }]);
  });
});

describe('top-level preference fields', () => {
  test('a field outside the unit namespace takes the local value', () => {
    const base = basePreferences();
    const local = clone(base);
    const remote = clone(base);
    local.revision = 5;
    remote.revision = 4;
    local.exerciseUnits['bench-press'] = { weight: 'lb' };

    const result = mergeDocuments({ family: PREFERENCES, base, local, remote });
    const merged = result.merged as { revision: number };

    expect(merged.revision).toBe(5);
    expect(unitsOf(result.merged)['bench-press']).toEqual({ weight: 'lb' });
  });

  test('a remote-only top-level change survives when local touches no such field', () => {
    const base = basePreferences();
    const local = clone(base);
    const remote = clone(base);
    remote.revision = 9;
    local.exerciseUnits['bench-press'] = { weight: 'lb' };

    const result = mergeDocuments({ family: PREFERENCES, base, local, remote });

    expect((result.merged as { revision: number }).revision).toBe(9);
  });
});
