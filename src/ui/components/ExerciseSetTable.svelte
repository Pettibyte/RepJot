<!--
  One reusable editor for repeated sets of an exercise or of a circuit.

  Warmup, strength, and conditioning use this same component. Each row stays
  an ExerciseRow, so saving, units, status, sides, effort, and attempts keep
  one implementation.

  Two shapes reach this component. A single-exercise table carries the
  exercise name in its heading and labels each row `Set N`, so the table
  reads as one set list. A circuit table carries the container name, shows
  a `Round N` divider per round, and names the exercise on every row,
  because one heading cannot name several exercises. The table body always
  comes from `rounds`; `rows` exists for callers that want one flat list.
-->
<script lang="ts">
  import ExerciseRow from './ExerciseRow.svelte';
  import LastTimeBadge from './LastTimeBadge.svelte';
  import type { ActiveExerciseRow, ActiveSetTable } from '../viewmodels/activeWorkoutModel';
  import type { ReasonCode, ResultStatus, Side, StartingSide } from '../../domain/enums';

  let {
    table,
    idPrefix = 'sets',
    disabled = false,
    busy = false,
    rowOverrides = {},
    rowFieldErrors = {},
    missingRowKeys = [],
    statusDrafts = {},
    sideDrafts = {},
    startingSideDrafts = {},
    effortDrafts = {},
    onfieldchange,
    onfieldblur,
    onstatuschange,
    onreasonchange,
    onunitchange,
    onsidechange,
    onstartingchange,
    oneffortchange,
    onaddattempt
  }: {
    table: ActiveSetTable;
    idPrefix?: string;
    disabled?: boolean;
    busy?: boolean;
    rowOverrides?: Record<string, Record<string, string>>;
    rowFieldErrors?: Record<string, Record<string, string>>;
    missingRowKeys?: string[];
    statusDrafts?: Record<string, ResultStatus>;
    sideDrafts?: Record<string, Side>;
    startingSideDrafts?: Record<string, StartingSide>;
    effortDrafts?: Record<string, string>;
    onfieldchange?: (rowKey: string, dimension: string, value: string) => void;
    onfieldblur?: (rowKey: string, dimension: string) => void;
    onstatuschange?: (rowKey: string, status: ResultStatus) => void;
    onreasonchange?: (rowKey: string, reason: ReasonCode) => void;
    onunitchange?: (rowKey: string, dimension: string) => void;
    onsidechange?: (rowKey: string, side: Side) => void;
    onstartingchange?: (rowKey: string, startingSide: StartingSide) => void;
    oneffortchange?: (rowKey: string, choice: string) => void;
    onaddattempt?: (rowKey: string) => void;
  } = $props();

  /**
   * The visible identity of one row.
   *
   * The label carries only the set and the attempt. A circuit prints the
   * exercise name beside the label through `showExerciseName`, so the two
   * never repeat each other.
   */
  function rowLabel(row: ActiveExerciseRow, index: number): string {
    const set = row.setNumber ?? index + 1;
    return row.attempt > 1 ? `Set ${set} · Attempt ${row.attempt}` : `Set ${set}`;
  }
</script>

<section class="set-table" aria-labelledby={`${idPrefix}-${table.key}-title`}>
  <p class="set-table__section">{table.sectionTitle}</p>
  <div class="set-table__head">
    <h3 class="set-table__title" id={`${idPrefix}-${table.key}-title`}>{table.title}</h3>
    {#if table.lastTime !== undefined}
      <LastTimeBadge lastTime={table.lastTime} exerciseName={table.title} />
    {/if}
  </div>
  <p class="set-table__label">{table.label}</p>

  <div class="set-table__rows">
    {#each table.rounds as round (round.key)}
      {#if round.label !== ''}
        <p class="set-table__round">{round.label}</p>
      {/if}
      {#each round.rows as row, index (row.key)}
        <ExerciseRow
          {row}
          compact
          setLabel={rowLabel(row, index)}
          showExerciseName={table.multiExercise}
          overrides={rowOverrides[row.key] ?? {}}
          fieldErrors={rowFieldErrors[row.key] ?? {}}
          missing={missingRowKeys.includes(row.key)}
          status={statusDrafts[row.key]}
          side={sideDrafts[row.key]}
          startingSide={startingSideDrafts[row.key] ?? 'left'}
          effortChoice={effortDrafts[row.key]}
          {idPrefix}
          {disabled}
          {busy}
          onfieldchange={(dimension, value) => onfieldchange?.(row.key, dimension, value)}
          onfieldblur={(dimension) => onfieldblur?.(row.key, dimension)}
          onstatuschange={(status) => onstatuschange?.(row.key, status)}
          onreasonchange={(reason) => onreasonchange?.(row.key, reason)}
          onunitchange={(dimension) => onunitchange?.(row.key, dimension)}
          onsidechange={(nextSide) => onsidechange?.(row.key, nextSide)}
          onstartingchange={(next) => onstartingchange?.(row.key, next)}
          oneffortchange={(choice) => oneffortchange?.(row.key, choice)}
          onaddattempt={() => onaddattempt?.(row.key)}
        />
      {/each}
    {/each}
  </div>
</section>
