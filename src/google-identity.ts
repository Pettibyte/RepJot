import { recordAuthDiagnostic } from './auth-diagnostics';

const GOOGLE_AUTHORIZATION_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_REVOCATION_ENDPOINT = 'https://oauth2.googleapis.com/revoke';
const DRIVE_AUTHORIZATION_CHECK_ENDPOINT =
  'https://www.googleapis.com/drive/v3/about?fields=user(permissionId)';
export const GOOGLE_ACCOUNT_CONNECTIONS_URL = 'https://myaccount.google.com/connections';
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';

const OAUTH_PENDING_KEY = 'repjot.oauth.pending.v1';
const OAUTH_RESPONSE_RECEIPT_KEY = 'repjot.oauth.response-receipt.v1';
const SESSION_TOKEN_KEY = 'repjot.oauth.token.v1';
const LOCAL_TOKEN_KEY = 'repjot.oauth.token.v1';
const MAX_TIMER_DELAY_MS = 2_147_483_647;
const PENDING_AUTHORIZATION_LIFETIME_MS = 30 * 60 * 1000;
const RESPONSE_RECEIPT_LIFETIME_MS = 60 * 1000;
const REVOCATION_CHECK_INTERVAL_MS = 500;

interface PendingAuthorization {
  state: string;
  remember: boolean;
  returnRoute: string;
  expiresAtUtc: string;
}

interface AuthorizationResponseReceipt {
  returnRoute: string;
  expiresAtUtc: string;
}

export interface DriveAuthorization {
  accessToken: string;
  expiresAtUtc: string;
  grantedScope: string;
  remember: boolean;
  accountKey?: string;
}

export interface BeginAuthorizationOptions {
  remember: boolean;
  returnRoute?: string;
  selectAccount?: boolean;
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
  if (window.crypto === undefined || typeof window.crypto.getRandomValues !== 'function') {
    throw new Error('This browser cannot create a secure Google authorization request.');
  }

  const bytes = new Uint8Array(24);
  window.crypto.getRandomValues(bytes);

  let state = '';
  for (let index = 0; index < bytes.length; index += 1) {
    const hex = bytes[index].toString(16);
    state += hex.length === 1 ? `0${hex}` : hex;
  }
  return state;
}

function replaceFragment(returnRoute: string): void {
  const cleanUrl = `${window.location.pathname}${window.location.search}${safeReturnRoute(returnRoute)}`;
  if (typeof window.history.replaceState === 'function') {
    window.history.replaceState(null, document.title, cleanUrl);
    return;
  }
  window.location.hash = safeReturnRoute(returnRoute);
}

