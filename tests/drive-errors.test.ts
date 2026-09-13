import { describe, expect, test } from 'bun:test';
import { AppError } from '../src/domain/errors';
import {
  googleErrorReason,
  invalidResponseAppError,
  networkAppError,
  toAppError
} from '../src/drive/errors';

describe('status mapping', () => {
  test('a 401 maps to authentication', () => {
    const error: AppError = toAppError(401);
    expect(error.kind).toBe('authentication');
    expect(error.detail.status).toBe(401);
  });

  test('a 403 rateLimitExceeded maps to drive_rate_limit', () => {
    expect(toAppError(403, 'rateLimitExceeded').kind).toBe('drive_rate_limit');
  });

  test('a 403 userRateLimitExceeded maps to drive_rate_limit', () => {
    expect(toAppError(403, 'userRateLimitExceeded').kind).toBe('drive_rate_limit');
  });

  test('a 403 storageQuotaExceeded maps to drive_quota', () => {
    expect(toAppError(403, 'storageQuotaExceeded').kind).toBe('drive_quota');
  });

  test('a 403 with an unknown reason maps to authorization', () => {
    expect(toAppError(403, 'somethingElse').kind).toBe('authorization');
  });

  test('a 403 with no reason maps to authorization', () => {
    expect(toAppError(403).kind).toBe('authorization');
  });

  test('a 404 maps to invalid_document with reason not_found', () => {
    const error: AppError = toAppError(404);
    expect(error.kind).toBe('invalid_document');
    expect(error.detail.reason).toBe('not_found');
  });

  test('a 429 maps to drive_rate_limit', () => {
    expect(toAppError(429).kind).toBe('drive_rate_limit');
  });

  test('a 5xx maps to network with reason server_error', () => {
    const error: AppError = toAppError(503);
    expect(error.kind).toBe('network');
    expect(error.detail.reason).toBe('server_error');
  });

  test('an unmapped status maps to invalid_document', () => {
    const error: AppError = toAppError(418);
    expect(error.kind).toBe('invalid_document');
    expect(error.detail.status).toBe(418);
  });

  test('a 400 names a request-shape failure, not a bad document', () => {
    const error: AppError = toAppError(400);
    expect(error.kind).toBe('invalid_document');
    expect(error.detail.reason).toBe('bad_request');
  });

  test('an unmapped status carries reason unexpected_status', () => {
    expect(toAppError(418).detail.reason).toBe('unexpected_status');
  });

  test('a caller-supplied reason survives the catch-all', () => {
    expect(toAppError(415, 'unsupportedOperation').detail.reason).toBe('unsupportedOperation');
  });

  test('every mapped error carries the status in detail', () => {
    for (const status of [401, 403, 404, 429, 500]) {
      expect(toAppError(status).detail.status).toBe(status);
    }
  });
});

describe('reason sanitizing', () => {
  test('a reason that is not an identifier shape is dropped', () => {
    const error: AppError = toAppError(403, 'Rate limit hit for token ya29.evil');
    expect(error.detail.reason).toBeUndefined();
    expect(error.kind).toBe('authorization');
  });

  test('a reason over the length cap is dropped', () => {
    const error: AppError = toAppError(403, `a`.repeat(80));
    expect(error.detail.reason).toBeUndefined();
  });

  test('googleErrorReason reads the first nested reason', () => {
    const body = { error: { errors: [{ reason: 'rateLimitExceeded' }] } };
    expect(googleErrorReason(body)).toBe('rateLimitExceeded');
  });

  test('googleErrorReason reads a flat error code', () => {
    expect(googleErrorReason({ error: { code: 'userRateLimitExceeded' } })).toBe(
      'userRateLimitExceeded'
    );
  });

  test('googleErrorReason returns undefined for a body with no reason', () => {
    expect(googleErrorReason({ error: { message: 'boom' } })).toBeUndefined();
    expect(googleErrorReason(null)).toBeUndefined();
    expect(googleErrorReason('text')).toBeUndefined();
  });

  test('googleErrorReason prefers a known reason over the first one', () => {
    const body = {
      error: { errors: [{ reason: 'someOpaqueCode' }, { reason: 'rateLimitExceeded' }] }
    };
    expect(googleErrorReason(body)).toBe('rateLimitExceeded');
  });

  test('googleErrorReason falls back to the first safe reason when none is known', () => {
    const body = { error: { errors: [{ reason: 'someOpaqueCode' }, { reason: 'anotherCode' }] } };
    expect(googleErrorReason(body)).toBe('someOpaqueCode');
  });

  test('googleErrorReason rejects an unsafe nested reason', () => {
    const body = { error: { errors: [{ reason: 'Bearer ya29.abc' }] } };
    expect(googleErrorReason(body)).toBeUndefined();
  });
});

describe('helper errors', () => {
  test('networkAppError carries kind network', () => {
    const error: AppError = networkAppError({ operation: 'listCatalog' });
    expect(error.kind).toBe('network');
    expect(error.detail.operation).toBe('listCatalog');
  });

  test('invalidResponseAppError carries reason unparseable_response', () => {
    const error: AppError = invalidResponseAppError({ operation: 'readFile' });
    expect(error.kind).toBe('invalid_document');
    expect(error.detail.reason).toBe('unparseable_response');
  });
});
