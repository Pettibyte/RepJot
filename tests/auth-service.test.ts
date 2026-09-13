import { beforeEach, describe, expect, test } from 'bun:test';
import { get } from 'svelte/store';
import {
  disconnect,
  expireSession,
  getSession,
  isSignedIn,
  millisecondsUntilExpiry,
  restoreAndBind,
  signOut
} from '../src/auth/auth-service';
import {
  DRIVE_SCOPE,
  restoreToken,
  saveToken,
  type TokenRecord
} from '../src/auth/oauth-redirect-adapter';
import {
  AUTH_STORAGE_KEYS,
  LOCAL_TOKEN_KEY,
  SELECTED_ACCOUNT_KEY,
  SESSION_TOKEN_KEY
} from '../src/auth/storage-keys';
import { activeError, clearError } from '../src/state/app-state';
import { AppError } from '../src/domain/errors';
import { createDriveRestAdapter } from '../src/drive/drive-rest-adapter';
import { installFakeBrowser, uninstallFakeBrowser, type FakeBrowser } from './support/fake-browser';

const HOUR_MS = 3_600_000;
const MAX_TIMER_DELAY_MS = 2_147_483_647;

/** Fetch stub that answers every call with one fixed response. */
function fixedFetch(status: number): typeof fetch {
  return (async (): Promise<Response> =>
    new Response('{}', { status })) as unknown as typeof fetch;
}

function unboundToken(hours = 1): TokenRecord {
  return {
    accessToken: 'a-token',
    expiresAtUtc: new Date(Date.now() + hours * HOUR_MS).toISOString(),
    grantedScope: DRIVE_SCOPE,
    accountKey: null
  };
}

function authKeysEmpty(browser: FakeBrowser): boolean {
  return AUTH_STORAGE_KEYS.every(
    (key: string) => browser.sessionStorage.getItem(key) === null && browser.localStorage.getItem(key) === null
  );
}

beforeEach(() => {
  installFakeBrowser();
  signOut();
  clearError();
});

describe('session restore and binding', () => {
  test('restoreAndBind binds the token and stores the account key before reporting a session', async () => {
    const browser = installFakeBrowser();
    saveToken(unboundToken(), false);
    const calls: string[] = [];

    const session = await restoreAndBind({
      bind: async (token: string): Promise<string> => {
        calls.push(token);
        // The session must not exist before the bind resolves.
        expect(getSession()).toBeNull();
        expect(isSignedIn()).toBe(false);
        return 'permission-1';
      }
    });

    expect(calls).toEqual(['a-token']);
    expect(session).not.toBeNull();
    expect(session?.accountKey).toBe('permission-1');
    expect(session?.accessToken).toBe('a-token');
    expect(getSession()?.accountKey).toBe('permission-1');
    expect(isSignedIn()).toBe(true);

    const stored = JSON.parse(browser.sessionStorage.getItem(SESSION_TOKEN_KEY) ?? '{}') as TokenRecord;
    expect(stored.accountKey).toBe('permission-1');
    expect(browser.sessionStorage.getItem(SELECTED_ACCOUNT_KEY)).toBe('permission-1');
  });

  test('restoreAndBind returns null with no stored token and never calls bind', async () => {
    let bindCalls = 0;

    const session = await restoreAndBind({
      bind: async (): Promise<string> => {
        bindCalls += 1;
        return 'permission-1';
      }
    });

    expect(session).toBeNull();
    expect(bindCalls).toBe(0);
  });

  test('a bind failure keeps the token for a retry and reports an authentication error', async () => {
    const browser = installFakeBrowser();
    saveToken(unboundToken(), false);

    const session = await restoreAndBind({
      bind: async (): Promise<string> => {
        throw new Error('network down');
      }
    });

    expect(session).toBeNull();
    expect(restoreToken()?.accessToken).toBe('a-token');
    expect(browser.sessionStorage.getItem(SESSION_TOKEN_KEY)).not.toBeNull();
    expect(get(activeError)?.kind).toBe('authentication');
    expect(get(activeError)?.detail.stage).toBe('bind');
  });

  test('a bind 401 erases the token and reports the unauthorized reason', async () => {
    const browser = installFakeBrowser();
    saveToken(unboundToken(), true);

    const session = await restoreAndBind({
      bind: async (): Promise<string> => {
        throw Object.assign(new Error('expired'), { status: 401 });
      }
    });

    expect(session).toBeNull();
    expect(browser.localStorage.getItem(LOCAL_TOKEN_KEY)).toBeNull();
    expect(browser.sessionStorage.getItem(SESSION_TOKEN_KEY)).toBeNull();
    expect(get(activeError)?.kind).toBe('authentication');
    expect(get(activeError)?.detail.reason).toBe('unauthorized');
  });

  test('an empty account key is rejected', async () => {
    saveToken(unboundToken(), false);

    const session = await restoreAndBind({ bind: async (): Promise<string> => '' });

    expect(session).toBeNull();
    expect(get(activeError)?.kind).toBe('authentication');
  });

  test('a bind that returns a display name carries it into the session', async () => {
    saveToken(unboundToken(), false);

    const session = await restoreAndBind({
      bind: async (): Promise<{ accountKey: string; displayName: string }> => ({
        accountKey: 'permission-1',
        displayName: 'Ada'
      })
    });

    expect(session?.accountKey).toBe('permission-1');
    expect(session?.displayName).toBe('Ada');
  });

  test('a bound account with an empty display name leaves the field absent', async () => {
    saveToken(unboundToken(), false);

    const session = await restoreAndBind({
      bind: async (): Promise<{ accountKey: string; displayName: string }> => ({
        accountKey: 'permission-1',
        displayName: ''
      })
    });

    expect(session?.displayName).toBeUndefined();
  });
});

