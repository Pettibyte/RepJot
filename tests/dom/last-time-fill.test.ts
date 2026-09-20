// Fill with last time data.
//
// The Last Time badge carries one more control: an arrow that copies the
// values it shows into the sets below it. These drive the real screen over
// the real session service and read the stored session back, because the
// two things that can go wrong are invisible in a render:
// - the fill stops at the draft, so the fields look recorded and Finish
//   still calls the work missing;
// - the fill reaches too far, so one badge over one exercise rewrites the
//   whole workout.

import { afterEach, describe, expect, test } from 'bun:test';
import ActiveWorkoutScreen from '../../src/ui/screens/ActiveWorkoutScreen.svelte';
import ExerciseSetTable from '../../src/ui/components/ExerciseSetTable.svelte';
import type { ActiveExerciseRow, ActiveSetTable } from '../../src/ui/viewmodels/activeWorkoutModel';
import type { ResultsShard, Session } from '../../src/domain/types';
import { createMemoryLocalStore } from '../../src/storage/memory-local-store';
import { createCoordinator } from '../../src/sync/sync-coordinator';
import { createPreferenceService } from '../../src/preferences/preference-service';
import { createLookupService } from '../../src/indexes/lookup-service';
import { createSessionService, type SessionService } from '../../src/sessions/session-service';
import { setServices } from '../../src/services/registry';
import { SESSION_KEY, SHARD_MONTH, WORKOUT_ID, exercises, validSession } from '../fixtures/semantic';
import { SHARD_NAME, frozenTimers, loadedStaticData } from '../fixtures/sync';
import { FakeDrive } from '../fakes/fake-drive';
import { flushSync, mountTo, settle, teardown } from './harness';

/** An earlier session. It holds one completed back squat set. */
const PRIOR_KEY = 'session-99999999-8888-4777-9666-555555555555';

let sessionService: SessionService;

afterEach(() => teardown());

/** The prior session, reduced to one squat set so the fill has one answer. */
function priorSession(): Session {
  const session = validSession();
  session.id = PRIOR_KEY;
  session.status = 'completed';
  session.completedAtUtc = '2026-08-10T15:05:00Z';
  session.exerciseResults = {
    'root/squat-sets:1/back-squat-set|both|1': {
      workoutId: WORKOUT_ID,
      executionPath: [
        { nodeId: 'root' },
        { nodeId: 'squat-sets', iteration: 1 },
        { nodeId: 'back-squat-set' }
      ],
      exerciseId: 'back-squat',
      side: 'both',
      attempt: 1,
      status: 'completed',
      values: {
        reps: { value: 7, unit: 'reps' },
        weight: { value: 95, unit: 'lb' }
      }
    }
  };
  session.containerResults = {};
  return session;
}

/** The session under edit. Nothing is recorded in it yet. */
function activeSession(): Session {
  const session = validSession();
  session.id = SESSION_KEY;
  session.status = 'in_progress';
  delete session.completedAtUtc;
  session.exerciseResults = {};
  session.containerResults = {};
  return session;
}

async function mountScreen(withHistory: boolean): Promise<HTMLElement> {
  const sessions: Record<string, Session> = { [SESSION_KEY]: activeSession() };
  if (withHistory) sessions[PRIOR_KEY] = priorSession();

  const shard: ResultsShard = {
    format: 'repjot/results',
    schemaVersion: 1,
    yearMonthUtc: SHARD_MONTH,
    sessions
  };

  const drive = new FakeDrive();
  drive.addFile(SHARD_NAME, JSON.stringify(shard));
  const store = await createMemoryLocalStore();
  const staticData = loadedStaticData(exercises());
  const timers = frozenTimers();
  const coordinator = createCoordinator({
    store,
    drive,
    staticData,
    accountKey: 'acct-fill',
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
    accountKey: 'acct-fill'
  });
  await coordinator.ensureLoaded(SHARD_NAME);

  const { target } = mountTo(ActiveWorkoutScreen, { sessionId: SESSION_KEY });
  await settle(40);
  flushSync();
  return target;
}

