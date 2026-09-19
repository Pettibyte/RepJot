// Side-change regressions.
//
// The side is part of the row key and the result key, so picking a new side
// moves the row. Three failures came from that:
// - a plain save wrote the new side and left the old one, so one round
//   read as two recorded sets;
// - drafts keyed by the old row key orphaned, so the typed value stopped
//   reaching the row on screen;
// - the recreated row closed its options panel.
//
// These drive the real screen over the real session service and read the
// stored session back.

import { afterEach, describe, expect, test } from 'bun:test';
import ActiveWorkoutScreen from '../../src/ui/screens/ActiveWorkoutScreen.svelte';
import type { Exercise, ResultsShard } from '../../src/domain/types';
import { createMemoryLocalStore } from '../../src/storage/memory-local-store';
import { createCoordinator } from '../../src/sync/sync-coordinator';
import { createPreferenceService } from '../../src/preferences/preference-service';
import { createLookupService } from '../../src/indexes/lookup-service';
import { createSessionService, type SessionService } from '../../src/sessions/session-service';
import { setServices } from '../../src/services/registry';
import { SESSION_KEY, WORKOUT_ID, exercises, validShard } from '../fixtures/semantic';
import { SHARD_NAME, frozenTimers, loadedStaticData } from '../fixtures/sync';
import { FakeDrive } from '../fakes/fake-drive';
import { flushSync, mountTo, settle, teardown, type Harness } from './harness';

/** The squat set of round 1. Its result key ends `|<side>|1`. */

let harness: Harness;
let sessionService: SessionService;

afterEach(() => teardown());

/** Make the squat unilateral so the side control appears. */
function unilateralBackSquat(): Exercise[] {
  return exercises().map((e) =>
    e.id === 'back-squat' ? { ...e, laterality: 'unilateral' as const } : e
  );
}

/** One stored result on the round-1 squat set, on the given side. */
function shardWithResult(
  side: string | null,
  reps: number,
  startingSide?: 'left' | 'right'
): ResultsShard {
  const shard = validShard();
  const session = shard.sessions[SESSION_KEY];
  if (session === undefined) throw new Error('The session fixture is missing.');
  session.status = 'in_progress';
  delete session.completedAtUtc;
  session.exerciseResults = side === null ? {} : {
    [`root/squat-sets:1/back-squat-set|${side}|1`]: {
      workoutId: WORKOUT_ID,
      executionPath: [
        { nodeId: 'root' },
        { nodeId: 'squat-sets', iteration: 1 },
        { nodeId: 'back-squat-set' }
      ],
      exerciseId: 'back-squat',
      side: side as never,
      attempt: 1,
      ...(startingSide === undefined ? {} : { startingSide }),
      status: 'completed',
      values: { reps: { value: reps, unit: 'reps' } }
    }
  };
  session.containerResults = {};
  return shard;
}

async function mountWith(
  side: string | null,
  reps = 0,
  startingSide?: 'left' | 'right'
): Promise<HTMLElement> {
  const shard = shardWithResult(side, reps, startingSide);
  // `signIn` builds its own static data, so stand up the same stack here
  // with the squat made unilateral. That is what puts the side control on
  // the screen.
  const drive = new FakeDrive();
  drive.addFile(SHARD_NAME, JSON.stringify(shard));
  const store = await createMemoryLocalStore();
  const staticData = loadedStaticData(unilateralBackSquat());
  const timers = frozenTimers();
  const coordinator = createCoordinator({
    store,
    drive,
    staticData,
    accountKey: 'acct-side',
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
    accountKey: 'acct-side'
  });
  harness = { drive, store, coordinator, preferences, lookup, staticData, timers };
  await coordinator.ensureLoaded(SHARD_NAME);
  const { target } = mountTo(ActiveWorkoutScreen, { sessionId: SESSION_KEY });
  await settle(40);
  flushSync();
  return target;
}

/**
 * The target row element.
 *
 * Matched on a prefix, not the whole id: the side sits inside the row key,
 * so the id changes every time the side changes. The stable part is the
 * workout, the path, and the attempt.
 */
function row(target: HTMLElement): HTMLElement {
  const el = target.querySelector<HTMLElement>(
    `[id^="active-demo|root/squat-sets:1/back-squat-set|"]`
  );
  if (el === null) throw new Error('the squat set row did not render');
  return el;
}

function chip(target: HTMLElement, text: string): HTMLButtonElement {
  const found = Array.from(row(target).querySelectorAll('.side-control button.chip')).find(
    (c) => c.textContent?.trim() === text
  ) as HTMLButtonElement | undefined;
  if (found === undefined) throw new Error(`no side chip "${text}" on the squat row`);
  return found;
}

function repsInput(target: HTMLElement): HTMLInputElement {
  const input = row(target).querySelector('.value-input input') as HTMLInputElement | null;
  if (input === null) throw new Error('no reps input on the squat row');
  return input;
}

/** The sides stored for the round-1 squat set. */
async function storedSides(): Promise<string[]> {
  const session = await sessionService.load(SESSION_KEY);
  return Object.keys(session.exerciseResults)
    .filter((key) => key.startsWith('root/squat-sets:1/back-squat-set|'))
    .map((key) => key.split('|')[1] ?? '?');
}

