// Active Workout input safety regressions.
//
// These tests exercise the real client component and session service. They
// protect three user-visible rules:
// - a prescription is guidance, not an entered result;
// - invalid text stays in the field for correction and never changes storage;
// - missing-work feedback leads back to the rows the user can act on.

import { afterEach, describe, expect, test } from 'bun:test';
import ActiveWorkoutScreen from '../../src/ui/screens/ActiveWorkoutScreen.svelte';
import type { ResultsShard, Session } from '../../src/domain/types';
import { createLookupService } from '../../src/indexes/lookup-service';
import { createSessionService, type SessionService } from '../../src/sessions/session-service';
import { setServices } from '../../src/services/registry';
import { SESSION_KEY, validShard } from '../fixtures/semantic';
import { SHARD_NAME } from '../fixtures/sync';
import {
  buttonWithText,
  flushSync,
  mountTo,
  settle,
  signIn,
  tap,
  teardown,
  type Harness
} from './harness';

const WARMUP_RESULT_KEY = 'root/warmup/warmup-squat|both|1';

let harness: Harness;
let sessionService: SessionService;

afterEach(() => {
  teardown();
});

/** Make the fixture editable while preserving its recorded results. */
function inProgressShard(empty = false): ResultsShard {
  const shard = validShard();
  const session = shard.sessions[SESSION_KEY];
  if (session === undefined) throw new Error('The session fixture is missing.');
  session.status = 'in_progress';
  delete session.completedAtUtc;
  if (empty) {
    session.exerciseResults = {};
    session.containerResults = {};
  }
  return shard;
}

async function mountWorkout(empty = false): Promise<HTMLElement> {
  const shard = inProgressShard(empty);
  harness = await signIn([{ name: SHARD_NAME, text: JSON.stringify(shard) }]);
  await harness.coordinator.ensureLoaded(SHARD_NAME);

  const lookup = createLookupService({ staticData: harness.staticData, shards: [shard] });
  sessionService = createSessionService({
    coordinator: harness.coordinator,
    staticData: harness.staticData,
    preferences: harness.preferences,
    lookup
  });
  setServices({ lookup, sessionService });

  const { target } = mountTo(ActiveWorkoutScreen, { sessionId: SESSION_KEY });
  await settle(16);
  flushSync();
  return target;
}

function firstExerciseRow(target: HTMLElement): HTMLElement {
  const row = target.querySelector('.exercise-row') as HTMLElement | null;
  if (row === null) throw new Error('No exercise row rendered.');
  return row;
}

function inputWithLabel(row: HTMLElement, label: string): HTMLInputElement {
  const field = Array.from(row.querySelectorAll('.value-input')).find(
    (candidate) => candidate.querySelector('.value-input__label')?.textContent?.trim() === label
  );
  const input = field?.querySelector('input') as HTMLInputElement | null | undefined;
  if (input == null) throw new Error(`No ${label} input rendered.`);
  return input;
}

function enter(input: HTMLInputElement, value: string): void {
  input.focus();
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
  input.dispatchEvent(new Event('blur'));
  flushSync();
}

describe('new actual-work fields', () => {
  test('show prescriptions as guidance without prefilling the editable values', async () => {
    const target = await mountWorkout(true);
    const row = firstExerciseRow(target);

    // The target remains visible, but it is not silently turned into actual work.
    expect(row.querySelector('.exercise-row__prescription')?.textContent).toContain('10 reps');
    expect(inputWithLabel(row, 'Reps').value).toBe('');
    expect(inputWithLabel(row, 'Weight').value).toBe('');

    const session = await sessionService.load(SESSION_KEY);
    expect(Object.keys(session.exerciseResults)).toHaveLength(0);
  });
});

describe('invalid actual-work fields', () => {
  async function expectRejectedEdit(label: string, value: string, dimension: 'reps' | 'weight') {
    const target = await mountWorkout();
    const input = inputWithLabel(firstExerciseRow(target), label);
    const before = await sessionService.load(SESSION_KEY);
    const beforeResult = structuredClone(before.exerciseResults[WARMUP_RESULT_KEY]);

    enter(input, value);
    await settle(24);
    flushSync();

    // Validation belongs to the field, not to a page-level save failure.
    expect(input.value).toBe(value);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const describedBy = input.getAttribute('aria-describedby') ?? '';
    const errorId = describedBy.split(/\s+/).find((id) => id.includes('error'));
    expect(errorId).toBeDefined();
    expect(errorId === undefined ? null : document.getElementById(errorId)?.textContent?.trim()).toBeTruthy();

    // Invalid input must neither replace the quantity nor clear it as if blank.
    const after = await sessionService.load(SESSION_KEY);
    expect(after.exerciseResults[WARMUP_RESULT_KEY]).toEqual(beforeResult);
    expect(after.exerciseResults[WARMUP_RESULT_KEY]?.values?.[dimension]).toEqual(
      before.exerciseResults[WARMUP_RESULT_KEY]?.values?.[dimension]
    );
    expect(harness.drive.calls.some((call) => call.startsWith('updateFile:'))).toBe(false);
  }

  test('malformed text is marked and does not save or clear the recorded value', async () => {
    await expectRejectedEdit('Weight', 'not-a-number', 'weight');
  });

  test('a negative number is marked and does not save or clear the recorded value', async () => {
    await expectRejectedEdit('Reps', '-1', 'reps');
  });
});

describe('missing-work feedback', () => {
  test('identifies actionable work, marks its rows, and returns focus to the first field', async () => {
    const target = await mountWorkout(true);
    const finish = buttonWithText(target, 'Finish Workout');
    if (finish === undefined) throw new Error('Finish Workout did not render.');

    tap(finish);
    await settle(24);
    flushSync();

    const prompt = target.querySelector('.finish-bar__prompt') as HTMLElement | null;
    expect(prompt).not.toBeNull();
    // A path alone can be shared by several exercises. Name the exercise too.
    expect(prompt?.querySelector('.finish-bar__item')?.textContent).toContain('Back Squat');

    const markedRows = target.querySelectorAll(
      '.exercise-row--missing, .exercise-row[data-missing-work="true"]'
    );
    expect(markedRows.length).toBeGreaterThan(0);

    const returnButton = buttonWithText(target, 'Return to workout');
    if (returnButton === undefined) throw new Error('Return to workout did not render.');
    tap(returnButton);
    await settle(8);
    flushSync();

    const firstMarkedInput = markedRows[0]?.querySelector('input') as HTMLInputElement | null;
    expect(firstMarkedInput).not.toBeNull();
    expect(document.activeElement).toBe(firstMarkedInput);
  });
});
