const GOOGLE_AUTHORIZATION_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_REVOCATION_ENDPOINT = 'https://oauth2.googleapis.com/revoke';
const DRIVE_AUTHORIZATION_CHECK_ENDPOINT =
  'https://www.googleapis.com/drive/v3/about?fields=user(permissionId)';
export const GOOGLE_ACCOUNT_CONNECTIONS_URL = 'https://myaccount.google.com/connections';
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';

const OAUTH_PENDING_KEY = 'repjot.oauth.pending.v1';
const SESSION_TOKEN_KEY = 'repjot.oauth.token.v1';
const LOCAL_TOKEN_KEY = 'repjot.oauth.token.v1';
const MAX_TIMER_DELAY_MS = 2_147_483_647;
const PENDING_AUTHORIZATION_LIFETIME_MS = 30 * 60 * 1000;
const REVOCATION_CHECK_INTERVAL_MS = 500;

interface PendingAuthorization {
  state: string;
  remember: boolean;
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

function clearExpiredPendingAuthorization(nowMs: number): void {
  const stores = [window.sessionStorage, window.localStorage];
  stores.forEach((storage: Storage) => {
    const value = parseJson(storage.getItem(OAUTH_PENDING_KEY));
    if (!isPendingAuthorization(value) || Date.parse(value.expiresAtUtc) <= nowMs) {
      storage.removeItem(OAUTH_PENDING_KEY);
    }
  });
}

function clearStoredTokens(): void {
  window.sessionStorage.removeItem(SESSION_TOKEN_KEY);
  window.localStorage.removeItem(LOCAL_TOKEN_KEY);
}

function saveAuthorization(authorization: DriveAuthorization): void {
  clearStoredTokens();
  tokenStorage(authorization.remember).setItem(
    authorization.remember ? LOCAL_TOKEN_KEY : SESSION_TOKEN_KEY,
    JSON.stringify(authorization)
  );
}

export function beginDriveAuthorization(clientId: string, options: BeginAuthorizationOptions): void {
  clearStoredTokens();
  clearPendingAuthorization();
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

  const parameters = new URLSearchParams();
  parameters.set('client_id', clientId);
  parameters.set('redirect_uri', redirectUri());
  parameters.set('response_type', 'token');
  parameters.set('scope', DRIVE_SCOPE);
  parameters.set('include_granted_scopes', 'true');
  parameters.set('state', pending.state);
  if (options.selectAccount === true) parameters.set('prompt', 'select_account');

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
  const returnRoute = sessionPending?.returnRoute ?? localPending?.returnRoute ?? '#/';
  clearPendingAuthorization();
  replaceFragment(returnRoute);

  const oauthError = parameters.get('error');
  if (oauthError !== null) {
    if (oauthError === 'access_denied') {
      throw new Error('Google authorization was denied. No access token was saved.');
    }
    throw new Error('Google authorization did not complete. Try again.');
  }

  if (pending === null) {
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

  const authorization: DriveAuthorization = {
    accessToken,
    expiresAtUtc: new Date(expiresAtMs).toISOString(),
    grantedScope: scope,
    remember: pending.remember
  };
  saveAuthorization(authorization);
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
  saveAuthorization(bound);
  return bound;
}

export function clearDriveAuthorization(): void {
  clearPendingAuthorization();
  clearStoredTokens();
}

export function millisecondsUntilExpiry(authorization: DriveAuthorization, nowMs: number = Date.now()): number {
  return Math.max(0, Math.min(Date.parse(authorization.expiresAtUtc) - nowMs, MAX_TIMER_DELAY_MS));
}

export function revokeDriveAuthorization(accessToken: string, timeoutMs = 15_000): Promise<void> {
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
      form.remove();
      scheduleCheck();
    } catch {
      fail();
    }
  });
}
