// Tests for schema compilation, format assertion, and envelope reading.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { AppError } from '../src/domain/errors';
import {
  DOC_FAMILIES,
  highestSupportedVersion,
  isSupported,
  registerValidator,
  resetValidatorsForTesting,
  validateAgainst,
  validateEnvelope,
  type DocFamily
} from '../src/validation/schema-validator';
import {
  exercisesDoc,
  preferencesDoc,
  preferencesV2Schema,
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
});

afterEach(() => {
  resetValidatorsForTesting();
});

describe('shipped v1 schemas', () => {
  test('every family reports version 1 as its highest supported version', () => {
    for (const family of DOC_FAMILIES) {
      expect(highestSupportedVersion(family)).toBe(1);
    }
  });

  test('every family and v1 compiles and validates a known-good fixture', () => {
    for (const family of DOC_FAMILIES) {
      expect(isSupported(family, 1)).toBe(true);
      expect(() => validateAgainst(family, 1, KNOWN_GOOD[family]())).not.toThrow();
    }
  });

  test('a v1 schema rejects a document from another family', () => {
    const error = captureError(() => validateAgainst('repjot/preferences', 1, exercisesDoc()));
    expect(error).toBeDefined();
    expect(error?.kind).toBe('invalid_document');
    expect(error?.detail.family).toBe('repjot/preferences');
    expect(error?.detail.version).toBe(1);
    expect(typeof error?.detail.issues).toBe('string');
  });

  test('an unknown family and version pair has no validator', () => {
    const error = captureError(() => validateAgainst('repjot/results', 2, resultsDoc()));
    expect(error?.kind).toBe('invalid_document');
    expect(error?.detail.reason).toBe('no_schema');
  });
});

describe('workout published status', () => {
  test('rejects a workout without publishedStatus', () => {
    const doc = workoutsDoc();
    delete (doc.workouts as Record<string, unknown>[])[0]?.publishedStatus;

    expect(captureError(() => validateAgainst('repjot/workouts', 1, doc))?.detail.issues).toContain(
      "publishedStatus"
    );
  });

  test('accepts live, draft, and deprecated publishedStatus values', () => {
    for (const publishedStatus of ['live', 'draft', 'deprecated']) {
      const doc = workoutsDoc();
      (doc.workouts as Record<string, unknown>[])[0]!.publishedStatus = publishedStatus;
      expect(() => validateAgainst('repjot/workouts', 1, doc)).not.toThrow();
    }
  });

  test('rejects a workout with an unsupported publishedStatus', () => {
    const doc = workoutsDoc();
    (doc.workouts as Record<string, unknown>[])[0]!.publishedStatus = 'retired';

    expect(captureError(() => validateAgainst('repjot/workouts', 1, doc))?.detail.issues).toContain(
      "publishedStatus"
    );
  });
});

describe('format assertion', () => {
  test('rejects a Utc field with a numeric offset', () => {
    const doc = preferencesDoc();
    doc.updatedAtUtc = '2026-08-15T07:30:00-07:00';

    const error = captureError(() => validateAgainst('repjot/preferences', 1, doc));
    expect(error?.kind).toBe('invalid_document');
    expect(error?.detail.issues).toContain('updatedAtUtc');
  });

  test('rejects a calendar-invalid Utc value that the Z pattern alone would accept', () => {
    const doc = preferencesDoc();
    doc.updatedAtUtc = '2026-02-30T10:00:00Z';

    const error = captureError(() => validateAgainst('repjot/preferences', 1, doc));
    expect(error?.kind).toBe('invalid_document');
    expect(error?.detail.issues).toContain('updatedAtUtc');
  });

  test('accepts a Utc value that ends in Z and names a real instant', () => {
    expect(() => validateAgainst('repjot/preferences', 1, preferencesDoc())).not.toThrow();
  });
});

