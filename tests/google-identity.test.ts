import { afterEach, describe, expect, test } from 'bun:test';
import {
  DRIVE_SCOPE,
  beginDriveAuthorization,
  bindDriveAuthorization,
  clearDriveAuthorization,
  consumeDriveAuthorizationResponse,
  restoreDriveAuthorization,
  revokeDriveAuthorization
} from '../src/google-identity';

const TOKEN_KEY = 'repjot.oauth.token.v1';

class MemoryStorage implements Storage {
  private values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.values.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

interface FakeBrowser {
  assignedUrl: string;
  replacedUrl: string;
  location: {
    href: string;
    pathname: string;
    search: string;
    hash: string;
    replace: (url: string) => void;
  };
  sessionStorage: MemoryStorage;
  localStorage: MemoryStorage;
  scriptUrl: string;
  scriptRemoved: boolean;
  scriptOnError: (() => void) | null;
}

function installBrowser(route = '#/settings'): FakeBrowser {
  const sessionStorage = new MemoryStorage();
  const localStorage = new MemoryStorage();
  const browser: FakeBrowser = {
    assignedUrl: '',
    replacedUrl: '',
    location: {
      href: `https://repjot.com/${route}`,
      pathname: '/',
      search: '',
      hash: route,
      replace: (url: string): void => {
        browser.assignedUrl = url;
      }
    },
    sessionStorage,
    localStorage,
    scriptUrl: '',
    scriptRemoved: false,
    scriptOnError: null
  };

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      crypto: globalThis.crypto,
      location: browser.location,
      sessionStorage,
      localStorage,
      history: {
        replaceState: (_state: unknown, _title: string, url: string): void => {
          browser.replacedUrl = url;
          browser.location.hash = url.includes('#') ? url.slice(url.indexOf('#')) : '';
        }
      },
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout
    }
  });
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      title: 'REP JOT',
      createElement: (): Record<string, unknown> => {
        const script: Record<string, unknown> = {
          src: '',
          async: false,
          onerror: null,
          remove: (): void => {
            browser.scriptRemoved = true;
          }
        };
        return script;
      },
      head: {
        appendChild: (script: { src: string; onerror: (() => void) | null }): void => {
          browser.scriptUrl = script.src;
          browser.scriptOnError = script.onerror;
        }
      }
    }
  });
  return browser;
}

function authorizationState(url: string): string {
  return new URL(url).searchParams.get('state') ?? '';
}

function responseHash(state: string, additions = ''): string {
  return `#access_token=test-token&token_type=Bearer&expires_in=3600&scope=${encodeURIComponent(DRIVE_SCOPE)}&state=${state}${additions}`;
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  delete (globalThis as { document?: unknown }).document;
});

