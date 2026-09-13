import { afterEach, describe, expect, test } from 'bun:test';
import { AppError } from '../src/domain/errors';
import {
  DRIVE_SCOPE,
  RECEIPT_TTL_MS,
  STATE_TTL_MS,
  beginAuthorization,
  clearAllAuthState,
  consumeCallback,
  hasCallbackFragment,
  hasStoredToken,
  isTokenRemembered,
  peekStoredToken,
  restoreToken,
  saveToken,
  type TokenRecord
} from '../src/auth/oauth-redirect-adapter';
import {
  AUTH_STORAGE_KEYS,
  LOCAL_TOKEN_KEY,
  OAUTH_RECEIPT_KEY,
  OAUTH_STATE_KEY,
  SELECTED_ACCOUNT_KEY,
  SESSION_TOKEN_KEY
} from '../src/auth/storage-keys';
import {
  authorizationState,
  installFakeBrowser,
  responseFragment,
  uninstallFakeBrowser,
  type FakeBrowser
} from './support/fake-browser';

const CLIENT_ID = 'client.apps.googleusercontent.com';
const HOUR_MS = 3_600_000;

afterEach(() => {
  uninstallFakeBrowser();
});

function completeSignIn(browser: FakeBrowser, remember: boolean, route = '#/settings'): TokenRecord {
  beginAuthorization(CLIENT_ID, { remember, returnRoute: route });
  browser.location.hash = responseFragment({ state: authorizationState(browser.assignedUrl) });
  const result = consumeCallback();
  if (result.kind !== 'accepted' || result.token === undefined) {
    throw new Error(`Expected an accepted callback, got ${result.kind}`);
  }
  return result.token;
}

function tokenWith(accessToken: string, expiresInMs: number, accountKey: string | null = 'perm-1'): TokenRecord {
  return {
    accessToken,
    expiresAtUtc: new Date(Date.now() + expiresInMs).toISOString(),
    grantedScope: DRIVE_SCOPE,
    accountKey
  };
}

describe('redirect request', () => {
  test('the redirect is a full-page implicit request for one scope', () => {
    const browser = installFakeBrowser();
    beginAuthorization(CLIENT_ID, { remember: false, returnRoute: '#/settings' });

    const url = new URL(browser.assignedUrl);
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('response_type')).toBe('token');
    expect(url.searchParams.get('scope')).toBe(DRIVE_SCOPE);
    expect(url.searchParams.get('client_id')).toBe(CLIENT_ID);
    expect(url.searchParams.get('prompt')).toBeNull();
  });

  test('the account switch asks Google for its account selector', () => {
    const browser = installFakeBrowser();
    beginAuthorization(CLIENT_ID, { remember: false, selectAccount: true });

    expect(new URL(browser.assignedUrl).searchParams.get('prompt')).toBe('select_account');
  });

  test('the request state is random, short lived, and stored in both stores', () => {
    const browser = installFakeBrowser();
    const startedAt = Date.now();
    beginAuthorization(CLIENT_ID, { remember: false });

    const sessionState = JSON.parse(browser.sessionStorage.getItem(OAUTH_STATE_KEY) ?? '{}') as {
      state?: string;
      expiresAtUtc?: string;
    };
    const localState = JSON.parse(browser.localStorage.getItem(OAUTH_STATE_KEY) ?? '{}') as {
      state?: string;
      expiresAtUtc?: string;
    };

    expect(sessionState.state).toMatch(/^[0-9a-f]{48}$/);
    expect(localState.state).toBe(sessionState.state);
    expect(Date.parse(sessionState.expiresAtUtc ?? '') - startedAt).toBeCloseTo(STATE_TTL_MS, -4);
    expect(JSON.stringify(sessionState)).not.toContain('access_token');
  });

  test('a host with no secure random source raises the typed insecure-environment error', () => {
    const browser = installFakeBrowser();
    const crypto = window.crypto;
    Object.defineProperty(window, 'crypto', { configurable: true, value: undefined });

    let thrown: unknown = null;
    try {
      beginAuthorization(CLIENT_ID, { remember: false });
    } catch (error: unknown) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AppError);
    expect((thrown as AppError).kind).toBe('insecure_environment');
    expect(browser.sessionStorage.getItem(OAUTH_STATE_KEY)).toBeNull();
    expect(browser.localStorage.getItem(OAUTH_STATE_KEY)).toBeNull();

    Object.defineProperty(window, 'crypto', { configurable: true, value: crypto });
  });
});