function parseJson(value: string | null): unknown {
  if (value === null) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function isPendingAuthorization(value: unknown): value is PendingAuthorization {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<PendingAuthorization>;
  return (
    typeof candidate.state === 'string' &&
    /^[0-9a-f]{48}$/.test(candidate.state) &&
    typeof candidate.remember === 'boolean' &&
    typeof candidate.returnRoute === 'string' &&
    typeof candidate.expiresAtUtc === 'string' &&
    Number.isFinite(Date.parse(candidate.expiresAtUtc))
  );
}

function isAuthorizationResponseReceipt(value: unknown): value is AuthorizationResponseReceipt {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<AuthorizationResponseReceipt>;
  return (
    typeof candidate.returnRoute === 'string' &&
    safeReturnRoute(candidate.returnRoute) === candidate.returnRoute &&
    typeof candidate.expiresAtUtc === 'string' &&
    Number.isFinite(Date.parse(candidate.expiresAtUtc))
  );
}

function isDriveAuthorization(value: unknown): value is DriveAuthorization {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<DriveAuthorization>;
  return (
    typeof candidate.accessToken === 'string' &&
    candidate.accessToken.length > 0 &&
    typeof candidate.expiresAtUtc === 'string' &&
    Number.isFinite(Date.parse(candidate.expiresAtUtc)) &&
    typeof candidate.grantedScope === 'string' &&
    grantedScopes(candidate.grantedScope).has(DRIVE_SCOPE) &&
    typeof candidate.remember === 'boolean' &&
    (candidate.accountKey === undefined ||
      (typeof candidate.accountKey === 'string' && candidate.accountKey.length > 0))
  );
}

function grantedScopes(scope: string): Set<string> {
  return new Set(scope.split(/\s+/).filter((value: string) => value.length > 0));
}

function tokenStorage(remember: boolean): Storage {
  return remember ? window.localStorage : window.sessionStorage;
}

function clearPendingAuthorization(): void {
  window.sessionStorage.removeItem(OAUTH_PENDING_KEY);
  window.localStorage.removeItem(OAUTH_PENDING_KEY);
}

function clearAuthorizationResponseReceipt(): void {
  window.localStorage.removeItem(OAUTH_RESPONSE_RECEIPT_KEY);
}

function saveAuthorizationResponseReceipt(returnRoute: string, nowMs: number): void {
  const receipt: AuthorizationResponseReceipt = {
    returnRoute: safeReturnRoute(returnRoute),
    expiresAtUtc: new Date(nowMs + RESPONSE_RECEIPT_LIFETIME_MS).toISOString()
  };
  window.localStorage.setItem(OAUTH_RESPONSE_RECEIPT_KEY, JSON.stringify(receipt));
}

function currentAuthorizationResponseReceipt(nowMs: number): AuthorizationResponseReceipt | null {
  const value = parseJson(window.localStorage.getItem(OAUTH_RESPONSE_RECEIPT_KEY));
  if (!isAuthorizationResponseReceipt(value) || Date.parse(value.expiresAtUtc) <= nowMs) {
    clearAuthorizationResponseReceipt();
    return null;
  }
  return value;
}

function clearExpiredPendingAuthorization(nowMs: number): void {
  currentAuthorizationResponseReceipt(nowMs);
  const stores = [window.sessionStorage, window.localStorage];
  stores.forEach((storage: Storage) => {
    const value = parseJson(storage.getItem(OAUTH_PENDING_KEY));
    if (!isPendingAuthorization(value) || Date.parse(value.expiresAtUtc) <= nowMs) {
      storage.removeItem(OAUTH_PENDING_KEY);
    }
  });
}

function authorizationMatchingToken(accessToken: string | null, nowMs: number): DriveAuthorization | null {
  if (accessToken === null || accessToken.length === 0) return null;
  const candidates = [
    parseJson(window.sessionStorage.getItem(SESSION_TOKEN_KEY)),
    parseJson(window.localStorage.getItem(LOCAL_TOKEN_KEY))
  ];
  const match = candidates.find((candidate: unknown) => (
    isDriveAuthorization(candidate) &&
    Date.parse(candidate.expiresAtUtc) > nowMs &&
    candidate.accessToken === accessToken
  ));
  return isDriveAuthorization(match) ? match : null;
}

function clearStoredTokens(): void {
  window.sessionStorage.removeItem(SESSION_TOKEN_KEY);
  window.localStorage.removeItem(LOCAL_TOKEN_KEY);
}

function saveAuthorization(authorization: DriveAuthorization): void {
  clearStoredTokens();
  const store = authorization.remember ? 'local' : 'session';
  tokenStorage(authorization.remember).setItem(
    authorization.remember ? LOCAL_TOKEN_KEY : SESSION_TOKEN_KEY,
    JSON.stringify(authorization)
  );
  recordAuthDiagnostic('token_saved', {
    store,
    accountBound: authorization.accountKey !== undefined
  });
}

export function beginDriveAuthorization(clientId: string, options: BeginAuthorizationOptions): void {
  recordAuthDiagnostic('authorization_begin', {
    remember: options.remember,
    selectAccount: options.selectAccount === true,
    hadSessionPending: window.sessionStorage.getItem(OAUTH_PENDING_KEY) !== null,
    hadLocalPending: window.localStorage.getItem(OAUTH_PENDING_KEY) !== null
  });
  clearStoredTokens();
  clearPendingAuthorization();
  clearAuthorizationResponseReceipt();
  const pending: PendingAuthorization = {
    state: createState(),
    remember: options.remember,
    returnRoute: safeReturnRoute(options.returnRoute),
    expiresAtUtc: new Date(Date.now() + PENDING_AUTHORIZATION_LIFETIME_MS).toISOString()
  };
  const serializedPending = JSON.stringify(pending);
  window.sessionStorage.setItem(OAUTH_PENDING_KEY, serializedPending);
  // Silk can replace sessionStorage during denial and account-selection redirects.
  // Keep the non-secret, short-lived request state in both browser stores.
  window.localStorage.setItem(OAUTH_PENDING_KEY, serializedPending);
  recordAuthDiagnostic('authorization_pending_saved', {
    sessionPending: window.sessionStorage.getItem(OAUTH_PENDING_KEY) !== null,
    localPending: window.localStorage.getItem(OAUTH_PENDING_KEY) !== null,
    lifetimeSeconds: PENDING_AUTHORIZATION_LIFETIME_MS / 1000
  });

  const parameters = new URLSearchParams();
  parameters.set('client_id', clientId);
  parameters.set('redirect_uri', redirectUri());
  parameters.set('response_type', 'token');
  parameters.set('scope', DRIVE_SCOPE);
  parameters.set('include_granted_scopes', 'true');
  parameters.set('state', pending.state);
  if (options.selectAccount === true) parameters.set('prompt', 'select_account');

  recordAuthDiagnostic('authorization_redirect', {
    selectAccount: options.selectAccount === true
  });
  window.location.replace(`${GOOGLE_AUTHORIZATION_ENDPOINT}?${parameters.toString()}`);
}

export function consumeDriveAuthorizationResponse(nowMs: number = Date.now()): DriveAuthorization | null {
  if (window.location.hash.length < 2) return null;

  const parameters = new URLSearchParams(window.location.hash.slice(1));
  if (!parameters.has('access_token') && !parameters.has('error')) return null;

  const sessionValue = parseJson(window.sessionStorage.getItem(OAUTH_PENDING_KEY));
  const localValue = parseJson(window.localStorage.getItem(OAUTH_PENDING_KEY));
  const sessionPending = isPendingAuthorization(sessionValue) ? sessionValue : null;
  const localPending = isPendingAuthorization(localValue) ? localValue : null;
  const returnedState = parameters.get('state');
  const pendingCandidates = [sessionPending, localPending];
  const pending = pendingCandidates.find((candidate: PendingAuthorization | null) => (
    candidate !== null &&
    Date.parse(candidate.expiresAtUtc) > nowMs &&
    candidate.state === returnedState
  )) ?? null;
  const oauthError = parameters.get('error');
  const duplicateAuthorization = pending === null && oauthError === null
    ? authorizationMatchingToken(parameters.get('access_token'), nowMs)
    : null;
  const responseReceipt = duplicateAuthorization === null
    ? null
    : currentAuthorizationResponseReceipt(nowMs);
  const duplicateResponse = duplicateAuthorization !== null && responseReceipt !== null;
  recordAuthDiagnostic('authorization_response', {
    hasToken: parameters.has('access_token'),
    errorKind: oauthError === null ? 'none' : oauthError === 'access_denied' ? 'access_denied' : 'other',
    returnedState: returnedState !== null,
    sessionPending: sessionPending !== null,
    localPending: localPending !== null,
    pendingCopiesEqual: sessionPending !== null && localPending !== null && sessionPending.state === localPending.state,
    stateMatched: pending !== null,
    duplicateResponse
  });
  const returnRoute = sessionPending?.returnRoute ??
    localPending?.returnRoute ??
    responseReceipt?.returnRoute ??
    '#/';
  clearPendingAuthorization();
  replaceFragment(returnRoute);

  if (oauthError !== null) {
    if (oauthError === 'access_denied') {
      throw new Error('Google authorization was denied. No access token was saved.');
    }
    throw new Error('Google authorization did not complete. Try again.');
  }

  if (pending === null) {
    if (duplicateResponse && duplicateAuthorization !== null) {
      recordAuthDiagnostic('authorization_duplicate_response_reused');
      return duplicateAuthorization;
    }
    throw new Error('Google authorization returned an invalid state. Try again.');
  }

  const accessToken = parameters.get('access_token');
  const scope = parameters.get('scope');
  const expiresInText = parameters.get('expires_in');
  const expiresInSeconds = expiresInText === null ? Number.NaN : Number(expiresInText);

  if (accessToken === null || accessToken.length === 0) {
    throw new Error('Google authorization did not return an access token.');
  }
  if (scope === null || !grantedScopes(scope).has(DRIVE_SCOPE)) {
    throw new Error('Google did not grant access to REP JOT app data.');
  }
  const expiresAtMs = nowMs + expiresInSeconds * 1000;
  if (
    !Number.isFinite(expiresInSeconds) ||
    expiresInSeconds <= 0 ||
    !Number.isFinite(expiresAtMs) ||
    Math.abs(expiresAtMs) > 8_640_000_000_000_000
  ) {
    throw new Error('Google authorization returned an invalid expiry time.');
  }
  const tokenType = parameters.get('token_type');
  if (tokenType !== null && tokenType.toLowerCase() !== 'bearer') {
    throw new Error('Google authorization returned an unsupported token type.');
  }

  recordAuthDiagnostic('authorization_response_validated', {
    remember: pending.remember,
    expiresInSeconds
  });
  const authorization: DriveAuthorization = {
    accessToken,
    expiresAtUtc: new Date(expiresAtMs).toISOString(),
    grantedScope: scope,
    remember: pending.remember
  };
  saveAuthorization(authorization);
  saveAuthorizationResponseReceipt(returnRoute, nowMs);
  return authorization;
}

export function restoreDriveAuthorization(nowMs: number = Date.now()): DriveAuthorization | null {
  clearExpiredPendingAuthorization(nowMs);
  const sessionValue = parseJson(window.sessionStorage.getItem(SESSION_TOKEN_KEY));
  const localValue = parseJson(window.localStorage.getItem(LOCAL_TOKEN_KEY));
  const sessionAuthorization = isDriveAuthorization(sessionValue) ? sessionValue : null;
  const localAuthorization = isDriveAuthorization(localValue) ? localValue : null;

  if (sessionAuthorization === null) window.sessionStorage.removeItem(SESSION_TOKEN_KEY);
  if (localAuthorization === null) window.localStorage.removeItem(LOCAL_TOKEN_KEY);

  const authorization = sessionAuthorization === null ? localAuthorization : sessionAuthorization;
  recordAuthDiagnostic('authorization_restore', {
    sessionTokenValid: sessionAuthorization !== null,
    localTokenValid: localAuthorization !== null,
    tokenFound: authorization !== null,
    expired: authorization !== null && Date.parse(authorization.expiresAtUtc) <= nowMs
  });
  if (authorization === null) return null;
  if (Date.parse(authorization.expiresAtUtc) <= nowMs) {
    clearDriveAuthorization();
    return null;
  }

  saveAuthorization(authorization);
  return authorization;
}

export function bindDriveAuthorization(
  authorization: DriveAuthorization,
  accountKey: string
): DriveAuthorization {
  if (accountKey.length === 0) throw new Error('Google Drive did not return an account key.');
  const bound: DriveAuthorization = { ...authorization, accountKey };
  recordAuthDiagnostic('account_binding_saved');
  saveAuthorization(bound);
  return bound;
}

export function clearDriveAuthorization(): void {
  clearPendingAuthorization();
  clearAuthorizationResponseReceipt();
  clearStoredTokens();
}

export function millisecondsUntilExpiry(authorization: DriveAuthorization, nowMs: number = Date.now()): number {
  return Math.max(0, Math.min(Date.parse(authorization.expiresAtUtc) - nowMs, MAX_TIMER_DELAY_MS));
}

export function revokeDriveAuthorization(accessToken: string, timeoutMs = 15_000): Promise<void> {
  recordAuthDiagnostic('revocation_begin', { timeoutMs });
  return new Promise<void>((resolve, reject) => {
    const frameName = `repjot_revoke_${createState()}`;
    const frame = document.createElement('iframe');
    const form = document.createElement('form');
    const tokenField = document.createElement('input');
    const deadline = Date.now() + timeoutMs;
    let checkTimer: number | null = null;
    let finished = false;

    frame.name = frameName;
    frame.title = 'Google authorization revocation';
    frame.style.display = 'none';
    form.method = 'post';
    form.action = GOOGLE_REVOCATION_ENDPOINT;
    form.target = frameName;
    form.style.display = 'none';
    tokenField.type = 'hidden';
    tokenField.name = 'token';
    tokenField.value = accessToken;
    form.appendChild(tokenField);

    const cleanup = (): void => {
      if (finished) return;
      finished = true;
      if (checkTimer !== null) window.clearTimeout(checkTimer);
      form.remove();
      frame.remove();
    };
    const fail = (): void => {
      recordAuthDiagnostic('revocation_unconfirmed');
      cleanup();
      reject(new Error('Google did not confirm that it revoked access.'));
    };
    const scheduleCheck = (): void => {
      if (finished) return;
      if (Date.now() >= deadline) {
        fail();
        return;
      }
      const delay = Math.min(REVOCATION_CHECK_INTERVAL_MS, deadline - Date.now());
      checkTimer = window.setTimeout(checkAuthorization, delay);
    };
    const checkAuthorization = async (): Promise<void> => {
      if (finished) return;
      try {
        const response = await fetch(DRIVE_AUTHORIZATION_CHECK_ENDPOINT, {
          headers: { Authorization: `Bearer ${accessToken}` },
          cache: 'no-store'
        });
        if (response.status === 401) {
          recordAuthDiagnostic('revocation_confirmed');
          cleanup();
          resolve();
          return;
        }
      } catch {
        // A network error cannot prove that Google revoked the token.
      }
      scheduleCheck();
    };

    document.body.appendChild(frame);
    document.body.appendChild(form);
    try {
      form.submit();
      recordAuthDiagnostic('revocation_form_submitted');
      form.remove();
      scheduleCheck();
    } catch {
      fail();
    }
  });
}