describe('a side change does not duplicate the set', () => {
  test('both -> alternating leaves exactly one result', async () => {
    const target = await mountWith('both', 12);
    expect(await storedSides()).toEqual(['both']);

    chip(target, 'Alternate').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await settle(30);
    flushSync();

    expect(await storedSides()).toEqual(['alternating']);
  });

  test('the reported repro: both, alternating, edit reps, back to both', async () => {
    const target = await mountWith('both', 12);

    chip(target, 'Alternate').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await settle(30);
    flushSync();
    expect(await storedSides()).toEqual(['alternating']);

    // Edit the reps while alternating. This save goes through the ordinary
    // field path, which used to write a second key.
    const input = repsInput(target);
    input.value = '14';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('blur', { bubbles: true }));
    await settle(30);
    flushSync();
    expect(await storedSides()).toEqual(['alternating']);

    // Back to both.
    chip(target, 'Both').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await settle(30);
    flushSync();
    expect(await storedSides()).toEqual(['both']);
  });

  test('two picks with no settle between them leave one result', async () => {
    const target = await mountWith('both', 12);

    // The second pick used to read the pre-change row and write a stale key
    // beside the new one.
    chip(target, 'Alternate').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    chip(target, 'Both').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await settle(40);
    flushSync();

    expect(await storedSides()).toEqual(['both']);
  });

  test('a blank row keeps its side draft until the first value is saved', async () => {
    const target = await mountWith(null);

    chip(target, 'Alternate').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await settle(20);
    flushSync();
    expect(await storedSides()).toEqual([]);

    const input = repsInput(target);
    input.value = '10';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('blur', { bubbles: true }));
    await settle(40);
    flushSync();

    expect(await storedSides()).toEqual(['alternating']);
  });

  test('a first value followed immediately by a side pick leaves one key', async () => {
    const target = await mountWith(null);
    const input = repsInput(target);
    input.value = '10';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    chip(target, 'Alternate').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    input.dispatchEvent(new Event('blur', { bubbles: true }));
    await settle(50);
    flushSync();

    expect(await storedSides()).toEqual(['alternating']);
  });

  test('a field save racing a side pick uses the moved row', async () => {
    const target = await mountWith('both', 12);

    chip(target, 'Alternate').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const input = repsInput(target);
    input.value = '14';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('blur', { bubbles: true }));
    await settle(50);
    flushSync();

    expect(await storedSides()).toEqual(['alternating']);
    const session = await sessionService.load(SESSION_KEY);
    expect(Object.values(session.exerciseResults)[0]?.values?.reps?.value).toBe(14);
  });

  test('an invalid field after a side pick cannot restore the old-side key', async () => {
    const target = await mountWith('both', 12);

    chip(target, 'Alternate').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const input = repsInput(target);
    input.value = '1.5';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('blur', { bubbles: true }));
    await settle(50);
    flushSync();

    expect(await storedSides()).toEqual(['alternating']);
  });
});

describe('the alternating split shows under the field', () => {
  test('a stored starting side is shown', async () => {
    const target = await mountWith('alternating', 9, 'right');
    const groups = Array.from(row(target).querySelectorAll<HTMLElement>('.chip-group'));
    const startsOn = groups.find((group) =>
      group.querySelector('.chip-group__label')?.textContent?.trim() === 'Starts on'
    );
    const right = Array.from(startsOn?.querySelectorAll<HTMLButtonElement>('button') ?? [])
      .find((button) => button.textContent?.trim() === 'Right');

    expect(right?.getAttribute('aria-pressed')).toBe('true');
    expect(row(target).querySelector('.exercise-row__meaning')?.textContent).toContain('5 right');
  });

  test('alternating puts the total line in exercise-row__meaning', async () => {
    const target = await mountWith('both', 12);
    chip(target, 'Alternate').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await settle(30);
    flushSync();

    const meaning = row(target)
      .querySelector('.exercise-row__meaning')
      ?.textContent?.trim();
    expect(meaning).toBeDefined();
    expect(meaning).toContain('total');
    expect(meaning).toContain('each');
  });

  test('the split is not drawn twice', async () => {
    const target = await mountWith('both', 12);
    chip(target, 'Alternate').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await settle(30);
    flushSync();

    // The old home for the line is gone, so it appears once.
    expect(target.querySelector('.side-control__split')).toBeNull();
    expect(row(target).querySelectorAll('.exercise-row__meaning').length).toBe(1);
  });
});

describe('the options panel survives a side change', () => {
  test('an open panel stays open when the row moves to a new key', async () => {
    const target = await mountWith('both', 12);
    const panel = () =>
      row(target).querySelector('details.exercise-row__options') as HTMLDetailsElement | null;

    // Open it the way a tap does.
    const first = panel();
    expect(first).not.toBeNull();
    first!.open = true;
    first!.dispatchEvent(new Event('toggle', { bubbles: true }));
    await settle(20);
    flushSync();
    expect(panel()?.open).toBe(true);

    // The side change rebuilds the row under a new key. The panel used to
    // come back closed, which is what made the user think the pick failed.
    chip(target, 'Alternate').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await settle(30);
    flushSync();

    expect(panel()?.open).toBe(true);
  });
});