describe('sign out', () => {
  test('signOut clears every auth key and the in-memory session', async () => {
    const browser = installFakeBrowser();
    saveToken(unboundToken(), true);
    await restoreAndBind({ bind: async (): Promise<string> => 'permission-1' });

    signOut();

    expect(authKeysEmpty(browser)).toBe(true);
    expect(getSession()).toBeNull();
    expect(isSignedIn()).toBe(false);
  });

  test('a signOut that lands while the bind await runs is not undone', async () => {
    const browser = installFakeBrowser();
    saveToken(unboundToken(), true);

    let releaseBind: (value: string) => void = () => undefined;
    const bindGate = new Promise<string>((resolve: (value: string) => void) => {
      releaseBind = resolve;
    });

    const restoring = restoreAndBind({ bind: async (): Promise<string> => bindGate });
    await Promise.resolve();
    await Promise.resolve();

    // The user signs out while the bind call is still in flight.
    signOut();
    expect(authKeysEmpty(browser)).toBe(true);

    releaseBind('permission-1');
    const session = await restoring;

    expect(session).toBeNull();
    expect(getSession()).toBeNull();
    expect(isSignedIn()).toBe(false);
    expect(authKeysEmpty(browser)).toBe(true);
  });

  test('a signOut during a failed bind leaves the state cleared', async () => {
    const browser = installFakeBrowser();
    saveToken(unboundToken(), false);

    let releaseBind: (error: Error) => void = () => undefined;
    const bindGate = new Promise<string>((_resolve, reject: (error: Error) => void) => {
      releaseBind = reject;
    });

    const restoring = restoreAndBind({ bind: async (): Promise<string> => bindGate });
    await Promise.resolve();
    await Promise.resolve();

    signOut();
    releaseBind(new Error('network down'));

    await expect(restoring).resolves.toBeNull();
    expect(authKeysEmpty(browser)).toBe(true);
    expect(get(activeError)).toBeNull();
  });
});