describe('callback validation', () => {
  test('an unknown state is rejected and stores no token', () => {
    const browser = installFakeBrowser();
    beginAuthorization(CLIENT_ID, { remember: false });
    browser.location.hash = responseFragment({ state: '0'.repeat(48) });

    const result = consumeCallback();
    expect(result.kind).toBe('invalid_state');
    expect(browser.sessionStorage.getItem(SESSION_TOKEN_KEY)).toBeNull();
    expect(browser.localStorage.getItem(LOCAL_TOKEN_KEY)).toBeNull();
  });

  test('an expired state is rejected and stores no token', () => {
    const browser = installFakeBrowser();
    beginAuthorization(CLIENT_ID, { remember: false });
    browser.location.hash = responseFragment({ state: authorizationState(browser.assignedUrl) });

    const result = consumeCallback(Date.now() + STATE_TTL_MS + 1);
    expect(result.kind).toBe('invalid_state');
    expect(browser.sessionStorage.getItem(SESSION_TOKEN_KEY)).toBeNull();
    expect(browser.localStorage.getItem(LOCAL_TOKEN_KEY)).toBeNull();
  });

  test('a valid callback is accepted with an expiry computed from expires_in', () => {
    const browser = installFakeBrowser();
    const now = Date.now();
    beginAuthorization(CLIENT_ID, { remember: false });
    browser.location.hash = responseFragment({ state: authorizationState(browser.assignedUrl) });

    const result = consumeCallback(now);
    expect(result.kind).toBe('accepted');
    expect(result.token?.accessToken).toBe('test-token');
    expect(Date.parse(result.token?.expiresAtUtc ?? '')).toBe(now + HOUR_MS);
    expect(result.token?.grantedScope).toBe(DRIVE_SCOPE);
    expect(result.token?.accountKey).toBeNull();
  });

  test('the fragment is removed before the caller sees the result', () => {
    const browser = installFakeBrowser();
    beginAuthorization(CLIENT_ID, { remember: true, returnRoute: '#/settings' });
    browser.location.hash = responseFragment({ state: authorizationState(browser.assignedUrl) });

    consumeCallback();
    expect(browser.replacedUrl).toBe('/#/settings');
    expect(browser.location.hash).toBe('#/settings');
  });

  test('a callback without the app-data scope is rejected', () => {
    const browser = installFakeBrowser();
    beginAuthorization(CLIENT_ID, { remember: false });
    browser.location.hash = responseFragment({
      state: authorizationState(browser.assignedUrl),
      scope: 'profile'
    });

    const result = consumeCallback();
    expect(result.kind).toBe('error');
    expect(result.error).toBe('missing_scope');
    expect(browser.sessionStorage.getItem(SESSION_TOKEN_KEY)).toBeNull();
  });

  test('a non-bearer token type is rejected', () => {
    const browser = installFakeBrowser();
    beginAuthorization(CLIENT_ID, { remember: false });
    browser.location.hash = responseFragment({
      state: authorizationState(browser.assignedUrl),
      tokenType: 'mac'
    });

    expect(consumeCallback().error).toBe('unsupported_token_type');
  });

  test('a bad expiry value is rejected', () => {
    const browser = installFakeBrowser();
    beginAuthorization(CLIENT_ID, { remember: false });
    browser.location.hash = responseFragment({
      state: authorizationState(browser.assignedUrl),
      expiresIn: 'soon'
    });

    const result = consumeCallback();
    expect(result.kind).toBe('error');
    expect(result.error).toBe('invalid_expiry');
  });

  test('a denial clears the fragment and stores no token', () => {
    const browser = installFakeBrowser();
    beginAuthorization(CLIENT_ID, { remember: true, returnRoute: '#/settings' });
    browser.location.hash = '#error=access_denied';

    const result = consumeCallback();
    expect(result.kind).toBe('error');
    expect(result.error).toBe('access_denied');
    expect(browser.replacedUrl).toBe('/#/settings');
    expect(browser.localStorage.getItem(LOCAL_TOKEN_KEY)).toBeNull();
    expect(browser.localStorage.getItem(OAUTH_STATE_KEY)).toBeNull();
  });

  test('a fragment with neither token nor error is a malformed callback', () => {
    const browser = installFakeBrowser();
    browser.location.hash = '#nothing=here';

    const result = consumeCallback();
    expect(result.kind).toBe('error');
    expect(result.error).toBe('malformed_callback');
    expect(hasCallbackFragment()).toBe(false);
  });

  test('a plain route hash is not a callback', () => {
    const browser = installFakeBrowser();
    browser.location.hash = '#/settings';

    expect(hasCallbackFragment()).toBe(false);
  });

  test('no fragment means there is no callback to consume', () => {
    const browser = installFakeBrowser();
    browser.location.hash = '';

    expect(hasCallbackFragment()).toBe(false);
  });
});

