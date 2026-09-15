import { afterEach, describe, expect, test } from 'bun:test';
import { readable } from 'svelte/store';
import App from '../src/App.svelte';
import type { Route } from '../src/routing/routes';
import {
  clearError,
  setSaveStatus,
  setStartupStatus,
  reportError
} from '../src/state/app-state';
import { AppError } from '../src/domain/errors';
import { putRawPayload, clearRawPayloads } from '../src/state/raw-payload-store';
import { html } from './support/render';

/** A route store that holds one value. The shell only reads it. */
function routeStore(route: Route) {
  return readable(route);
}

const ACCOUNT = { accountKey: 'acct-1', displayName: 'Test User' };

afterEach(() => {
  setStartupStatus('loading_static');
  setSaveStatus('idle');
  clearError();
  clearRawPayloads();
});

describe('shell header variant', () => {
  test('a tab root renders the wordmark header and the three tabs', () => {
    setStartupStatus('ready');
    const out = html(App, { route: routeStore({ name: 'home' }), account: ACCOUNT, clientId: 'cid' });

    expect(out).toContain('app-header');
    expect(out).toContain('REP JOT');
    expect(out).toContain('tabs');
    expect(out).toContain('Workout');
    expect(out).toContain('History');
    expect(out).toContain('Settings');
    expect(out).not.toContain('back-header');
  });

  test('the current tab is marked', () => {
    setStartupStatus('ready');
    const out = html(App, { route: routeStore({ name: 'history' }), account: ACCOUNT, clientId: 'cid' });

    expect(out).toContain('tabs__item--current');
    expect(out).toContain('aria-current="page"');
  });

  test('a detail route renders the compact back header and no tab bar', () => {
    setStartupStatus('ready');
    const out = html(App, {
      route: routeStore({ name: 'session-active', sessionId: 'session-abc' }),
      account: ACCOUNT,
      clientId: 'cid'
    });

    expect(out).toContain('back-header');
    expect(out).toContain('Back');
    expect(out).toContain('Active Workout');
    expect(out).not.toContain('tabs__item');
    expect(out).not.toContain('app-header');
  });

  test('the back control points at the parent route', () => {
    setStartupStatus('ready');
    const out = html(App, {
      route: routeStore({ name: 'exercise-history', exerciseId: 'Barbell_Squat' }),
      account: ACCOUNT,
      clientId: 'cid'
    });
    expect(out).toContain('href="#/history"');
  });
});

describe('shell save status', () => {
  test('the header shows the save badge the store carries', () => {
    setStartupStatus('ready');
    setSaveStatus('saving');
    const out = html(App, { route: routeStore({ name: 'home' }), account: ACCOUNT, clientId: 'cid' });
    expect(out).toContain('Saving');
  });

  test('an idle store shows no badge text', () => {
    setStartupStatus('ready');
    setSaveStatus('idle');
    const out = html(App, { route: routeStore({ name: 'home' }), account: ACCOUNT, clientId: 'cid' });
    expect(out).toContain('save-status');
    expect(out).not.toContain('Saving');
    expect(out).not.toContain('Saved');
  });

  // REQUIREMENTS 4.3. `session-active` is a back-header route and is where the
  // user types measurements, so the back header carries the same indicator the
  // tab header does.
  test('a back-header route shows the saving badge', () => {
    setStartupStatus('ready');
    setSaveStatus('saving');
    const out = html(App, {
      route: routeStore({ name: 'session-active', sessionId: 'session-abc' }),
      account: ACCOUNT,
      clientId: 'cid'
    });
    expect(out).toContain('back-header');
    expect(out).toContain('save-status');
    expect(out).toContain('Saving');
  });

  test('a back-header route shows the saved badge', () => {
    setStartupStatus('ready');
    setSaveStatus('saved');
    const out = html(App, {
      route: routeStore({ name: 'session-active', sessionId: 'session-abc' }),
      account: ACCOUNT,
      clientId: 'cid'
    });
    expect(out).toContain('save-status');
    expect(out).toContain('Saved');
  });

  test('a back-header route shows the spec label for a failed sync', () => {
    setStartupStatus('ready');
    setSaveStatus('sync_failed');
    const out = html(App, {
      route: routeStore({ name: 'session-active', sessionId: 'session-abc' }),
      account: ACCOUNT,
      clientId: 'cid'
    });
    expect(out).toContain('save-status');
    expect(out).toContain('Sync failed');
    expect(out).not.toContain('Not synced');
  });

  test('the tab root shows the spec label for a failed sync', () => {
    setStartupStatus('ready');
    setSaveStatus('sync_failed');
    const out = html(App, { route: routeStore({ name: 'home' }), account: ACCOUNT, clientId: 'cid' });
    expect(out).toContain('save-status');
    expect(out).toContain('Sync failed');
    expect(out).not.toContain('Not synced');
  });

  test('the save badge markup appears once per render', () => {
    setStartupStatus('ready');
    setSaveStatus('saved');
    const back = html(App, {
      route: routeStore({ name: 'session-active', sessionId: 'session-abc' }),
      account: ACCOUNT,
      clientId: 'cid'
    });
    const tab = html(App, { route: routeStore({ name: 'home' }), account: ACCOUNT, clientId: 'cid' });
    expect(countOf(back, 'class="save-status"')).toBe(1);
    expect(countOf(tab, 'class="save-status"')).toBe(1);
  });
});

