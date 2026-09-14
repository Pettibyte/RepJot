// Index build benchmark. Phase 12 manual verification.
//
// Synthesizes 24 months of result shards at a realistic volume, builds the
// `DataIndex`, and prints the build time and the entry counts. Run with:
//
//     bun run bench:index
//
// No Drive account and no network. The synthetic shard shape matches
// `ResultsShard` in `src/domain/types.ts`, so the builder sees the same shape it
// sees in production. The exercise and workout data comes from the real bundled
// files, so the node map and the muscle map size like the real ones.
//
// The numbers answer the Phase 12 checklist item: how long a 24-month rebuild
// takes, and how many entries it holds.

import exercisesJson from '../src/public/data/exercises.json';
import workoutsJson from '../src/public/data/workouts.json';
import type { LoadedStaticData } from '../src/documents/static-loader';
import type { ExercisesDoc, WorkoutsDoc } from '../src/domain/types';
import { encodePath, exerciseResultKey, type PathSegment } from '../src/domain/execution-path';
import type {
  ContainerNode,
  ExerciseResult,
  ResultsShard,
  Score,
  Session,
  WorkoutNode
} from '../src/domain/types';
import { buildIndex } from '../src/indexes/index-builder';

/** Months of synthetic history. */
const MONTHS = 24;

/** Sessions per month. Four training days a week, one session each. */
const SESSIONS_PER_MONTH = 16;

/** First month of the synthetic range. */
const START_YEAR = 2024;
const START_MONTH = 10;

// A JSON import widens every enum and literal field to `string`, so the object does
// not satisfy `Exercise[]` or `Workout[]`. The files are schema-validated by
// `bun run check:schemas`, so the cast restates what the build already proved.
const exercises = (exercisesJson as unknown as ExercisesDoc).exercises;
const workouts = (workoutsJson as unknown as WorkoutsDoc).workouts;

const staticData: LoadedStaticData = {
  exercises,
  workouts,
  exerciseById: new Map(exercises.map((exercise) => [exercise.id, exercise])),
  workoutById: new Map(workouts.map((workout) => [workout.id, workout]))
};

/** One exercise leaf, with the path that reaches it from the workout root. */
interface Leaf {
  exerciseId: string;
  path: PathSegment[];
}

/** Collect every exercise leaf in one workout. */
function leavesOf(workoutId: string): Leaf[] {
  const workout = staticData.workoutById.get(workoutId);
  if (workout === undefined) return [];

  const out: Leaf[] = [];
  const walk = (node: WorkoutNode, parent: PathSegment[]): void => {
    const path: PathSegment[] = [...parent, { nodeId: node.id }];
    if (node.type === 'exercise') {
      out.push({ exerciseId: node.exerciseId, path });
      return;
    }
    const container = node as ContainerNode;
    for (const child of container.children) walk(child, path);
  };

  walk(workout.root, []);
  return out;
}

/** Build one session with one completed result per exercise leaf. */
function synthSession(
  workoutId: string,
  leaves: Leaf[],
  yearMonthUtc: string,
  day: string,
  index: number
): Session {
  const exerciseResults: Record<string, ExerciseResult> = {};

  leaves.forEach((leaf, leafIndex) => {
    const reps = 5 + ((index + leafIndex) % 8);
    const result: ExerciseResult = {
      workoutId,
      executionPath: leaf.path,
      exerciseId: leaf.exerciseId,
      side: 'both',
      attempt: 1,
      status: 'completed',
      values: { reps: { value: reps, unit: 'reps' } },
      startedAtUtc: `${yearMonthUtc}-${day}T08:00:00Z`,
      endedAtUtc: `${yearMonthUtc}-${day}T08:${String(leafIndex % 60).padStart(2, '0')}:00Z`
    };
    exerciseResults[exerciseResultKey(leaf.path, 'both', 1)] = result;
  });

  const id = `session-synth-${index}`;
  return {
    id,
    workoutId,
    status: 'completed',
    startedAtUtc: `${yearMonthUtc}-${day}T08:00:00Z`,
    completedAtUtc: `${yearMonthUtc}-${day}T09:00:00Z`,
    updatedAtUtc: `${yearMonthUtc}-${day}T09:00:00Z`,
    exerciseResults,
    containerResults: synthContainerResults(workoutId, index)
  };
}

