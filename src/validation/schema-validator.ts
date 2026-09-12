// Schema compilation and validation for the document read path.
// ARCHITECTURE ADR-005, REQUIREMENTS 5.1.
//
// Bundle-size note: Ajv and ajv-formats are compiled into the app bundle because
// ADR-005 puts validation in the browser. If the Ajv cost breaks the Phase 20
// bundle budget, move schema loading to a runtime `fetch` of bundled
// `data/schemas/*.json`. Only the body of `registerValidator` changes. No call
// site changes.

import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import type { ErrorObject, ValidateFunction } from 'ajv';

import exercisesV1 from '../../schemas/exercises/v1.schema.json';
import preferencesV1 from '../../schemas/preferences/v1.schema.json';
import resultsV1 from '../../schemas/results/v1.schema.json';
import workoutsV1 from '../../schemas/workouts/v1.schema.json';
import { AppError } from '../domain/errors';

/**
 * The four document families the app reads.
 *
 * Each family maps to one Drive document shape. The seed allowlist is not a
 * family: it is build input and carries no `format` envelope.
 */
export type DocFamily =
  | 'repjot/exercises'
  | 'repjot/workouts'
  | 'repjot/preferences'
  | 'repjot/results';

/** Every family, in a stable order. Useful for tests and diagnostics. */
export const DOC_FAMILIES: readonly DocFamily[] = [
  'repjot/exercises',
  'repjot/workouts',
  'repjot/preferences',
  'repjot/results'
];

/** The envelope read from any document before validation. */
export interface DocEnvelope {
  family: DocFamily;
  schemaVersion: number;
}

/**
 * Highest schema version this build supports, per family.
 *
 * A map, so `highestSupportedVersion` needs no schema scan. `registerValidator`
 * raises the entry when a build adds a newer version.
 */
const FAMILY_MAX_VERSION: Record<DocFamily, number> = {
  'repjot/exercises': 1,
  'repjot/workouts': 1,
  'repjot/preferences': 1,
  'repjot/results': 1
};

/** The shipped v1 schema for each family, imported statically. */
const SHIPPED_SCHEMAS: Readonly<Record<DocFamily, { version: number; schema: unknown }>> = {
  'repjot/exercises': { version: 1, schema: exercisesV1 },
  'repjot/workouts': { version: 1, schema: workoutsV1 },
  'repjot/preferences': { version: 1, schema: preferencesV1 },
  'repjot/results': { version: 1, schema: resultsV1 }
};

// Draft 2020-12 with strict mode, so a malformed schema fails at compile time.
// `discriminator: true` supports the keyword the seed allowlist schema uses.
const ajv = new Ajv2020({ strict: true, discriminator: true });

// Formats assert. ajv-formats v3 registers each format as a validation keyword,
// so a value that violates `format` fails the validate call. The v2 option
// `{ assertion: true }` no longer exists in this version. `keywords: false` keeps
// the optional formatMaximum/formatMinimum keywords out of the validator. The
// schemas use neither. ARCHITECTURE ADR-005.
// tests/schema-validator.test.ts proves the assertion holds.
addFormats(ajv, { keywords: false });

/** Compiled validators, keyed `family@version`. */
const compiledValidators = new Map<string, ValidateFunction>();

/** Most issues reported in one error detail. Keeps the detail string short. */
const MAX_REPORTED_ISSUES = 5;

function cacheKey(family: DocFamily, version: number): string {
  return family + '@' + version;
}

/** True when the value is one of the four family tags. */
export function isDocFamily(value: unknown): value is DocFamily {
  return typeof value === 'string' && (DOC_FAMILIES as readonly string[]).indexOf(value) !== -1;
}

function readSchemaId(schema: unknown): string | undefined {
  if (schema === null || typeof schema !== 'object') return undefined;
  const id = (schema as { $id?: unknown }).$id;
  return typeof id === 'string' && id.length > 0 ? id : undefined;
}

function formatIssues(errors: null | ErrorObject[] | undefined): string {
  if (errors === null || errors === undefined || errors.length === 0) {
    return 'schema reported no issue detail';
  }
  const parts: string[] = [];
  for (const issue of errors.slice(0, MAX_REPORTED_ISSUES)) {
    // Only the path and the schema-side message. Never the offending value.
    const where = issue.instancePath === '' ? '/' : issue.instancePath;
    parts.push(where + ' ' + (issue.message ?? 'is invalid'));
  }
  if (errors.length > MAX_REPORTED_ISSUES) {
    parts.push('(' + String(errors.length - MAX_REPORTED_ISSUES) + ' more issues)');
  }
  return parts.join('; ');
}

