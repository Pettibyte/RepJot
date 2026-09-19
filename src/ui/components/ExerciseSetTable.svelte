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
  import { cellRepsTotal } from '../viewmodels/activeWorkoutModel';
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
    openRowPanels = {},
    onpaneltoggle = undefined,
    onfieldchange,
    onfieldblur,
    onstatuschange,
    onreasonchange,
    onunitchange,
    onsidechange,
    onstartingchange,
    oneffortchange,
    onaddattempt,
    ondeleteattempt
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
    /** Which rows have their **Set options** panel open, keyed by row key. */
    openRowPanels?: Record<string, boolean>;
    /** Reports a panel opening or closing, so the state survives a rebuild. */
    onpaneltoggle?: ((rowKey: string, open: boolean) => void) | undefined;
    onfieldchange?: (rowKey: string, dimension: string, value: string) => void;
    onfieldblur?: (rowKey: string, dimension: string) => void;
    onstatuschange?: (rowKey: string, status: ResultStatus) => void;
    onreasonchange?: (rowKey: string, reason: ReasonCode) => void;
    onunitchange?: (rowKey: string, dimension: string) => void;
    onsidechange?: (rowKey: string, side: Side) => void;
    onstartingchange?: (rowKey: string, startingSide: StartingSide) => void;
    oneffortchange?: (rowKey: string, choice: string) => void;
    onaddattempt?: (rowKey: string) => void;
    ondeleteattempt?: (rowKey: string) => void;
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

  /** The marker a cell shows when it holds more than one row. */
  function attemptLabel(row: ActiveExerciseRow): string {
    const parts: string[] = [];
    if (row.attempt > 1) parts.push(`Attempt ${row.attempt}`);
    if (row.side !== 'both') parts.push(row.side === 'left' ? 'Left' : row.side === 'right' ? 'Right' : 'Alternating');
    return parts.join(' · ');
  }

  /**
   * True when one row needs attention.
   *
   * Two things raise it: Finish found no completed result for the row, and
   * a field holds text that will not parse. The linear view shows both on
   * the row head; the matrix has no row head per set, so the table marks
   * the whole exercise line and the offending cell.
   */
  function rowNeedsAttention(row: ActiveExerciseRow): boolean {
    return (
      missingRowKeys.includes(row.key) ||
      Object.keys(rowFieldErrors[row.key] ?? {}).length > 0
    );
  }

  /** True when one matrix line holds a row that needs attention. */
  function lineNeedsAttention(line: { cells: Array<{ rows: ActiveExerciseRow[] }> }): boolean {
    return line.cells.some((cell) => cell.rows.some((row) => rowNeedsAttention(row)));
  }

  /** True when one cell holds a row that needs attention. */
  function cellNeedsAttention(cell: { rows: ActiveExerciseRow[] }): boolean {
    return cell.rows.some((row) => rowNeedsAttention(row));
  }

  /** The section heading carries the message once for the whole table. */
  const tableNeedsAttention = $derived(table.rows.some((row) => rowNeedsAttention(row)));
</script>

<section class="set-table" aria-labelledby={`${idPrefix}-${table.key}-title`}>
  <p class="set-table__section">{table.sectionTitle}</p>
  <div class="set-table__head">
    <h3 class="set-table__title" id={`${idPrefix}-${table.key}-title`}>{table.title}</h3>
    {#if tableNeedsAttention}
      <span class="exercise-row__missing-label">Needs attention</span>
    {/if}
    {#if table.lastTime !== undefined}
      <LastTimeBadge lastTime={table.lastTime} exerciseName={table.title} />
    {/if}
  </div>
  <p class="set-table__label">{table.label}</p>

  {#if table.matrix !== undefined}
    {@const matrix = table.matrix}
    <!--
      The circuit matrix. One exercise per row, one set per column. The
      exercise name and its prescription are stated once per row instead of
      once per set, which is what makes the circuit compact.

      The wrapper scrolls sideways when the set columns cannot all fit. The
      exercise column wraps instead of forcing width, so a long name costs
      height rather than pushing the grid out. Sticky positioning is banned
      under src/ui by the style guard and ARCHITECTURE C-04, so the exercise
      column scrolls with the grid.

      The wrapper carries no tab stop. Every cell holds a focusable input, so
      a keyboard user reaches all of the content by tabbing, and the wrapper
      scrolls with that focus.
    -->
    <div class="set-matrix__scroll" role="region" aria-label="{table.title} sets">
      <table class="set-matrix">
        <thead class="set-matrix__head">
          <tr>
            <th class="set-matrix__corner" scope="col">Exercise</th>
            {#each matrix.columns as column (column.key)}
              <th class="set-matrix__col" scope="col">{column.label}</th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each matrix.rows as line (line.key)}
            <tr
              class="set-matrix__line"
              class:set-matrix__line--error={lineNeedsAttention(line)}
            >
              <th class="set-matrix__name" scope="row">
                <span class="set-matrix__exercise">{line.exerciseName}</span>
                {#if line.prescriptionText !== ''}
                  <span class="set-matrix__rx">{line.prescriptionText}</span>
                {/if}
                {#if lineNeedsAttention(line)}
                  <!-- <span class="exercise-row__missing-label">Needs attention</span> -->
                {/if}
                <LastTimeBadge lastTime={line.lastTime} exerciseName={line.exerciseName} />
              </th>
              {#each line.cells as cell, columnIndex (cell.key)}
                <td
                  class="set-matrix__cell"
                  class:set-matrix__cell--error={cellNeedsAttention(cell)}
                >
                  {#if cell.prescriptionText !== undefined}
                    <span class="set-matrix__cell-rx">{cell.prescriptionText}</span>
                  {/if}
                  {#each cell.rows as row, rowIndex (row.key)}
                    <ExerciseRow
                      {row}
                      compact
                      cell
                      cellLabel={cell.rows.length > 1
                        ? attemptLabel(row)
                        : ''}
                      overrides={rowOverrides[row.key] ?? {}}
                      fieldErrors={rowFieldErrors[row.key] ?? {}}
                      missing={missingRowKeys.includes(row.key)}
                      status={statusDrafts[row.key]}
                      side={sideDrafts[row.key]}
                      startingSide={startingSideDrafts[row.key] ?? row.startingSide ?? 'left'}
                      effortChoice={effortDrafts[row.key]}
                      panelOpen={openRowPanels[row.key] === true}
                      onpaneltoggle={onpaneltoggle}
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
                      ondeleteattempt={() => ondeleteattempt?.(row.key)}
                    />
                  {/each}
                  {#if cell.rows.length === 0}
                    <span class="set-matrix__empty">\u2014</span>
                  {/if}
                  <!--
                    A cell that holds several rows gains a total the single
                    fields cannot show: five left and four right reads as
                    nine for the set.
                  -->
                  {#if cellRepsTotal(cell.rows, (rowKey) => rowOverrides[rowKey] ?? {}) !== ''}
                    <p class="set-matrix__cell-total">
                      {cellRepsTotal(cell.rows, (rowKey) => rowOverrides[rowKey] ?? {})}
                    </p>
                  {/if}
                </td>
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {:else}
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
            startingSide={startingSideDrafts[row.key] ?? row.startingSide ?? 'left'}
            effortChoice={effortDrafts[row.key]}
            panelOpen={openRowPanels[row.key] === true}
            onpaneltoggle={onpaneltoggle}
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
            ondeleteattempt={() => ondeleteattempt?.(row.key)}
          />
        {/each}
      {/each}
    </div>
  {/if}
</section>
