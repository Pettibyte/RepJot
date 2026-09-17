// The tree resolver: iteration expansion, effective prescriptions, level, and
// the compact path label. Phase 14. REQUIREMENTS 10.2, 10.3, 10.8, 11.17.

import { describe, expect, test } from 'bun:test';
import type { Workout } from '../src/domain/types';
import { encodePath } from '../src/domain/execution-path';
import {
  applyIterationOverrides,
  iterationCount,
  overlayResults,
  resolveTree
} from '../src/sessions/tree-resolver';
import { workout, nestedWorkout, WORKOUT_ID } from './fixtures/semantic';

/** A three-level named tree for the compact path label case. */
function deepWorkout(): Workout {
  return {
    id: 'deep',
    name: 'Deep Workout',
    root: {
      id: 'strength',
      type: 'container',
      name: 'Strength',
      strategy: 'sequence',
      strategyConfig: {},
      children: [
        {
          id: 'complex',
          type: 'container',
          name: 'Complex',
          strategy: 'complex',
          strategyConfig: { cycles: 3 },
          resultCapture: { mode: 'scored', scoreType: 'cycles', childDetail: 'none' },
          children: [
            {
              id: 'kb-complex',
              type: 'exercise',
              exerciseId: 'kb-press',
              stimulus: 'strength',
              prescription: { reps: 5, weight: { value: 16, unit: 'kg' } }
            }
          ]
        }
      ]
    }
  };
}

/**
 * A workout whose root container repeats.
 *
 * The shipped bundle holds two of these, so the resolver cannot treat the root
 * as a single walk. This fixture carries the per-iteration override shape the
 * root case has to honor.
 */
function repeatedRootWorkout(): Workout {
  return {
    id: 'repeated-root',
    name: 'Repeated Root Workout',
    root: {
      id: 'root',
      type: 'container',
      name: 'Repeated Root',
      strategy: 'emom',
      strategyConfig: { cycles: 3, interval: { value: 60, unit: 'second' } },
      children: [
        {
          id: 'child',
          type: 'exercise',
          exerciseId: 'push-up',
          stimulus: 'conditioning',
          prescription: {
            reps: 10,
            iterations: [
              { iteration: 2, reps: 20 },
              { iteration: 3, reps: 30 }
            ]
          }
        }
      ]
    }
  };
}

