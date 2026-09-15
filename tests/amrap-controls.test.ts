// AMRAP and EMOM controls.
// Phase 17. REQUIREMENTS 10.9, 10.10, 10.19-10.22.

import { describe, expect, test } from 'bun:test';

import AmrapControls from '../src/ui/components/AmrapControls.svelte';
import EmomControls from '../src/ui/components/EmomControls.svelte';
import type { GroupModel } from '../src/ui/viewmodels/activeWorkoutModel';
import { html as renderHtml } from './support/render';

function amrapGroup(overrides: Partial<GroupModel> = {}): GroupModel {
  return {
    key: 'w|cindy|1',
    nodeKey: 'w|cindy',
    containerNodeId: 'cindy',
    storedPath: 'root/cindy',
    title: 'Cindy',
    level: 2,
    showCompactPath: false,
    compactPathLabel: 'root / Cindy',
    strategy: 'amrap',
    summaryText: 'AMRAP 20 min',
    scored: true,
    scoreType: 'rounds_and_reps',
    childDetail: 'optional',
    detailed: false,
    hasSavedDetail: false,
    canExpand: false,
    isAmrap: true,
    isEmom: false,
    totalIntervals: 0,
    rowKeys: [],
    ...overrides
  };
}

function emomGroup(overrides: Partial<GroupModel> = {}): GroupModel {
  return {
    key: 'w|emom|1',
    nodeKey: 'w|emom',
    containerNodeId: 'emom',
    storedPath: 'root/emom',
    title: 'EMOM',
    level: 2,
    showCompactPath: false,
    compactPathLabel: 'root / EMOM',
    strategy: 'emom',
    summaryText: 'EMOM 12 min',
    scored: true,
    scoreType: 'intervals',
    childDetail: 'optional',
    detailed: false,
    hasSavedDetail: false,
    canExpand: false,
    isAmrap: false,
    isEmom: true,
    totalIntervals: 12,
    rowKeys: [],
    ...overrides
  };
}

describe('AmrapControls', () => {
  test('an AMRAP with child detail offers Add round', () => {
    const html = renderHtml(AmrapControls, { group: amrapGroup() });
    expect(html).toContain('Add round');
    // The icon carries its own label, so the button reads as an action and
    // not a bare glyph.
    expect(html).toContain('aria-label="Add one completed round"');
  });

  test('a container with no child detail cannot add a round', () => {
    // `childDetail: none` means the container keeps no per-child record, so
    // there is nothing to add a round of. REQUIREMENT 10.10.
    const html = renderHtml(AmrapControls, {
      group: amrapGroup({ childDetail: 'none' })
    });
    expect(html).not.toContain('Add round');
  });

  test('an unscored container offers nothing', () => {
    const html = renderHtml(AmrapControls, {
      group: amrapGroup({ scored: false, scoreType: undefined })
    });
    expect(html).not.toContain('Add round');
    expect(html).not.toContain('Extra reps');
  });

  test('the partial field stays live once saved detail exists', () => {
    // The `+` writes child results, so hiding the partial field on saved
    // detail would remove it after the first tap. The normal AMRAP flow
    // uses both controls, and the save keeps the round count already on
    // file. REQUIREMENTS 19.7, 19.8.
    const html = renderHtml(AmrapControls, { group: amrapGroup({ hasSavedDetail: true }) });
    expect(html).toContain('Extra reps');
    expect(html).toContain('Add round');
  });

  test('the partial field carries the typed value and a numeric pad', () => {
    const html = renderHtml(AmrapControls, { group: amrapGroup(), additionalReps: '7' });
    expect(html).toContain('value="7"');
    expect(html).toContain('inputmode="numeric"');
  });

  test('a busy control disables the add button', () => {
    const html = renderHtml(AmrapControls, { group: amrapGroup(), busy: true });
    const button = html.slice(html.indexOf('<button'), html.indexOf('</button>'));
    expect(button).toContain('disabled');
    expect(html).toContain('Adding');
  });
});

describe('EmomControls', () => {
  test('the field names the total so the user knows the target', () => {
    const html = renderHtml(EmomControls, { group: emomGroup() });
    expect(html).toContain('Intervals completed of 12');
  });

  test('an unbounded EMOM omits the total', () => {
    const html = renderHtml(EmomControls, {
      group: emomGroup({ totalIntervals: 0 })
    });
    expect(html).toContain('Intervals completed');
    expect(html).not.toContain('of 0');
  });

  test('the field takes a whole number', () => {
    const html = renderHtml(EmomControls, { group: emomGroup(), completed: '9' });
    expect(html).toContain('inputmode="numeric"');
    expect(html).toContain('value="9"');
  });

  test('saved detail locks the field and says why', () => {
    const html = renderHtml(EmomControls, {
      group: emomGroup({ hasSavedDetail: true }),
      completed: '12'
    });
    const input = html.slice(html.indexOf('<input'), html.indexOf('>', html.indexOf('<input')));
    expect(input).toContain('disabled');
    expect(html).toContain('Set by the recorded detail below.');
  });

  test('an unlocked field is editable', () => {
    const html = renderHtml(EmomControls, { group: emomGroup() });
    const input = html.slice(html.indexOf('<input'), html.indexOf('>', html.indexOf('<input')));
    expect(input).not.toContain('disabled');
  });
});