/**
 * One container score per scored container in the workout.
 *
 * Without these the container indexing path stays unmeasured, so the reported
 * build time would understate the real cost.
 */
function synthContainerResults(workoutId: string, index: number): Session['containerResults'] {
  const out: Session['containerResults'] = {};
  const workout = staticData.workoutById.get(workoutId);
  if (workout === undefined) return out;

  const walk = (node: WorkoutNode, parent: PathSegment[]): void => {
    const path: PathSegment[] = [...parent, { nodeId: node.id }];
    if (node.type === 'container' && node.resultCapture !== undefined) {
      const scoreType = node.resultCapture.scoreType;
      const score: Score =
        scoreType === 'cycles'
          ? { type: 'cycles', completedCycles: 3 + (index % 4) }
          : scoreType === 'intervals'
            ? { type: 'intervals', completedIntervals: 4, totalIntervals: 4 }
            : { type: 'rounds_and_reps', completedRounds: 5 + (index % 6), additionalReps: 3 };
      out[`${encodePath(path)}|1`] = {
        workoutId,
        executionPath: path,
        attempt: 1,
        status: 'completed',
        score
      };
    }
    if (node.type === 'container') {
      for (const child of node.children) walk(child, path);
    }
  };

  walk(workout.root, []);
  return out;
}

/** Build the 24-month shard set. */
function synthShards(): ResultsShard[] {
  const shards: ResultsShard[] = [];
  let sessionIndex = 0;

  for (let m = 0; m < MONTHS; m += 1) {
    const absolute = START_YEAR * 12 + (START_MONTH - 1) + m;
    const year = Math.floor(absolute / 12);
    const month = (absolute % 12) + 1;
    const yearMonthUtc = `${year}-${String(month).padStart(2, '0')}`;

    const workout = workouts[sessionIndex % workouts.length]!;
    const leaves = leavesOf(workout.id);
    const sessions: Record<string, Session> = {};

    for (let s = 0; s < SESSIONS_PER_MONTH; s += 1) {
      const day = String(1 + (s % 27)).padStart(2, '0');
      const session = synthSession(workout.id, leaves, yearMonthUtc, day, sessionIndex);
      sessions[session.id] = session;
      sessionIndex += 1;
    }

    shards.push({
      format: 'repjot/results',
      schemaVersion: 1,
      yearMonthUtc,
      sessions
    });
  }

  return shards;
}

function count(map: Map<string, unknown[]>): number {
  let total = 0;
  for (const list of map.values()) total += list.length;
  return total;
}

const shards = synthShards();

const started = performance.now();
const index = buildIndex({ staticData, shards, unresolved: [] });
const elapsedMs = performance.now() - started;

let musclePairCount = 0;
for (const set of index.exerciseIdsByMuscleGroup.values()) musclePairCount += set.size;

console.log(`Exercises in bundle:         ${exercises.length}`);
console.log(`Workouts in bundle:          ${workouts.length}`);
console.log(`Months of shards:            ${MONTHS}`);
console.log(`Sessions:                    ${index.sessionsById.size}`);
console.log(`Exercise occurrences:        ${count(index.occurrencesByExerciseId)}`);
console.log(`Container occurrences:       ${count(index.containerOccurrencesBySessionId)}`);
console.log(`Workout node lookups:        ${index.nodeByWorkoutAndId.size}`);
console.log(`Muscle-to-exercise pairs:    ${musclePairCount}`);
console.log(`Capped recent occurrences:   ${count(index.recentByExerciseId)}`);
console.log(`Recent sessions:             ${index.recentSessions.length}`);
console.log(`Active sessions:             ${index.activeSessionsByUpdatedAtUtc.length}`);
console.log(`Build time:                  ${elapsedMs.toFixed(1)} ms`);
