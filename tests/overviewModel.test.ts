// Tests for the workout overview view model.
// PHASE-16 checklist: every node carries a depth and a prescription string, an
// iteration override shows the effective value for each iteration, and an
// unknown workout produces no model.

import { describe, expect, test } from 'bun:test';

import type { Exercise } from '../src/domain/types';
import {
  buildOverviewModel,
  formatPrescription,
  workoutSectionLabel
} from '../src/ui/viewmodels/overviewModel';
import { exercises, workout } from './fixtures/semantic';

function exerciseIndex(list: Exercise[]): Map<string, Exercise> {
  return new Map(list.map((exercise) => [exercise.id, exercise]));
}

describe('buildOverviewModel: shape', () => {
  const model = buildOverviewModel(workout(), { exerciseById: exerciseIndex(exercises()) });

  test('every node carries a depth and a prescription string', () => {
    expect(model).not.toBeNull();
    if (model === null) return;
    expect(model.nodes.length).toBeGreaterThan(0);
    for (const node of model.nodes) {
      expect(Number.isInteger(node.depth)).toBe(true);
      expect(node.depth).toBeGreaterThanOrEqual(1);
      expect(typeof node.prescriptionText).toBe('string');
      expect(typeof node.label).toBe('string');
      expect(node.label.length).toBeGreaterThan(0);
    }
  });

  test('the root sits at depth 1 and children sit deeper', () => {
    if (model === null) return;
    expect(model.nodes[0].depth).toBe(1);
    expect(model.nodes.some((node) => node.depth >= 3)).toBe(true);
  });

  test('the title is the workout name', () => {
    expect(model?.title).toBe('Demo Workout');
  });

  test('an exercise row links to its history', () => {
    if (model === null) return;
    const row = model.nodes.find((node) => node.isExercise && node.label === 'Back Squat');
    expect(row?.exerciseHref).toBe('#/exercises/back-squat/history');
  });

  test('a container row carries no exercise link', () => {
    if (model === null) return;
    const cindy = model.nodes.find((node) => node.label === 'Cindy');
    expect(cindy?.isExercise).toBe(false);
    expect(cindy?.exerciseHref).toBeUndefined();
  });
});

describe('buildOverviewModel: container summaries', () => {
  const model = buildOverviewModel(workout(), { exerciseById: exerciseIndex(exercises()) });

  test('an AMRAP names its duration', () => {
    const cindy = model?.nodes.find((node) => node.label === 'Cindy');
    expect(cindy?.prescriptionText).toBe('AMRAP 20 min');
  });

  test('an EMOM names its cycles and interval', () => {
    const emomRow = model?.nodes.find((node) => node.prescriptionText.startsWith('EMOM'));
    expect(emomRow?.prescriptionText).toBe('EMOM 4 x 1 min');
    expect(emomRow?.isExercise).toBe(false);
  });

  test('a rounds container names its round count', () => {
    const rounds = model?.nodes.find((node) => node.prescriptionText === '3 rounds');
    expect(rounds?.isExercise).toBe(false);
  });

  test('a complex names its cycle count', () => {
    const complex = model?.nodes.find((node) => node.prescriptionText === '5 cycles');
    expect(complex?.isExercise).toBe(false);
  });

  test('a sequence carries no summary', () => {
    const root = model?.nodes[0];
    expect(root?.prescriptionText).toBe('');
  });
});

