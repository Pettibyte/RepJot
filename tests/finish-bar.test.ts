// The Finish Workout bar.
// Phase 17. REQUIREMENTS 15.1-15.8.

import { describe, expect, test } from 'bun:test';

import FinishWorkoutBar from '../src/ui/components/FinishWorkoutBar.svelte';
import type { MissingWorkItem } from '../src/sessions/session-service';
import { html as renderHtml } from './support/render';

function missing(): MissingWorkItem[] {
  return [
    {
      nodeKey: 'w|back-squat-set',
      compactPathLabel: 'Strength / Sets / Round 2',
      reason: 'no_result'
    },
    {
      nodeKey: 'w|bench-set',
      compactPathLabel: 'Strength / Bench / Round 1',
      reason: 'incomplete'
    }
  ];
}

describe('FinishWorkoutBar', () => {
  test('the closed bar offers Finish and Abandon', () => {
    const html = renderHtml(FinishWorkoutBar, { missing: [], promptOpen: false });

    expect(html).toContain('Finish Workout');
    expect(html).toContain('Abandon workout');
    expect(html).not.toContain('Return to workout');
  });

  test('missing prescribed work produces both Return and Finish as incomplete', () => {
    const html = renderHtml(FinishWorkoutBar, { missing: missing(), promptOpen: true });

    // The user must be able to go back and fill the gap, or finish anyway.
    // REQUIREMENT 15.4.
    expect(html).toContain('Return to workout');
    expect(html).toContain('Finish as incomplete');
  });

  test('the prompt names each missing item and why', () => {
    const html = renderHtml(FinishWorkoutBar, { missing: missing(), promptOpen: true });

    expect(html).toContain('Strength / Sets / Round 2');
    expect(html).toContain('Strength / Bench / Round 1');
    expect(html).toContain('2 items are not recorded');
  });

  test('one missing item reads as singular', () => {
    const html = renderHtml(FinishWorkoutBar, {
      missing: [missing()[0]],
      promptOpen: true
    });
    expect(html).toContain('1 item is not recorded');
  });

  test('the prompt warns that gaps are kept', () => {
    const html = renderHtml(FinishWorkoutBar, { missing: missing(), promptOpen: true });
    expect(html).toContain('keeps these gaps');
  });

  test('a busy bar disables every action', () => {
    const html = renderHtml(FinishWorkoutBar, {
      missing: missing(),
      promptOpen: true,
      busy: true
    });

    const buttons = html.match(/<button[^>]*>/g) ?? [];
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      expect(button).toContain('disabled');
    }
  });

  test('an empty path label still reads as the workout', () => {
    const html = renderHtml(FinishWorkoutBar, {
      missing: [{ nodeKey: 'w|root', compactPathLabel: '', reason: 'no_result' }],
      promptOpen: true
    });
    expect(html).toContain('Workout');
  });

  test('a closed bar with missing work shows no prompt', () => {
    // The prompt only appears after the user presses Finish. A bar that
    // warned on every render would nag.
    const html = renderHtml(FinishWorkoutBar, { missing: missing(), promptOpen: false });
    expect(html).not.toContain('not recorded');
    expect(html).toContain('Finish Workout');
  });
});
