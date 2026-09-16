// The Settings screen.
// Phase 19. REQUIREMENTS 12.3, 12.10, 12.11, 21.1 through 21.7.
//
// The screen is rendered through the Svelte server renderer over a registry
// built from the same fakes the sync tests use. That keeps the assertions on
// what the user sees: which sections appear, what they say, and that the two
// destructive actions stay separate controls.

import { afterEach, describe, expect, test } from 'bun:test';
import SettingsScreen from '../src/ui/screens/SettingsScreen.svelte';
import { createMemoryLocalStore } from '../src/storage/memory-local-store';
import { createCoordinator } from '../src/sync/sync-coordinator';
import { createPreferenceService } from '../src/preferences/preference-service';
import { createLookupService } from '../src/indexes/lookup-service';
import { clearServices, setServices } from '../src/services/registry';
import { clearRawPayloads } from '../src/state/raw-payload-store';
import { clearError, setStartupStatus } from '../src/state/app-state';
import { FakeDrive } from './fakes/fake-drive';
import { frozenTimers, loadedStaticData } from './fixtures/sync';
import { html as renderHtml } from './support/render';

/** Build a signed-in registry over a fake Drive and a memory store. */
async function signIn(seed: Array<{ name: string; text: string }> = []): Promise<FakeDrive> {
  const drive = new FakeDrive();
  for (const file of seed) drive.addFile(file.name, file.text);
  const store = await createMemoryLocalStore();
  const staticData = loadedStaticData();
  const coordinator = createCoordinator({
    store,
    drive,
    staticData,
    accountKey: 'acct-1',
    pagehideTarget: null,
    timers: frozenTimers().timers
  });
  setServices({
    lookup: createLookupService({ staticData }),
    preferences: createPreferenceService({ coordinator, staticData }),
    coordinator,
    staticData,
    drive,
    store,
    accountKey: 'acct-1'
  });
  return drive;
}

afterEach(() => {
  clearServices();
  clearRawPayloads();
  clearError();
  setStartupStatus('loading_static');
});

describe('the license line', () => {
  test('it renders exactly as the requirement words it', async () => {
    await signIn();
    const out = renderHtml(SettingsScreen, {});

    expect(out).toContain(
      'For non-commercial use only. For commercial licensing, Contact Pettibyte LLC.'
    );
  });

  test('it renders for an anonymous visitor too', () => {
    const out = renderHtml(SettingsScreen, { clientId: 'cid' });

    expect(out).toContain(
      'For non-commercial use only. For commercial licensing, Contact Pettibyte LLC.'
    );
  });
});

describe('anonymous Settings', () => {
  test('an anonymous visitor gets a sign-in control and no data sections', () => {
    const out = renderHtml(SettingsScreen, { clientId: 'cid' });

    expect(out).toContain('Continue with Google');
    expect(out).not.toContain('Data Export');
    expect(out).not.toContain('Danger Zone');
    expect(out).not.toContain('Delete All User Data');
  });

  test('a build with no client id says so instead of offering a dead control', () => {
    const out = renderHtml(SettingsScreen, { clientId: '' });

    expect(out).toContain('no Google client id');
    expect(out).not.toContain('Continue with Google');
  });
});

describe('signed-in Settings sections', () => {
  test('every section renders', async () => {
    await signIn([{ name: 'preferences.json', text: '{"formatVersion":1,"exerciseUnits":{}}' }]);
    const out = renderHtml(SettingsScreen, {});

    expect(out).toContain('Exercise Units');
    expect(out).toContain('Data Export');
    expect(out).toContain('Diagnostics');
    expect(out).toContain('Danger Zone');
  });

  test('the export section offers the list refresh action', async () => {
    await signIn();
    const out = renderHtml(SettingsScreen, {});

    expect(out).toContain('Refresh file list');
  });

  test('the diagnostics action is present and says the log stays local', async () => {
    await signIn();
    const out = renderHtml(SettingsScreen, {});

    expect(out).toContain('Download diagnostic log');
    expect(out).toContain('never uploads it');
  });
});

describe('delete and disconnect stay separate', () => {
  test('both controls render, and each names its own action', async () => {
    await signIn();
    const out = renderHtml(SettingsScreen, {});

    expect(out).toContain('Delete All User Data');
    expect(out).toContain('Disconnect Google Account');
  });

  test('the delete confirmation is not open at rest', async () => {
    await signIn();
    const out = renderHtml(SettingsScreen, {});

    // The typed-phrase field belongs to the confirmation. It must not be on
    // the page before the user asks for the delete.
    expect(out).not.toContain('delete-phrase');
  });

  test('the disconnect confirmation is not open at rest', async () => {
    await signIn();
    const out = renderHtml(SettingsScreen, {});

    // The second-step disconnect copy must not appear before the press.
    expect(out).not.toContain('Disconnecting');
  });

  test('the two actions carry different copy about what they do', async () => {
    await signIn();
    const out = renderHtml(SettingsScreen, {});

    // Delete talks about removing files. Disconnect talks about the link and
    // the local copy, and says the files stay.
    expect(out).toContain('removes the REP JOT files');
    expect(out).toContain('Your files stay in');
  });

  test('a failed revoke shows the Google Account connections link', async () => {
    await signIn();
    const out = renderHtml(SettingsScreen, { onExitToLanding: () => {} });
    expect(out).not.toContain('myaccount.google.com');

    // The link itself is a component-level rule. Render the section directly
    // with the failure set.
    const { default: DisconnectSection } = await import(
      '../src/ui/components/DisconnectSection.svelte'
    );
    const failed = renderHtml(DisconnectSection, { revokeFailed: true });
    expect(failed).toContain('https://myaccount.google.com/connections');
    expect(failed).toContain('Google did not confirm');
  });
});

describe('the exercise units list', () => {
  test('one row renders per exercise', async () => {
    await signIn();
    const out = renderHtml(SettingsScreen, {});

    const rows = out.match(/class="unit-row"/g) ?? [];
    const staticData = loadedStaticData();
    expect(rows.length).toBe(staticData.exercises.length);
  });

  test('a switchable unit renders a pill and a single unit renders plain text', async () => {
    await signIn();
    const out = renderHtml(SettingsScreen, {});

    // Every exercise in the bundle has at least one two-unit dimension, so
    // the list carries pills, and reps-only cells carry static text.
    expect(out).toContain('unit-pill');
    expect(out).toContain('unit-row__static');
  });
});
