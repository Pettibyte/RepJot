const GOOGLE_AUTHORIZATION_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const OAUTH_STATE_KEY = 'repjot-google-oauth-state';

function redirectUri(): string {
  return new URL('./', window.location.href).href;
}

function createState(): string {
  const bytes = new Uint8Array(24);
  window.crypto.getRandomValues(bytes);

  let state = '';
  for (let index = 0; index < bytes.length; index += 1) {
    const hex = bytes[index].toString(16);
    state += hex.length === 1 ? `0${hex}` : hex;
  }
  return state;
}

function clearOAuthFragment(): void {
  if (typeof window.history.replaceState === 'function') {
    window.history.replaceState(null, document.title, `${window.location.pathname}${window.location.search}`);
  }
}

export function beginDriveAuthorization(clientId: string): void {
  const state = createState();
  window.sessionStorage.setItem(OAUTH_STATE_KEY, state);

  const parameters = new URLSearchParams();
  parameters.set('client_id', clientId);
  parameters.set('redirect_uri', redirectUri());
  parameters.set('response_type', 'token');
  parameters.set('scope', DRIVE_SCOPE);
  parameters.set('include_granted_scopes', 'true');
  parameters.set('state', state);

  window.location.assign(`${GOOGLE_AUTHORIZATION_ENDPOINT}?${parameters.toString()}`);
}

export function consumeDriveAuthorizationResponse(): string | null {
  if (window.location.hash.length < 2) return null;

  const parameters = new URLSearchParams(window.location.hash.slice(1));
  if (!parameters.has('access_token') && !parameters.has('error')) return null;

  const expectedState = window.sessionStorage.getItem(OAUTH_STATE_KEY);
  window.sessionStorage.removeItem(OAUTH_STATE_KEY);
  clearOAuthFragment();

  const returnedState = parameters.get('state');
  if (expectedState === null || returnedState !== expectedState) {
    throw new Error('Google authorization returned an invalid state value. Please try again.');
  }

  const oauthError = parameters.get('error');
  if (oauthError !== null) {
    throw new Error(parameters.get('error_description') ?? oauthError);
  }

  const accessToken = parameters.get('access_token');
  if (accessToken === null || accessToken.length === 0) {
    throw new Error('Google authorization did not return an access token.');
  }

  return accessToken;
}