describe('buildOverviewModel: semantic presentation', () => {
  const model = buildOverviewModel(workout(), { exerciseById: exerciseIndex(exercises()) });

  test('repeated exercise rounds become one compact set table', () => {
    if (model === null) throw new Error('expected a model');
    const table = model.blocks.find(
      (block) => block.kind === 'set-table' && block.table.title === 'Back Squat'
    );
    expect(table?.kind).toBe('set-table');
    if (table?.kind !== 'set-table') return;
    expect(table.table.sectionTitle).toBe('Strength');
    expect(table.table.rows.map((row) => row.setNumber)).toEqual([1, 2, 3]);
    expect(table.table.rows[2]?.prescriptionText).toContain('@ 110 lb');
  });

  test('conditioning containers carry a semantic section divider', () => {
    if (model === null) throw new Error('expected a model');
    const cindy = model.blocks.find(
      (block) => block.kind === 'group' && block.node.label === 'Cindy'
    );
    expect(cindy?.kind === 'group' ? cindy.sectionTitle : undefined).toBe('Conditioning');
  });

  test('a repeated circuit becomes one table grouped by round', () => {
    const circuitWorkout = {
      id: 'circuit-w',
      name: 'Circuit Day',
      publishedStatus: 'live',
      root: {
        id: 'croot',
        type: 'container',
        strategy: 'sequence',
        strategyConfig: {},
        children: [
          {
            id: 'csup',
            type: 'container',
            name: 'Superset A',
            strategy: 'rounds',
            strategyConfig: { rounds: 2 },
            children: [
              {
                id: 'ccurl',
                type: 'exercise',
                exerciseId: 'back-squat',
                stimulus: 'hypertrophy',
                setType: 'working',
                prescription: { reps: 8 }
              },
              {
                id: 'cext',
                type: 'exercise',
                exerciseId: 'back-squat',
                stimulus: 'hypertrophy',
                setType: 'working',
                prescription: { reps: 10 }
              }
            ]
          }
        ]
      }
    } as never;

    const circuitModel = buildOverviewModel(circuitWorkout, {
      exerciseById: exerciseIndex(exercises())
    });
    expect(circuitModel).not.toBeNull();
    if (circuitModel === null) return;

    const tables = circuitModel.blocks.filter((block) => block.kind === 'set-table');
    expect(tables).toHaveLength(1);
    if (tables[0]?.kind !== 'set-table') return;
    expect(tables[0].table.multiExercise).toBe(true);
    // The container names the table, because one heading cannot name both.
    expect(tables[0].table.title).toBe('Superset A');
    expect(tables[0].table.rounds.map((round) => round.label)).toEqual(['Round 1', 'Round 2']);
    expect(tables[0].table.rounds.map((round) => round.rows.length)).toEqual([2, 2]);
    // No loose exercise rows are left behind.
    expect(circuitModel.blocks.filter((block) => block.kind === 'exercise')).toHaveLength(0);
  });

  test('a scored rounds container does not collapse into a table', () => {
    const scoredWorkout = {
      id: 'scored-w',
      name: 'Scored Day',
      publishedStatus: 'live',
      root: {
        id: 'sroot',
        type: 'container',
        strategy: 'sequence',
        strategyConfig: {},
        children: [
          {
            id: 'sblk',
            type: 'container',
            name: 'Row Block',
            strategy: 'rounds',
            strategyConfig: { rounds: 3 },
            resultCapture: { mode: 'scored', scoreType: 'distance', childDetail: 'optional' },
            children: [
              {
                id: 'srow',
                type: 'exercise',
                exerciseId: 'back-squat',
                stimulus: 'conditioning',
                setType: 'working',
                prescription: { reps: 8 }
              }
            ]
          }
        ]
      }
    } as never;

    const scoredModel = buildOverviewModel(scoredWorkout, {
      exerciseById: exerciseIndex(exercises())
    });
    expect(scoredModel).not.toBeNull();
    if (scoredModel === null) return;
    // The container keeps its own heading, so its score reads in place.
    expect(scoredModel.blocks.filter((block) => block.kind === 'set-table')).toHaveLength(0);
    expect(scoredModel.blocks.some((block) => block.kind === 'group')).toBe(true);
  });

  test('the unnamed sequence root does not add a decorative nesting level', () => {
    if (model === null) throw new Error('expected a model');
    expect(model.blocks.some(
      (block) => block.kind === 'group' && block.node.label === 'Sequence' && block.node.depth === 1
    )).toBe(false);
  });

  test('all workout categories share one section-label rule', () => {
    expect(workoutSectionLabel('warmup', 'strength')).toBe('Warmup');
    expect(workoutSectionLabel('working', 'strength')).toBe('Strength');
    expect(workoutSectionLabel(undefined, 'conditioning')).toBe('Conditioning');
  });
});

describe('buildOverviewModel: iteration overrides', () => {
  test('each round shows the weight that applies to it', () => {
    // The fixture prescribes 100 lb for three rounds and overrides round 3 to
    // 110 lb. The model must show 100, 100, 110 rather than one value thrice.
    const model = buildOverviewModel(workout(), { exerciseById: exerciseIndex(exercises()) });
    if (model === null) throw new Error('expected a model');

    const squatSets = model.nodes.filter(
      (node) => node.isExercise && node.label === 'Back Squat' && node.prescriptionText.includes('@ 1')
    );

    const weights = squatSets.map((node) => node.prescriptionText);
    expect(weights.filter((text) => text.includes('@ 100 lb')).length).toBe(2);
    expect(weights.filter((text) => text.includes('@ 110 lb')).length).toBe(1);
  });
});

describe('buildOverviewModel: unknown workout', () => {
  test('an absent workout produces no model', () => {
    expect(buildOverviewModel(undefined, { exerciseById: new Map() })).toBeNull();
    expect(buildOverviewModel(null, { exerciseById: new Map() })).toBeNull();
  });

  test('an exercise missing from the directory is marked, not dropped', () => {
    const model = buildOverviewModel(workout(), { exerciseById: new Map() });
    if (model === null) throw new Error('expected a model');

    const unresolved = model.nodes.filter((node) => node.unresolved === true);
    expect(unresolved.length).toBeGreaterThan(0);
    // The row still names what it refers to, through the raw exercise id.
    expect(unresolved.map((node) => node.label)).toContain('back-squat');
    expect(unresolved.every((node) => node.exerciseHref === undefined)).toBe(true);
  });
});

