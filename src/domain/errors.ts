// The typed error vocabulary. Defined once; every layer reuses it.
// ARCHITECTURE section 15.

/**
 * Every error category the app recognizes.
 * ARCHITECTURE section 15, plus `'insecure_environment'` for a host with no
 * cryptographically secure random source. ARCHITECTURE C-09.
 */
export type AppErrorKind =
  | 'authentication'
  | 'authorization'
  | 'network'
  | 'drive_rate_limit'
  | 'drive_quota'
  | 'duplicate_drive_file'
  | 'unsupported_schema'
  | 'invalid_document'
  | 'migration'
  | 'semantic_reference'
  | 'storage'
  | 'ambiguous_upload'
  | 'insecure_environment';

/** Safe context carried by an error. */
export type AppErrorDetail = Record<string, string | number>;

/** Short message used when a caller supplies none. */
const DEFAULT_MESSAGES: Record<AppErrorKind, string> = {
  authentication: 'Sign-in did not complete.',
  authorization: 'Google access is missing or expired.',
  network: 'The network request failed.',
  drive_rate_limit: 'Google Drive asked us to slow down.',
  drive_quota: 'Google Drive storage is full.',
  duplicate_drive_file: 'Drive holds two copies of the same file.',
  unsupported_schema: 'This document uses an unsupported schema version.',
  invalid_document: 'This document does not match its schema.',
  migration: 'The data migration failed.',
  semantic_reference: 'A stored result points at data that no longer exists.',
  storage: 'Local storage failed.',
  ambiguous_upload: 'An upload result is unknown.',
  insecure_environment: 'This browser has no secure random source.'
};

/**
 * Application error with a safe typed category.
 *
 * `detail` carries only safe context. It never holds a token, an authorization
 * header, a file body, a note, or a measurement. ARCHITECTURE section 15.
 */
export class AppError extends Error {
  readonly kind: AppErrorKind;
  readonly detail: AppErrorDetail;

  constructor(kind: AppErrorKind, detail?: AppErrorDetail, message?: string) {
    super(message ?? DEFAULT_MESSAGES[kind]);
    // Keeps `instanceof` working when a bundler down-levels the class.
    Object.setPrototypeOf(this, AppError.prototype);
    this.name = 'AppError';
    this.kind = kind;
    this.detail = detail ?? {};
  }
}

/** Narrow an unknown thrown value to `AppError`. */
export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}
