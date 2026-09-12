import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { AppError } from '../src/domain/errors';
import {
  SESSION_ID_PREFIX,
  assertIdSafe,
  createSessionId,
  isIntegerLikeKey,
  secureUuid
} from '../src/domain/ids';

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');

function restoreCrypto(): void {
  if (cryptoDescriptor !== undefined) {
    Object.defineProperty(globalThis, 'crypto', cryptoDescriptor);
  }
}

function stubCrypto(value: unknown): void {
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value });
}

describe('secureUuid', () => {
  afterEach(restoreCrypto);

  test('returns a UUID v4 string', () => {
    expect(secureUuid()).toMatch(UUID_V4_PATTERN);
  });

  test('two calls differ', () => {
    const seen = new Set<string>();
    for (let index = 0; index < 50; index += 1) {
      seen.add(secureUuid());
    }
    expect(seen.size).toBe(50);
  });

  test('throws AppError insecure_environment when getRandomValues is missing', () => {
    stubCrypto({});

    let caught: unknown;
    try {
      secureUuid();
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AppError);
    expect((caught as AppError).kind).toBe('insecure_environment');
  });

  test('throws AppError insecure_environment when crypto is missing', () => {
    stubCrypto(undefined);

    expect(() => secureUuid()).toThrow(AppError);
  });
});

describe('createSessionId', () => {
  test('starts with the session prefix and carries a UUID v4', () => {
    const id = createSessionId();

    expect(id.startsWith(SESSION_ID_PREFIX)).toBe(true);
    expect(id.slice(SESSION_ID_PREFIX.length)).toMatch(UUID_V4_PATTERN);
  });

  test('two calls differ', () => {
    expect(createSessionId()).not.toBe(createSessionId());
  });

  test('is safe as a Record key', () => {
    expect(() => assertIdSafe(createSessionId(), 'session ID')).not.toThrow();
    expect(isIntegerLikeKey(createSessionId())).toBe(false);
  });
});

describe('assertIdSafe', () => {
  test('rejects the composite key separators', () => {
    for (const bad of ['a/b', 'a|b', 'a:b']) {
      let caught: unknown;
      try {
        assertIdSafe(bad, 'test ID');
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(AppError);
      expect((caught as AppError).kind).toBe('invalid_document');
    }
  });

  test('rejects an empty ID', () => {
    expect(() => assertIdSafe('', 'test ID')).toThrow(AppError);
  });

  test('rejects an all-digit ID', () => {
    expect(() => assertIdSafe('12', 'test ID')).toThrow(AppError);
  });

  test('accepts a normal slug', () => {
    expect(() => assertIdSafe('back-squat-set', 'test ID')).not.toThrow();
  });
});

describe('isIntegerLikeKey', () => {
  test('is true for an all-digit key', () => {
    expect(isIntegerLikeKey('12')).toBe(true);
    expect(isIntegerLikeKey('0')).toBe(true);
    expect(isIntegerLikeKey('007')).toBe(true);
  });

  test('is false for a key with a non-digit character', () => {
    // The schema rule is `^(?![0-9]+$)`. Only an all-digit key reorders in
    // JavaScript, so '1e2' is not integer-like.
    expect(isIntegerLikeKey('1e2')).toBe(false);
    expect(isIntegerLikeKey('session-x')).toBe(false);
    expect(isIntegerLikeKey('a1')).toBe(false);
    expect(isIntegerLikeKey('')).toBe(false);
  });

  test('is false for a composite result key', () => {
    expect(isIntegerLikeKey('root/squat-sets:3/back-squat-set|both|1')).toBe(false);
    expect(isIntegerLikeKey('w|n')).toBe(false);
  });
});
