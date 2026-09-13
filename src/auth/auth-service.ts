// Authentication service.
// REQUIREMENTS 2.11 through 2.13. ARCHITECTURE section 10, steps 12 through 14.
//
// The service owns the token lifecycle above the redirect adapter: the bound
// session in memory, the account binding, sign out, disconnect, and expiry.
//
// This module imports no Drive module. The caller injects the Drive calls so the
// service stays testable and the dependency direction stays one way. See
// `src/drive/drive-rest-adapter.ts` for the injected implementations.

import { AppError, isAppError } from '../domain/errors';
import { reportError } from '../state/app-state';
import {
  clearAllAuthState,
  hasStoredToken,
  isTokenRemembered,
  restoreToken,
  saveToken,
  type TokenRecord
} from './oauth-redirect-adapter';

const MAX_TIMER_DELAY_MS = 2_147_483_647;

/** A token that passed account binding. The app works with this, never with a raw token. */
export interface AuthSession {
  accessToken: string;
  accountKey: string;
  expiresAtUtc: string;
  /** Display name from the bind step. Absent when the caller did not read one. */
  displayName?: string;
}

/** The account identity a bind step returns. */
export interface BoundAccount {
  accountKey: string;
  displayName?: string;
}

/** Result of a disconnect request. */
export type DisconnectResult = { kind: 'revoked' | 'revoke_failed' };

/** Why the app dropped its session. */
export type ExpiryReason = 'expired' | 'unauthorized';

export interface BindDependencies {
  /**
   * Return the Drive account for the token. Reject on any failure.
   *
   * A plain string is the `user.permissionId`. A `BoundAccount` also carries
   * the display name, so the screen does not send a second `about` request.
   *
   * Error contract: a Drive `401` arrives as `AppError` kind `authentication`
   * with the status at `detail.status`. This service reads that status and
   * erases the stored token. Any other rejection keeps the token for a retry.
   * REQUIREMENTS 2.11, ARCHITECTURE §10 step 14.
   */
  bind: (accessToken: string) => Promise<string | BoundAccount>;
}

export interface DisconnectDependencies {
  /**
   * Send the token to Google's revocation endpoint and confirm the revocation.
   *
   * Resolve only when the token is no longer accepted. Reject when Google does
   * not confirm. The adapter's `revokeToken` already polls Drive until Drive
   * answers `401`, so this service performs no second probe. A probe after a
   * confirmed revocation would report failure for a revocation that worked.
   * REQUIREMENTS 2.13.
   */
  revoke: (accessToken: string) => Promise<void>;
}

let boundSession: AuthSession | null = null;

/**
 * Link the UI shows when Google does not confirm a revocation.
 *
 * The user revokes from there. REP JOT keeps its local state so the disconnect
 * can be retried or completed by hand. REQUIREMENTS 2.13.
 */
export const GOOGLE_ACCOUNT_CONNECTIONS_URL = 'https://myaccount.google.com/connections';

/** True when this page holds a bound session. */
export function isSignedIn(): boolean {
  return boundSession !== null;
}

/** The bound session, or `null` before binding completes. */
export function getSession(): AuthSession | null {
  return boundSession;
}

/**
 * Restore a stored token and bind it to its Drive account.
 *
 * REQUIREMENTS 2.11. The caller opens no private cache before this function
 * returns a session. A bind failure keeps the token so the user can retry. A
 * `401` from the bind call erases the token instead.
 */
export async function restoreAndBind(deps: BindDependencies): Promise<AuthSession | null> {
  const token: TokenRecord | null = restoreToken();
  if (token === null) {
    boundSession = null;
    return null;
  }

  let bound: unknown;
  try {
    bound = await deps.bind(token.accessToken);
  } catch (error: unknown) {
    if (signedOutDuringBind()) {
      return null;
    }
    boundSession = null;
    if (httpStatusOf(error) === 401) {
      expireSession('unauthorized');
      return null;
    }
    reportError(
      new AppError('authentication', { stage: 'bind' }, 'Account binding did not complete.')
    );
    return null;
  }

  // A `signOut()` or an expiry can land while the bind call is in flight. That
  // erased the stored token and the in-memory session. Do not write the token
  // back and do not report a session the user already ended. REQUIREMENTS 2.12.
  if (signedOutDuringBind()) {
    return null;
  }

  const account: BoundAccount | null = normalizeBoundAccount(bound);
  if (account === null) {
    boundSession = null;
    reportError(
      new AppError('authentication', { stage: 'bind' }, 'Google Drive returned no account key.')
    );
    return null;
  }

  const stored: TokenRecord = { ...token, accountKey: account.accountKey };
  saveToken(stored, isTokenRemembered());
  boundSession = {
    accessToken: stored.accessToken,
    accountKey: account.accountKey,
    expiresAtUtc: stored.expiresAtUtc,
    ...(account.displayName === undefined || account.displayName.length === 0
      ? {}
      : { displayName: account.displayName })
  };
  return boundSession;
}

