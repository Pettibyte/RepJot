// Correctness audit areas 13-15: account-action separation.
//
// Sign out is a distinct operation from Disconnect Google Account and Delete
// All User Data. REQUIREMENTS 2.12 and ARCHITECTURE §10 define its different
// effect: clear authorization state while retaining the account cache and
// pending edits. PHASE-15 explicitly moved the sign-out control to the Phase 19
// Settings screen, and PHASE-19 requires deletion and disconnect to remain
// separate from sign out.

import { afterEach, describe, expect, test } from 'bun:test';
import SettingsScreen from '../src/ui/screens/SettingsScreen.svelte';
import { clearServices, setServices } from '../src/services/registry';
import { createMemoryLocalStore } from '../src/storage/memory-local-store';
import { FakeDrive } from './fakes/fake-drive';
import { html as renderHtml } from './support/render';

afterEach(() => {
  clearServices();
});

describe('sign-out, disconnect, and deletion stay separately available', () => {
  test('signed-in Settings exposes a Sign out action as well as delete and disconnect', async () => {
    setServices({
      drive: new FakeDrive(),
      store: await createMemoryLocalStore(),
      accountKey: 'acct-1'
    });

    const out = renderHtml(SettingsScreen, {});

    expect(out).toContain('Delete All User Data');
    expect(out).toContain('Disconnect Google Account');
    expect(out).toContain('Sign out');
  });
});
