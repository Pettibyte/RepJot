// F-1: the Exercise Units pills must actually move.
//
// The audit found that tapping a pill saved the preference but never changed
// what the pill showed, and that the cycle read its "current" unit from the
// stale row so every tap wrote the same value again. The user could not get
// an exercise back to its other unit from Settings.
//
// REQUIREMENTS 12.3, 12.4, 19.6.

import { afterEach, describe, expect, test } from 'bun:test';
import ExerciseUnitsSection from '../../src/ui/components/ExerciseUnitsSection.svelte';
import type { Exercise } from '../../src/domain/types';
import {
  drainTimers,
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

/** The first pill in the first row. Back Squat sorts first. */
function firstPill(target: HTMLElement): HTMLButtonElement {
  const pill = target.querySelector('button.unit-pill') as HTMLButtonElement | undefined;
  if (pill === undefined) throw new Error('No unit pill rendered.');
  return pill;
}

function mountSection(exercises: Exercise[] = harness.staticData.exercises): HTMLElement {
  const { target } = mountTo(ExerciseUnitsSection, {
    preferences: harness.preferences,
    exercises
  });
  return target;
}

/**
 * An exercise whose distance dimension lists four units.
 *
 * Back Squat only has lb and kg, so a correct two-way cycle still shows just
 * two distinct labels. A four-unit dimension is what makes "the cycle moves"
 * a check with room to fail.
 */
function fourUnitRow(): Exercise {
  return {
    id: 'farmers-carry',
    name: "Farmers Carry",
    instructions: ['Walk with the weight.'],
    equipment: 'dumbbell',
    force: 'static',
    mechanic: 'compound',
    category: 'strength',
    level: 'beginner',
    movementPattern: 'locomotion',
    primaryMuscles: ['forearms'],
    secondaryMuscles: [],
    laterality: 'bilateral',
    measurements: [
      { dimension: 'reps', compatibleUnits: ['reps'] },
      { dimension: 'distance', compatibleUnits: ['m', 'km', 'ft', 'mi'] }
    ],
    loadSemantics: 'total'
  };
}

describe('the unit pill updates on tap', () => {
  test('the label changes on the first tap', async () => {
    harness = await signIn([{ name: 'preferences.json', text: prefsDoc() }]);
    const target = mountSection();

    const before = firstPill(target).textContent?.trim();
    tap(firstPill(target));

    expect(firstPill(target).textContent?.trim()).not.toBe(before);
  });

  test('the accessible name changes on the first tap', async () => {
    harness = await signIn([{ name: 'preferences.json', text: prefsDoc() }]);
    const target = mountSection();

    const before = firstPill(target).getAttribute('aria-label');
    tap(firstPill(target));
    const after = firstPill(target).getAttribute('aria-label');

    expect(after).not.toBe(before);
    expect(after).toContain('Currently kg');
  });

  test('the rendered unit and the service agree after every tap', async () => {
    harness = await signIn([{ name: 'preferences.json', text: prefsDoc() }]);
    await harness.preferences.ensureDoc();
    const target = mountSection();

    for (const expected of ['kg', 'lb', 'kg']) {
      tap(firstPill(target));
      // The paint is immediate and the save is not. Asserting the pair
      // without this would compare a rendered value against a write that has
      // not landed, and pass on a stale service read.
      await settle(12);

      expect(firstPill(target).textContent?.trim()).toBe(expected);
      expect(harness.preferences.getUnit('back-squat', 'weight')).toBe(expected);
    }
  });
});

describe('the unit cycle is not stuck', () => {
  test('three taps produce more than two distinct rendered values', async () => {
    harness = await signIn([{ name: 'preferences.json', text: prefsDoc() }]);
    const target = mountSection([fourUnitRow()]);

    const seen = new Set<string>();
    seen.add(firstPill(target).textContent?.trim() ?? '');
    for (let i = 0; i < 3; i += 1) {
      tap(firstPill(target));
      seen.add(firstPill(target).textContent?.trim() ?? '');
    }

    // m -> km -> ft -> mi. The stuck cycle produced two.
    expect(seen.size).toBeGreaterThan(2);
    expect(Array.from(seen)).toEqual(['m', 'km', 'ft', 'mi']);
  });

  test('a tap writes the new unit, not the same unit again', async () => {
    harness = await signIn([{ name: 'preferences.json', text: prefsDoc() }]);
    await harness.preferences.ensureDoc();
    const target = mountSection();

    tap(firstPill(target));
    await drainTimers(harness.timers);
    expect(harness.preferences.getUnit('back-squat', 'weight')).toBe('kg');

    tap(firstPill(target));
    await drainTimers(harness.timers);
    expect(harness.preferences.getUnit('back-squat', 'weight')).toBe('lb');
  });

  test('a row the user never tapped still shows the stored value', async () => {
    harness = await signIn([
      {
        name: 'preferences.json',
        text: prefsDoc({ 'back-squat': { weight: 'kg' } })
      }
    ]);
    await harness.preferences.ensureDoc();
    const target = mountSection();

    expect(firstPill(target).textContent?.trim()).toBe('kg');
  });
});