describe('disconnect', () => {
  test('disconnect clears state when the revoke confirms', async () => {
    const browser = installFakeBrowser();
    saveToken(unboundToken(), true);
    await restoreAndBind({ bind: async (): Promise<string> => 'permission-1' });
    const order: string[] = [];

    const result = await disconnect({
      revoke: async (token: string): Promise<void> => {
        order.push(`revoke:${token}`);
      }
    });

    expect(result.kind).toBe('revoked');
    expect(order).toEqual(['revoke:a-token']);
    expect(authKeysEmpty(browser)).toBe(true);
    expect(getSession()).toBeNull();
  });

  test('an unconfirmed revoke returns revoke_failed and keeps the session', async () => {
    const browser = installFakeBrowser();
    saveToken(unboundToken(), true);
    await restoreAndBind({ bind: async (): Promise<string> => 'permission-1' });

    const result = await disconnect({
      revoke: async (): Promise<void> => {
        throw new Error('Google did not confirm that it revoked access.');
      }
    });

    expect(result.kind).toBe('revoke_failed');
    expect(browser.localStorage.getItem(LOCAL_TOKEN_KEY)).not.toBeNull();
    expect(getSession()).not.toBeNull();
    expect(get(activeError)?.detail.stage).toBe('disconnect');
  });

  test('a failed revoke returns revoke_failed and keeps the session', async () => {
    const browser = installFakeBrowser();
    saveToken(unboundToken(), false);
    await restoreAndBind({ bind: async (): Promise<string> => 'permission-1' });

    const result = await disconnect({
      revoke: async (): Promise<void> => {
        throw new Error('Google did not confirm that it revoked access.');
      }
    });

    expect(result.kind).toBe('revoke_failed');
    expect(browser.sessionStorage.getItem(SESSION_TOKEN_KEY)).not.toBeNull();
  });

  test('a revoke that reports a 401 clears the state', async () => {
    const browser = installFakeBrowser();
    saveToken(unboundToken(), true);
    await restoreAndBind({ bind: async (): Promise<string> => 'permission-1' });

    const result = await disconnect({
      revoke: async (): Promise<void> => {
        throw new AppError('authentication', { status: 401 }, 'Google rejected the access token.');
      }
    });

    expect(result.kind).toBe('revoked');
    expect(authKeysEmpty(browser)).toBe(true);
    expect(getSession()).toBeNull();
  });

  test('disconnect works from a stored token with no bound session', async () => {
    const browser = installFakeBrowser();
    saveToken(unboundToken(), false);
    let revoked = '';

    const result = await disconnect({
      revoke: async (token: string): Promise<void> => {
        revoked = token;
      }
    });

    expect(result.kind).toBe('revoked');
    expect(revoked).toBe('a-token');
    expect(authKeysEmpty(browser)).toBe(true);
  });
});

