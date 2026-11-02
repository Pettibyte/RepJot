import { afterEach, expect, test } from 'bun:test';
import SummaryTree from '../../src/ui/components/SummaryTree.svelte';
import type { SummaryExerciseRow, SummarySetTable } from '../../src/ui/viewmodels/summaryModel';
import { mountTo, teardown } from './harness';

afterEach(() => teardown());

function exercise(exerciseId: string, label: string): SummaryExerciseRow & { setNumber: number } {
  return {
    key: exerciseId, exerciseId, label,
    href: `#/exercises/${exerciseId}/history`,
    encodedPath: '', path: [], attempt: 1, setNumber: 1,
    status: 'completed', statusLabel: 'Completed', valuesLabel: '16 reps',
    unresolved: false, rawJson: '{}'
  };
}

const curl = exercise('Incline_Dumbbell_Curl', 'Incline Dumbbell Curl');
const extension = exercise('Dumbbell_One-Arm_Triceps_Extension', 'Dumbbell One-Arm Triceps Extension');

function table(multiExercise: boolean): SummarySetTable {
  const rows = multiExercise ? [curl, extension] : [curl];
  return {
    key: 'sets', title: multiExercise ? 'Superset A: Biceps and Triceps (Long Heads)' : curl.label,
    sectionTitle: 'Strength', label: 'Working sets', multiExercise,
    rows, rounds: [{ key: 'round-1', label: '', rows }],
    ...(multiExercise ? {
      matrix: {
        columns: [{ key: 'set-1', label: 'Set 1', setNumber: 1 }],
        rows: rows.map((row) => ({
          key: row.key, label: row.label, href: row.href,
          cells: [{ key: `${row.key}-1`, rows: [row] }]
        }))
      }
    } : {})
  };
}

test('superset exercise headers link to their own histories, not the superset title', () => {
  const { target } = mountTo(SummaryTree, { blocks: [{ kind: 'set-table', table: table(true) }] });
  expect(target.querySelector('.set-table__title a')).toBeNull();
  const links = Array.from(target.querySelectorAll('.set-matrix__name a'));
  expect(links.map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
    [curl.label, curl.href],
    [extension.label, extension.href]
  ]);
});

test('single-exercise set title keeps its history link', () => {
  const { target } = mountTo(SummaryTree, { blocks: [{ kind: 'set-table', table: table(false) }] });
  expect(target.querySelector('.set-table__title a')?.getAttribute('href')).toBe(curl.href);
});

test('matrix headers without a history address remain plain text', () => {
  const sets = table(true);
  delete sets.matrix!.rows[1].href;
  const { target } = mountTo(SummaryTree, { blocks: [{ kind: 'set-table', table: sets }] });
  const headers = target.querySelectorAll('.set-matrix__name');
  expect(headers[1].textContent).toContain(extension.label);
  expect(headers[1].querySelector('a')).toBeNull();
});
