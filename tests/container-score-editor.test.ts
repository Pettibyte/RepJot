// The container score editor.
// Phase 17. REQUIREMENTS 10.17, 10.18, 10.23.

import { describe, expect, test } from 'bun:test';

import ContainerScoreEditor from '../src/ui/components/ContainerScoreEditor.svelte';
import type { GroupModel } from '../src/ui/viewmodels/activeWorkoutModel';
import { html as renderHtml } from './support/render';

function scoreGroup(overrides: Partial<GroupModel> = {}): GroupModel {
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

describe('ContainerScoreEditor', () => {
  test('the label names the number to type for each score kind', () => {
    const rounds = renderHtml(ContainerScoreEditor, { group: scoreGroup() });
    expect(rounds).toContain('Rounds completed');

    const cycles = renderHtml(ContainerScoreEditor, {
      group: scoreGroup({ scoreType: 'cycles' })
    });
    expect(cycles).toContain('Cycles completed');

    const intervals = renderHtml(ContainerScoreEditor, {
      group: scoreGroup({ scoreType: 'intervals' })
    });
    expect(intervals).toContain('Intervals completed');
  });

  test('an unknown score kind falls back to the container title', () => {
    const html = renderHtml(ContainerScoreEditor, {
      group: scoreGroup({ scoreType: undefined, title: 'Finisher' })
    });
    expect(html).toContain('Finisher score');
  });

  test('the field carries the typed score and a numeric pad', () => {
    const html = renderHtml(ContainerScoreEditor, {
      group: scoreGroup(),
      scoreText: '21'
    });
    expect(html).toContain('value="21"');
    expect(html).toContain('inputmode="numeric"');
  });

  test('saved child detail makes the score read-only and says why', () => {
    // Saved detail decides the score, so this box must not write it. A
    // typed value here would be thrown away on the next derive.
    // REQUIREMENT 10.17.
    const html = renderHtml(ContainerScoreEditor, {
      group: scoreGroup({ hasSavedDetail: true }),
      scoreText: '21'
    });
    const input = html.slice(html.indexOf('<input'), html.indexOf('>', html.indexOf('<input')));
    expect(input).toContain('disabled');
    expect(html).toContain('Set by the recorded detail below.');
  });

  test('a container without saved detail keeps the field live', () => {
    const html = renderHtml(ContainerScoreEditor, { group: scoreGroup() });
    const input = html.slice(html.indexOf('<input'), html.indexOf('>', html.indexOf('<input')));
    expect(input).not.toContain('disabled');
    expect(html).not.toContain('Set by the recorded detail below.');
  });

  test('a nonstandard score shows the Detailed marker', () => {
    // REQUIREMENT 10.18: the marker reads off the score discriminator.
    const html = renderHtml(ContainerScoreEditor, {
      group: scoreGroup({ detailed: true })
    });
    expect(html).toContain('Detailed');
    expect(html).toContain('badge--outline');
  });

  test('a standard score shows no marker', () => {
    const html = renderHtml(ContainerScoreEditor, { group: scoreGroup() });
    expect(html).not.toContain('Detailed');
  });

  test('an external disabled flag locks the field', () => {
    const html = renderHtml(ContainerScoreEditor, {
      group: scoreGroup(),
      disabled: true
    });
    const input = html.slice(html.indexOf('<input'), html.indexOf('>', html.indexOf('<input')));
    expect(input).toContain('disabled');
  });

  test('the label is bound to the field for assistive tech', () => {
    const html = renderHtml(ContainerScoreEditor, { group: scoreGroup() });
    const forMatch = html.match(/for="([^"]+)"/);
    const idMatch = html.match(/id="([^"]+)"/);
    expect(forMatch).not.toBeNull();
    expect(idMatch).not.toBeNull();
    expect(forMatch?.[1]).toBe(idMatch?.[1]);
  });
});
