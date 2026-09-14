// Merge behaviour for the results family: one session is one conflict unit.
// REQUIREMENTS 4.7 through 4.13, ARCHITECTURE ADR-011, ADR-012.

import { describe, expect, test } from 'bun:test';
import {
  diagnosticSnapshot,
  resetDiagnosticLog
} from '../src/diagnostics/diagnostic-log';
import {
  conflictUnitsFor,
  mergeDocuments,
  unitsTouchedBy,
  type MergeConflictEvent
} from '../src/sync/merge-documents';
import {
  RESULTS,
  baseShard,
  clone,
  deepFreeze,
  keyNames,
  resultsShard,
  session
} from './fixtures/merge';

/** Read `sessions` out of a merged document. */
function sessionsOf(merged: unknown): Record<string, Record<string, unknown>> {
  return (merged as { sessions: Record<string, Record<string, unknown>> }).sessions;
}

/** Read one session out of a merged document. */
function sessionOf(merged: unknown, id: string): Record<string, unknown> | undefined {
  return sessionsOf(merged)[id];
}

describe('two devices add different sessions', () => {
  const base = baseShard();
  const local = clone(base);
  const remote = clone(base);
  local.sessions.c = session('c');
  remote.sessions.d = session('d');

  const result = mergeDocuments({ family: RESULTS, base, local, remote });

  test('both new sessions survive', () => {
    expect(Object.keys(sessionsOf(result.merged)).sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  test('no session content shifts', () => {
    expect(sessionOf(result.merged, 'c')).toEqual(local.sessions.c);
    expect(sessionOf(result.merged, 'd')).toEqual(remote.sessions.d);
    expect(sessionOf(result.merged, 'a')).toEqual(base.sessions.a);
    expect(sessionOf(result.merged, 'b')).toEqual(base.sessions.b);
  });

  test('different sessions never conflict', () => {
    expect(result.conflictedUnits).toEqual([]);
    expect(result.needsUpload).toBe(true);
  });
});

describe('the same session changed on both sides', () => {
  const base = baseShard();
  const local = clone(base);
  const remote = clone(base);
  local.sessions.a.status = 'skipped';
  local.sessions.a.notes = 'local note';
  remote.sessions.a.status = 'aborted';
  remote.sessions.a.notes = 'remote note';

  const result = mergeDocuments({ family: RESULTS, base, local, remote });

  test('the local session is the conflict unit', () => {
    expect(result.conflictedUnits).toEqual(['a']);
  });

  test('the merged entry equals the local entry in full', () => {
    expect(sessionOf(result.merged, 'a')).toEqual(local.sessions.a);
  });

  test('no field merge inside the conflicted unit', () => {
    const mergedSession = sessionOf(result.merged, 'a');
    expect(mergedSession?.status).toBe('skipped');
    expect(mergedSession?.notes).toBe('local note');
    expect(JSON.stringify(mergedSession)).toBe(JSON.stringify(local.sessions.a));
  });

  test('an untouched session keeps the remote edit', () => {
    const remoteOnly = clone(base);
    const localOnly = clone(base);
    remoteOnly.sessions.b.notes = 'remote only';
    const merged = mergeDocuments({
      family: RESULTS,
      base,
      local: localOnly,
      remote: remoteOnly
    });
    expect(sessionOf(merged.merged, 'b')?.notes).toBe('remote only');
    expect(merged.conflictedUnits).toEqual([]);
  });
});

describe('a local edit against a remote delete', () => {
  const base = baseShard();
  const local = clone(base);
  const remote = clone(base);
  local.sessions.a.notes = 'edited locally';
  delete remote.sessions.a;

  const result = mergeDocuments({ family: RESULTS, base, local, remote });

  test('the session returns with local content', () => {
    expect(sessionOf(result.merged, 'a')).toEqual(local.sessions.a);
  });

  test('the edit beats the delete and the unit is conflicted', () => {
    expect(result.conflictedUnits).toEqual(['a']);
    expect(result.needsUpload).toBe(true);
  });
});

describe('a local delete against a remote edit', () => {
  const base = baseShard();
  const local = clone(base);
  const remote = clone(base);
  delete local.sessions.b;
  remote.sessions.b.notes = 'edited remotely';

  const result = mergeDocuments({ family: RESULTS, base, local, remote });

  test('the session returns with remote content', () => {
    expect(sessionOf(result.merged, 'b')).toEqual(remote.sessions.b);
  });

  test('the remote edit beats the local delete', () => {
    expect(sessionOf(result.merged, 'b')?.notes).toBe('edited remotely');
    expect(result.conflictedUnits).toEqual(['b']);
  });
});

describe('a session deleted on both sides', () => {
  const base = baseShard();
  const local = clone(base);
  const remote = clone(base);
  delete local.sessions.b;
  delete remote.sessions.b;

  const result = mergeDocuments({ family: RESULTS, base, local, remote });

  test('the session stays deleted', () => {
    expect(Object.keys(sessionsOf(result.merged))).toEqual(['a']);
    expect(sessionOf(result.merged, 'b')).toBeUndefined();
  });

  test('the unit still counts as touched on both sides', () => {
    expect(result.conflictedUnits).toEqual(['b']);
  });
});

describe('no merge produces a new session ID or a sync copy', () => {
  test('the merged session IDs are the union of the input IDs', () => {
    const base = baseShard();
    const local = clone(base);
    const remote = clone(base);
    local.sessions.c = session('c');
    local.sessions.a.notes = 'local edit';
    remote.sessions.d = session('d');
    remote.sessions.a.status = 'aborted';

    const result = mergeDocuments({ family: RESULTS, base, local, remote });

    const mergedIds = Object.keys(sessionsOf(result.merged)).sort();
    const inputIds = Array.from(
      new Set([
        ...Object.keys(base.sessions),
        ...Object.keys(local.sessions),
        ...Object.keys(remote.sessions)
      ])
    ).sort();
    expect(mergedIds).toEqual(inputIds);
  });

  test('no conflictOf field appears anywhere in the merged document', () => {
    const base = baseShard();
    const local = clone(base);
    const remote = clone(base);
    local.sessions.a.notes = 'local edit';
    remote.sessions.a.notes = 'remote edit';

    const result = mergeDocuments({ family: RESULTS, base, local, remote });
    const names = Array.from(keyNames(result.merged));
    expect(names.filter((name) => name.startsWith('conflictOf'))).toEqual([]);
    expect(names.filter((name) => /copy/i.test(name))).toEqual([]);
  });
});

describe('a merge inside one session result map', () => {
  test('unrelated results stay intact', () => {
    const base = baseShard();
    const local = clone(base);
    const remote = clone(base);

    local.sessions.a.exerciseResults['new-1|both|1'] = {
      workoutId: 'full-body',
      executionPath: [{ nodeId: 'new-1' }],
      exerciseId: 'back-squat',
      side: 'both',
      attempt: 1,
      status: 'completed'
    };
    (remote.sessions.b.exerciseResults['squat-1|both|1'] as Record<string, unknown>) = {
      ...(remote.sessions.b.exerciseResults['squat-1|both|1'] as Record<string, unknown>),
      notes: 'remote touched'
    };

    const result = mergeDocuments({ family: RESULTS, base, local, remote });
    const merged = result.merged;

    const localResults = sessionOf(merged, 'a')!.exerciseResults as Record<string, unknown>;
    expect(Object.keys(localResults).sort()).toEqual(['new-1|both|1', 'squat-1|both|1']);
    expect(sessionOf(merged, 'a')!.exerciseResults['squat-1|both|1']).toEqual(
      base.sessions.a.exerciseResults['squat-1|both|1']
    );
    expect(sessionOf(merged, 'b')!.exerciseResults['squat-1|both|1']).toEqual(
      remote.sessions.b.exerciseResults['squat-1|both|1']
    );
    expect(sessionOf(merged, 'b')!.containerResults).toEqual(base.sessions.b.containerResults);
    expect(result.conflictedUnits).toEqual([]);
  });

  test('a conflicted session keeps the local result map in full', () => {
    const base = baseShard();
    const local = clone(base);
    const remote = clone(base);
    delete local.sessions.a.exerciseResults['squat-1|both|1'];
    (remote.sessions.a.exerciseResults['squat-1|both|1'] as Record<string, unknown>).notes =
      'remote edit';

    const result = mergeDocuments({ family: RESULTS, base, local, remote });

    expect(sessionOf(result.merged, 'a')).toEqual(local.sessions.a);
    expect(result.conflictedUnits).toEqual(['a']);
  });
});

describe('conflict unit reporting', () => {
  test('the observer sees one event per conflicted unit', () => {
    const base = resultsShard({ a: session('a'), b: session('b'), c: session('c') });
    const local = clone(base);
    const remote = clone(base);
    local.sessions.a.notes = 'x';
    local.sessions.c.notes = 'x';
    remote.sessions.a.notes = 'y';
    remote.sessions.b.notes = 'y';

    const events: MergeConflictEvent[] = [];
    const result = mergeDocuments({ family: RESULTS, base, local, remote }, (event) => {
      events.push(event);
    });

    expect(result.conflictedUnits).toEqual(['a']);
    expect(events).toEqual([{ family: RESULTS, unit: 'a' }]);
  });

  test('conflictUnitsFor returns the session keys', () => {
    expect(conflictUnitsFor(RESULTS, baseShard()).sort()).toEqual(['a', 'b']);
    expect(conflictUnitsFor(RESULTS, null)).toEqual([]);
    expect(conflictUnitsFor(RESULTS, { format: 'repjot/results' })).toEqual([]);
  });

  test('unitsTouchedBy maps a nested path to its owning session', () => {
    const delta = {
      sessions: {
        a: { exerciseResults: { 'squat-1|both|1': { notes: ['x', 'y'] } } }
      }
    };
    expect(Array.from(unitsTouchedBy(RESULTS, delta))).toEqual(['a']);
  });

  test('unitsTouchedBy expands a whole-map operation', () => {
    const delta = { sessions: [{ a: session('a'), b: session('b') }, 0, 0] };
    expect(Array.from(unitsTouchedBy(RESULTS, delta)).sort()).toEqual(['a', 'b']);
  });

  test('a top-level field touches no unit', () => {
    const delta = { yearMonthUtc: ['2026-08', '2026-09'] };
    expect(unitsTouchedBy(RESULTS, delta).size).toBe(0);
  });
});

describe('diagnostics', () => {
  test('the default observer records one event per conflicted unit', () => {
    resetDiagnosticLog();
    const base = resultsShard({ a: session('a'), b: session('b') });
    const local = clone(base);
    const remote = clone(base);
    local.sessions.a.notes = 'local';
    local.sessions.b.notes = 'local';
    remote.sessions.a.notes = 'remote';
    remote.sessions.b.notes = 'remote';

    mergeDocuments({ family: RESULTS, base, local, remote });

    const events = diagnosticSnapshot().filter((event) => event.code === 'sync_merge_conflict');
    expect(events.map((event) => `${event.context?.family}/${event.context?.unit}`).sort()).toEqual([
      'repjot/results/a',
      'repjot/results/b'
    ]);
    expect(events.every((event) => event.severity === 'info')).toBe(true);
    resetDiagnosticLog();
  });

  test('an injected observer replaces the diagnostic write', () => {
    resetDiagnosticLog();
    const base = baseShard();
    const local = clone(base);
    const remote = clone(base);
    local.sessions.a.notes = 'local';
    remote.sessions.a.notes = 'remote';

    mergeDocuments({ family: RESULTS, base, local, remote }, () => {});

    expect(diagnosticSnapshot().filter((event) => event.code === 'sync_merge_conflict')).toEqual([]);
    resetDiagnosticLog();
  });
});

describe('no shared document base', () => {
  test('the local document wins whole and every unit reports as conflicted', () => {
    const local = resultsShard({ a: session('a') });
    const remote = resultsShard({ b: session('b'), c: session('c') });

    const events: MergeConflictEvent[] = [];
    const result = mergeDocuments(
      { family: RESULTS, base: null, local, remote },
      (event) => {
        events.push(event);
      }
    );

    expect(result.merged).toEqual(local);
    expect(result.needsUpload).toBe(true);
    expect(result.conflictedUnits).toEqual(['a', 'b', 'c']);
    expect(events.map((event) => event.unit)).toEqual(['a', 'b', 'c']);
  });

  test('an empty base object merges additively and loses nothing', () => {
    const local = baseShard();
    const remote = resultsShard({ z: session('z') });

    const result = mergeDocuments({ family: RESULTS, base: {}, local, remote });
    const merged = result.merged as { sessions: Record<string, unknown> };

    // An empty object is still a shared base, so both sides apply and no session
    // is lost. Only a missing or non-object base forces the whole-local result.
    expect(Object.keys(merged.sessions).sort()).toEqual(['a', 'b', 'z']);
    expect(result.conflictedUnits).toEqual([]);
    expect(result.needsUpload).toBe(true);
  });

  test('the result shares no node with the inputs on this path', () => {
    const local = resultsShard({ a: session('a') });
    const remote = resultsShard({ b: session('b') });

    const result = mergeDocuments({ family: RESULTS, base: null, local, remote });
    const merged = result.merged as { sessions: Record<string, { notes?: string }> };

    merged.sessions.a.notes = 'written after merge';
    expect(local.sessions.a.notes).toBeUndefined();
  });
});

describe('inputs stay untouched', () => {
  test('a merge over frozen inputs writes nothing', () => {
    const base = deepFreeze(baseShard());
    const local = deepFreeze(sessionMergeFixture().local);
    const remote = deepFreeze(sessionMergeFixture().remote);
    const baseJson = JSON.stringify(base);
    const localJson = JSON.stringify(local);
    const remoteJson = JSON.stringify(remote);

    const result = mergeDocuments({ family: RESULTS, base, local, remote });

    expect(JSON.stringify(base)).toBe(baseJson);
    expect(JSON.stringify(local)).toBe(localJson);
    expect(JSON.stringify(remote)).toBe(remoteJson);
    expect(result.needsUpload).toBe(true);
  });

  test('the merged document does not alias an input value', () => {
    const base = baseShard();
    const local = clone(base);
    const remote = clone(base);
    local.sessions.a.notes = 'local only';
    remote.sessions.b.notes = 'remote only';

    const result = mergeDocuments({ family: RESULTS, base, local, remote });
    const merged = result.merged as { sessions: Record<string, { notes?: string }> };

    merged.sessions.a.notes = 'written after merge';
    expect(local.sessions.a.notes).toBe('local only');
    expect(remote.sessions.a.notes).toBeUndefined();
  });
});

/** A local edit and a remote edit on two different sessions. */
function sessionMergeFixture(): { local: Record<string, unknown>; remote: Record<string, unknown> } {
  const local = clone(baseShard());
  const remote = clone(baseShard());
  local.sessions.a.notes = 'local edit';
  remote.sessions.b.notes = 'remote edit';
  return { local, remote };
}