describe('formatPrescription', () => {
  test('a plain rep count', () => {
    expect(formatPrescription({ reps: 8 })).toBe('8 reps');
  });

  test('an approximate target carries the tilde', () => {
    expect(formatPrescription({ reps: { target: 8, qualifier: 'approximate' } })).toBe('~8 reps');
  });

  test('a range shows both bounds', () => {
    expect(formatPrescription({ reps: { min: 5, max: 8 } })).toBe('5-8 reps');
  });

  test('work, load, and effort read in that order', () => {
    expect(
      formatPrescription({
        reps: 5,
        weight: { value: 225, unit: 'lb' },
        effort: { type: 'rir', target: 2 }
      })
    ).toBe('5 reps @ 225 lb RIR 2');
  });

  test('failure reads as words, not a number', () => {
    expect(formatPrescription({ reps: { target: 10, qualifier: 'approximate' }, effort: { type: 'failure' } })).toBe(
      '~10 reps to failure'
    );
  });

  test('added weight carries a plus sign', () => {
    expect(formatPrescription({ reps: 10, addedWeight: { value: 25, unit: 'lb' } })).toBe(
      '10 reps +25 lb'
    );
  });

  test('assistance reads as help, not as load', () => {
    expect(formatPrescription({ reps: 8, assistedWeight: { value: 40, unit: 'kg' } })).toBe(
      '8 reps assist 40 kg'
    );
  });

  test('a duration in seconds folds to minutes when it divides evenly', () => {
    expect(formatPrescription({ duration: { value: 120, unit: 'second' } })).toBe('2 min');
    expect(formatPrescription({ duration: { value: 90, unit: 'second' } })).toBe('90 s');
    expect(formatPrescription({ duration: { value: 30, unit: 'minute' } })).toBe('30 min');
  });

  test('a distance and a calorie target render with their units', () => {
    expect(formatPrescription({ distance: { value: 400, unit: 'm' } })).toBe('400 m');
    expect(formatPrescription({ calories: { value: 120, unit: 'kcal' } })).toBe('120 kcal');
  });

  test('an RPE target renders', () => {
    expect(formatPrescription({ reps: 10, effort: { type: 'rpe', target: 8 } })).toBe('10 reps RPE 8');
  });

  test('a prescription with no visible work yields an empty string', () => {
    expect(formatPrescription({ loadStrategy: { type: 'top_set_then_back_off' } })).toBe('');
  });
});

describe('overview circuit matrix', () => {
  const circuitWorkout = {
    id: 'ov-circuit',
    name: 'Circuit Day',
    publishedStatus: 'live',
    root: {
      id: 'ov-root',
      type: 'container',
      strategy: 'sequence',
      strategyConfig: {},
      children: [
        {
          id: 'ov-sup',
          type: 'container',
          name: 'Superset A',
          strategy: 'rounds',
          strategyConfig: { rounds: 3 },
          children: [
            {
              id: 'ov-squat',
              type: 'exercise',
              exerciseId: 'back-squat',
              stimulus: 'hypertrophy',
              setType: 'working',
              prescription: { reps: 10 }
            },
            {
              id: 'ov-bench',
              type: 'exercise',
              exerciseId: 'back-squat',
              stimulus: 'hypertrophy',
              setType: 'working',
              prescription: { reps: 8 }
            }
          ]
        }
      ]
    }
  } as never;

  test('a circuit table carries one line per exercise and one cell per set', () => {
    const model = buildOverviewModel(circuitWorkout, {
      exerciseById: exerciseIndex(exercises())
    });
    expect(model).not.toBeNull();
    if (model === null) return;

    const table = model.blocks.find(
      (block) => block.kind === 'set-table' && block.table.title === 'Superset A'
    );
    expect(table?.kind).toBe('set-table');
    if (table?.kind !== 'set-table') return;

    const matrix = table.table.matrix;
    expect(matrix).toBeDefined();
    expect(matrix!.columns.map((column) => column.label)).toEqual(['Set 1', 'Set 2', 'Set 3']);
    // One line per exercise, in the programmed order.
    expect(matrix!.rows.length).toBe(2);
    for (const line of matrix!.rows) {
      expect(line.cells.length).toBe(3);
      for (const cell of line.cells) expect(cell.prescriptionText).not.toBe('');
    }
  });

  test('a single-exercise table has no matrix', () => {
    const singleWorkout = {
      id: 'ov-single',
      name: 'Single Day',
      publishedStatus: 'live',
      root: {
        id: 'ov-sroot',
        type: 'container',
        strategy: 'sequence',
        strategyConfig: {},
        children: [
          {
            id: 'ov-sonly',
            type: 'container',
            name: 'Squat',
            strategy: 'rounds',
            strategyConfig: { rounds: 3 },
            children: [
              {
                id: 'ov-se1',
                type: 'exercise',
                exerciseId: 'back-squat',
                stimulus: 'hypertrophy',
                setType: 'working',
                prescription: { reps: 10 }
              }
            ]
          }
        ]
      }
    } as never;

    const model = buildOverviewModel(singleWorkout, {
      exerciseById: exerciseIndex(exercises())
    });
    expect(model).not.toBeNull();
    if (model === null) return;

    const table = model.blocks.find((block) => block.kind === 'set-table');
    expect(table?.kind).toBe('set-table');
    if (table?.kind !== 'set-table') return;
    expect(table.table.multiExercise).toBe(false);
    expect(table.table.matrix).toBeUndefined();
  });
});
