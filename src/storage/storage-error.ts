// The one mapping from a raw storage failure to the typed `storage` error.
// REQUIREMENTS 3.12. ARCHITECTURE section 15.
//
// Every storage module routes its failures through this function, so a caller
// sees one error kind and one set of reasons no matter which engine ran. The
// error never carries a stored value or a key.

import { AppError } from '../domain/errors';

/**
 * Map any storage failure to `AppError('storage')`.
 *
 * A `QuotaExceededError` maps to `reason: 'quota'`. Anything else maps to
 * `reason: 'write_failed'` and keeps the original error name in `detail.cause`.
 */
export function storageError(cause: unknown): AppError {
  const name = cause instanceof Error ? cause.name : String(cause);
  if (name === 'QuotaExceededError') {
    return new AppError('storage', { reason: 'quota' }, 'Local storage is full.');
  }
  return new AppError('storage', { reason: 'write_failed', cause: name });
}