/**
 * Forget this device's authorization without revoking the Google grant.
 *
 * REQUIREMENTS 2.12. Clears tokens, request state, the receipt, and the account
 * selection. Local caches and pending edits stay in place.
 */
export function signOut(): void {
  clearAllAuthState();
  boundSession = null;
}

/**
 * Revoke the grant at Google and clear local state once the revoke confirms.
 *
 * REQUIREMENTS 2.13. Local state clears only after the injected revoke step
 * confirms that the token is dead. A failed or unconfirmed revocation keeps the
 * session and reports the failure so the UI can link to Google Account
 * connections.
 */
export async function disconnect(deps: DisconnectDependencies): Promise<DisconnectResult> {
  const accessToken: string | null =
    boundSession?.accessToken ?? restoreToken()?.accessToken ?? null;

  if (accessToken === null) {
    clearAllAuthState();
    boundSession = null;
    return { kind: 'revoked' };
  }

  try {
    await deps.revoke(accessToken);
    clearAllAuthState();
    boundSession = null;
    return { kind: 'revoked' };
  } catch (error: unknown) {
    if (httpStatusOf(error) === 401) {
      clearAllAuthState();
      boundSession = null;
      return { kind: 'revoked' };
    }
    reportRevokeFailure();
    return { kind: 'revoke_failed' };
  }
}

/**
 * Drop the session and report the cause.
 *
 * REQUIREMENTS 2.14 support, ARCHITECTURE section 10 step 14. Call this on a
 * token expiry or when any Drive call returns `401`.
 */
export function expireSession(reason: ExpiryReason): void {
  clearAllAuthState();
  boundSession = null;
  reportError(
    new AppError(
      'authentication',
      { reason },
      reason === 'expired'
        ? 'Google access expired. Sign in to REP JOT again.'
        : 'Google rejected the stored access. Sign in to REP JOT again.'
    )
  );
}

/**
 * Milliseconds until the stored token expires, capped for `setTimeout`.
 *
 * Returns `0` when no token is present or the token already expired.
 */
export function millisecondsUntilExpiry(nowMs: number = Date.now()): number {
  const expiresAtUtc: string | null =
    boundSession?.expiresAtUtc ?? restoreToken()?.expiresAtUtc ?? null;
  if (expiresAtUtc === null) return 0;
  const remaining = Date.parse(expiresAtUtc) - nowMs;
  if (!Number.isFinite(remaining) || remaining <= 0) return 0;
  return Math.min(remaining, MAX_TIMER_DELAY_MS);
}

/**
 * True when the caller ended the session while the bind call ran.
 *
 * `signOut`, `expireSession`, and a confirmed `disconnect` clear storage and
 * drop the in-memory session. A bind that returns after one of those must not
 * write back the state the user just erased. REQUIREMENTS 2.12.
 */
function signedOutDuringBind(): boolean {
  return boundSession === null && !hasStoredToken();
}

/**
 * Accept either bind result shape. Returns `null` when no usable account key
 * came back.
 */
function normalizeBoundAccount(value: unknown): BoundAccount | null {
  if (typeof value === 'string') {
    return value.length > 0 ? { accountKey: value } : null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const candidate = value as BoundAccount;
  if (typeof candidate.accountKey !== 'string' || candidate.accountKey.length === 0) return null;
  return candidate;
}

function reportRevokeFailure(): void {
  reportError(
    new AppError(
      'authentication',
      { stage: 'disconnect' },
      'Google did not confirm that it revoked REP JOT access.'
    )
  );
}

/**
 * Read an HTTP status from an injected dependency error.
 *
 * The service does not import the Drive module, so it reads the status
 * structurally instead of by class. The Drive adapter throws `AppError` and
 * carries the status at `detail.status`. A plain thrown object with a
 * top-level `status` is read too, so any injected dependency can report one.
 * ARCHITECTURE §10 step 14.
 */
function httpStatusOf(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) return null;
  const status: unknown = isAppError(error)
    ? error.detail.status
    : (error as { status?: unknown }).status;
  return typeof status === 'number' ? status : null;
}
