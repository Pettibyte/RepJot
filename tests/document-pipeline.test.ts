// Tests for the eight-stage document pipeline.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { AppError } from '../src/domain/errors';
import { processDocument, processJson } from '../src/documents/document-pipeline';
import { MAX_DOCUMENT_BYTES, MAX_NESTING_DEPTH } from '../src/documents/limits';
import {
  registerMigration,
  resetMigrationsForTesting
} from '../src/migrations/migration-registry';
import {
  registerValidator,
  resetValidatorsForTesting,
  type DocFamily
} from '../src/validation/schema-validator';
import {
  brokenPreferencesDoc,
  deepFreeze,
  exercisesDoc,
  preferencesDoc,
  preferencesV1ToV2,
  preferencesV2Schema,
  preferencesV2ToV3,
  preferencesV3Schema,
  resultsDoc,
  workoutsDoc
} from './fixtures/documents';

const KNOWN_GOOD: Record<DocFamily, () => Record<string, unknown>> = {
  'repjot/exercises': exercisesDoc,
  'repjot/workouts': workoutsDoc,
  'repjot/preferences': preferencesDoc,
  'repjot/results': resultsDoc
};

function captureError(run: () => void): AppError | undefined {
  try {
    run();
  } catch (error) {
    return error instanceof AppError ? error : undefined;
  }
  return undefined;
}

beforeEach(() => {
  resetValidatorsForTesting();
  resetMigrationsForTesting();
});

afterEach(() => {
  resetValidatorsForTesting();
  resetMigrationsForTesting();
});

describe('stage 1: parse limits', () => {
  test('a document over MAX_DOCUMENT_BYTES fails at stage 1', () => {
    const padding = 'x'.repeat(MAX_DOCUMENT_BYTES);
    const text = '{"pad":"' + padding + '"}';

    const error = captureError(() => processDocument(text));
    expect(error?.kind).toBe('invalid_document');
    expect(error?.detail.reason).toBe('parse');
    expect(error?.detail.limit).toBe('bytes');
    expect(Number(error?.detail.actualBytes)).toBeGreaterThan(MAX_DOCUMENT_BYTES);
  });

  test('a document over MAX_NESTING_DEPTH fails at stage 1', () => {
    const deep = '['.repeat(MAX_NESTING_DEPTH + 1) + ']'.repeat(MAX_NESTING_DEPTH + 1);

    const error = captureError(() => processDocument(deep));
    expect(error?.kind).toBe('invalid_document');
    expect(error?.detail.reason).toBe('parse');
    expect(error?.detail.limit).toBe('depth');
  });

  test('a document at the depth limit clears stage 1', () => {
    const text = '['.repeat(MAX_NESTING_DEPTH) + ']'.repeat(MAX_NESTING_DEPTH);
    const error = captureError(() => processDocument(text));
    // The document has no envelope, so it fails at stage 2. Stage 1 let it pass.
    expect(error?.detail.reason).toBe('envelope');
  });

  test('invalid JSON fails at stage 1 with reason parse', () => {
    const error = captureError(() => processDocument('{ not json'));
    expect(error?.kind).toBe('invalid_document');
    expect(error?.detail.reason).toBe('parse');
  });
});

describe('stage 3: family check', () => {
  test('an expectedFamily mismatch fails with reason family', () => {
    const error = captureError(() => processJson(preferencesDoc(), 'repjot/workouts'));
    expect(error?.kind).toBe('invalid_document');
    expect(error?.detail.reason).toBe('family');
    expect(error?.detail.family).toBe('repjot/preferences');
    expect(error?.detail.expectedFamily).toBe('repjot/workouts');
  });

  test('a matching expectedFamily loads', () => {
    const result = processJson(preferencesDoc(), 'repjot/preferences');
    expect(result.family).toBe('repjot/preferences');
  });
});

describe('stage 4: version gate', () => {
  test('a future schemaVersion yields unsupported_schema with declared and max version', () => {
    const doc = { ...preferencesDoc(), schemaVersion: 9 };

    const error = captureError(() => processJson(doc));
    expect(error?.kind).toBe('unsupported_schema');
    expect(error?.detail.family).toBe('repjot/preferences');
    expect(error?.detail.declaredVersion).toBe(9);
    expect(error?.detail.maxSupportedVersion).toBe(1);
  });

  test('a future version is rejected before any schema or migration runs', () => {
    let ran = false;
    registerMigration({
      family: 'repjot/preferences',
      fromVersion: 1,
      toVersion: 2,
      migrate(input: unknown): unknown {
        ran = true;
        return input;
      }
    });

    const error = captureError(() => processJson({ ...preferencesDoc(), schemaVersion: 2 }));
    expect(error?.kind).toBe('unsupported_schema');
    expect(ran).toBe(false);
  });
});

