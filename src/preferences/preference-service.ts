// Per-exercise unit preferences, read and written through the coordinator.
// Phase 13. REQUIREMENTS 12.2, 12.3, 12.4, 12.7, 12.8, 12.9.
// SPEC rep-jot-json-schema-spec §4.
//
// One service owns the `exerciseUnits` map so the pill on the Active Workout
// screen and the list on the Settings screen read and write the same thing.
// The service holds no state of its own: the coordinator owns the working
// document, and this module reads and edits it.
//
// Three rules shape the whole file.
//
// 1. The service writes only `preferences.json`. A preference change never
//    touches a saved result, so a unit toggle cannot rewrite workout history.
//    REQUIREMENTS 12.7.
// 2. The coordinator stamps `revision` and `updatedAtUtc` on the upload
//    candidate. See `bumpPreferences` in `sync-coordinator.ts`. The service
//    must not bump them too, or one toggle would advance the counter twice.
//    `revision` is informational. It never selects a migration and never
//    resolves a conflict. SPEC §4.
// 3. A read is synchronous against the coordinator's in-memory document, so
//    a screen can render a pill without awaiting a load. Call `ensureDoc`
//    once at startup. Before that, a read falls back to the static default.

import type { LoadedStaticData } from '../documents/static-loader';
import { AppError } from '../domain/errors';
import type { PreferencesDoc } from '../domain/types';
import { PREFERENCES_NAME } from '../sync/sync-coordinator';
import type { Coordinator } from '../sync/sync-coordinator';
import {
  DIMENSION_ORDER,
  defaultUnit,
  unitsFor,
  type Dimension
} from '../units/conversion';

/** One row of the Settings exercise-unit list. REQUIREMENTS 12.3. */
export interface ExerciseUnitMapping {
  exerciseId: string;
  /** Resolved from the current bundle. Falls back to the raw ID when the
   *  exercise no longer exists, so a stale mapping still lists. */
  exerciseName: string;
  dimension: Dimension;
  unit: string;
}

/** The preference surface the screens use. */
export interface PreferenceService {
  /**
   * The unit for one exercise and dimension.
   *
   * A saved mapping wins when the exercise still lists that unit. Otherwise
   * the first `compatibleUnits` entry is the default. `undefined` means the
   * exercise is unknown or does not measure the dimension, so no unit exists
   * to show.
   */
  getUnit(exerciseId: string, dimension: Dimension): string | undefined;
  /**
   * Save one mapping. Resolves once the edit is durable on this device.
   *
   * @throws AppError `invalid_document` when the unit is not one the exercise
   *         lists for that dimension. Nothing is written in that case.
   */
  setUnit(exerciseId: string, dimension: Dimension, unit: string): Promise<void>;
  /** Every stored mapping, exercise name A-Z, then the fixed dimension order. */
  listMappings(): ExerciseUnitMapping[];
  /** Load the preferences document. Safe to call more than once. */
  ensureDoc(): Promise<PreferencesDoc>;
}

/** Everything the service needs. */
export interface PreferenceServiceDeps {
  coordinator: Coordinator;
  staticData: LoadedStaticData;
}

/** Read the working document out of the coordinator. `undefined` when unloaded. */
function peekDoc(coordinator: Coordinator): PreferencesDoc | undefined {
  const doc = coordinator.peek(PREFERENCES_NAME);
  if (doc === undefined) return undefined;
  const candidate = doc as Partial<PreferencesDoc>;
  if (candidate.exerciseUnits === undefined) return undefined;
  return doc as PreferencesDoc;
}

/**
 * One saved unit, read by own property only.
 *
 * A bracket read on a plain object walks the prototype chain, so an exercise
 * ID of `toString` or `__proto__` would return an inherited member instead of
 * the missing mapping. The preferences key pattern permits those IDs, so the
 * read checks each level with `hasOwnProperty` and returns `undefined` when the
 * key is not the document's own.
 */
function readSavedUnit(
  exerciseUnits: Record<string, Record<string, string>> | undefined,
  exerciseId: string,
  dimension: Dimension
): string | undefined {
  if (exerciseUnits === undefined || exerciseUnits === null) return undefined;
  const ownsExercise = Object.prototype.hasOwnProperty.call(exerciseUnits, exerciseId);
  if (!ownsExercise) return undefined;
  const dimensions = exerciseUnits[exerciseId];
  if (dimensions === null || typeof dimensions !== 'object') return undefined;
  if (!Object.prototype.hasOwnProperty.call(dimensions, dimension)) return undefined;
  return dimensions[dimension];
}

/**
 * The preference service for one account.
 *
 * `staticData` supplies the exercise directory, which is what makes a unit
 * legal or illegal for a given exercise. The coordinator supplies the live
 * document and the whole save path.
 */
