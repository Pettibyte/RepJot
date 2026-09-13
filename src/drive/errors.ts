// Google Drive failure to `AppError` mapping.
// ARCHITECTURE §15. REQUIREMENTS 2.13, 4.16.
//
// Every Drive failure reaches the sync layer through this file. The sync layer
// therefore switches on `AppErrorKind` and never parses a Google error string.
//
// Nothing here copies a Google error message into an `AppError`. A Google message
// is free-form text and could echo a request URL, so only the machine reason code
// crosses this boundary, and only when it looks like a reason code.

import { AppError, type AppErrorKind } from '../domain/errors';

/** Reason codes that mean "slow down". Drive returns these on HTTP 403. */
const RATE_LIMIT_REASONS: readonly string[] = ['rateLimitExceeded', 'userRateLimitExceeded'];

/** Reason code that means the user's Drive storage is full. */
const QUOTA_REASON = 'storageQuotaExceeded';

/**
 * Shape a Google reason code must match to enter an `AppError` detail.
 *
 * A reason code is a short identifier such as `rateLimitExceeded`. Anything
 * longer, or anything carrying punctuation a code never has, is treated as
 * free-form text and dropped, so an echoed request value cannot ride along.
 */
const SAFE_REASON = /^[A-Za-z][A-Za-z0-9_.]{0,63}$/;

/** Reason carried on a `404`, which has no Google reason code of its own. */
const NOT_FOUND_REASON = 'not_found';

/** True when `reason` names a rate-limit response. */
function isRateLimitReason(reason: string): boolean {
  return RATE_LIMIT_REASONS.indexOf(reason) !== -1;
}

/**
 * Map an HTTP status and a Google reason code to a typed `AppError`.
 *
 * | Input | Kind |
 * | --- | --- |
 * | `401` | `authentication` |
 * | `403` + `rateLimitExceeded` or `userRateLimitExceeded` | `drive_rate_limit` |
 * | `403` + `storageQuotaExceeded` | `drive_quota` |
 * | `403` + any other reason, or none | `authorization` |
 * | `404` | `invalid_document`, reason `not_found` |
 * | `429` | `drive_rate_limit` |
 * | `5xx` | `network`, reason `server_error` |
 * | any other status | `invalid_document`, reason `bad_request` for a `400`,
 *   otherwise `unexpected_status` |
 *
 * The catch-all keeps a reason that names the failing layer. A `400` means this
 * app sent a malformed request, so the log says `bad_request` instead of
 * blaming the user's document.
 *
 * A network rejection has no status. Use `networkAppError` for that case.
 */
export function toAppError(status: number, googleReason?: string): AppError {
  const reason: string | undefined =
    typeof googleReason === 'string' && SAFE_REASON.test(googleReason) ? googleReason : undefined;
  const detail: Record<string, string | number> = { status };
  if (reason !== undefined) {
    detail.reason = reason;
  }

  if (status === 401) {
    return new AppError('authentication', detail, 'Google rejected the access token.');
  }

  if (status === 403) {
    if (reason !== undefined && isRateLimitReason(reason)) {
      return new AppError('drive_rate_limit', detail, 'Google Drive asked us to slow down.');
    }
    if (reason === QUOTA_REASON) {
      return new AppError('drive_quota', detail, 'Google Drive storage is full.');
    }
    return new AppError('authorization', detail, 'Google Drive refused this request.');
  }

  if (status === 404) {
    return new AppError(
      'invalid_document',
      { ...detail, reason: NOT_FOUND_REASON },
      'That file is no longer in Google Drive.'
    );
  }

  if (status === 429) {
    return new AppError('drive_rate_limit', detail, 'Google Drive asked us to slow down.');
  }

  if (status >= 500 && status <= 599) {
    return new AppError(
      'network',
      { ...detail, reason: 'server_error' },
      'Google Drive could not handle the request.'
    );
  }

  return new AppError(
    'invalid_document',
    { ...detail, reason: reason ?? (status === 400 ? 'bad_request' : 'unexpected_status') },
    'Google Drive rejected this request.'
  );
}

/**
 * Typed error for a request that never reached Drive.
 *
 * A refused connection, a DNS failure, and a timeout all land here. The caller
 * cannot tell them apart, and does not need to: all three mean retry later.
 * REQUIREMENTS 4.16, ARCHITECTURE §15.
 */
export function networkAppError(context: Record<string, string | number> = {}): AppError {
  return new AppError('network', context, 'The network request to Google Drive failed.');
}

/**
 * Typed error for a Drive response body that is not JSON.
 *
 * A truncated body, an HTML error page from a proxy, and an empty body all land
 * here. The caller receives `invalid_document` instead of a raw parse error.
 */
export function invalidResponseAppError(context: Record<string, string | number> = {}): AppError {
  return new AppError(
    'invalid_document',
    { reason: 'unparseable_response', ...context },
    'Google Drive returned a response that is not valid JSON.'
  );
}

/**
 * Pull the reason code out of a parsed Google error body.
 *
 * Google nests reasons at `error.errors[].reason` and sometimes reports a flat
 * `error.code`. Only safe codes are collected. When the body holds several, a
 * code this app maps wins over an unknown one, because the first entry is not
 * always the operative error.
 */
export function googleErrorReason(parsedBody: unknown): string | undefined {
  if (typeof parsedBody !== 'object' || parsedBody === null) {
    return undefined;
  }
  const error = (parsedBody as { error?: unknown }).error;
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }

  const candidates: string[] = [];
  const errors = (error as { errors?: unknown }).errors;
  if (Array.isArray(errors)) {
    for (const entry of errors) {
      if (typeof entry === 'object' && entry !== null) {
        const reason = safeReason((entry as { reason?: unknown }).reason);
        if (reason !== undefined) candidates.push(reason);
      }
    }
  }
  const code = safeReason((error as { code?: unknown }).code);
  if (code !== undefined) candidates.push(code);

  return candidates.find(isKnownReason) ?? candidates[0];
}

/** Return the reason when it is a safe code, otherwise `undefined`. */
function safeReason(value: unknown): string | undefined {
  return typeof value === 'string' && SAFE_REASON.test(value) ? value : undefined;
}

/** True when this app maps the reason to a specific kind. */
function isKnownReason(reason: string): boolean {
  return isRateLimitReason(reason) || reason === QUOTA_REASON;
}
