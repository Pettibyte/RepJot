// Guards over the committed static files.
// Phase 05, REQUIREMENTS 6.13-6.15, 6.19-6.22, 10.1-10.11.
//
// These tests read the files the app ships, not fixtures. They fail when a later
// change drops a shape a later phase depends on, so `workouts.json` cannot quietly
// lose its EMOM, its complex, or its benchmark.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  ContainerNode,
  ContainerNodeFor,
  ContainerStrategy,
  Exercise,
  ExercisesDoc,
  ExerciseNode,
  Workout,
  WorkoutNode,
  WorkoutsDoc
} from '../src/domain/types';
import { validateStaticData, validateWorkoutSemantics } from '../src/validation/semantic-validator';

const ROOT = join(import.meta.dir, '..');
const EXERCISES_PATH = join(ROOT, 'src/public/data/exercises.json');
const WORKOUTS_PATH = join(ROOT, 'src/public/data/workouts.json');

const exercisesDoc = JSON.parse(readFileSync(EXERCISES_PATH, 'utf8')) as ExercisesDoc;
const workoutsDoc = JSON.parse(readFileSync(WORKOUTS_PATH, 'utf8')) as WorkoutsDoc;

const exercises = exercisesDoc.exercises;
const workouts = workoutsDoc.workouts;
const exerciseById = new Map<string, Exercise>(
  exercises.map((exercise) => [exercise.id, exercise])
);

function workoutWithId(id: string): Workout {
  const found = workouts.find((workout) => workout.id === id);
  if (found === undefined) {
    throw new Error(`workout "${id}" is missing from workouts.json`);
  }
  return found;
}

/** Depth-first walk over every node under one node, that node first. */
function walkNodes(node: WorkoutNode, visit: (node: WorkoutNode) => void): void {
  visit(node);
  if (node.type === 'container') {
    for (const child of node.children) walkNodes(child, visit);
  }
}

function containersUnder(node: WorkoutNode): ContainerNode[] {
  return collect(node, (candidate) => (candidate.type === 'container' ? candidate : undefined));
}

function exerciseNodesUnder(node: WorkoutNode): ExerciseNode[] {
  return collect(node, (candidate) => (candidate.type === 'exercise' ? candidate : undefined));
}

/** Collects nodes under `root` in depth-first order through one picker. */
function collect<T>(root: WorkoutNode, pick: (node: WorkoutNode) => T | undefined): T[] {
  const found: T[] = [];
  walkNodes(root, (node) => {
    const picked = pick(node);
    if (picked !== undefined) found.push(picked);
  });
  return found;
}

/**
 * Containers of one strategy, typed by that strategy.
 *
 * The cast is safe because `strategy` and `strategyConfig` are paired by the
 * workouts schema, and this filter keeps only the matching branch.
 */
function containersOf<S extends ContainerStrategy>(workout: Workout, strategy: S): ContainerNodeFor<S>[] {
  return containersUnder(workout.root).filter(
    (container) => container.strategy === strategy
  ) as ContainerNodeFor<S>[];
}

/** Every key name that appears anywhere in a value, at any depth. */
function allKeys(value: unknown): string[] {
  const keys: string[] = [];
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === null || typeof current !== 'object') continue;
    if (Array.isArray(current)) {
      for (const item of current) stack.push(item);
      continue;
    }
    for (const [key, child] of Object.entries(current)) {
      keys.push(key);
      stack.push(child);
    }
  }
  return keys;
}

