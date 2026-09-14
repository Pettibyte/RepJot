// Sync fixtures for Phase 10. One `LoadedStaticData` built from the Phase 04
// semantic fixtures, so the coordinator's semantic stage sees the same
// exercises and workouts every other test sees.

import type { LoadedStaticData } from '../../src/documents/static-loader';
import type { Exercise, Workout } from '../../src/domain/types';
import { exercises, workout } from './semantic';

/** The static bundle shape the coordinator needs. */
export function loadedStaticData(
  exerciseList: Exercise[] = exercises(),
  workoutList: Workout[] = [workout()]
): LoadedStaticData {
  return {
    exercises: exerciseList,
    workouts: workoutList,
    exerciseById: new Map(exerciseList.map((exercise) => [exercise.id, exercise])),
    workoutById: new Map(workoutList.map((candidate) => [candidate.id, candidate]))
  };
}

/** The shard logical name that matches the semantic fixtures' month. */
export const SHARD_NAME = 'results-2026-08.json';

/** The preferences logical name. */
export const PREFS_NAME = 'preferences.json';

/** A timer pair that never fires, so a debounce never runs on its own. */
export function frozenTimers(): {
  timers: import('../../src/sync/debounce').TimerSet;
  pending: () => number;
  runAll: () => void;
} {
  const waiting = new Map<number, () => void>();
  let next = 1;
  return {
    timers: {
      setTimeout: (callback: () => void, _delayMs: number): unknown => {
        const id = next;
        next += 1;
        waiting.set(id, callback);
        return id;
      },
      clearTimeout: (handle: unknown): void => {
        waiting.delete(handle as number);
      }
    },
    pending: (): number => waiting.size,
    runAll: (): void => {
      const callbacks = Array.from(waiting.values());
      waiting.clear();
      for (const callback of callbacks) callback();
    }
  };
}
