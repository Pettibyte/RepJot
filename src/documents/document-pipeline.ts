// The staged read path: bytes or a parsed value in, typed current-version document
// or typed error out.
// ARCHITECTURE section 12, specs/schema-versioning.md "Loader sequence",
// REQUIREMENTS 5.1 through 5.6.
//
// Every document from every source -- Drive, cache, or bundle -- goes through
// `processDocument` or `processJson`. Callers do not parse, version-check, or
// migrate on their own.
//
// The pipeline is read-only. It returns an in-memory view and writes nothing.
// REQUIREMENTS 5.6. A rejected future version never reaches a write path, so a
// newer-version document cannot be edited or overwritten. REQUIREMENTS 5.5.

import { AppError } from '../domain/errors';
import { findStep } from '../migrations/migration-registry';
import {
  highestSupportedVersion,
  validateAgainst,
  validateEnvelope,
  type DocFamily
} from '../validation/schema-validator';
import { MAX_DOCUMENT_BYTES, MAX_NESTING_DEPTH } from './limits';

/** One document carried out of the pipeline. */
export interface PipelineResult<T> {
  /** The current-version document, typed by the caller. */
  document: T;
  /** The family read from the envelope. */
  family: DocFamily;
  /** The version the document declared on read. */
  sourceVersion: number;
  /** True when at least one migration step ran. */
  migrated: boolean;
}

/**
 * Count UTF-8 bytes without building a byte array.
 *
 * Uses `TextEncoder` when the host provides one. The manual pass is the fallback
 * for a host without it, so the size gate never disappears.
 */
function utf8ByteLength(text: string): number {
  if (typeof TextEncoder === 'function') {
    return new TextEncoder().encode(text).length;
  }

  let bytes = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
      // A surrogate pair encodes as one four-byte sequence.
      bytes += 4;
      index += 1;
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

/**
 * True when the value nests deeper than `max` levels below the root value.
 *
 * Walks with an explicit stack instead of recursion, so the walk itself cannot
 * overflow the stack before it reports the depth.
 */
function exceedsNestingDepth(value: unknown, max: number): boolean {
  const pending: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];

  while (pending.length > 0) {
    const node = pending.pop() as { value: unknown; depth: number };
    const current = node.value;
    if (current === null || typeof current !== 'object') continue;

    const depth = node.depth + 1;
    if (depth > max) return true;

    const children = Array.isArray(current)
      ? current.slice()
      : Object.keys(current as Record<string, unknown>).map(
          (key) => (current as Record<string, unknown>)[key]
        );
    for (const child of children) {
      pending.push({ value: child, depth });
    }
  }

  return false;
}

/**
 * Stage 1 for a text source: size gate, then `JSON.parse`.
 *
 * Throws `AppError('invalid_document')` with detail `reason: 'parse'`.
 */
function parseWithByteLimit(text: string): unknown {
  if (typeof text !== 'string') {
    throw new AppError('invalid_document', { reason: 'parse', field: 'text' });
  }

  const byteLength = utf8ByteLength(text);
  if (byteLength > MAX_DOCUMENT_BYTES) {
    throw new AppError(
      'invalid_document',
      { reason: 'parse', limit: 'bytes', maxBytes: MAX_DOCUMENT_BYTES, actualBytes: byteLength },
      'Document is larger than the parse limit.'
    );
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new AppError('invalid_document', { reason: 'parse' }, 'Document is not valid JSON.');
  }
}

/**
 * Stage 1 depth gate for an already parsed value.
 *
 * Throws `AppError('invalid_document')` with detail `reason: 'parse'` and
 * `limit: 'depth'`.
 */
function assertNestingDepth(value: unknown): void {
  if (exceedsNestingDepth(value, MAX_NESTING_DEPTH)) {
    throw new AppError(
      'invalid_document',
      { reason: 'parse', limit: 'depth', maxDepth: MAX_NESTING_DEPTH },
      'Document nests deeper than the parse limit.'
    );
  }
}

/**
 * Read a text document through the full pipeline.
 *
 * Stages: parse, envelope, family check, version gate, historical schema,
 * migrate, current schema, normalize.
 *
 * @param text The raw document text.
 * @param expectedFamily When set, the document must carry this family.
 */
export function processDocument<T = unknown>(
  text: string,
  expectedFamily?: DocFamily
): PipelineResult<T> {
  const parsed = parseWithByteLimit(text);
  return processJson<T>(parsed, expectedFamily);
}

/**
 * Read an already parsed value through the pipeline, from stage 1 depth gate
 * onward.
 *
 * Use this for a value a host API already parsed. Every text source uses
 * `processDocument` instead.
 */
export function processJson<T = unknown>(
  raw: unknown,
  expectedFamily?: DocFamily
): PipelineResult<T> {
  // Stage 1, depth gate. The byte gate needs text and lives in processDocument.
  assertNestingDepth(raw);

  // Stage 2, envelope. Throws when `format` or `schemaVersion` is missing or
  // malformed. REQUIREMENTS 5.1.
  const envelope = validateEnvelope(raw);
  const family = envelope.family;
  const sourceVersion = envelope.schemaVersion;

  // Stage 3, family check.
  if (expectedFamily !== undefined && expectedFamily !== family) {
    throw new AppError(
      'invalid_document',
      { family, expectedFamily, reason: 'family' },
      'Document family does not match the expected family.'
    );
  }

  const maxSupportedVersion = highestSupportedVersion(family);

  // Stage 4, version gate. A newer document is rejected before anything reads or
  // writes it. REQUIREMENTS 5.5.
  if (sourceVersion > maxSupportedVersion) {
    throw new AppError(
      'unsupported_schema',
      { family, declaredVersion: sourceVersion, maxSupportedVersion },
      'Document declares a newer schema version than this build supports.'
    );
  }

  // Stage 5, historical schema. Validate the declared version before any
  // migration runs, so a migration never repairs a broken input.
  // REQUIREMENTS 5.4.
  if (sourceVersion < maxSupportedVersion) {
    validateAgainst(family, sourceVersion, raw);
  }

  // Stage 6, migrate. Apply `vN -> vN+1` steps in order. A missing step is a
  // typed error, never a silent repair. REQUIREMENTS 5.9, 5.10.
  let current: unknown = raw;
  let version = sourceVersion;
  const migrated = sourceVersion < maxSupportedVersion;

  while (version < maxSupportedVersion) {
    const step = findStep(family, version);
    if (step === undefined) {
      throw new AppError(
        'migration',
        { family, fromVersion: version, missingStep: version + 1 },
        'No migration step exists to move this document forward.'
      );
    }
    current = step.migrate(current);
    version = step.toVersion;

    // Stage 7, current schema. Validate each step output before the next step
    // sees it. A bad output discards the migrated view.
    validateAgainst(family, version, current);
  }

  // Stage 7 final pass. When nothing migrated, this is the only schema validation
  // for the document.
  validateAgainst(family, maxSupportedVersion, current);

  // Stage 8, normalize. The current-version document is the normalized view.
  return {
    document: current as T,
    family,
    sourceVersion,
    migrated
  };
}
