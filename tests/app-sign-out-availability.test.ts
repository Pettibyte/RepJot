import { afterEach, describe, expect, test } from 'bun:test';
import { DRIVE_SCOPE, saveToken, type TokenRecord } from '../src/auth/oauth-redirect-adapter';
import App from '../src/App.svelte';
import { installFakeBrowser, uninstallFakeBrowser } from './support/fake-browser';
import { html } from './support/render';

const HOUR_MS = 3_600_000;

function liveToken(accessToken: string): TokenRecord {
  return {
    accessToken,
    expiresAtUtc: new Date(Date.now() + HOUR_MS).toISOString(),
    grantedScope: DRIVE_SCOPE,
    accountKey: null
  };
}

afterEach(() => {
  uninstallFakeBrowser();
});

describe('sign-out reachability', () => {
  test('a stored token with no bound session still renders the sign-out control', () => {
    installFakeBrowser();
    saveToken(liveToken('a-token'), false);

    const out = html(App, { initialCallback: null });

    expect(out).toContain('Sign out from REP JOT');
    expect(out).toContain('Retry account binding');
  });

  test('no stored token means no sign-out control', () => {
    installFakeBrowser();

    const out = html(App, { initialCallback: null });

    expect(out).not.toContain('Sign out from REP JOT');
  });
});
