const GOOGLE_AUTHORIZATION_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_REVOCATION_ENDPOINT = 'https://oauth2.googleapis.com/revoke';
export const GOOGLE_ACCOUNT_CONNECTIONS_URL = 'https://myaccount.google.com/connections';
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';

const OAUTH_PENDING_KEY = 'repjot.oauth.pending.v1';
const SESSION_TOKEN_KEY = 'repjot.oauth.token.v1';
const LOCAL_TOKEN_KEY = 'repjot.oauth.token.v1';
const MAX_TIMER_DELAY_MS = 2_147_483_647;

interface PendingAuthorization {
  state: string;
  remember: boolean;
  returnRoute: string;
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
    typeof candidate.returnRoute === 'string'
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
  const pending: PendingAuthorization = {
    state: createState(),
    remember: options.remember,
    returnRoute: safeReturnRoute(options.returnRoute)
  };
  window.sessionStorage.setItem(OAUTH_PENDING_KEY, JSON.stringify(pending));

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

  const pendingValue = parseJson(window.sessionStorage.getItem(OAUTH_PENDING_KEY));
  const pending = isPendingAuthorization(pendingValue) ? pendingValue : null;
  window.sessionStorage.removeItem(OAUTH_PENDING_KEY);
  replaceFragment(pending === null ? '#/' : pending.returnRoute);

  if (pending === null || parameters.get('state') !== pending.state) {
    throw new Error('Google authorization returned an invalid state. Try again.');
  }

  const oauthError = parameters.get('error');
  if (oauthError !== null) {
    if (oauthError === 'access_denied') {
      throw new Error('Google authorization was denied. No access token was saved.');
    }
    throw new Error('Google authorization did not complete. Try again.');
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
  window.sessionStorage.removeItem(OAUTH_PENDING_KEY);
  clearStoredTokens();
}

export function millisecondsUntilExpiry(authorization: DriveAuthorization, nowMs: number = Date.now()): number {
  return Math.max(0, Math.min(Date.parse(authorization.expiresAtUtc) - nowMs, MAX_TIMER_DELAY_MS));
}

export function revokeDriveAuthorization(accessToken: string, timeoutMs = 15_000): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const callbackName = `__repjotRevoke_${createState()}`;
    const script = document.createElement('script');
    let finished = false;

    const cleanup = (): void => {
      if (finished) return;
      finished = true;
      window.clearTimeout(timeout);
      script.remove();
      delete (window as unknown as Record<string, unknown>)[callbackName];
    };
    const fail = (message: string): void => {
      cleanup();
      reject(new Error(message));
    };

    (window as unknown as Record<string, unknown>)[callbackName] = (response: unknown): void => {
      if (typeof response === 'object' && response !== null && 'error' in response) {
        fail('Google did not confirm that it revoked access.');
        return;
      }
      cleanup();
      resolve();
    };

    const timeout = window.setTimeout(() => {
      fail('Google did not confirm that it revoked access.');
    }, timeoutMs);
    script.onerror = () => {
      fail('REP JOT could not contact the Google revocation service.');
    };

    const parameters = new URLSearchParams({ token: accessToken, callback: callbackName });
    script.src = `${GOOGLE_REVOCATION_ENDPOINT}?${parameters.toString()}`;
    script.async = true;
    document.head.appendChild(script);
  });
}