/** Count non-overlapping occurrences of `needle` in `haystack`. */
function countOf(haystack: string, needle: string): number {
  let count = 0;
  let at = haystack.indexOf(needle);
  while (at !== -1) {
    count += 1;
    at = haystack.indexOf(needle, at + needle.length);
  }
  return count;
}

describe('shell startup gate', () => {
  test('a loading status renders no screen', () => {
    setStartupStatus('loading_static');
    const out = html(App, { route: routeStore({ name: 'home' }), account: null, clientId: 'cid' });
    expect(out).toContain('Loading REP JOT');
    expect(out).not.toContain('tabs');
  });

  test('a static failure renders the blocker with the error family', () => {
    setStartupStatus('static_failed');
    reportError(new AppError('network', { reason: 'fetch_failed' }, 'The request failed.'));

    const out = html(App, { route: routeStore({ name: 'home' }), account: null, clientId: 'cid' });

    expect(out).toContain('REP JOT cannot start');
    expect(out).toContain('network');
    expect(out).toContain('View Raw JSON');
    expect(out).not.toContain('tabs');
  });

  // REQUIREMENTS 6.9. **View Raw JSON** must work from the blocker, so the raw
  // route renders the viewer instead of the blocker even while startup is failed.
  test('the raw route renders the viewer even while startup is failed', () => {
    setStartupStatus('static_failed');
    reportError(new AppError('network', { reason: 'fetch_failed' }, 'The request failed.'));
    const key = putRawPayload('{"kind":"network"}');

    const out = html(App, {
      route: routeStore({ name: 'raw-json', source: key }),
      account: null,
      clientId: 'cid'
    });

    expect(out).toContain('<pre class="raw-json">{"kind":"network"}</pre>');
    expect(out).not.toContain('REP JOT cannot start');
  });

  test('every other route keeps the blocker while startup is failed', () => {
    setStartupStatus('static_failed');
    const out = html(App, {
      route: routeStore({ name: 'session-active', sessionId: 'session-abc' }),
      account: null,
      clientId: 'cid'
    });
    expect(out).toContain('REP JOT cannot start');
    expect(out).not.toContain('<pre class="raw-json">');
  });
});

describe('shell route outlet', () => {
  test('home renders the sign-in control for an anonymous visitor', () => {
    setStartupStatus('ready');
    const out = html(App, { route: routeStore({ name: 'home' }), account: null, clientId: 'cid' });
    expect(out).toContain('Continue with Google');
  });

  test('an unbuilt route renders not-found with its own address', () => {
    setStartupStatus('ready');
    const out = html(App, { route: routeStore({ name: 'settings' }), account: ACCOUNT, clientId: 'cid' });

    expect(out).toContain('No screen for that address');
    expect(out).toContain('#/settings');
  });

  test('an unmatched route shows the text the user typed', () => {
    setStartupStatus('ready');
    const out = html(App, {
      route: routeStore({ name: 'not-found', attempted: '#/typo' }),
      account: null,
      clientId: 'cid'
    });
    expect(out).toContain('#/typo');
  });

  test('the raw route renders the stored payload', () => {
    setStartupStatus('ready');
    const key = putRawPayload('{"format":"repjot/preferences"}');
    const out = html(App, {
      route: routeStore({ name: 'raw-json', source: key }),
      account: ACCOUNT,
      clientId: 'cid'
    });

    expect(out).toContain('Raw JSON');
    expect(out).toContain('<pre class="raw-json">{"format":"repjot/preferences"}</pre>');
  });
});

describe('shell error banner', () => {
  test('an active error renders a dismissible banner', () => {
    setStartupStatus('ready');
    reportError(new AppError('drive_rate_limit', {}, 'Google asked us to slow down.'));

    const out = html(App, { route: routeStore({ name: 'home' }), account: ACCOUNT, clientId: 'cid' });

    expect(out).toContain('shell__banner');
    expect(out).toContain('Google asked us to slow down.');
    expect(out).toContain('Dismiss');
  });

  test('no active error means no banner', () => {
    setStartupStatus('ready');
    const out = html(App, { route: routeStore({ name: 'home' }), account: ACCOUNT, clientId: 'cid' });
    expect(out).not.toContain('shell__banner');
  });
});