// The stub-based tests above pin the flow with a hand-made error. These wire the
// real adapter behind a fetch stub, so the error shape the adapter actually
// throws is the one under test. ARCHITECTURE §10 step 14.
describe('real adapter integration', () => {
  test('a real adapter 401 during bind erases the stored token', async () => {
    const browser = installFakeBrowser();
    saveToken(unboundToken(), true);
    const adapter = createDriveRestAdapter(() => 'a-token', { fetchImpl: fixedFetch(401) });

    const session = await restoreAndBind({ bind: () => adapter.getAccountProfile() });

    expect(session).toBeNull();
    expect(browser.localStorage.getItem(LOCAL_TOKEN_KEY)).toBeNull();
    expect(browser.sessionStorage.getItem(SESSION_TOKEN_KEY)).toBeNull();
    expect(get(activeError)?.kind).toBe('authentication');
    expect(get(activeError)?.detail.reason).toBe('unauthorized');
  });

  test('a real adapter bind stores the account key and reports a session', async () => {
    saveToken(unboundToken(), false);
    const fetchImpl = (async (): Promise<Response> =>
      new Response(
        JSON.stringify({ user: { permissionId: 'permission-7', displayName: 'Ada' } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )) as unknown as typeof fetch;
    const adapter = createDriveRestAdapter(() => 'a-token', { fetchImpl });

    const session = await restoreAndBind({ bind: () => adapter.getAccountProfile() });

    expect(session?.accountKey).toBe('permission-7');
    expect(session?.displayName).toBe('Ada');
  });

  test('a real adapter network failure keeps the token for a retry', async () => {
    const browser = installFakeBrowser();
    saveToken(unboundToken(), false);
    const fetchImpl = (async (): Promise<Response> => {
      throw new TypeError('offline');
    }) as unknown as typeof fetch;
    const adapter = createDriveRestAdapter(() => 'a-token', { fetchImpl });

    const session = await restoreAndBind({ bind: () => adapter.getAccountProfile() });

    expect(session).toBeNull();
    expect(browser.sessionStorage.getItem(SESSION_TOKEN_KEY)).not.toBeNull();
    expect(get(activeError)?.detail.stage).toBe('bind');
  });

  test('disconnect through the real adapter clears state once Drive rejects', async () => {
    const browser = installFakeBrowser();
    saveToken(unboundToken(), true);
    await restoreAndBind({ bind: async (): Promise<string> => 'permission-1' });
    const adapter = createDriveRestAdapter(() => 'a-token', { fetchImpl: fixedFetch(401) });

    const result = await disconnect({ revoke: (token: string) => adapter.revokeToken(token) });

    expect(result.kind).toBe('revoked');
    expect(authKeysEmpty(browser)).toBe(true);
    expect(getSession()).toBeNull();
  });

  test('disconnect through the real adapter reports failure when the revoke is unconfirmed', async () => {
    const browser = installFakeBrowser();
    saveToken(unboundToken(), true);
    await restoreAndBind({ bind: async (): Promise<string> => 'permission-1' });
    const adapter = createDriveRestAdapter(() => 'a-token', {
      fetchImpl: fixedFetch(200),
      revokeTimeoutMs: 10
    });

    const result = await disconnect({ revoke: (token: string) => adapter.revokeToken(token) });

    expect(result.kind).toBe('revoke_failed');
    expect(browser.localStorage.getItem(LOCAL_TOKEN_KEY)).not.toBeNull();
    expect(getSession()).not.toBeNull();
  });
});

describe('expiry', () => {
  test('millisecondsUntilExpiry reports the remaining lifetime', async () => {
    saveToken(unboundToken(2), false);
    await restoreAndBind({ bind: async (): Promise<string> => 'permission-1' });

    const remaining = millisecondsUntilExpiry();
    expect(remaining).toBeGreaterThan(2 * HOUR_MS - 5_000);
    expect(remaining).toBeLessThanOrEqual(2 * HOUR_MS);
  });

  test('millisecondsUntilExpiry caps the delay for setTimeout', () => {
    saveToken(
      {
        accessToken: 'a-token',
        expiresAtUtc: new Date(Date.now() + MAX_TIMER_DELAY_MS * 4).toISOString(),
        grantedScope: DRIVE_SCOPE,
        accountKey: null
      },
      false
    );

    expect(millisecondsUntilExpiry()).toBe(MAX_TIMER_DELAY_MS);
  });

  test('millisecondsUntilExpiry is zero with no token or a past expiry', () => {
    expect(millisecondsUntilExpiry()).toBe(0);

    saveToken(
      {
        accessToken: 'a-token',
        expiresAtUtc: new Date(Date.now() - 1_000).toISOString(),
        grantedScope: DRIVE_SCOPE,
        accountKey: null
      },
      false
    );
    expect(millisecondsUntilExpiry()).toBe(0);
  });

  test('expireSession erases token state and reports an authentication error', () => {
    const browser = installFakeBrowser();
    saveToken(unboundToken(), true);

    expireSession('expired');

    expect(authKeysEmpty(browser)).toBe(true);
    expect(getSession()).toBeNull();
    expect(get(activeError)?.kind).toBe('authentication');
    expect(get(activeError)?.detail.reason).toBe('expired');
  });
});