describe('Google authorization continuity', () => {
  test('a remembered response restores the route and uses local storage', () => {
    const browser = installBrowser();
    beginDriveAuthorization('client.apps.googleusercontent.com', {
      remember: true,
      returnRoute: '#/settings'
    });

    expect(browser.assignedUrl.startsWith('https://accounts.google.com/o/oauth2/v2/auth?')).toBe(true);
    expect(new URL(browser.assignedUrl).searchParams.get('scope')).toBe(DRIVE_SCOPE);
    browser.location.hash = responseHash(authorizationState(browser.assignedUrl));

    const authorization = consumeDriveAuthorizationResponse(Date.parse('2026-01-01T00:00:00Z'));
    expect(authorization?.expiresAtUtc).toBe('2026-01-01T01:00:00.000Z');
    expect(browser.replacedUrl).toBe('/#/settings');
    expect(browser.localStorage.getItem(TOKEN_KEY)).not.toBeNull();
    expect(browser.sessionStorage.getItem(TOKEN_KEY)).toBeNull();
  });

  test('an unremembered response uses session storage', () => {
    const browser = installBrowser('#/history');
    beginDriveAuthorization('client.apps.googleusercontent.com', {
      remember: false,
      returnRoute: '#/history'
    });
    browser.location.hash = responseHash(authorizationState(browser.assignedUrl));

    const authorization = consumeDriveAuthorizationResponse(1_000);
    expect(authorization?.remember).toBe(false);
    expect(browser.sessionStorage.getItem(TOKEN_KEY)).not.toBeNull();
    expect(browser.localStorage.getItem(TOKEN_KEY)).toBeNull();
  });

  test('expiry removes all token copies', () => {
    const browser = installBrowser();
    beginDriveAuthorization('client.apps.googleusercontent.com', { remember: true });
    browser.location.hash = responseHash(authorizationState(browser.assignedUrl));
    consumeDriveAuthorizationResponse(1_000);

    expect(restoreDriveAuthorization(3_601_000)).toBeNull();
    expect(browser.localStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(browser.sessionStorage.getItem(TOKEN_KEY)).toBeNull();
  });

  test('account binding persists and sign out clears both stores', () => {
    const browser = installBrowser();
    beginDriveAuthorization('client.apps.googleusercontent.com', { remember: false });
    browser.location.hash = responseHash(authorizationState(browser.assignedUrl));
    const authorization = consumeDriveAuthorizationResponse(1_000);
    if (authorization === null) throw new Error('Expected an authorization response.');

    bindDriveAuthorization(authorization, 'permission-id');
    expect(restoreDriveAuthorization(2_000)?.accountKey).toBe('permission-id');
    clearDriveAuthorization();
    expect(browser.sessionStorage.length).toBe(0);
    expect(browser.localStorage.length).toBe(0);
  });

  test('denial clears the fragment and saves no token', () => {
    const browser = installBrowser();
    beginDriveAuthorization('client.apps.googleusercontent.com', {
      remember: true,
      returnRoute: '#/settings'
    });
    const state = authorizationState(browser.assignedUrl);
    browser.location.hash = `#error=access_denied&state=${state}`;

    expect(() => consumeDriveAuthorizationResponse()).toThrow('Google authorization was denied');
    expect(browser.replacedUrl).toBe('/#/settings');
    expect(browser.localStorage.getItem(TOKEN_KEY)).toBeNull();
  });

  test('a response without the Drive app-data scope is rejected', () => {
    const browser = installBrowser();
    beginDriveAuthorization('client.apps.googleusercontent.com', { remember: false });
    const state = authorizationState(browser.assignedUrl);
    browser.location.hash = `#access_token=test&expires_in=3600&scope=profile&state=${state}`;

    expect(() => consumeDriveAuthorizationResponse()).toThrow('Google did not grant access');
    expect(browser.sessionStorage.getItem(TOKEN_KEY)).toBeNull();
  });

  test('revocation uses a transient same-page JSONP script', async () => {
    const browser = installBrowser();
    const revocation = revokeDriveAuthorization('test-token', 1_000);
    const revocationUrl = new URL(browser.scriptUrl);
    const callbackName = revocationUrl.searchParams.get('callback');

    expect(revocationUrl.origin + revocationUrl.pathname).toBe('https://oauth2.googleapis.com/revoke');
    expect(revocationUrl.searchParams.get('token')).toBe('test-token');
    expect(callbackName).not.toBeNull();
    if (callbackName === null) throw new Error('Expected a JSONP callback.');
    const callback = (window as unknown as Record<string, (response: unknown) => void>)[callbackName];
    callback({});

    await expect(revocation).resolves.toBeUndefined();
    expect(browser.scriptRemoved).toBe(true);
    expect((window as unknown as Record<string, unknown>)[callbackName]).toBeUndefined();
  });

  test('a revocation script error keeps the fallback path available', async () => {
    const browser = installBrowser();
    const revocation = revokeDriveAuthorization('test-token', 1_000);
    browser.scriptOnError?.();

    await expect(revocation).rejects.toThrow('could not contact the Google revocation service');
    expect(browser.scriptRemoved).toBe(true);
  });
});
