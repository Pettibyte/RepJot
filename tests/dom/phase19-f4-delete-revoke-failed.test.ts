// F-4: a delete whose revoke fails must not leave the device live.
//
// The audit found that after `revoke_failed` the screen returned early, so
// `clearServices()` never ran. The coordinator, preference service, and lookup
// index stayed published, and one pill tap wrote `preferences.json` straight
// back into the folder the user had just emptied.
//
// THE TRAP. The upload is fire-and-forget. A test that checks the catalog
// right after the write sees nothing landed and passes while the bug is still
// present. Every assertion here runs after the sync is drained. The last test
// is the negative control: it proves this file can see the bug at all.
//
// REQUIREMENTS 21.3, 21.4, 21.7.

import { afterEach, describe, expect, test } from 'bun:test';
import SettingsScreen from '../../src/ui/screens/SettingsScreen.svelte';
import { runDeleteAllUserData } from '../../src/data/account-flows';
import { getServices } from '../../src/services/registry';
import {
  bindTestSession,
  buttonWithText,
  drainTimers,
  makeRevokeFail,
  mountTo,
  prefsDoc,
  settle,
  signIn,
  tap,
  teardown,
  type Harness
} from './harness';

let harness: Harness;

/**
 * Open the confirmation and type the phrase. Returns the screen target.
 *
 * The session is bound inside the setup so `disconnect()` really calls the
 * adapter's revoke. Without a stored token it short-circuits to `revoked`
 * and the test would exercise the wrong branch.
 */
async function openAndConfirm(exits: () => void): Promise<HTMLElement> {
  const { target } = mountTo(SettingsScreen, {
    clientId: 'cid',
    onExitToLanding: exits
  });

  const deleteButton = buttonWithText(target, 'Delete All User Data');
  if (deleteButton === undefined) throw new Error('No Delete All User Data button.');
  tap(deleteButton);
  await settle(12);

  const input = target.querySelector('#delete-phrase') as HTMLInputElement | null;
  if (input === null) throw new Error('The delete confirmation did not open.');
  input.value = 'DELETE ALL USER DATA';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await settle(12);

  const confirm = buttonWithText(target, 'Delete all user data');
  if (confirm === undefined) throw new Error('No confirm button.');
  expect(confirm.disabled).toBe(false);
  tap(confirm);

  // The delete runs several awaited steps: coordinator reset, the delete
  // loop, then the revoke. A fixed microtask count is a guess about how many
  // turns that takes, and a short one makes the test read a half-finished
  // screen. Poll for the settled state instead.
  await waitForDeleteToSettle();

  return target;
}

/**
 * Wait until the delete flow has stopped moving.
 *
 * "Settled" means the confirmation shows the unconfirmed-revoke alert, or
 * the services have cleared. Either way the awaited steps are done. The
 * timeout is loud on purpose: a flow that never settles should fail the
 * test, not hang it.
 */
async function waitForDeleteToSettle(): Promise<void> {
  for (let i = 0; i < 200; i += 1) {
    await settle(4);
    if (getServices().preferences === null) return;
    const alert = document.body.querySelector('.danger-confirm__error')?.textContent ?? '';
    if (alert.includes('did not confirm')) return;
  }
  throw new Error('The delete flow did not settle.');
}

afterEach(() => {
  teardown();
});