/** The working-set table. Its heading names the exercise and holds its badge. */
function squatTable(target: HTMLElement): HTMLElement {
  const found = Array.from(target.querySelectorAll<HTMLElement>('.set-table')).find((section) =>
    (section.querySelector('.set-table__title')?.textContent ?? '').includes('Squat')
  );
  if (found === undefined) throw new Error('the back squat set table did not render');
  return found;
}

function fillButton(scope: HTMLElement): HTMLButtonElement {
  const found = scope.querySelector<HTMLButtonElement>('.last-time__fill');
  if (found === null) throw new Error('the fill control did not render');
  return found;
}

/** One field of one working set. The id carries the row key. */
function setField(iteration: number, dimension: string): HTMLInputElement | null {
  return document.getElementById(
    `active-${WORKOUT_ID}|root/squat-sets:${iteration}/back-squat-set|both|1-${dimension}`
  ) as HTMLInputElement | null;
}

/** The warm-up squat row, which sits outside the working-set table. */
function warmupRow(target: HTMLElement): HTMLElement {
  const found = target.querySelector<HTMLElement>(
    `[id^="active-${WORKOUT_ID}|root/warmup/warmup-squat|"]`
  );
  if (found === undefined) throw new Error('the warm-up squat row did not render');
  return found;
}

function tap(el: HTMLElement): void {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}

describe('fill with last time data', () => {
  test('the fill control sits beside the badge and says what it does', async () => {
    const target = await mountScreen(true);
    const button = fillButton(squatTable(target));

    // The mark is the reviewed `input` glyph drawn as inline SVG. A raw
    // Unicode codepoint can render as a blank box where no font covers it.
    expect(button.querySelector('svg')).not.toBeNull();
    expect(button.textContent?.trim()).toBe('');
    expect(button.getAttribute('title')).toBe('Fill with last time data.');
    expect(button.className).toContain('pill');
    expect(button.className).toContain('chip');
    expect(button.className).toContain('chip--on');
  });

  test('one tap fills every set of that exercise', async () => {
    const target = await mountScreen(true);
    tap(fillButton(squatTable(target)));
    await settle(40);
    flushSync();

    for (const iteration of [1, 2, 3]) {
      expect(setField(iteration, 'reps')?.value).toBe('7');
      expect(setField(iteration, 'weight')?.value).toBe('95');
    }
  });

  test('the fill is durable, so Finish sees the work', async () => {
    const target = await mountScreen(true);
    tap(fillButton(squatTable(target)));
    await settle(40);

    const stored = await sessionService.load(SESSION_KEY);
    const keys = Object.keys(stored.exerciseResults).filter((key) =>
      key.includes('squat-sets')
    );
    expect(keys.length).toBe(3);
    for (const key of keys) {
      const result = stored.exerciseResults[key];
      expect(result?.values?.reps?.value).toBe(7);
      expect(result?.values?.weight?.value).toBe(95);
      expect(result?.status).toBe('completed');
    }
  });

  test('the fill stops at the exercise its badge sits on', async () => {
    const target = await mountScreen(true);
    tap(fillButton(squatTable(target)));
    await settle(40);
    flushSync();

    // The warm-up squat is a different set of the same exercise, outside
    // the table. The table badge does not reach it.
    expect(warmupRow(target).querySelector('input')?.value ?? '').toBe('');
  });

  test('a row fills only itself', async () => {
    const target = await mountScreen(true);
    tap(fillButton(warmupRow(target)));
    await settle(40);
    flushSync();

    expect(warmupRow(target).querySelector('input')?.value).toBe('7');
    expect(setField(1, 'reps')?.value ?? '').toBe('');
  });

  test('no history means no arrow', async () => {
    const target = await mountScreen(false);
    expect(target.querySelector('.last-time__fill')).toBeNull();
  });
});

