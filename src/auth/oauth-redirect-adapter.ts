// OAuth redirect adapter.
// REQUIREMENTS 2.1 through 2.12. ARCHITECTURE section 10, steps 1 through 11.
//
// This module owns everything that touches the browser stores for authorization:
// the redirect request, the request-state records, the callback receipt, the
// token records, and the fragment cleanup. It talks to no network service. The
// account binding and the revocation calls live in `auth-service.ts` and
// `src/drive/drive-rest-adapter.ts`.
//
// The wire flow is the one proven in Phase 0. Do not change it. See
// `docs/PHASE-0-AUTHORIZATION-PROOF.md`.

import { AppError } from '../domain/errors';
import {
  AUTH_STORAGE_KEYS,
  LOCAL_TOKEN_KEY,
  OAUTH_RECEIPT_KEY,
  OAUTH_STATE_KEY,
  SELECTED_ACCOUNT_KEY,
  SESSION_TOKEN_KEY
} from './storage-keys';

const AUTHORIZATION_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';

/** The only scope REP JOT requests. REQUIREMENTS 2.3. */
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';

/** Lifetime of the OAuth request state. REQUIREMENTS 2.4. */
export const STATE_TTL_MS = 30 * 60 * 1000;

/** Lifetime of the duplicate-callback receipt. REQUIREMENTS 2.7. */
export const RECEIPT_TTL_MS = 60 * 1000;

const STATE_BYTES = 24;
const STATE_PATTERN = /^[0-9a-f]{48}$/;
const MAX_EXPIRY_SPAN_MS = 8_640_000_000_000_000;

/** A stored access token. `accountKey` stays `null` until the service binds it. */
export interface TokenRecord {
  accessToken: string;
  expiresAtUtc: string;
  grantedScope: string;
  accountKey: string | null;
}

export type CallbackKind = 'accepted' | 'duplicate' | 'invalid_state' | 'error';

/**
 * Result of one callback parse.
 *
 * `error` holds a safe code only, for example `access_denied`. It never holds a
 * token, a fragment, or a Google response body.
 */
export interface CallbackResult {
  kind: CallbackKind;
  token?: TokenRecord;
  error?: string;
}

export interface BeginAuthorizationOptions {
  /** Checked "Remember me on this device" selects `localStorage`. */
  remember: boolean;
  /** Route to restore after the redirect. Defaults to the current hash or `#/`. */
  returnRoute?: string;
  /** Ask Google for its account selector. Used by "Switch Google account". */
  selectAccount?: boolean;
}

interface StateRecord {
  state: string;
  remember: boolean;
  returnRoute: string;
  expiresAtUtc: string;
}

interface ReceiptRecord {
  tokenFingerprint: string;
  returnRoute: string;
  expiresAtUtc: string;
}

function stores(): Storage[] {
  return [window.sessionStorage, window.localStorage];
}

function redirectUri(): string {
  return new URL('./', window.location.href).href;
}

function safeReturnRoute(route: string | undefined): string {
  if (route !== undefined && /^#\/[A-Za-z0-9_~!$&'()*+,;=:@%./-]*$/.test(route)) {
    return route;
  }
  return '#/';
}

function createState(): string {
  const crypto = window.crypto;
  if (crypto === undefined || typeof crypto.getRandomValues !== 'function') {
    throw new AppError('insecure_environment', { stage: 'authorize' });
  }

  const bytes = new Uint8Array(STATE_BYTES);
  crypto.getRandomValues(bytes);

  let state = '';
  for (let index = 0; index < bytes.length; index += 1) {
    const hex = bytes[index].toString(16);
    state += hex.length === 1 ? `0${hex}` : hex;
  }
  return state;
}

