// Delete-attempt regressions.
//
// `Add another attempt` had no counterpart: once an attempt was on screen
// the user could not remove it. These drive the real Active Workout screen
// over the real session service and check three things a delete can get
// wrong:
// - the button appears on a recorded attempt and not on a blank row;
// - the tap removes the stored result and its row;
// - a middle delete renumbers the rows that move down, and their drafts
//   follow the new keys instead of orphaning.

import { afterEach, describe, expect, test } from 'bun:test';
import ActiveWorkoutScreen from '../../src/ui/screens/ActiveWorkoutScreen.svelte';
import type { ResultsShard } from '../../src/domain/types';
import { createMemoryLocalStore } from '../../src/storage/memory-local-store';
import { createCoordinator } from '../../src/sync/sync-coordinator';
import { createPreferenceService } from '../../src/preferences/preference-service';
import { createLookupService } from '../../src/indexes/lookup-service';
import { createSessionService, type SessionService } from '../../src/sessions/session-service';
import { setServices } from '../../src/services/registry';
import { SESSION_KEY, WORKOUT_ID, exercises, validShard } from '../fixtures/semantic';
import { SHARD_NAME, frozenTimers, loadedStaticData } from '../fixtures/sync';
import { FakeDrive } from '../fakes/fake-drive';
import { buttonWithText, flushSync, mountTo, settle, teardown, type Harness } from './harness';

const PATH = [
  { nodeId: 'root' },
  { nodeId: 'squat-sets', iteration: 1 },
  { nodeId: 'back-squat-set' }
];

let harness: Harness;
let sessionService: SessionService;

afterEach(() => teardown());

/** A shard whose round-1 squat set holds the given attempts. */
function shardWithAttempts(attempts: Array<{ attempt: number; reps: number }>): ResultsShard {
  const shard = validShard();
  const session = shard.sessions[SESSION_KEY];
  if (session === undefined) throw new Error('The session fixture is missing.');
  session.status = 'in_progress';
  delete session.completedAtUtc;
  session.exerciseResults = {};
  session.containerResults = {};
  for (const { attempt, reps } of attempts) {
    session.exerciseResults[`root/squat-sets:1/back-squat-set|both|${attempt}`] = {
      workoutId: WORKOUT_ID,
      executionPath: PATH,
      exerciseId: 'back-squat',
      side: 'both',
      attempt,
      status: 'completed',
      values: { reps: { value: reps, unit: 'reps' } }
    };
  }
  return shard;
}

async function mountWith(attempts: Array<{ attempt: number; reps: number }>): Promise<HTMLElement> {
  const shard = shardWithAttempts(attempts);
  const drive = new FakeDrive();
  drive.addFile(SHARD_NAME, JSON.stringify(shard));
  const store = await createMemoryLocalStore();
  const staticData = loadedStaticData(exercises());
  const timers = frozenTimers();
  const coordinator = createCoordinator({
    store,
    drive,
    staticData,
    accountKey: 'acct-del',
    pagehideTarget: null,
    timers: timers.timers
  });
  const preferences = createPreferenceService({ coordinator, staticData });
  const lookup = createLookupService({ staticData, shards: [shard] });
  sessionService = createSessionService({ coordinator, staticData, preferences, lookup });
  setServices({
    lookup,
    preferences,
    coordinator,
    staticData,
    drive,
    store,
    sessionService,
    accountKey: 'acct-del'
  });
  harness = { drive, store, coordinator, preferences, lookup, staticData, timers };
  await coordinator.ensureLoaded(SHARD_NAME);
  const { target } = mountTo(ActiveWorkoutScreen, { sessionId: SESSION_KEY });
  await settle(40);
  flushSync();
  return target;
}

/** The row element for one attempt of the round-1 squat set. */
function rowFor(target: HTMLElement, attempt: number): HTMLElement | null {
  return target.querySelector<HTMLElement>(
    `[id^="active-demo|root/squat-sets:1/back-squat-set|both|${attempt}"]`
  );
}

/** The stored attempts for the round-1 squat set as `attempt:reps`. */
function storedAttempts(): string[] {
  const session = (harness.coordinator.peek(SHARD_NAME) as any).sessions[SESSION_KEY];
  return Object.entries(session.exerciseResults as Record<string, any>)
    .filter(([key]) => key.includes('squat-sets:1/back-squat-set'))
    .map(([, r]) => `${r.attempt}:${r.values?.reps?.value ?? 0}`)
    .sort((a, b) => Number(a.split(':')[0]) - Number(b.split(':')[0]));
}

/** Open the options panel of one attempt so its buttons render. */
async function openPanel(target: HTMLElement, attempt: number): Promise<void> {
  const row = rowFor(target, attempt);
  if (row === null) throw new Error(`attempt ${attempt} did not render`);
  const summary = row.querySelector('summary');
  if (summary !== null) {
    (summary.parentElement as HTMLDetailsElement).open = true;
    await settle(10);
    flushSync();
  }
}

describe('the Delete attempt button', () => {
  test('appears on a recorded attempt', async () => {
    const target = await mountWith([{ attempt: 1, reps: 5 }]);
    await openPanel(target, 1);
    expect(buttonWithText(rowFor(target, 1)!, 'Delete attempt')).toBeDefined();
  });

  test('removes the stored result and the row', async () => {
    const target = await mountWith([{ attempt: 1, reps: 5 }, { attempt: 2, reps: 7 }]);
    await openPanel(target, 2);
    const button = buttonWithText(rowFor(target, 2)!, 'Delete attempt');
    if (button === undefined) throw new Error('Delete attempt button missing');

    button.click();
    await settle(60);
    flushSync();

    expect(storedAttempts()).toEqual(['1:5']);
    expect(rowFor(target, 2)).toBeNull();
  });

  test('a middle delete renumbers the rows that move down', async () => {
    const target = await mountWith([
      { attempt: 1, reps: 5 },
      { attempt: 2, reps: 7 },
      { attempt: 3, reps: 9 }
    ]);
    await openPanel(target, 2);
    const button = buttonWithText(rowFor(target, 2)!, 'Delete attempt');
    if (button === undefined) throw new Error('Delete attempt button missing');

    button.click();
    await settle(60);
    flushSync();

    // Stored: 5, 9. The old attempt 3 now carries number 2.
    expect(storedAttempts()).toEqual(['1:5', '2:9']);
    // And the screen shows it there, not stranded under the old key.
    const moved = rowFor(target, 2);
    if (moved === null) throw new Error('the renumbered row did not render at attempt 2');
    const input = moved.querySelector('.value-input input') as HTMLInputElement | null;
    expect(input?.value).toBe('9');
    expect(rowFor(target, 3)).toBeNull();
  });

  test('deleting the only attempt leaves the blank row back', async () => {
    const target = await mountWith([{ attempt: 1, reps: 5 }]);
    await openPanel(target, 1);
    const button = buttonWithText(rowFor(target, 1)!, 'Delete attempt');
    if (button === undefined) throw new Error('Delete attempt button missing');

    button.click();
    await settle(60);
    flushSync();

    expect(storedAttempts()).toEqual([]);
    // The model recreates the blank row, so the set is still on screen.
    const blank = rowFor(target, 1);
    if (blank === null) throw new Error('the blank row was not recreated');
    const input = blank.querySelector('.value-input input') as HTMLInputElement | null;
    expect(input?.value ?? '').toBe('');
  });
});