export function createPreferenceService(deps: PreferenceServiceDeps): PreferenceService {
  const { coordinator, staticData } = deps;

  /**
   * The exercise's own list for one dimension, as a set.
   *
   * A saved mapping is honored only when the exercise still lists the unit.
   * A static-data change can leave a stored unit behind that the exercise no
   * longer accepts. The semantic stage already reports that as unresolved,
   * and the pill must not offer a unit the exercise cannot hold, so the read
   * falls back to the default.
   */
  function isListedByExercise(exerciseId: string, dimension: Dimension, unit: string): boolean {
    const exercise = staticData.exerciseById.get(exerciseId);
    return unitsFor(exercise, dimension).indexOf(unit) >= 0;
  }

  function getUnit(exerciseId: string, dimension: Dimension): string | undefined {
    const exercise = staticData.exerciseById.get(exerciseId);
    const doc = peekDoc(coordinator);
    const saved = readSavedUnit(doc?.exerciseUnits, exerciseId, dimension);
    if (typeof saved === 'string' && isListedByExercise(exerciseId, dimension, saved)) {
      return saved;
    }
    return defaultUnit(exercise, dimension);
  }

  function setUnit(exerciseId: string, dimension: Dimension, unit: string): Promise<void> {
    const exercise = staticData.exerciseById.get(exerciseId);
    if (exercise === undefined) {
      return Promise.reject(
        new AppError(
          'invalid_document',
          { reason: 'unknown_exercise', exerciseId },
          'That exercise is not in the current bundle.'
        )
      );
    }
    if (!isListedByExercise(exerciseId, dimension, unit)) {
      // Rejected before the coordinator is called, so no local row and no
      // upload happens. The document on Drive keeps its previous content.
      return Promise.reject(
        new AppError(
          'invalid_document',
          { reason: 'unit_incompatible', exerciseId, dimension, unit },
          'That unit is not one this exercise lists.'
        )
      );
    }

    // The mutator sets one leaf and nothing else. It does not touch
    // `revision` or `updatedAtUtc`: the coordinator stamps both on the
    // upload candidate in `bumpPreferences`, and stamping here as well
    // would advance the counter twice per toggle. `revision` is
    // informational either way. It never selects a migration and never
    // resolves a conflict. SPEC §4.
    //
    // The map is rebuilt through a `Map` and serialized with
    // `Object.fromEntries`. A direct `exerciseMap[exerciseId] = ...` on a
    // plain object would set the object's *prototype* when `exerciseId` is
    // `__proto__`, so the mapping would vanish on serialize: accepted, never
    // written, no error raised. `Object.fromEntries` defines each key as an
    // own data property, so `__proto__` survives as a key like any other.
    return coordinator
      .edit(PREFERENCES_NAME, (doc: unknown): unknown => {
        const current = (doc ?? {}) as PreferencesDoc;
        const byExercise = new Map<string, Record<string, string>>(
          Object.entries(current.exerciseUnits ?? {})
        );
        const dimensions = new Map<string, string>(
          Object.entries(byExercise.get(exerciseId) ?? {})
        );
        dimensions.set(dimension, unit);
        byExercise.set(exerciseId, Object.fromEntries(dimensions));
        return { ...current, exerciseUnits: Object.fromEntries(byExercise) };
      })
      .then((handle): void => {
        // Local durability is the contract. The coordinator already drives
        // the save-status store through `Saving`, `Saved`, and `Sync failed`,
        // so the sync outcome reaches the user without this promise. The
        // handler is attached so a failed upload is never an unhandled
        // rejection. REQUIREMENTS 4.1, 4.3.
        void handle.synced.catch(() => undefined);
      });
  }

  function listMappings(): ExerciseUnitMapping[] {
    const doc = peekDoc(coordinator);
    if (doc === undefined) return [];
    const rows: ExerciseUnitMapping[] = [];
    for (const [exerciseId, dimensions] of Object.entries(doc.exerciseUnits)) {
      if (dimensions === null || typeof dimensions !== 'object') continue;
      const exercise = staticData.exerciseById.get(exerciseId);
      const exerciseName = exercise?.name ?? exerciseId;
      for (const [dimension, unit] of Object.entries(dimensions)) {
        if (typeof unit !== 'string') continue;
        rows.push({
          exerciseId,
          exerciseName,
          dimension: dimension as Dimension,
          unit
        });
      }
    }
    // The document is a keyed map, so its key order is not a display order.
    // REQUIREMENTS 3.17, 3.19. Sort by the name a person reads, then by the
    // fixed dimension order, so the Settings list is stable across devices.
    rows.sort((a, b): number => {
      if (a.exerciseName !== b.exerciseName) return a.exerciseName < b.exerciseName ? -1 : 1;
      const aIndex = DIMENSION_ORDER.indexOf(a.dimension);
      const bIndex = DIMENSION_ORDER.indexOf(b.dimension);
      // An unknown dimension sorts last, so it still shows instead of
      // disappearing from the list a user needs to clean up.
      const aRank = aIndex < 0 ? Number.MAX_SAFE_INTEGER : aIndex;
      const bRank = bIndex < 0 ? Number.MAX_SAFE_INTEGER : bIndex;
      if (aRank !== bRank) return aRank < bRank ? -1 : 1;
      return a.unit < b.unit ? -1 : a.unit > b.unit ? 1 : 0;
    });
    return rows;
  }

  async function ensureDoc(): Promise<PreferencesDoc> {
    const doc = (await coordinator.ensureLoaded(PREFERENCES_NAME)) as PreferencesDoc;
    return doc;
  }

  return { getUnit, setUnit, listMappings, ensureDoc };
}