/**
 * Fingerprint of an access token.
 *
 * The receipt must prove that a repeated callback carries the same token without
 * storing the token again. `crypto.subtle` is asynchronous and the callback
 * handler is synchronous, so this uses two FNV-1a 32-bit passes with different
 * offset bases. The result is 16 hex characters. It is not a security boundary;
 * it only makes a repeated or substituted token detectable for 60 seconds.
 */
function tokenFingerprint(accessToken: string): string {
  const codes: number[] = [];
  for (let index = 0; index < accessToken.length; index += 1) {
    codes.push(accessToken.charCodeAt(index));
  }

  const pass = (hashSeed: number, prime: number): string => {
    let hash = hashSeed;
    for (let index = 0; index < codes.length; index += 1) {
      hash = Math.imul(hash ^ codes[index], prime) >>> 0;
    }
    const hex = hash.toString(16);
    return `${'00000000'.slice(hex.length)}${hex}`;
  };

  return pass(0x811c9dc5, 0x01000193) + pass(0x1000193, 0x811c9dc5);
}

function replaceFragment(returnRoute: string): void {
  const route = safeReturnRoute(returnRoute);
  const cleanUrl = `${window.location.pathname}${window.location.search}${route}`;
  if (typeof window.history.replaceState === 'function') {
    window.history.replaceState(null, document.title, cleanUrl);
    return;
  }
  window.location.hash = route;
}