describe('empty chain at v1', () => {
  test('every family loads, validates, and normalizes with migrated false', () => {
    for (const family of Object.keys(KNOWN_GOOD) as DocFamily[]) {
      const fixture = KNOWN_GOOD[family]();
      const result = processDocument<Record<string, unknown>>(JSON.stringify(fixture), family);

      expect(result.family).toBe(family);
      expect(result.sourceVersion).toBe(1);
      expect(result.migrated).toBe(false);
      expect(result.document).toEqual(fixture);
    }
  });

  test('a v1 document that fails its own schema is rejected', () => {
    const doc = { ...preferencesDoc(), revision: 'three' };

    const error = captureError(() => processJson(doc));
    expect(error?.kind).toBe('invalid_document');
    expect(error?.detail.version).toBe(1);
  });
});

describe('migration path', () => {
  test('a registered v1 -> v2 step runs and its output validates against the v2 schema', () => {
    registerValidator('repjot/preferences', 2, preferencesV2Schema());
    registerMigration(preferencesV1ToV2());

    const result = processJson<{ schemaVersion: number; theme: string }>(preferencesDoc());

    expect(result.migrated).toBe(true);
    expect(result.sourceVersion).toBe(1);
    expect(result.document.schemaVersion).toBe(2);
    expect(result.document.theme).toBe('light');
  });

  test('a step whose input fails stage 5 never executes', () => {
    let calls = 0;
    registerValidator('repjot/preferences', 2, preferencesV2Schema());
    registerMigration({
      family: 'repjot/preferences',
      fromVersion: 1,
      toVersion: 2,
      migrate(input: unknown): unknown {
        calls += 1;
        return input;
      }
    });

    const error = captureError(() => processJson(brokenPreferencesDoc()));
    expect(error?.kind).toBe('invalid_document');
    expect(error?.detail.version).toBe(1);
    expect(calls).toBe(0);
  });

  test('a step that produces an invalid output fails stage 7 and discards the view', () => {
    registerValidator('repjot/preferences', 2, preferencesV2Schema());
    registerMigration({
      family: 'repjot/preferences',
      fromVersion: 1,
      toVersion: 2,
      migrate(input: unknown): unknown {
        const source = input as Record<string, unknown>;
        // Drops the field the v2 schema requires.
        return { ...source, schemaVersion: 2 };
      }
    });

    const error = captureError(() => processJson(preferencesDoc()));
    expect(error?.kind).toBe('invalid_document');
    expect(error?.detail.version).toBe(2);
  });

  test('a missing middle step yields a migration error naming the missing version', () => {
    registerValidator('repjot/preferences', 2, preferencesV2Schema());
    registerValidator('repjot/preferences', 3, preferencesV3Schema());
    registerMigration(preferencesV2ToV3());

    const input = preferencesDoc();
    const error = captureError(() => processJson(input));

    expect(error?.kind).toBe('migration');
    expect(error?.detail.family).toBe('repjot/preferences');
    expect(error?.detail.fromVersion).toBe(1);
    expect(error?.detail.missingStep).toBe(2);
    expect(input).toEqual(preferencesDoc());
  });

  test('a two-step chain runs in order and lands on the current version', () => {
    registerValidator('repjot/preferences', 2, preferencesV2Schema());
    registerValidator('repjot/preferences', 3, preferencesV3Schema());
    registerMigration(preferencesV1ToV2());
    registerMigration(preferencesV2ToV3());

    const result = processJson<{ schemaVersion: number; revision?: unknown; theme: string }>(
      preferencesDoc()
    );

    expect(result.migrated).toBe(true);
    expect(result.sourceVersion).toBe(1);
    expect(result.document.schemaVersion).toBe(3);
    expect(result.document.revision).toBeUndefined();
    expect(result.document.theme).toBe('light');
  });
});

describe('migration purity', () => {
  test('every registered step accepts a frozen input and returns a new object', () => {
    const steps = [preferencesV1ToV2(), preferencesV2ToV3()];

    for (const step of steps) {
      const input = deepFreeze(preferencesDoc());
      let output: unknown;

      expect(() => {
        output = step.migrate(input);
      }).not.toThrow();

      expect(output).not.toBe(input);
      expect(input).toEqual(preferencesDoc());
    }
  });

  test('the same input produces the same output', () => {
    const steps = [preferencesV1ToV2(), preferencesV2ToV3()];

    for (const step of steps) {
      const first = step.migrate(preferencesDoc());
      const second = step.migrate(preferencesDoc());
      expect(first).toEqual(second);
    }
  });
});