describe('duplicate callback', () => {
  test('a repeated callback with the same token is a duplicate and reuses the stored token', () => {
    const browser = installFakeBrowser();
    const first = completeSignIn(browser, false);
    const repeated = responseFragment({ state: '0'.repeat(48), accessToken: first.accessToken });

    browser.location.hash = repeated;
    const result = consumeCallback();

    expect(result.kind).toBe('duplicate');
    expect(result.token?.accessToken).toBe(first.accessToken);
    expect(result.token?.expiresAtUtc).toBe(first.expiresAtUtc);
  });

  test('a repeated callback with a different token is not a duplicate', () => {
    const browser = installFakeBrowser();
    completeSignIn(browser, false);

    browser.location.hash = responseFragment({ state: '0'.repeat(48), accessToken: 'other-token' });
    const result = consumeCallback();

    expect(result.kind).toBe('invalid_state');
    expect(result.token).toBeUndefined();
  });

  test('a repeat outside the receipt window is not a duplicate', () => {
    const browser = installFakeBrowser();
    const first = completeSignIn(browser, false);

    browser.location.hash = responseFragment({ state: '0'.repeat(48), accessToken: first.accessToken });
    const result = consumeCallback(Date.now() + RECEIPT_TTL_MS + 1);

    expect(result.kind).toBe('invalid_state');
  });

  test('the receipt holds a fingerprint and never the token', () => {
    const browser = installFakeBrowser();
    completeSignIn(browser, true);

    const raw = browser.localStorage.getItem(OAUTH_RECEIPT_KEY) ?? '';
    expect(raw).not.toContain('test-token');
    const receipt = JSON.parse(raw) as { tokenFingerprint?: string };
    expect(receipt.tokenFingerprint).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('token persistence', () => {
  test('an unchecked remember choice writes sessionStorage only', () => {
    const browser = installFakeBrowser('#/history');
    completeSignIn(browser, false, '#/history');

    expect(browser.sessionStorage.getItem(SESSION_TOKEN_KEY)).not.toBeNull();
    expect(browser.localStorage.getItem(LOCAL_TOKEN_KEY)).toBeNull();
    expect(isTokenRemembered()).toBe(false);
  });

  test('a checked remember choice writes localStorage', () => {
    const browser = installFakeBrowser('#/history');
    completeSignIn(browser, true, '#/history');

    expect(browser.localStorage.getItem(LOCAL_TOKEN_KEY)).not.toBeNull();
    expect(browser.sessionStorage.getItem(SESSION_TOKEN_KEY)).toBeNull();
    expect(isTokenRemembered()).toBe(true);
  });

  test('saveToken moves the record when the remember choice changes', () => {
    const browser = installFakeBrowser();
    const token: TokenRecord = {
      accessToken: 'a-token',
      expiresAtUtc: new Date(Date.now() + HOUR_MS).toISOString(),
      grantedScope: DRIVE_SCOPE,
      accountKey: null
    };

    saveToken(token, false);
    expect(browser.sessionStorage.getItem(SESSION_TOKEN_KEY)).not.toBeNull();

    saveToken(token, true);
    expect(browser.sessionStorage.getItem(SESSION_TOKEN_KEY)).toBeNull();
    expect(browser.localStorage.getItem(LOCAL_TOKEN_KEY)).not.toBeNull();
  });

  test('a bound account key is stored beside the token', () => {
    const browser = installFakeBrowser();
    const token: TokenRecord = {
      accessToken: 'a-token',
      expiresAtUtc: new Date(Date.now() + HOUR_MS).toISOString(),
      grantedScope: DRIVE_SCOPE,
      accountKey: 'permission-42'
    };

    saveToken(token, false);
    expect(browser.sessionStorage.getItem(SELECTED_ACCOUNT_KEY)).toBe('permission-42');
  });

  test('restoreToken returns the record while it is valid', () => {
    const browser = installFakeBrowser();
    const first = completeSignIn(browser, true);

    const restored = restoreToken();
    expect(restored?.accessToken).toBe(first.accessToken);
    expect(restored?.expiresAtUtc).toBe(first.expiresAtUtc);
  });

  test('peekStoredToken reads a live record and writes nothing', () => {
    const browser = installFakeBrowser();
    const first = completeSignIn(browser, true);
    const localLength = browser.localStorage.length;
    const sessionLength = browser.sessionStorage.length;

    const peeked = peekStoredToken();

    expect(peeked?.accessToken).toBe(first.accessToken);
    expect(browser.localStorage.length).toBe(localLength);
    expect(browser.sessionStorage.length).toBe(sessionLength);
  });

  test('peekStoredToken prefers the sessionStorage record', () => {
    const browser = installFakeBrowser();
    saveToken(tokenWith('session-token', HOUR_MS), false);
    browser.localStorage.setItem(LOCAL_TOKEN_KEY, JSON.stringify(tokenWith('local-token', HOUR_MS)));

    expect(peekStoredToken()?.accessToken).toBe('session-token');
    // The other record stays where it is. Two tabs can hold one record each.
    expect(browser.localStorage.getItem(LOCAL_TOKEN_KEY)).not.toBeNull();
  });

  test('peekStoredToken returns null for an expired record and leaves it in place', () => {
    const browser = installFakeBrowser();
    browser.localStorage.setItem(LOCAL_TOKEN_KEY, JSON.stringify(tokenWith('dead-token', -HOUR_MS)));
    const localLength = browser.localStorage.length;

    expect(peekStoredToken()).toBeNull();
    expect(browser.localStorage.length).toBe(localLength);
  });

  test('peekStoredToken skips a malformed record', () => {
    const browser = installFakeBrowser();
    browser.localStorage.setItem(LOCAL_TOKEN_KEY, 'not-json');

    expect(peekStoredToken()).toBeNull();
  });

  test('restoreToken returns null past the exact expiry and erases the record', () => {
    const browser = installFakeBrowser();
    const first = completeSignIn(browser, true);
    const expiresAtMs = Date.parse(first.expiresAtUtc);

    expect(restoreToken(expiresAtMs)).toBeNull();
    expect(browser.localStorage.getItem(LOCAL_TOKEN_KEY)).toBeNull();
    expect(browser.sessionStorage.getItem(SESSION_TOKEN_KEY)).toBeNull();
    expect(browser.localStorage.getItem(SELECTED_ACCOUNT_KEY)).toBeNull();
  });

  test('an expired sessionStorage record cannot erase a valid localStorage record', () => {
    const browser = installFakeBrowser();

    // Tab A signs in with Remember me checked. The record lands in localStorage.
    saveToken(tokenWith('tabA', 29 * 60_000), true);

    // Tab B signs in unchecked, then its record passes its exact expiry.
    browser.sessionStorage.setItem(
      SESSION_TOKEN_KEY,
      JSON.stringify(tokenWith('tabB', -60_000))
    );

    const restored = restoreToken();

    expect(restored?.accessToken).toBe('tabA');
    expect(browser.localStorage.getItem(LOCAL_TOKEN_KEY)).not.toBeNull();
    expect(browser.sessionStorage.getItem(SESSION_TOKEN_KEY)).toBeNull();
    expect(hasStoredToken()).toBe(true);
  });

  test('an expired localStorage record cannot erase a valid sessionStorage record', () => {
    const browser = installFakeBrowser();

    saveToken(tokenWith('tabA', 29 * 60_000), false);
    browser.localStorage.setItem(
      LOCAL_TOKEN_KEY,
      JSON.stringify(tokenWith('tabB', -60_000))
    );

    const restored = restoreToken();

    expect(restored?.accessToken).toBe('tabA');
    expect(browser.sessionStorage.getItem(SESSION_TOKEN_KEY)).not.toBeNull();
    expect(browser.localStorage.getItem(LOCAL_TOKEN_KEY)).toBeNull();
  });

  test('restoreToken drops the expired record and keeps the account key of the live one', () => {
    const browser = installFakeBrowser();

    saveToken(tokenWith('tabA', 29 * 60_000, 'perm-A'), true);
    browser.sessionStorage.setItem(
      SESSION_TOKEN_KEY,
      JSON.stringify(tokenWith('tabB', -60_000, 'perm-B'))
    );
    browser.sessionStorage.setItem(SELECTED_ACCOUNT_KEY, 'perm-B');

    const restored = restoreToken();

    expect(restored?.accountKey).toBe('perm-A');
    expect(browser.localStorage.getItem(SELECTED_ACCOUNT_KEY)).toBe('perm-A');
  });

  test('hasStoredToken is false when every record is expired', () => {
    const browser = installFakeBrowser();
    browser.sessionStorage.setItem(SESSION_TOKEN_KEY, JSON.stringify(tokenWith('s', -1_000)));
    browser.localStorage.setItem(LOCAL_TOKEN_KEY, JSON.stringify(tokenWith('l', -1_000)));

    expect(hasStoredToken()).toBe(false);
    expect(restoreToken()).toBeNull();
  });

  test('hasStoredToken reads without writing, so a render cannot erase state', () => {
    const browser = installFakeBrowser();
    saveToken(tokenWith('tabA', 29 * 60_000), true);
    browser.sessionStorage.setItem(SESSION_TOKEN_KEY, JSON.stringify(tokenWith('tabB', -60_000)));

    expect(hasStoredToken()).toBe(true);
    expect(browser.sessionStorage.getItem(SESSION_TOKEN_KEY)).not.toBeNull();
  });

  test('restoreToken drops a malformed record', () => {
    const browser = installFakeBrowser();
    browser.localStorage.setItem(LOCAL_TOKEN_KEY, '{"accessToken":"x"}');

    expect(restoreToken()).toBeNull();
    expect(browser.localStorage.getItem(LOCAL_TOKEN_KEY)).toBeNull();
  });

  test('clearAllAuthState leaves no auth key in either store', () => {
    const browser = installFakeBrowser();
    completeSignIn(browser, true);
    beginAuthorization(CLIENT_ID, { remember: true, selectAccount: true });
    saveToken(
      {
        accessToken: 'a-token',
        expiresAtUtc: new Date(Date.now() + HOUR_MS).toISOString(),
        grantedScope: DRIVE_SCOPE,
        accountKey: 'permission-42'
      },
      true
    );

    clearAllAuthState();

    AUTH_STORAGE_KEYS.forEach((key: string) => {
      expect(browser.sessionStorage.getItem(key)).toBeNull();
      expect(browser.localStorage.getItem(key)).toBeNull();
    });
  });

  test('an abandoned request state is removed on the next restore', () => {
    const browser = installFakeBrowser();
    beginAuthorization(CLIENT_ID, { remember: false });
    const state = JSON.parse(browser.localStorage.getItem(OAUTH_STATE_KEY) ?? '{}') as {
      expiresAtUtc?: string;
    };

    restoreToken(Date.parse(state.expiresAtUtc ?? ''));
    expect(browser.sessionStorage.getItem(OAUTH_STATE_KEY)).toBeNull();
    expect(browser.localStorage.getItem(OAUTH_STATE_KEY)).toBeNull();
  });

  test('the request state survives a lost sessionStorage entry', () => {
    const browser = installFakeBrowser();
    beginAuthorization(CLIENT_ID, { remember: false, returnRoute: '#/settings', selectAccount: true });
    browser.sessionStorage.removeItem(OAUTH_STATE_KEY);
    browser.location.hash = responseFragment({ state: authorizationState(browser.assignedUrl) });

    expect(consumeCallback().kind).toBe('accepted');
    expect(browser.replacedUrl).toBe('/#/settings');
  });
});