/**
 * Compile one schema and cache its validator.
 *
 * Registering a version also raises that family's highest supported version when
 * the new version is higher. A build that ships a v2 schema therefore accepts v2
 * and requires a migration step from v1.
 *
 * Exported for tests. A test registers a test-only schema this way instead of
 * adding a file under `schemas/`, which would ship in the product. Production
 * code registers only the four shipped v1 schemas, at module load.
 */
export function registerValidator(family: DocFamily, version: number, schema: unknown): void {
  if (!isDocFamily(family)) {
    throw new AppError('invalid_document', { family: String(family), reason: 'family' });
  }
  if (!Number.isInteger(version) || version < 1) {
    throw new AppError('invalid_document', { family, reason: 'version' });
  }

  let validate: ValidateFunction;
  try {
    const id = readSchemaId(schema);
    if (id === undefined) {
      validate = ajv.compile(schema as object);
    } else if (ajv.getSchema(id) === undefined) {
      ajv.addSchema(schema as object);
      validate = ajv.getSchema(id) as ValidateFunction;
    } else {
      validate = ajv.getSchema(id) as ValidateFunction;
    }
    // Force the compile now, so a strict-mode problem surfaces at registration
    // instead of inside the first caller that needs the validator.
    validate(undefined);
  } catch (error) {
    throw new AppError(
      'invalid_document',
      { family, version, reason: 'compile' },
      'Schema for ' + cacheKey(family, version) + ' did not compile: ' + String(error)
    );
  }

  compiledValidators.set(cacheKey(family, version), validate);
  if (version > FAMILY_MAX_VERSION[family]) {
    FAMILY_MAX_VERSION[family] = version;
  }
}

/** Restore the shipped schema set. Test-only. */
export function resetValidatorsForTesting(): void {
  compiledValidators.clear();
  for (const family of DOC_FAMILIES) {
    FAMILY_MAX_VERSION[family] = 1;
  }
  registerShippedSchemas();
}

function registerShippedSchemas(): void {
  for (const family of DOC_FAMILIES) {
    const entry = SHIPPED_SCHEMAS[family];
    registerValidator(family, entry.version, entry.schema);
  }
}

registerShippedSchemas();

/** Highest schema version this build supports for the family. */
export function highestSupportedVersion(family: DocFamily): number {
  const maxVersion = FAMILY_MAX_VERSION[family];
  if (maxVersion === undefined) {
    throw new AppError('invalid_document', { family: String(family), reason: 'family' });
  }
  return maxVersion;
}

/** True when the build supports the family and version pair. */
export function isSupported(family: DocFamily, version: number): boolean {
  if (!isDocFamily(family)) return false;
  if (!Number.isInteger(version) || version < 1) return false;
  return version <= FAMILY_MAX_VERSION[family];
}

/**
 * Validate one value against the compiled schema for the family and version.
 *
 * Throws `AppError('invalid_document')` with detail `{ family, version, issues }`.
 * The issues string carries schema paths and messages only. It never carries a
 * user value, a note, or a measurement.
 */
export function validateAgainst(family: DocFamily, version: number, data: unknown): void {
  const validate = compiledValidators.get(cacheKey(family, version));
  if (validate === undefined) {
    throw new AppError('invalid_document', { family, version, reason: 'no_schema' });
  }
  if (validate(data) !== true) {
    throw new AppError('invalid_document', {
      family,
      version,
      issues: formatIssues(validate.errors)
    });
  }
}

/**
 * Read and check the envelope of one document.
 *
 * Checks that `format` names a known family and that `schemaVersion` is a positive
 * integer. Throws `AppError('invalid_document')` with detail `reason: 'envelope'`
 * and the offending `field`. REQUIREMENTS 5.1.
 */
export function validateEnvelope(data: unknown): DocEnvelope {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new AppError('invalid_document', { reason: 'envelope', field: 'document' });
  }

  const record = data as Record<string, unknown>;
  const format = record.format;
  if (!isDocFamily(format)) {
    throw new AppError('invalid_document', { reason: 'envelope', field: 'format' });
  }

  const schemaVersion = record.schemaVersion;
  if (typeof schemaVersion !== 'number' || !Number.isInteger(schemaVersion) || schemaVersion < 1) {
    throw new AppError('invalid_document', { family: format, reason: 'envelope', field: 'schemaVersion' });
  }

  return { family: format, schemaVersion };
}
