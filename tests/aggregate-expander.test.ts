// The aggregate expander.
// Phase 17. REQUIREMENTS 10.11-10.16.

import { describe, expect, test } from 'bun:test';

import AggregateExpander from '../src/ui/components/AggregateExpander.svelte';
import type { GroupModel } from '../src/ui/viewmodels/activeWorkoutModel';
import type { DraftChild } from '../src/sessions/draft-expansion';
import { html as renderHtml } from './support/render';

function group(overrides: Partial<GroupModel> = {}): GroupModel {
  return {
    key: 'w|inner-amrap|1',
    nodeKey: 'w|inner-amrap',
    containerNodeId: 'inner-amrap',
    storedPath: 'root/outer-ring:1/inner-amrap',
    title: 'AMRAP',
    level: 3,
    showCompactPath: false,
    compactPathLabel: 'root / outer-ring / Round 1 / inner-amrap',
    strategy: 'amrap',
    summaryText: 'AMRAP 10 min',
    scored: true,
    scoreType: 'rounds_and_reps',
    detailed: false,
    hasSavedDetail: false,
    canExpand: true,
    isAmrap: true,
    isEmom: false,
    totalIntervals: 0,
    rowKeys: [],
    ...overrides
  };
}

function drafts(): DraftChild[] {
  return [
    {
      draft: {
        exerciseId: 'push-up',
        status: 'completed',
        values: { reps: { value: 10, unit: 'reps' } }
      },
      inferred: true
    },
    {
      draft: {
        exerciseId: 'sit-up',
        status: 'completed',
        values: { reps: { value: 15, unit: 'reps' } }
      },
      inferred: true
    }
  ];
}

describe('AggregateExpander', () => {
  test('a closed expander offers the expand action and shows no drafts', () => {
    const html = renderHtml(AggregateExpander, {
      group: group(),
      drafts: [],
      expanded: false
    });

    expect(html).toContain('Expand detail');
    expect(html).not.toContain('Inferred');
  });

  test('every draft row carries the Inferred label', () => {
    const html = renderHtml(AggregateExpander, {
      group: group(),
      drafts: drafts(),
      expanded: true
    });

    // Both draft rows are marked. A user must never mistake derived numbers
    // for recorded work. REQUIREMENT 10.14.
    const matches = html.match(/aggregate-draft__label"[^>]*>Inferred</g) ?? [];
    expect(matches.length).toBe(2);
  });

  test('the expanded box says the values are not recorded work', () => {
    const html = renderHtml(AggregateExpander, {
      group: group(),
      drafts: drafts(),
      expanded: true
    });

    expect(html).toContain('not recorded work until you save them');
  });

  test('the save action appears only when drafts exist', () => {
    const withDrafts = renderHtml(AggregateExpander, {
      group: group(),
      drafts: drafts(),
      expanded: true
    });
    expect(withDrafts).toContain('Save inferred detail');

    const empty = renderHtml(AggregateExpander, {
      group: group(),
      drafts: [],
      expanded: true
    });
    expect(empty).not.toContain('Save inferred detail');
    expect(empty).toContain('No detail could be derived.');
  });

  test('a busy expander disables both actions', () => {
    const html = renderHtml(AggregateExpander, {
      group: group(),
      drafts: drafts(),
      expanded: true,
      busy: true
    });

    expect(html).toContain('disabled');
    // The save button must not stay live while a save runs.
    const saveIndex = html.indexOf('Save inferred detail');
    expect(saveIndex).toBeGreaterThan(-1);
    const before = html.slice(0, saveIndex);
    expect(before.slice(before.lastIndexOf('<button'))).toContain('disabled');
  });

  test('the draft quantities are shown', () => {
    const html = renderHtml(AggregateExpander, {
      group: group(),
      drafts: drafts(),
      expanded: true
    });
    expect(html).toContain('10 reps');
    expect(html).toContain('15 reps');
  });
});
