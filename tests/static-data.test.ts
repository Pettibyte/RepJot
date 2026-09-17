// Guards over a synthetic static bundle. Production data is validated by the build
// gate; these tests keep strategy and semantic coverage independent of bundle curation.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  ContainerNode,
  ContainerNodeFor,
  ContainerStrategy,
  Exercise,
  ExerciseNode,
  Workout,
  WorkoutNode
} from '../src/domain/types';
import { validateStaticData, validateWorkoutSemantics } from '../src/validation/semantic-validator';
import { staticData, workout } from './fixtures/semantic';

const ROOT = join(import.meta.dir, '..');
const fixture = staticData();
const exerciseById = new Map<string, Exercise>(fixture.exercises.map((exercise) => [exercise.id, exercise]));
const demoWorkout = workout();

function workoutWithId(id: string): Workout {
  const found = fixture.workouts.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`fixture workout "${id}" is missing`);
  return found;
}

function walkNodes(node: WorkoutNode, visit: (node: WorkoutNode) => void): void {
  visit(node);
  if (node.type === 'container') for (const child of node.children) walkNodes(child, visit);
}

function collect<T>(root: WorkoutNode, pick: (node: WorkoutNode) => T | undefined): T[] {
  const found: T[] = [];
  walkNodes(root, (node) => {
    const picked = pick(node);
    if (picked !== undefined) found.push(picked);
  });
  return found;
}

function containersUnder(node: WorkoutNode): ContainerNode[] {
  return collect(node, (candidate) => candidate.type === 'container' ? candidate : undefined);
}

function exerciseNodesUnder(node: WorkoutNode): ExerciseNode[] {
  return collect(node, (candidate) => candidate.type === 'exercise' ? candidate : undefined);
}

function containersOf<S extends ContainerStrategy>(candidate: Workout, strategy: S): ContainerNodeFor<S>[] {
  return containersUnder(candidate.root).filter(
    (container) => container.strategy === strategy
  ) as ContainerNodeFor<S>[];
}

function allKeys(value: unknown): string[] {
  const keys: string[] = [];
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === null || typeof current !== 'object') continue;
    if (Array.isArray(current)) {
      stack.push(...current);
      continue;
    }
    for (const [key, child] of Object.entries(current)) {
      keys.push(key);
      stack.push(child);
    }
  }
  return keys;
}

describe('synthetic static fixtures', () => {
  test('the fixture documents carry their envelopes', () => {
    expect(fixture.exercises.length).toBeGreaterThan(0);
    expect(fixture.workouts).toHaveLength(1);
  });

  test('the fixture pair passes validateStaticData', () => {
    expect(validateStaticData(fixture.exercises, fixture.workouts)).toEqual([]);
  });

  test('the fixture pair passes the runtime prescription pass', () => {
    expect(validateWorkoutSemantics(fixture.workouts, fixture.exercises)).toEqual([]);
  });

  test('every fixture workout node exerciseId resolves', () => {
    const unresolved: string[] = [];
    for (const candidate of fixture.workouts) {
      for (const node of exerciseNodesUnder(candidate.root)) {
        if (!exerciseById.has(node.exerciseId)) unresolved.push(`${candidate.id}/${node.id}`);
      }
    }
    expect(unresolved).toEqual([]);
  });

  test('the fixture carries no deprecated field', () => {
    const document = { format: 'repjot/static-fixture', ...fixture };
    expect(allKeys(document).filter((key) => key === 'deprecated')).toEqual([]);
  });

  test('package.json registers check:static inside the build chain', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts['check:static']).toBe('bun scripts/check-static-data.ts');
    expect(pkg.scripts.build).toContain('check:static');
    expect(pkg.scripts.build.indexOf('check:static')).toBeLessThan(pkg.scripts.build.indexOf('vite build'));
  });
});

describe('fixture workout strategies', () => {
  test('covers sequence root, rounds overrides, and a benchmark AMRAP', () => {
    expect(demoWorkout.root.strategy).toBe('sequence');
    expect(containersOf(demoWorkout, 'rounds').length).toBeGreaterThan(0);
    expect(exerciseNodesUnder(demoWorkout.root).some((node) => node.prescription.iterations !== undefined)).toBe(true);
    const [amrap] = containersOf(demoWorkout, 'amrap');
    expect(amrap?.resultCapture?.scoreType).toBe('rounds_and_reps');
    expect(amrap?.resultCapture?.childDetail).toBe('optional');
    expect(amrap?.benchmark?.name).toBe('Cindy');
  });

  test('covers EMOM cycles, interval, and interval scoring', () => {
    const [emom] = containersOf(demoWorkout, 'emom');
    expect(emom?.strategyConfig.cycles).toBeGreaterThan(0);
    expect(emom?.strategyConfig.interval.value).toBeGreaterThan(0);
    expect(emom?.resultCapture?.scoreType).toBe('intervals');
  });

  test('covers complex cycles, none child detail, and load semantics', () => {
    const [complex] = containersOf(demoWorkout, 'complex');
    expect(complex?.strategyConfig.cycles).toBeGreaterThan(0);
    expect(complex?.resultCapture?.childDetail).toBe('none');
    const semantics = exerciseNodesUnder(complex!).map((node) => exerciseById.get(node.exerciseId)?.loadSemantics);
    expect(semantics).toContain('total');
  });

  test('covers nested sequences, mobility stimulus, and warmup sets', () => {
    const nested = containersOf(demoWorkout, 'sequence').filter((container) =>
      container.children.some((child) => child.type === 'container' && child.strategy === 'sequence')
    );
    expect(nested.length).toBeGreaterThan(0);
    const nodes = exerciseNodesUnder(demoWorkout.root);
    expect(nodes.some((node) => node.stimulus === 'mobility')).toBe(true);
    expect(nodes.some((node) => node.setType === 'warmup')).toBe(true);
  });
});
