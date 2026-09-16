// F-5: a failed delete file-count read must be visible.
//
// The audit found that `openDelete()` set `deleteError` in its catch, but
// `deleteOpen` stayed false and `deleteError` rendered only inside the
// `{#if deleteOpen}` branch. The button was pressed and the screen did not
// change at all.
//
// REQUIREMENTS 21.3.

import { afterEach, describe, expect, test } from 'bun:test';
import SettingsScreen from '../../src/ui/screens/SettingsScreen.svelte';
import {
  buttonWithText,
  mountTo,
  prefsDoc,
  settle,
  signIn,
  tap,
  teardown,
  type Harness
} from './harness';

let harness: Harness;

afterEach(() => {
  teardown();
});

function mountScreen(): HTMLElement {
  const { target } = mountTo(SettingsScreen, {
    clientId: 'cid',
    onExitToLanding: () => undefined
  });
  return target;
}

function dangerRegion(target: HTMLElement): HTMLElement {
  const region = target.querySelector('.settings-danger') as HTMLElement | null;
  if (region === null) throw new Error('No Danger Zone rendered.');
  return region;
}

function deleteButton(target: HTMLElement): HTMLButtonElement {
  const button = buttonWithText(target, 'Delete All User Data');
  if (button === undefined) throw new Error('No Delete All User Data button.');
  return button;
}

describe('a failed file-count read surfaces', () => {
  test('the error text appears when listCatalog rejects', async () => {
    harness = await signIn([
      { name: 'preferences.json', text: prefsDoc({ 'back-squat': { weight: 'kg' } }) }
    ]);
    harness.drive.listCatalog = async () => {
      throw new Error('network down');
    };

    const target = mountScreen();
    const before = dangerRegion(target).textContent ?? '';

    tap(deleteButton(target));
    await settle(20);

    const after = dangerRegion(target).textContent ?? '';
    expect(after).toContain('could not read the file list');
    expect(after).not.toBe(before);
  });

  test('the error carries a role that announces it', async () => {
    harness = await signIn([
      { name: 'preferences.json', text: prefsDoc({ 'back-squat': { weight: 'kg' } }) }
    ]);
    harness.drive.listCatalog = async () => {
      throw new Error('network down');
    };

    const target = mountScreen();
    tap(deleteButton(target));
    await settle(20);

    const alerts = Array.from(dangerRegion(target).querySelectorAll('[role="alert"]'));
    expect(alerts.length).toBeGreaterThan(0);
    expect(alerts.map((el: Element) => el.textContent ?? '').join(' ')).toContain(
      'could not read the file list'
    );
  });

  test('the confirmation does not open on a failed read', async () => {
    harness = await signIn([
      { name: 'preferences.json', text: prefsDoc({ 'back-squat': { weight: 'kg' } }) }
    ]);
    harness.drive.listCatalog = async () => {
      throw new Error('network down');
    };

    const target = mountScreen();
    tap(deleteButton(target));
    await settle(20);

    // No count means no honest confirmation. The error is the answer.
    expect(target.querySelector('.danger-confirm')).toBeNull();
  });

  test('a later successful read clears the error and opens the dialog', async () => {
    harness = await signIn([
      { name: 'preferences.json', text: prefsDoc({ 'back-squat': { weight: 'kg' } }) }
    ]);
    const realList = harness.drive.listCatalog.bind(harness.drive);
    harness.drive.listCatalog = async () => {
      throw new Error('network down');
    };

    const target = mountScreen();
    tap(deleteButton(target));
    await settle(20);
    expect(dangerRegion(target).textContent).toContain('could not read the file list');

    harness.drive.listCatalog = realList;
    tap(deleteButton(target));
    await settle(20);

    expect(target.querySelector('.danger-confirm')).not.toBeNull();
    expect(dangerRegion(target).textContent).not.toContain('could not read the file list');
  });
});
