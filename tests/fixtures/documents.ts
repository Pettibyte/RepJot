// Known-good v1 documents, one per family, plus test-only schemas and steps.
//
// The test-only schemas live here, not under `schemas/`, so they never ship. A
// test registers them with `registerValidator`, which raises the family's highest
// supported version for the test.

import type { Migration } from '../../src/migrations/migration-registry';

export const SESSION_KEY = 'session-3f2a6b1c-8d4e-4a7b-9c5d-1e2f3a4b5c6d';

export function exercisesDoc(): Record<string, unknown> {
  return {
    format: 'repjot/exercises',
    schemaVersion: 1,
    exercises: [
      {
        id: 'back-squat',
        name: 'Back Squat',
        instructions: ['Set the bar on your upper back.', 'Descend until the hip crease passes the knee.'],
        icon: { type: 'material_symbol', name: 'fitness_center' },
        equipment: 'barbell',
        force: 'push',
        mechanic: 'compound',
        category: 'strength',
        level: 'intermediate',
        movementPattern: 'squat',
        primaryMuscles: ['quadriceps'],
        secondaryMuscles: ['glutes'],
        laterality: 'bilateral',
        measurements: [{ dimension: 'weight', compatibleUnits: ['lb', 'kg'] }],
        loadSemantics: 'total'
      }
    ]
  };
}

export function workoutsDoc(): Record<string, unknown> {
  return {
    format: 'repjot/workouts',
    schemaVersion: 1,
    workouts: [
      {
        id: 'full-body',
        name: 'Full Body',
        root: {
          id: 'root',
          type: 'container',
          strategy: 'sequence',
          strategyConfig: {},
          children: [
            {
              id: 'squat-1',
              type: 'exercise',
              exerciseId: 'back-squat',
              stimulus: 'strength',
              prescription: { reps: 5, weight: { value: 100, unit: 'lb' } }
            }
          ]
        }
      }
    ]
  };
}

export function preferencesDoc(): Record<string, unknown> {
  return {
    format: 'repjot/preferences',
    schemaVersion: 1,
    revision: 3,
    updatedAtUtc: '2026-08-15T07:30:00Z',
    exerciseUnits: {
      'back-squat': { weight: 'kg' }
    }
  };
}

export function resultsDoc(): Record<string, unknown> {
  return {
    format: 'repjot/results',
    schemaVersion: 1,
    yearMonthUtc: '2026-08',
    sessions: {
      [SESSION_KEY]: {
        id: SESSION_KEY,
        workoutId: 'full-body',
        status: 'completed',
        startedAtUtc: '2026-08-15T07:30:00Z',
        completedAtUtc: '2026-08-15T08:00:00Z',
        updatedAtUtc: '2026-08-15T08:00:00Z',
        exerciseResults: {
          'squat-1|both|1': {
            workoutId: 'full-body',
            executionPath: [{ nodeId: 'squat-1' }],
            exerciseId: 'back-squat',
            side: 'both',
            attempt: 1,
            status: 'completed',
            values: {
              reps: { value: 5, unit: 'reps' },
              weight: { value: 100, unit: 'kg' }
            }
          }
        },
        containerResults: {
          'root|1': {
            workoutId: 'full-body',
            executionPath: [{ nodeId: 'root' }],
            attempt: 1,
            status: 'completed',
            score: { type: 'cycles', completedCycles: 1 }
          }
        }
      }
    }
  };
}

/**
 * Test-only v2 preferences schema.
 *
 * Adds a required `theme` field and moves `schemaVersion` to 2. Standalone: it
 * references no other schema file.
 */
export function preferencesV2Schema(): Record<string, unknown> {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://repjot.test/schemas/preferences/v2.schema.json',
    title: 'REP JOT Preferences (test v2)',
    type: 'object',
    additionalProperties: false,
    required: ['format', 'schemaVersion', 'revision', 'updatedAtUtc', 'exerciseUnits', 'theme'],
    properties: {
      format: { const: 'repjot/preferences' },
      schemaVersion: { const: 2 },
      revision: { type: 'integer', minimum: 0 },
      updatedAtUtc: { type: 'string', format: 'date-time', pattern: 'Z$' },
      exerciseUnits: {
        type: 'object',
        propertyNames: { type: 'string', minLength: 1, pattern: '^(?![0-9]+$)[^/|:]+$' },
        additionalProperties: {
          type: 'object',
          additionalProperties: false,
          minProperties: 1,
          properties: {
            reps: { const: 'reps' },
            weight: { enum: ['lb', 'kg'] },
            addedWeight: { enum: ['lb', 'kg'] },
            assistedWeight: { enum: ['lb', 'kg'] },
            distance: { enum: ['m', 'km', 'ft', 'mi'] },
            duration: { enum: ['second', 'minute'] },
            calories: { const: 'kcal' }
          }
        }
      },
      theme: { enum: ['light', 'dark'] }
    }
  };
}

/**
 * Test-only v3 preferences schema.
 *
 * Drops `revision` and moves `schemaVersion` to 3.
 */
export function preferencesV3Schema(): Record<string, unknown> {
  const v2 = preferencesV2Schema() as { properties: Record<string, unknown> };
  const properties: Record<string, unknown> = { ...v2.properties, schemaVersion: { const: 3 } };
  delete properties.revision;

  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://repjot.test/schemas/preferences/v3.schema.json',
    title: 'REP JOT Preferences (test v3)',
    type: 'object',
    additionalProperties: false,
    required: ['format', 'schemaVersion', 'updatedAtUtc', 'exerciseUnits', 'theme'],
    properties
  };
}

/** A v1 -> v2 step that adds the field the v2 schema requires. */
export function preferencesV1ToV2(): Migration {
  return {
    family: 'repjot/preferences',
    fromVersion: 1,
    toVersion: 2,
    migrate(input: unknown): unknown {
      const source = input as Record<string, unknown>;
      return { ...source, schemaVersion: 2, theme: 'light' };
    }
  };
}

/** A v2 -> v3 step that drops the field the v3 schema removed. */
export function preferencesV2ToV3(): Migration {
  return {
    family: 'repjot/preferences',
    fromVersion: 2,
    toVersion: 3,
    migrate(input: unknown): unknown {
      const source = input as Record<string, unknown>;
      const copy: Record<string, unknown> = { ...source };
      delete copy.revision;
      copy.schemaVersion = 3;
      return copy;
    }
  };
}

/** A preferences document that fails the v1 schema: `revision` is not a number. */
export function brokenPreferencesDoc(): Record<string, unknown> {
  return {
    format: 'repjot/preferences',
    schemaVersion: 1,
    revision: 'three',
    updatedAtUtc: '2026-08-15T07:30:00Z',
    exerciseUnits: {}
  };
}

/** Deep-freeze a value and everything reachable from it. */
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}