/** One grid row. The grid test reads the keys the fill passes, not the draw. */
function gridRow(key: string, name: string): ActiveExerciseRow {
  return {
    key,
    keyBase: `w|${key}`,
    nodeKey: `w|${key}`,
    resultKey: `${key}|both|1`,
    path: [{ nodeId: 'root' }],
    exerciseId: 'x',
    exerciseName: name,
    prescriptionText: '8 reps',
    fields: [],
    lastTime: { kind: 'none', text: 'No history' },
    side: 'both',
    attempt: 1,
    status: 'completed',
    unresolved: false,
    recordable: true,
    level: 3,
    showCompactPath: false,
    compactPathLabel: '',
    hasSavedResult: true,
    unilateral: false,
    setNumber: 1,
    latestAttempt: true
  };
}

/** A two-exercise, two-set circuit drawn as the exercise-by-set grid. */
function circuitGrid(): ActiveSetTable {
  return {
    key: 'sets-w|superset',
    title: 'Superset A',
    sectionTitle: 'Strength',
    label: 'Working sets',
    level: 3,
    multiExercise: true,
    rounds: [],
    rows: [gridRow('a', 'Preacher Curl'), gridRow('b', 'Triceps Extension')],
    matrix: {
      columns: [
        { key: 'r1', label: 'Set 1', setNumber: 1 },
        { key: 'r2', label: 'Set 2', setNumber: 2 }
      ],
      rows: [
        {
          key: 'curl-line',
          exerciseName: 'Preacher Curl',
          prescriptionText: '8 reps',
          lastTime: {
            kind: 'value',
            text: '8 reps',
            fill: { reps: { value: 8, unit: 'reps' } }
          },
          cells: [
            { key: 'curl@r1', rows: [gridRow('a', 'Preacher Curl')] },
            { key: 'curl@r2', rows: [gridRow('c', 'Preacher Curl')] }
          ]
        },
        {
          key: 'ext-line',
          exerciseName: 'Triceps Extension',
          prescriptionText: '8 reps',
          lastTime: { kind: 'none', text: 'No history' },
          cells: [
            { key: 'ext@r1', rows: [gridRow('b', 'Triceps Extension')] },
            { key: 'ext@r2', rows: [gridRow('d', 'Triceps Extension')] }
          ]
        }
      ]
    }
  } as unknown as ActiveSetTable;
}

describe('fill in a circuit grid', () => {
  test('one line badge fills every set of that exercise', async () => {
    const seen: string[][] = [];
    const { target } = mountTo(ExerciseSetTable as never, {
      table: circuitGrid(),
      idPrefix: 'g',
      onfilllasttime: (keys: string[]) => seen.push(keys)
    });
    await settle(10);

    const line = Array.from(target.querySelectorAll('.set-matrix__line')).find((row) =>
      (row.querySelector('.set-matrix__exercise')?.textContent ?? '').includes('Preacher Curl')
    ) as HTMLElement;
    tap(fillButton(line));

    // Both sets of the curl, and nothing of the extension beside it.
    expect(seen).toEqual([['a', 'c']]);
  });

  test('a grid line with no history draws no arrow', async () => {
    const { target } = mountTo(ExerciseSetTable as never, {
      table: circuitGrid(),
      idPrefix: 'g2',
      onfilllasttime: () => {}
    });
    await settle(10);

    const line = Array.from(target.querySelectorAll('.set-matrix__line')).find((row) =>
      (row.querySelector('.set-matrix__exercise')?.textContent ?? '').includes('Triceps')
    ) as HTMLElement;
    expect(line.querySelector('.last-time__fill')).toBeNull();
  });

  test('a table with no fill handler draws no arrow at all', async () => {
    const { target } = mountTo(ExerciseSetTable as never, {
      table: circuitGrid(),
      idPrefix: 'g3'
    });
    await settle(10);

    expect(target.querySelector('.last-time__fill')).toBeNull();
  });
});
