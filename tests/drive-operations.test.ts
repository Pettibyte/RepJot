import { afterEach, describe, expect, test } from 'bun:test';
import {
  GOOGLE_ACCOUNT_CONNECTIONS_URL,
  bindAccount,
  bindAccountWithProfile,
  probeRejected,
  revokeToken
} from '../src/auth/drive-operations';
import { installFakeBrowser, uninstallFakeBrowser } from './support/fake-browser';

const originalFetch = globalThis.fetch;

afterEach(() => {
  uninstallFakeBrowser();
  globalThis.fetch = originalFetch;
});

describe('account binding', () => {
  test('bindAccount returns the Drive permission ID', async () => {
    installFakeBrowser();
    globalThis.fetch = (async (): Promise<Response> =>
      new Response(JSON.stringify({ user: { permissionId: 'permission-9', displayName: 'Ada' } }), {
        status: 200
      })) as typeof fetch;

    expect(await bindAccount('a-token')).toBe('permission-9');
  });

  test('bindAccount rejects when Drive returns no permission ID', async () => {
    installFakeBrowser();
    globalThis.fetch = (async (): Promise<Response> =>
      new Response(JSON.stringify({ user: {} }), { status: 200 })) as typeof fetch;

    await expect(bindAccount('a-token')).rejects.toThrow('did not return an account key');
  });

  test('bindAccount rejects when Drive rejects the token', async () => {
    installFakeBrowser();
    globalThis.fetch = (async (): Promise<Response> =>
      new Response('Unauthorized', { status: 401 })) as typeof fetch;

    await expect(bindAccount('a-token')).rejects.toThrow('401');
  });

  test('bindAccountWithProfile returns the key and the display name from one request', async () => {
    installFakeBrowser();
    const requestedUrls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
      requestedUrls.push(String(input));
      return new Response(JSON.stringify({ user: { permissionId: 'permission-9', displayName: 'Ada' } }), {
        status: 200
      });
    }) as typeof fetch;

    const account = await bindAccountWithProfile('a-token');

    expect(account.accountKey).toBe('permission-9');
    expect(account.displayName).toBe('Ada');
    expect(requestedUrls).toHaveLength(1);
  });

  test('bindAccountWithProfile omits the display name when Drive returns none', async () => {
    installFakeBrowser();
    globalThis.fetch = (async (): Promise<Response> =>
      new Response(JSON.stringify({ user: { permissionId: 'permission-9' } }), {
        status: 200
      })) as typeof fetch;

    const account = await bindAccountWithProfile('a-token');

    expect(account).toEqual({ accountKey: 'permission-9' });
  });
});

describe('rejection probe', () => {
  test('a 401 answer means the token is rejected', async () => {
    installFakeBrowser();
    globalThis.fetch = (async (): Promise<Response> =>
      new Response(null, { status: 401 })) as typeof fetch;

    expect(await probeRejected('a-token')).toBe(true);
  });

  test('a 200 answer means the token still works', async () => {
    installFakeBrowser();
    globalThis.fetch = (async (): Promise<Response> =>
      new Response(JSON.stringify({ user: { permissionId: 'permission-9' } }), { status: 200 })) as
      typeof fetch;

    expect(await probeRejected('a-token')).toBe(false);
  });

  test('a network error proves nothing', async () => {
    installFakeBrowser();
    globalThis.fetch = (async (): Promise<Response> => {
      throw new TypeError('offline');
    }) as typeof fetch;

    expect(await probeRejected('a-token')).toBe(false);
  });
});

describe('revocation', () => {
  test('revocation posts a hidden form and resolves when Drive rejects the token', async () => {
    const browser = installFakeBrowser();
    globalThis.fetch = (async (): Promise<Response> => new Response(null, { status: 401 })) as typeof fetch;

    const revocation = revokeToken('a-token', 50);

    expect(browser.submittedForm?.method).toBe('post');
    expect(browser.submittedForm?.action).toBe('https://oauth2.googleapis.com/revoke');
    expect(browser.submittedForm?.target.startsWith('repjot_revoke_')).toBe(true);
    expect(browser.submittedForm?.children[0]?.name).toBe('token');
    expect(browser.submittedForm?.children[0]?.value).toBe('a-token');
    await expect(revocation).resolves.toBeUndefined();
    expect(browser.removedElementCount).toBeGreaterThanOrEqual(2);
  });

  test('an unconfirmed revocation rejects so the UI can show the fallback link', async () => {
    installFakeBrowser();
    globalThis.fetch = (async (): Promise<Response> => new Response('{}', { status: 200 })) as typeof fetch;

    await expect(revokeToken('a-token', 10)).rejects.toThrow(
      'Google did not confirm that it revoked access'
    );
  });

  test('the fallback link points at Google Account connections', () => {
    expect(GOOGLE_ACCOUNT_CONNECTIONS_URL).toBe('https://myaccount.google.com/connections');
  });
});
