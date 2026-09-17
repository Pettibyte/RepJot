// Session summary deletion tests. These run against the client runtime because
// the server renderer does not execute the summary screen's load effect.

import { afterEach, describe, expect, test } from 'bun:test';
import WorkoutSummaryScreen from '../../src/ui/screens/WorkoutSummaryScreen.svelte';
import { createSessionService, type SessionService } from '../../src/sessions/session-service';
import { setServices } from '../../src/services/registry';
import { setRouter } from '../../src/routing/router-registry';
import type { Route } from '../../src/routing/routes';
import {
  buttonWithText,
  mountTo,
  settle,
  signIn,
  tap,
  teardown,
  type Harness
} from './harness';
import { workout } from '../fixtures/semantic';

let harness: Harness;

afterEach(() => {
  setRouter(null);
  teardown();
});

async function setupSession(): Promise<{ service: SessionService; id: string }> {
  harness = await signIn();
  const service = createSessionService({
    coordinator: harness.coordinator,
    staticData: harness.staticData,
    preferences: harness.preferences,
    lookup: harness.lookup
  });
  setServices({ sessionService: service });
  const session = await service.start(workout().id);
  await service.complete(session.id);
  return { service, id: session.id };
}

async function waitForSummary(target: HTMLElement): Promise<void> {
  for (let i = 0; i < 100; i += 1) {
    await settle(2);
    if (target.querySelector('.summary-screen__title') !== null) return;
  }
  throw new Error('The session summary did not load.');
}

describe('WorkoutSummaryScreen session deletion', () => {
  test('shows Edit, Delete, and Back to History in that order', async () => {
    const { id } = await setupSession();

    const { target } = mountTo(WorkoutSummaryScreen, { sessionId: id });
    await waitForSummary(target);

    const labels = Array.from(target.querySelectorAll('.summary-screen__actions .btn')).map((button) =>
      (button.textContent ?? '').trim()
    );
    expect(labels).toEqual(['Edit', 'Delete', 'Back to History']);
  });

  test('requires confirmation, removes the session, and returns to History', async () => {
    const { service, id } = await setupSession();

    let navigated: Route | null = null;
    setRouter({
      current: () => ({ subscribe: () => () => {} }),
      navigate: (route: Route): void => {
        navigated = route;
      },
      start: (): void => {},
      stop: (): void => {}
    });

    const { target } = mountTo(WorkoutSummaryScreen, { sessionId: id });
    await waitForSummary(target);

    const deleteButton = buttonWithText(target, 'Delete');
    if (deleteButton === undefined) throw new Error('No Delete button.');
    tap(deleteButton);
    expect(target.textContent).toContain('Delete this workout?');
    expect(target.textContent).toContain('Cancel');

    const confirmButton = buttonWithText(target, 'Delete session');
    if (confirmButton === undefined) throw new Error('No Delete session confirmation button.');
    tap(confirmButton);
    await settle(20);

    expect(navigated).toEqual({ name: 'history' });
    await expect(service.load(id)).rejects.toThrow('not in its shard');
  });
});
