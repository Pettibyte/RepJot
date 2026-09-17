<!--
  One reusable editor for repeated sets of an exercise.

  Warmup, strength, and conditioning use this same component. Each row remains
  an ExerciseRow, so saving, units, status, sides, effort, and attempts keep one
  implementation.
-->
<script lang="ts">
  import ExerciseRow from './ExerciseRow.svelte';
  import LastTimeBadge from './LastTimeBadge.svelte';
  import type { ActiveSetTable } from '../viewmodels/activeWorkoutModel';
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

  function rowLabel(index: number): string {
    const row = table.rows[index];
    if (row === undefined) return '';
    const set = row.setNumber ?? index + 1;
    return row.attempt > 1 ? `Set ${set} · Attempt ${row.attempt}` : `Set ${set}`;
  }
</script>

<section class="set-table" aria-labelledby={`${idPrefix}-${table.key}-title`}>
  <p class="set-table__section">{table.sectionTitle}</p>
  <div class="set-table__head">
    <h3 class="set-table__title" id={`${idPrefix}-${table.key}-title`}>{table.title}</h3>
    <LastTimeBadge lastTime={table.lastTime} exerciseName={table.title} />
  </div>
  <p class="set-table__label">{table.label}</p>

  <div class="set-table__rows">
    {#each table.rows as row, index (row.key)}
      <ExerciseRow
        {row}
        compact
        setLabel={rowLabel(index)}
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
  </div>
</section>