function parseJson(value: string | null): unknown {
  if (value === null) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function isStateRecord(value: unknown): value is StateRecord {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<StateRecord>;
  return (
    typeof candidate.state === 'string' &&
    STATE_PATTERN.test(candidate.state) &&
    typeof candidate.remember === 'boolean' &&
    typeof candidate.returnRoute === 'string' &&
    typeof candidate.expiresAtUtc === 'string' &&
    Number.isFinite(Date.parse(candidate.expiresAtUtc))
  );
}

function isReceiptRecord(value: unknown): value is ReceiptRecord {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<ReceiptRecord>;
  return (
    typeof candidate.tokenFingerprint === 'string' &&
    /^[0-9a-f]{16}$/.test(candidate.tokenFingerprint) &&
    typeof candidate.returnRoute === 'string' &&
    safeReturnRoute(candidate.returnRoute) === candidate.returnRoute &&
    typeof candidate.expiresAtUtc === 'string' &&
    Number.isFinite(Date.parse(candidate.expiresAtUtc))
  );
}

function isTokenRecord(value: unknown): value is TokenRecord {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<TokenRecord>;
  return (
    typeof candidate.accessToken === 'string' &&
    candidate.accessToken.length > 0 &&
    typeof candidate.expiresAtUtc === 'string' &&
    Number.isFinite(Date.parse(candidate.expiresAtUtc)) &&
    typeof candidate.grantedScope === 'string' &&
    grantedScopes(candidate.grantedScope).has(DRIVE_SCOPE) &&
    (candidate.accountKey === null ||
      (typeof candidate.accountKey === 'string' && candidate.accountKey.length > 0))
  );
}

function grantedScopes(scope: string): Set<string> {
  return new Set(scope.split(/\s+/).filter((value: string) => value.length > 0));
}

function removeKeyEverywhere(key: string): void {
  stores().forEach((storage: Storage) => storage.removeItem(key));
}

function readState(nowMs: number): { session: StateRecord | null; local: StateRecord | null } {
  const result: { session: StateRecord | null; local: StateRecord | null } = {
    session: null,
    local: null
  };
  const pairs: Array<[Storage, 'session' | 'local']> = [
    [window.sessionStorage, 'session'],
    [window.localStorage, 'local']
  ];
  pairs.forEach(([storage, name]) => {
    const value = parseJson(storage.getItem(OAUTH_STATE_KEY));
    if (!isStateRecord(value) || Date.parse(value.expiresAtUtc) <= nowMs) {
      storage.removeItem(OAUTH_STATE_KEY);
      return;
    }
    result[name] = value;
  });
  return result;
}

function readReceipt(nowMs: number): ReceiptRecord | null {
  const value = parseJson(window.localStorage.getItem(OAUTH_RECEIPT_KEY));
  if (!isReceiptRecord(value) || Date.parse(value.expiresAtUtc) <= nowMs) {
    window.localStorage.removeItem(OAUTH_RECEIPT_KEY);
    return null;
  }
  return value;
}

/** True when `value` is a token record that has not passed its exact expiry. */
function isLiveTokenRecord(value: unknown, nowMs: number): value is TokenRecord {
  return isTokenRecord(value) && Date.parse(value.expiresAtUtc) > nowMs;
}

/**
 * Read one store's token record and drop it when it cannot be used.
 *
 * Only that store's keys are removed. A dead record in one store must never
 * erase a live record in the other store, because two tabs in one browser
 * profile can hold one record each. REQUIREMENTS 2.10.
 */
function takeTokenRecord(storage: Storage, key: string, nowMs: number): TokenRecord | null {
  const value = parseJson(storage.getItem(key));
  if (value === null) return null;
  if (!isLiveTokenRecord(value, nowMs)) {
    storage.removeItem(key);
    storage.removeItem(SELECTED_ACCOUNT_KEY);
    return null;
  }
  return value;
}

/**
 * Read the live token record, `sessionStorage` first, then `localStorage`.
 *
 * An expired or malformed record is skipped, so it cannot shadow a live record
 * in the other store. REQUIREMENTS 2.10.
 */
function readStoredTokenRecord(nowMs: number): TokenRecord | null {
  const sessionRecord = takeTokenRecord(window.sessionStorage, SESSION_TOKEN_KEY, nowMs);
  const localRecord = takeTokenRecord(window.localStorage, LOCAL_TOKEN_KEY, nowMs);
  return sessionRecord ?? localRecord;
}

function removeTokenState(): void {
  removeKeyEverywhere(SESSION_TOKEN_KEY);
  removeKeyEverywhere(LOCAL_TOKEN_KEY);
  removeKeyEverywhere(SELECTED_ACCOUNT_KEY);
}

/**
 * Save one token record and drop the copy in the other store.
 *
 * REQUIREMENTS 2.9 and 2.10. A bound account key is stored beside the token so
 * sign-out can clear the account selection.
 */
export function saveToken(token: TokenRecord, remember: boolean): void {
  removeTokenState();
  const storage: Storage = remember ? window.localStorage : window.sessionStorage;
  const key: string = remember ? LOCAL_TOKEN_KEY : SESSION_TOKEN_KEY;
  storage.setItem(key, JSON.stringify(token));
  if (token.accountKey !== null) {
    storage.setItem(SELECTED_ACCOUNT_KEY, token.accountKey);
  }
}

/**
 * Remove every authorization key from both stores.
 *
 * REQUIREMENTS 2.12. Covers tokens, request state, the callback receipt, and the
 * selected account.
 */
export function clearAllAuthState(): void {
  AUTH_STORAGE_KEYS.forEach((key: string) => removeKeyEverywhere(key));
}

/**
 * True when the current URL fragment can hold a Google callback.
 *
 * A plain route fragment such as `#/settings` is not a callback, so a normal
 * page load never reads one.
 */
export function hasCallbackFragment(): boolean {
  const hash = window.location.hash;
  if (hash.length < 2) return false;
  const parameters = new URLSearchParams(hash.slice(1));
  return parameters.has('access_token') || parameters.has('error');
}

/** True when the stored token sits in `localStorage`. False when absent or in `sessionStorage`. */
export function isTokenRemembered(nowMs: number = Date.now()): boolean {
  const local = parseJson(window.localStorage.getItem(LOCAL_TOKEN_KEY));
  return isTokenRecord(local) && Date.parse(local.expiresAtUtc) > nowMs;
}

/**
 * True when a live token record sits in either store.
 *
 * The UI uses this to keep the sign-out control reachable when a token exists
 * but the account bind failed. This reader never writes, so a component can
 * call it while it renders. REQUIREMENTS 2.12.
 */
export function hasStoredToken(nowMs: number = Date.now()): boolean {
  return (
    isLiveTokenRecord(parseJson(window.sessionStorage.getItem(SESSION_TOKEN_KEY)), nowMs) ||
    isLiveTokenRecord(parseJson(window.localStorage.getItem(LOCAL_TOKEN_KEY)), nowMs)
  );
}

/**
 * Start the full-page implicit redirect in this window.
 *
 * REQUIREMENTS 2.1 through 2.5. The request state goes to both stores because
 * Silk can replace `sessionStorage` during a denial or account-selection
 * redirect. The state record holds no token.
 */
export function beginAuthorization(clientId: string, opts: BeginAuthorizationOptions): void {
  clearAllAuthState();

  const record: StateRecord = {
    state: createState(),
    remember: opts.remember,
    returnRoute: safeReturnRoute(opts.returnRoute ?? window.location.hash),
    expiresAtUtc: new Date(Date.now() + STATE_TTL_MS).toISOString()
  };
  const serialized = JSON.stringify(record);
  window.sessionStorage.setItem(OAUTH_STATE_KEY, serialized);
  window.localStorage.setItem(OAUTH_STATE_KEY, serialized);

  const parameters = new URLSearchParams();
  parameters.set('client_id', clientId);
  parameters.set('redirect_uri', redirectUri());
  parameters.set('response_type', 'token');
  parameters.set('scope', DRIVE_SCOPE);
  parameters.set('include_granted_scopes', 'true');
  parameters.set('state', record.state);
  if (opts.selectAccount === true) parameters.set('prompt', 'select_account');

  window.location.replace(`${AUTHORIZATION_ENDPOINT}?${parameters.toString()}`);
}

/**
 * Parse the callback fragment and store the token it carries.
 *
 * REQUIREMENTS 2.6 through 2.10. The fragment is removed before this function
 * returns on every path, so the access token never stays in the address bar or in
 * the browser history.
 */
export function consumeCallback(nowMs: number = Date.now()): CallbackResult {
  if (!hasCallbackFragment()) return { kind: 'error', error: 'malformed_callback' };

  const parameters = new URLSearchParams(window.location.hash.slice(1));
  const hasToken = parameters.has('access_token');
  const oauthError = parameters.get('error');
  if (!hasToken && oauthError === null) return { kind: 'error', error: 'malformed_callback' };

  const stateRecords = readState(nowMs);
  const returnedState = parameters.get('state');
  const matched = [stateRecords.session, stateRecords.local].find((record: StateRecord | null) => (
    record !== null && record.state === returnedState
  )) ?? null;

  const returnRoute = stateRecords.session?.returnRoute ??
    stateRecords.local?.returnRoute ??
    readReceipt(nowMs)?.returnRoute ??
    '#/';

  clearStateRecords();
  replaceFragment(returnRoute);

  if (oauthError !== null) {
    return { kind: 'error', error: safeErrorCode(oauthError) };
  }

  if (matched === null) {
    const duplicate = findDuplicate(parameters.get('access_token'), nowMs);
    return duplicate === null
      ? { kind: 'invalid_state' }
      : { kind: 'duplicate', token: duplicate };
  }

  const accessToken = parameters.get('access_token');
  if (accessToken === null || accessToken.length === 0) {
    return { kind: 'error', error: 'missing_token' };
  }

  const scope = parameters.get('scope');
  if (scope === null || !grantedScopes(scope).has(DRIVE_SCOPE)) {
    return { kind: 'error', error: 'missing_scope' };
  }

  const tokenType = parameters.get('token_type');
  if (tokenType !== null && tokenType.toLowerCase() !== 'bearer') {
    return { kind: 'error', error: 'unsupported_token_type' };
  }

  const expiresInSeconds = Number(parameters.get('expires_in') ?? '');
  const expiresAtMs = nowMs + expiresInSeconds * 1000;
  if (
    !Number.isFinite(expiresInSeconds) ||
    expiresInSeconds <= 0 ||
    !Number.isFinite(expiresAtMs) ||
    Math.abs(expiresAtMs) > MAX_EXPIRY_SPAN_MS
  ) {
    return { kind: 'error', error: 'invalid_expiry' };
  }

  const token: TokenRecord = {
    accessToken,
    expiresAtUtc: new Date(expiresAtMs).toISOString(),
    grantedScope: scope,
    accountKey: null
  };
  saveToken(token, matched.remember);
  saveReceipt(accessToken, returnRoute, nowMs);
  return { kind: 'accepted', token };
}

/**
 * Read the live token record and drop it when it cannot be used.
 *
 * REQUIREMENTS 2.10. Returns `null` for an absent, malformed, or expired record
 * and erases the record in every case where it cannot be used.
 */
export function restoreToken(nowMs: number = Date.now()): TokenRecord | null {
  readState(nowMs);
  readReceipt(nowMs);

  const record = readStoredTokenRecord(nowMs);
  if (record === null) {
    removeKeyEverywhere(SELECTED_ACCOUNT_KEY);
  }
  return record;
}

/**
 * Read the live token record without writing anything.
 *
 * `restoreToken` cleans up state it finds unusable, so it writes to browser
 * storage. A value read on every Drive call must not write, because a getter
 * that mutates storage is a trap for its callers. This reader only reads, and
 * skips a record past its expiry the same way `restoreToken` does.
 * REQUIREMENTS 2.10.
 */
export function peekStoredToken(nowMs: number = Date.now()): TokenRecord | null {
  const sessionValue = parseJson(window.sessionStorage.getItem(SESSION_TOKEN_KEY));
  const localValue = parseJson(window.localStorage.getItem(LOCAL_TOKEN_KEY));
  if (isLiveTokenRecord(sessionValue, nowMs)) return sessionValue;
  if (isLiveTokenRecord(localValue, nowMs)) return localValue;
  return null;
}

function clearStateRecords(): void {
  removeKeyEverywhere(OAUTH_STATE_KEY);
}

function saveReceipt(accessToken: string, returnRoute: string, nowMs: number): void {
  const record: ReceiptRecord = {
    tokenFingerprint: tokenFingerprint(accessToken),
    returnRoute: safeReturnRoute(returnRoute),
    expiresAtUtc: new Date(nowMs + RECEIPT_TTL_MS).toISOString()
  };
  window.localStorage.setItem(OAUTH_RECEIPT_KEY, JSON.stringify(record));
}

/**
 * Return the stored token for a repeated callback.
 *
 * REQUIREMENTS 2.8. A repeat is a duplicate only when the stored record is
 * valid, unexpired, holds the same access token, and the receipt fingerprint for
 * that token is still live.
 */
function findDuplicate(accessToken: string | null, nowMs: number): TokenRecord | null {
  if (accessToken === null || accessToken.length === 0) return null;

  const receipt = readReceipt(nowMs);
  if (receipt === null || receipt.tokenFingerprint !== tokenFingerprint(accessToken)) return null;

  const candidates = [
    parseJson(window.sessionStorage.getItem(SESSION_TOKEN_KEY)),
    parseJson(window.localStorage.getItem(LOCAL_TOKEN_KEY))
  ];
  const match = candidates.find((candidate: unknown) => (
    isTokenRecord(candidate) &&
    Date.parse(candidate.expiresAtUtc) > nowMs &&
    candidate.accessToken === accessToken
  ));
  return isTokenRecord(match) ? match : null;
}

function safeErrorCode(error: string): string {
  const code = error.trim().toLowerCase();
  return /^[a-z_]{1,32}$/.test(code) ? code : 'oauth_error';
}