describe('resolveTree', () => {
  test('a sequence runs once and carries no iteration', () => {
    const nodes = resolveTree(workout());
    const root = nodes[0];
    expect(root?.node.id).toBe('root');
    expect(root?.iteration).toBeUndefined();
    expect(root?.level).toBe(1);
    expect(root?.path).toEqual([{ nodeId: 'root' }]);
  });

  test('a rounds container expands to one occurrence per round', () => {
    const nodes = resolveTree(workout());
    const squatSets = nodes.filter((node) => node.node.id === 'squat-sets');
    expect(squatSets).toHaveLength(3);
    expect(squatSets.map((node) => node.iteration)).toEqual([1, 2, 3]);
    expect(squatSets[2]?.path).toEqual([
      { nodeId: 'root' },
      { nodeId: 'squat-sets', iteration: 3 }
    ]);
  });

  test('a child of a repeated round carries the round on its path', () => {
    const nodes = resolveTree(workout());
    const sets = nodes.filter((node) => node.node.id === 'back-squat-set');
    expect(sets).toHaveLength(3);
    expect(sets[1]?.path).toEqual([
      { nodeId: 'root' },
      { nodeId: 'squat-sets', iteration: 2 },
      { nodeId: 'back-squat-set' }
    ]);
  });

  test('a nested repeated container produces a path segment with its own iteration', () => {
    const nodes = resolveTree(nestedWorkout());
    const inner = nodes.filter((node) => node.node.id === 'inner-amrap');
    // Two outer rounds, each holding the inner AMRAP as its first cycle.
    expect(inner.length).toBeGreaterThanOrEqual(2);
    const secondOuter = inner.find((node) => {
      const outer = node.path.find((segment) => segment.nodeId === 'outer-ring');
      return outer?.iteration === 2 && node.path.some((segment) => segment.nodeId === 'inner-amrap');
    });
    expect(secondOuter).toBeDefined();
    expect(secondOuter?.path).toEqual([
      { nodeId: 'root' },
      { nodeId: 'outer-ring', iteration: 2 },
      { nodeId: 'inner-amrap', iteration: 1 }
    ]);
  });

  test('an AMRAP resolves to its first cycle only', () => {
    const nodes = resolveTree(workout());
    const cindy = nodes.filter((node) => node.node.id === 'cindy');
    expect(cindy).toHaveLength(1);
    expect(cindy[0]?.iteration).toBe(1);
  });

  test('emom and complex expand to their configured cycle count', () => {
    const nodes = resolveTree(workout());
    expect(nodes.filter((node) => node.node.id === 'emom-block')).toHaveLength(4);
    expect(nodes.filter((node) => node.node.id === 'complex-block')).toHaveLength(5);
  });

  test('level is the depth from the root', () => {
    const nodes = resolveTree(deepWorkout());
    const byId = new Map(nodes.map((node) => [`${node.node.id}:${String(node.iteration)}`, node]));
    expect(byId.get('strength:undefined')?.level).toBe(1);
    expect(byId.get('complex:2')?.level).toBe(2);
    expect(byId.get('kb-complex:undefined')?.level).toBe(3);
  });

  test('compactPathLabel renders the named path with the round marker', () => {
    const nodes = resolveTree(deepWorkout());
    const deep = nodes.find(
      (node) => node.node.id === 'kb-complex' && node.path.some((s) => s.iteration === 2)
    );
    expect(deep?.compactPathLabel).toBe('Strength / Complex / Round 2');
  });

  test('the walk is preorder, so a container precedes its children', () => {
    const nodes = resolveTree(workout());
    const order = nodes.map((node) => node.node.id);
    expect(order.indexOf('squat-sets')).toBeLessThan(order.indexOf('back-squat-set'));
    expect(order.indexOf('root')).toBe(0);
  });

  test('a repeated workout root expands one occurrence per cycle', () => {
    const root = repeatedRootWorkout();
    const nodes = resolveTree(root);
    const rootNodes = nodes.filter((node) => node.node.id === 'root');
    expect(rootNodes.map((node) => node.iteration)).toEqual([1, 2, 3]);
    expect(rootNodes.every((node) => node.level === 1)).toBe(true);
  });

  test('a child of a repeated root carries the root iteration on its path', () => {
    const nodes = resolveTree(repeatedRootWorkout());
    const leaves = nodes.filter((node) => node.node.type === 'exercise');
    expect(leaves.map((node) => encodePath(node.path))).toEqual([
      'root:1/child',
      'root:2/child',
      'root:3/child'
    ]);
  });

  test('a repeated root applies the per-iteration override of each cycle', () => {
    const leaves = resolveTree(repeatedRootWorkout()).filter(
      (node) => node.node.type === 'exercise'
    );
    expect(leaves.map((node) => node.effectivePrescription.reps)).toEqual([10, 20, 30]);
  });

  test('a repeated root labels each cycle with its round marker', () => {
    const nodes = resolveTree(repeatedRootWorkout());
    const roots = nodes.filter((node) => node.node.id === 'root');
    expect(roots.map((node) => node.compactPathLabel)).toEqual([
      'Repeated Root / Round 1',
      'Repeated Root / Round 2',
      'Repeated Root / Round 3'
    ]);
  });

  test('a sequence root still resolves once with no iteration', () => {
    const nodes = resolveTree(workout());
    expect(nodes.filter((node) => node.node.id === 'root')).toHaveLength(1);
    expect(nodes[0]?.iteration).toBeUndefined();
  });
});

describe('applyIterationOverrides', () => {
  const prescription = {
    reps: 5,
    weight: { value: 100, unit: 'lb' as const },
    iterations: [{ iteration: 3, weight: { value: 110, unit: 'lb' as const } }]
  };

  test('top-level fields apply to every iteration', () => {
    for (const iteration of [1, 2, 3]) {
      expect(applyIterationOverrides(prescription, iteration).reps).toBe(5);
    }
  });

  test('an iterations entry overrides only the fields it contains', () => {
    const third = applyIterationOverrides(prescription, 3);
    expect(third.weight).toEqual({ value: 110, unit: 'lb' });
    expect(third.reps).toBe(5);
  });

  test('an iteration with no override keeps the top-level fields', () => {
    const second = applyIterationOverrides(prescription, 2);
    expect(second.weight).toEqual({ value: 100, unit: 'lb' });
  });

  test('the override table never survives into the effective prescription', () => {
    expect(applyIterationOverrides(prescription, 3).iterations).toBeUndefined();
  });
});

describe('iterationCount', () => {
  test('each strategy reports its own count', () => {
    const root = workout().root;
    const byId = new Map(root.children.map((child) => [child.id, child]));
    const rounds = byId.get('squat-sets');
    const amrap = byId.get('cindy');
    const emom = byId.get('emom-block');
    const complex = byId.get('complex-block');
    expect(rounds?.type === 'container' && iterationCount(rounds)).toBe(3);
    expect(amrap?.type === 'container' && Number.isFinite(iterationCount(amrap))).toBe(false);
    expect(emom?.type === 'container' && iterationCount(emom)).toBe(4);
    expect(complex?.type === 'container' && iterationCount(complex)).toBe(5);
  });
});

describe('overlayResults', () => {
  test('keys are the composite exercise result keys', () => {
    const nodes = resolveTree(workout());
    const session = {
      id: 'session-aaaa0000-0000-4000-8000-000000000001',
      workoutId: WORKOUT_ID,
      status: 'in_progress' as const,
      startedAtUtc: '2026-08-01T10:00:00Z',
      updatedAtUtc: '2026-08-01T10:00:00Z',
      exerciseResults: {},
      containerResults: {}
    };
    expect(overlayResults(nodes, session).size).toBe(0);
  });
});
