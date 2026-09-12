// ID creation and the ID character rule.
// Requirement 11.22 (session IDs), Requirement 22.4.6 (banned characters),
// Requirement 3.18 (no integer-like Record keys), ARCHITECTURE C-09 (secure random).

import { AppError } from './errors';

/** Prefix that keeps a session Record key from being integer-like. Requirement 3.18. */
export const SESSION_ID_PREFIX = 'session-';

/** Characters that break the composite result key. Requirement 22.4.6. */
const BANNED_ID_CHARACTERS = ['/', '|', ':'];

/** All-digit key. JavaScript treats such a key as an array index. Requirement 3.17. */
const INTEGER_LIKE_PATTERN = /^[0-9]+$/;

/** Shape of the browser random source this module needs. */
interface RandomSource {
  getRandomValues?: (bytes: Uint8Array) => unknown;
}

function readRandomSource(): RandomSource | undefined {
  return (globalThis as { crypto?: RandomSource }).crypto;
}

function toHex(value: number): string {
  return (value + 0x100).toString(16).slice(1);
}

/**
 * Create one UUID v4 from the browser cryptographic random source.
 *
 * Sets the RFC 4122 version 4 bits and the variant bits. Throws
 * `AppError('insecure_environment')` when `crypto.getRandomValues` is missing,
 * so no insecure fallback exists. ARCHITECTURE C-09.
 */
export function secureUuid(): string {
  const source = readRandomSource();
  if (source === undefined || typeof source.getRandomValues !== 'function') {
    throw new AppError(
      'insecure_environment',
      { reason: 'crypto.getRandomValues is unavailable' },
      'No secure random source is available.'
    );
  }

  const bytes = new Uint8Array(16);
  source.getRandomValues(bytes);

  bytes[6] = (bytes[6] & 0x0f) | 0x40; // Version 4.
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant.

  const hex = Array.from(bytes, toHex).join('');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20)
  ].join('-');
}

/**
 * Create a new session ID: `session-` plus a UUID v4.
 * The ID encodes no time. Requirement 11.22.
 */
export function createSessionId(): string {
  return SESSION_ID_PREFIX + secureUuid();
}

/**
 * Reject an ID that would break a composite key or a keyed map.
 *
 * Bans `/`, `|`, and `:`, the separators used by the composite result key.
 * Requirement 22.4.6. Also rejects an empty ID and an all-digit ID, which
 * JavaScript reorders ahead of string keys. Requirement 3.17 and Requirement 3.18.
 */
export function assertIdSafe(id: string, what: string): void {
  if (typeof id !== 'string' || id.length === 0) {
    throw new AppError('invalid_document', { what }, `${what} must not be empty.`);
  }

  for (const character of BANNED_ID_CHARACTERS) {
    if (id.includes(character)) {
      throw new AppError(
        'invalid_document',
        { what, banned: character },
        `${what} must not contain "${character}".`
      );
    }
  }

  if (INTEGER_LIKE_PATTERN.test(id)) {
    throw new AppError(
      'invalid_document',
      { what },
      `${what} must not be all digits, because JavaScript reorders such a key.`
    );
  }
}

/**
 * Report whether a string is an all-digit key.
 *
 * JavaScript iterates integer-like keys first, in ascending numeric order, ahead of
 * string keys. Requirement 3.17 and Requirement 3.18. This matches the schema rule
 * `^(?![0-9]+$)` exactly. Loaders and tests use it to reject such a key.
 */
export function isIntegerLikeKey(key: string): boolean {
  return INTEGER_LIKE_PATTERN.test(key);
}
