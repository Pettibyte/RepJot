// The Last Time badge.
// Phase 17. REQUIREMENTS 19.1-19.5.

import { describe, expect, test } from 'bun:test';

import LastTimeBadge from '../src/ui/components/LastTimeBadge.svelte';
import type { LastTimeModel } from '../src/ui/viewmodels/activeWorkoutModel';
import { html as renderHtml } from './support/render';

describe('LastTimeBadge', () => {
  test('shows the last recorded values', () => {
    const lastTime: LastTimeModel = {
      kind: 'value',
      text: '225 lb',
      sessionId: 's-old',
      dateLabel: 'Aug 12'
    };

    const html = renderHtml(LastTimeBadge, { lastTime, exerciseName: 'Back Squat' });

    expect(html).toContain('225 lb');
    expect(html).toContain('last-time');
    expect(html).toContain('Aug 12');
  });

  test('the accessible name says whose history it is', () => {
    const lastTime: LastTimeModel = { kind: 'value', text: '225 lb' };
    const html = renderHtml(LastTimeBadge, { lastTime, exerciseName: 'Back Squat' });

    // A screen reader must not read four identical badges on one screen.
    expect(html).toContain('Back Squat');
    expect(html).toContain('Last time');
  });

  test('no history reads as no history', () => {
    const lastTime: LastTimeModel = { kind: 'none', text: 'No history' };
    const html = renderHtml(LastTimeBadge, { lastTime, exerciseName: 'Back Squat' });

    expect(html).toContain('No history');
    expect(html).toContain('last-time--none');
  });

  test('a badge is not a control', () => {
    const lastTime: LastTimeModel = { kind: 'value', text: '12 reps', sessionId: 's-old' };
    const html = renderHtml(LastTimeBadge, { lastTime, exerciseName: 'Push Up' });

    // The badge reports. It does not act, navigate, or take focus.
    expect(html).not.toContain('<button');
    expect(html).not.toContain('<a ');
    expect(html).not.toContain('tabindex');
  });

  test('a badge carries no inline color, shadow, or radius', () => {
    const lastTime: LastTimeModel = { kind: 'value', text: '12 reps' };
    const html = renderHtml(LastTimeBadge, { lastTime, exerciseName: 'Push Up' });
    expect(html).not.toMatch(/style="[^"]*(color|shadow|radius)/);
  });

  test('a badge with no date still reads', () => {
    const lastTime: LastTimeModel = { kind: 'value', text: '100 kg' };
    const html = renderHtml(LastTimeBadge, { lastTime, exerciseName: 'Deadlift' });
    expect(html).toContain('100 kg');
    // No stray date separator when no date is known.
    expect(html).not.toContain('Last time :');
  });
});