describe('committed static files', () => {
  test('both files carry their envelope', () => {
    expect(exercisesDoc.format).toBe('repjot/exercises');
    expect(workoutsDoc.format).toBe('repjot/workouts');
    expect(exercises.length).toBeGreaterThan(0);
    expect(workouts.length).toBeGreaterThanOrEqual(4);
  });

  test('the committed pair passes validateStaticData', () => {
    expect(validateStaticData(exercises, workouts)).toEqual([]);
  });

  test('the committed pair passes the runtime prescription pass too', () => {
    // The build gate runs only the three identity checks, per REQUIREMENTS 6.22.
    // That leaves the authored prescription rules unguarded by the build, so this
    // test carries them: an `iterations` override past its container's count, or
    // a weight on an exercise that cannot hold one, fails here.
    expect(validateWorkoutSemantics(workouts, exercises)).toEqual([]);
  });

  test('every workout node exerciseId resolves in the committed exercises', () => {
    const unresolved: string[] = [];
    for (const workout of workouts) {
      for (const node of exerciseNodesUnder(workout.root)) {
        if (!exerciseById.has(node.exerciseId)) {
          unresolved.push(`${workout.id}/${node.id} -> ${node.exerciseId}`);
        }
      }
    }
    expect(unresolved).toEqual([]);
  });

  test('neither committed file carries a deprecated field', () => {
    // REQUIREMENTS 6.13: static data has no lifecycle flag. A `deprecated` key
    // anywhere, on any shape, breaks that rule.
    const offenders = [exercisesDoc, workoutsDoc]
      .flatMap((doc) => allKeys(doc))
      .filter((key) => key === 'deprecated');
    expect(offenders).toEqual([]);
  });

  test('package.json registers check:static inside the build chain', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts['check:static']).toBe('bun scripts/check-static-data.ts');
    expect(pkg.scripts.build).toContain('check:static');
    expect(pkg.scripts.build.indexOf('check:static')).toBeLessThan(
      pkg.scripts.build.indexOf('vite build')
    );
  });
});

describe('committed workout strategies', () => {
  test('strength-and-cindy covers sequence root, rounds overrides, and a benchmark AMRAP', () => {
    const workout = workoutWithId('strength-and-cindy');
    expect(workout.root.strategy).toBe('sequence');

    const rounds = containersOf(workout, 'rounds');
    expect(rounds.length).toBeGreaterThan(0);
    for (const container of rounds) {
      expect(container.strategyConfig.rounds).toBeGreaterThan(0);
    }

    // A rounds container holds a per-iteration prescription override.
    const withIterations = exerciseNodesUnder(workout.root).filter(
      (node) => node.prescription.iterations !== undefined
    );
    expect(withIterations.length).toBeGreaterThan(0);

    const [amrap] = containersOf(workout, 'amrap');
    expect(amrap).toBeDefined();
    expect(amrap?.resultCapture?.scoreType).toBe('rounds_and_reps');
    expect(amrap?.resultCapture?.childDetail).toBe('optional');
    expect(amrap?.benchmark?.name).toBe('Cindy');
  });

  test('emom-conditioning covers cycles, interval, and the intervals score', () => {
    const workout = workoutWithId('emom-conditioning');

    const [emom] = containersOf(workout, 'emom');
    expect(emom).toBeDefined();
    expect(emom?.strategyConfig.cycles).toBeGreaterThan(0);
    expect(emom?.strategyConfig.interval.value).toBeGreaterThan(0);
    expect(emom?.resultCapture?.scoreType).toBe('intervals');
    expect(emom?.resultCapture?.childDetail).toBe('optional');
  });

  test('kb-complex covers a none-detail complex with added and assisted load', () => {
    const workout = workoutWithId('kb-complex');

    const [complex] = containersOf(workout, 'complex');
    expect(complex).toBeDefined();
    expect(complex?.strategyConfig.cycles).toBeGreaterThan(0);
    expect(complex?.resultCapture?.childDetail).toBe('none');

    const semantics = exerciseNodesUnder(complex).map(
      (node) => exerciseById.get(node.exerciseId)?.loadSemantics
    );
    expect(semantics).toContain('added');
    expect(semantics).toContain('assisted');
  });

  test('warmup-mobility covers nested sequences, mobility stimulus, and warmup sets', () => {
    const workout = workoutWithId('warmup-mobility');

    const nested = containersOf(workout, 'sequence').filter((container) =>
      container.children.some(
        (child) => child.type === 'container' && child.strategy === 'sequence'
      )
    );
    expect(nested.length).toBeGreaterThan(0);

    const nodes = exerciseNodesUnder(workout.root);
    expect(nodes.some((node) => node.stimulus === 'mobility')).toBe(true);
    expect(nodes.some((node) => node.setType === 'warmup')).toBe(true);
  });
});