describe('validateEnvelope', () => {
  test('reads family and version from a known-good document', () => {
    for (const family of DOC_FAMILIES) {
      const envelope = validateEnvelope(KNOWN_GOOD[family]());
      expect(envelope.family).toBe(family);
      expect(envelope.schemaVersion).toBe(1);
    }
  });

  test('rejects a missing format', () => {
    const doc = preferencesDoc();
    delete doc.format;

    const error = captureError(() => validateEnvelope(doc));
    expect(error?.kind).toBe('invalid_document');
    expect(error?.detail.reason).toBe('envelope');
    expect(error?.detail.field).toBe('format');
  });

  test('rejects an unknown format tag', () => {
    const error = captureError(() => validateEnvelope({ format: 'repjot/notes', schemaVersion: 1 }));
    expect(error?.detail.reason).toBe('envelope');
    expect(error?.detail.field).toBe('format');
  });

  test('rejects a missing schemaVersion', () => {
    const doc = preferencesDoc();
    delete doc.schemaVersion;

    const error = captureError(() => validateEnvelope(doc));
    expect(error?.kind).toBe('invalid_document');
    expect(error?.detail.reason).toBe('envelope');
    expect(error?.detail.field).toBe('schemaVersion');
  });

  test('rejects a non-integer schemaVersion', () => {
    const doc = preferencesDoc();
    doc.schemaVersion = 1.5;

    const error = captureError(() => validateEnvelope(doc));
    expect(error?.detail.reason).toBe('envelope');
    expect(error?.detail.field).toBe('schemaVersion');
  });

  test('rejects a string schemaVersion', () => {
    const doc = preferencesDoc();
    doc.schemaVersion = '1';

    const error = captureError(() => validateEnvelope(doc));
    expect(error?.detail.field).toBe('schemaVersion');
  });

  test('rejects a zero or negative schemaVersion', () => {
    expect(captureError(() => validateEnvelope({ ...preferencesDoc(), schemaVersion: 0 }))?.detail.field).toBe(
      'schemaVersion'
    );
    expect(
      captureError(() => validateEnvelope({ ...preferencesDoc(), schemaVersion: -1 }))?.detail.field
    ).toBe('schemaVersion');
  });

  test('rejects a non-object document', () => {
    for (const value of [null, 'text', 7, []]) {
      const error = captureError(() => validateEnvelope(value));
      expect(error?.detail.reason).toBe('envelope');
      expect(error?.detail.field).toBe('document');
    }
  });
});

describe('registerValidator', () => {
  test('a registered schema compiles and becomes the highest supported version', () => {
    registerValidator('repjot/preferences', 2, preferencesV2Schema());

    expect(highestSupportedVersion('repjot/preferences')).toBe(2);
    expect(isSupported('repjot/preferences', 2)).toBe(true);
  });

  test('a broken schema fails at registration, not at first use', () => {
    const error = captureError(() =>
      registerValidator('repjot/preferences', 9, { type: 'object', unknownKeyword: true })
    );
    expect(error?.kind).toBe('invalid_document');
    expect(error?.detail.reason).toBe('compile');
  });

  test('a failed registration leaves the highest supported version unchanged', () => {
    captureError(() => registerValidator('repjot/preferences', 2, { unknownKeyword: true }));
    expect(highestSupportedVersion('repjot/preferences')).toBe(1);
  });

  test('rejects a version that is not a positive integer', () => {
    expect(captureError(() => registerValidator('repjot/preferences', 0, preferencesV2Schema()))?.detail.reason).toBe(
      'version'
    );
  });

  test('rejects a different schema body under an $id already in use', () => {
    registerValidator('repjot/preferences', 2, preferencesV2Schema());

    // Same $id, different rules. Reusing the cached validator here would leave the
    // version registry pointing at rules the supplied schema does not hold.
    const stale = JSON.parse(JSON.stringify(preferencesV2Schema())) as Record<string, unknown>;
    stale.properties = {
      ...(stale.properties as Record<string, unknown>),
      schemaVersion: { const: 3 }
    };

    const error = captureError(() => registerValidator('repjot/preferences', 3, stale));
    expect(error?.kind).toBe('invalid_document');
    expect(error?.detail.reason).toBe('duplicate_schema_id');
    expect(highestSupportedVersion('repjot/preferences')).toBe(2);
  });

  test('accepts the same schema body registered again under the same $id', () => {
    registerValidator('repjot/preferences', 2, preferencesV2Schema());

    expect(() =>
      registerValidator('repjot/preferences', 2, JSON.parse(JSON.stringify(preferencesV2Schema())))
    ).not.toThrow();
  });
});