describe('a delete whose revoke fails', () => {
  test('the services clear, so no write path survives', async () => {
    harness = await signIn([
      {
        name: 'preferences.json',
        text: prefsDoc({ 'back-squat': { weight: 'kg' } })
      }
    ]);
    await harness.preferences.ensureDoc();
    await bindTestSession();
    makeRevokeFail(harness.drive);

    let exited = 0;
    await openAndConfirm(() => {
      exited += 1;
    });

    // The flow reports the revoke as unconfirmed, and the local state is
    // still treated as deleted.
    expect(getServices().preferences).toBeNull();
    expect(getServices().coordinator).toBeNull();
    expect(getServices().lookup).toBeNull();
    // The screen does not reload out from under the message. The user reads
    // it, follows the link, or presses Cancel.
    expect(exited).toBe(0);
  });

  test('a later unit change cannot re-create a recognized file', async () => {
    harness = await signIn([
      {
        name: 'preferences.json',
        text: prefsDoc({ 'back-squat': { weight: 'kg' } })
      }
    ]);
    await harness.preferences.ensureDoc();
    await bindTestSession();
    makeRevokeFail(harness.drive);

    await openAndConfirm(() => undefined);

    // The folder really is empty after the flow.
    expect(harness.drive.textOf('preferences.json')).toBeUndefined();

    const callsBefore = harness.drive.calls.length;
    expect(getServices().preferences).toBeNull();

    // Drain the way a real session would. If any queued edit survived the
    // clear, this is where its upload would land.
    await drainTimers(harness.timers);
    const newCalls = harness.drive.calls.slice(callsBefore);
    expect(newCalls.filter((call: string) => call.startsWith('createFile'))).toEqual([]);
    expect(harness.drive.textOf('preferences.json')).toBeUndefined();
  });

  test('the confirmation stays open and carries the Google link', async () => {
    harness = await signIn([
      { name: 'preferences.json', text: prefsDoc({ 'back-squat': { weight: 'kg' } }) }
    ]);
    await harness.preferences.ensureDoc();
    await bindTestSession();
    makeRevokeFail(harness.drive);

    const target = await openAndConfirm(() => undefined);

    const alert = target.querySelector('[role="alert"]')?.textContent ?? '';
    expect(alert).toContain('files are deleted');
    expect(alert).toContain('did not confirm the revoke');

    const link = Array.from(target.querySelectorAll('a')).find((anchor: Element) =>
      (anchor.getAttribute('href') ?? '').includes('myaccount.google.com/connections')
    );
    expect(link).toBeDefined();
  });

  test('closing the confirmation after a cleared delete routes out', async () => {
    harness = await signIn([
      { name: 'preferences.json', text: prefsDoc({ 'back-squat': { weight: 'kg' } }) }
    ]);
    await harness.preferences.ensureDoc();
    await bindTestSession();
    makeRevokeFail(harness.drive);

    let exited = 0;
    const target = await openAndConfirm(() => {
      exited += 1;
    });
    expect(exited).toBe(0);

    const cancel = buttonWithText(target, 'Cancel');
    if (cancel === undefined) throw new Error('No cancel button in the confirmation.');
    tap(cancel);

    expect(exited).toBe(1);
  });

  test('the units list is gone once the delete has cleared the device', async () => {
    harness = await signIn([
      { name: 'preferences.json', text: prefsDoc({ 'back-squat': { weight: 'kg' } }) }
    ]);
    await harness.preferences.ensureDoc();
    await bindTestSession();
    makeRevokeFail(harness.drive);

    const target = await openAndConfirm(() => undefined);

    // No pill means no control that could write. This is the belt on the
    // suspenders: even if a write path were rebuilt, there is no control.
    expect(target.querySelector('button.unit-pill')).toBeNull();
  });
});

describe('the negative control', () => {
  test('the harness can see a live write path when one exists', async () => {
    // If this test ever passes by accident, the tests above are vacuous.
    //
    // It reproduces the original defect at the flow level: run the delete
    // with a failing revoke, leave the services published exactly as the
    // unfixed screen did, then tap a unit. The file comes back.
    harness = await signIn([
      { name: 'preferences.json', text: prefsDoc({ 'back-squat': { weight: 'kg' } }) }
    ]);
    const service = harness.preferences;
    await service.ensureDoc();
    makeRevokeFail(harness.drive);

    const result = await runDeleteAllUserData({
      drive: harness.drive,
      store: harness.store,
      accountKey: 'acct-1',
      coordinator: harness.coordinator,
      revoke: async () => false
    });
    expect(result.kind).toBe('revoke_failed');
    expect(harness.drive.textOf('preferences.json')).toBeUndefined();

    // The services are still live. This is the state the fix removes.
    await service.setUnit('back-squat', 'weight', 'lb');
    await drainTimers(harness.timers);

    // A live service does re-create the file. This is the bug, reproduced
    // on purpose, so a green suite above means the path is genuinely closed.
    expect(harness.drive.textOf('preferences.json')).toBeDefined();
  });
});
