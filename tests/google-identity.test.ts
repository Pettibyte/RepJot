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

const PENDING_KEY = 'repjot.oauth.pending.v1';
const TOKEN_KEY = 'repjot.oauth.token.v1';
const originalFetch = globalThis.fetch;

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

interface FakeElement {
  action: string;
  method: string;
  name: string;
  target: string;
  title: string;
  type: string;
  value: string;
  style: { display: string };
  children: FakeElement[];
  appendChild: (child: FakeElement) => void;
  remove: () => void;
  submit: () => void;
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
  submittedForm: FakeElement | null;
  removedElementCount: number;
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
    submittedForm: null,
    removedElementCount: 0
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
      createElement: (): FakeElement => {
        const element: FakeElement = {
          action: '',
          method: '',
          name: '',
          target: '',
          title: '',
          type: '',
          value: '',
          style: { display: '' },
          children: [],
          appendChild: (child: FakeElement): void => {
            element.children.push(child);
          },
          remove: (): void => {
            browser.removedElementCount += 1;
          },
          submit: (): void => {
            browser.submittedForm = element;
          }
        };
        return element;
      },
      body: { appendChild: (): void => undefined }
    }
  });
  return browser;
}

function authorizationState(url: string): string {
  return new URL(url).searchParams.get('state') ?? '';
}

function responseHash(state: string): string {
  return `#access_token=test-token&token_type=Bearer&expires_in=3600&scope=${encodeURIComponent(DRIVE_SCOPE)}&state=${state}`;
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  delete (globalThis as { document?: unknown }).document;
  globalThis.fetch = originalFetch;
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

    const authorization = consumeDriveAuthorizationResponse(Date.now());
    expect(Date.parse(authorization?.expiresAtUtc ?? '') - Date.now()).toBeGreaterThan(3_599_000);
    expect(browser.replacedUrl).toBe('/#/settings');
    expect(browser.localStorage.getItem(TOKEN_KEY)).not.toBeNull();
    expect(browser.sessionStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(browser.localStorage.getItem(PENDING_KEY)).toBeNull();
  });

  test('an unremembered response uses session storage', () => {
    const browser = installBrowser('#/history');
    beginDriveAuthorization('client.apps.googleusercontent.com', {
      remember: false,
      returnRoute: '#/history'
    });
    browser.location.hash = responseHash(authorizationState(browser.assignedUrl));

    const authorization = consumeDriveAuthorizationResponse();
    expect(authorization?.remember).toBe(false);
    expect(browser.sessionStorage.getItem(TOKEN_KEY)).not.toBeNull();
    expect(browser.localStorage.getItem(TOKEN_KEY)).toBeNull();
  });

  test('local request state survives lost Kindle session storage', () => {
    const browser = installBrowser();
    beginDriveAuthorization('client.apps.googleusercontent.com', {
      remember: false,
      returnRoute: '#/settings',
      selectAccount: true
    });
    browser.sessionStorage.removeItem(PENDING_KEY);
    browser.location.hash = responseHash(authorizationState(browser.assignedUrl));

    expect(consumeDriveAuthorizationResponse()?.accessToken).toBe('test-token');
    expect(browser.replacedUrl).toBe('/#/settings');
  });

  test('an abandoned request state is removed after its short lifetime', () => {
    const browser = installBrowser();
    beginDriveAuthorization('client.apps.googleusercontent.com', { remember: false });
    const pending = JSON.parse(browser.localStorage.getItem(PENDING_KEY) ?? '{}') as {
      expiresAtUtc?: string;
    };

    restoreDriveAuthorization(Date.parse(pending.expiresAtUtc ?? ''));
    expect(browser.sessionStorage.getItem(PENDING_KEY)).toBeNull();
    expect(browser.localStorage.getItem(PENDING_KEY)).toBeNull();
  });

  test('expiry removes all token copies', () => {
    const browser = installBrowser();
    beginDriveAuthorization('client.apps.googleusercontent.com', { remember: true });
    browser.location.hash = responseHash(authorizationState(browser.assignedUrl));
    const authorization = consumeDriveAuthorizationResponse();
    const expiresAtMs = Date.parse(authorization?.expiresAtUtc ?? '');

    expect(restoreDriveAuthorization(expiresAtMs)).toBeNull();
    expect(browser.localStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(browser.sessionStorage.getItem(TOKEN_KEY)).toBeNull();
  });

  test('account binding persists and sign out clears both stores', () => {
    const browser = installBrowser();
    beginDriveAuthorization('client.apps.googleusercontent.com', { remember: false });
    browser.location.hash = responseHash(authorizationState(browser.assignedUrl));
    const authorization = consumeDriveAuthorizationResponse();
    if (authorization === null) throw new Error('Expected an authorization response.');

    bindDriveAuthorization(authorization, 'permission-id');
    expect(restoreDriveAuthorization()?.accountKey).toBe('permission-id');
    clearDriveAuthorization();
    expect(browser.sessionStorage.length).toBe(0);
    expect(browser.localStorage.length).toBe(0);
  });

  test('denial without returned state clears the fragment and saves no token', () => {
    const browser = installBrowser();
    beginDriveAuthorization('client.apps.googleusercontent.com', {
      remember: true,
      returnRoute: '#/settings'
    });
    browser.location.hash = '#error=access_denied';

    expect(() => consumeDriveAuthorizationResponse()).toThrow('Google authorization was denied');
    expect(browser.replacedUrl).toBe('/#/settings');
    expect(browser.localStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(browser.localStorage.getItem(PENDING_KEY)).toBeNull();
  });

  test('a successful response with invalid state is rejected', () => {
    const browser = installBrowser();
    beginDriveAuthorization('client.apps.googleusercontent.com', { remember: false });
    browser.location.hash = responseHash('wrong-state');

    expect(() => consumeDriveAuthorizationResponse()).toThrow('invalid state');
    expect(browser.sessionStorage.getItem(TOKEN_KEY)).toBeNull();
  });

  test('a response without the Drive app-data scope is rejected', () => {
    const browser = installBrowser();
    beginDriveAuthorization('client.apps.googleusercontent.com', { remember: false });
    const state = authorizationState(browser.assignedUrl);
    browser.location.hash = `#access_token=test&expires_in=3600&scope=profile&state=${state}`;

    expect(() => consumeDriveAuthorizationResponse()).toThrow('Google did not grant access');
    expect(browser.sessionStorage.getItem(TOKEN_KEY)).toBeNull();
  });

  test('revocation posts a hidden form and confirms token rejection', async () => {
    const browser = installBrowser();
    globalThis.fetch = (async (): Promise<Response> => new Response(null, { status: 401 })) as typeof fetch;

    const revocation = revokeDriveAuthorization('test-token', 10);
    expect(browser.submittedForm?.method).toBe('post');
    expect(browser.submittedForm?.action).toBe('https://oauth2.googleapis.com/revoke');
    expect(browser.submittedForm?.target.startsWith('repjot_revoke_')).toBe(true);
    expect(browser.submittedForm?.children[0]?.name).toBe('token');
    expect(browser.submittedForm?.children[0]?.value).toBe('test-token');
    await expect(revocation).resolves.toBeUndefined();
    expect(browser.removedElementCount).toBeGreaterThanOrEqual(2);
  });

  test('an unconfirmed revocation keeps the fallback path available', async () => {
    installBrowser();
    globalThis.fetch = (async (): Promise<Response> => new Response('{}', { status: 200 })) as typeof fetch;

    await expect(revokeDriveAuthorization('test-token', 5)).rejects.toThrow(
      'Google did not confirm that it revoked access'
    );
  });
});
