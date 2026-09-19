<!--
  One exercise with its inputs.
  Phase 17. REQUIREMENTS 11.1-11.8, 19.1-19.9.

  The row is the unit of the Active Workout screen: the exercise name, the
  prescription it sits under, the Last Time badge, one input per measurement
  dimension, and the status control.

  Three rules shape the row.

  1. A row under a container that records with no child detail shows no
     inputs. The container score is the record there, and an input beside it
     would offer work the validator refuses. REQUIREMENTS 10.10, 10.13.
  2. The status control only offers a reason code when the status is not
     `completed`. A completed result must not carry one, and the validator
     rejects the pair. REQUIREMENT 11.4.
  3. An unresolved row keeps its name and its stored values visible and adds
     the data-error card. One stale reference never drops the rest of the
     workout. REQUIREMENTS 6.10, 15.6.
-->
<script lang="ts">
  import DataError from './DataError.svelte';
  import ChipGroup from './ChipGroup.svelte';
  import EffortControl from './EffortControl.svelte';
  import LastTimeBadge from './LastTimeBadge.svelte';
  import SideControl from './SideControl.svelte';
  import ValueInput from './ValueInput.svelte';
  import Button from './Button.svelte';
  import type { ActiveExerciseRow } from '../viewmodels/activeWorkoutModel';
  import { fieldDisplay, repsMeaning } from '../viewmodels/activeWorkoutModel';
  import { canAddAttempt, canDeleteAttempt, choiceForEffort } from '../screens/activeWorkoutActions';
  import type { ReasonCode, ResultStatus, Side, StartingSide } from '../../domain/enums';
  import { REASON_OPTIONS, STATUS_OPTIONS } from './exercise-row-options';

  let {
    row,
    overrides = {},
    fieldErrors = {},
    missing = false,
    disabled = false,
    idPrefix = 'row',
    status = undefined,
    side = undefined,
    startingSide = 'left',
    effortChoice = undefined,
    busy = false,
    compact = false,
    setLabel = '',
    showExerciseName = false,
    cell = false,
    cellLabel = '',
    panelOpen = false,
    onpaneltoggle = undefined,
    onfieldchange = undefined,
    onfieldblur = undefined,
    onstatuschange = undefined,
    onreasonchange = undefined,
    onunitchange = undefined,
    onsidechange = undefined,
    onstartingchange = undefined,
    oneffortchange = undefined,
    onaddattempt = undefined,
    ondeleteattempt = undefined,
    onfilllasttime = undefined
  }: {
    /** The row to draw. */
    row: ActiveExerciseRow;
    /** Draft text per dimension, overriding the model's display value. */
    overrides?: Record<string, string>;
    /** Inline validation messages keyed by dimension. */
    fieldErrors?: Record<string, string>;
    /** True when Finish found no completed result for this row. */
    missing?: boolean;
    disabled?: boolean;
    /** Prefix for element ids, so two trees on one page stay addressable. */
    idPrefix?: string;
    /** Draft status. Falls back to the stored row status. */
    status?: ResultStatus;
    /** Draft side. Falls back to the side the row records. */
    side?: Side;
    /** Draft starting side for an alternating set. */
    startingSide?: StartingSide;
    /** Draft effort choice. Falls back to the effort already on the row. */
    effortChoice?: string;
    /** True while a row-level action is in flight, so a double tap cannot repeat. */
    busy?: boolean;
    /** Compact mode is used inside one shared exercise set table. */
    compact?: boolean;
    /** Visible identity such as `Set 2` or `Set 2 · Attempt 2`. */
    setLabel?: string;
    /**
     * Print the exercise name beside the set label in compact mode.
     *
     * A single-exercise set table leaves this false, because its heading
     * already names the exercise. A circuit table sets it true, because
     * one heading cannot name several exercises.
     */
    showExerciseName?: boolean;
    /**
     * Draw this row as one cell of the circuit matrix.
     *
     * The matrix states the exercise name in the row header and the set
     * number in the column header, so a cell carries neither. It keeps the
     * inputs, the status control, and the attempt marker, because those
     * belong to the row and nowhere else.
     */
    cell?: boolean;
    /**
     * The attempt or side marker a cell shows when it holds one of several
     * rows for the same exercise and set.
     */
    cellLabel?: string;
    /**
     * Whether the **Set options** panel is open.
     *
     * The panel is driven from outside rather than left to the browser.
     * A side change moves the row to a new key, which destroys and
     * recreates this component, and a `<details>` left to itself closes on
     * the way. Owning the state up top lets the panel stay open across the
     * rebuild.
     */
    panelOpen?: boolean;
    /** Reports the panel opening or closing. */
    onpaneltoggle?: ((rowKey: string, open: boolean) => void) | undefined;
    /**
     * Runs on every keystroke in a value field.
     *
     * This is the link that carries a typed value out of the row and into
     * the screen's draft. Without it the text dies in the input and every
     * edit is discarded. REQUIREMENT 11.1.
     */
    onfieldchange?: ((dimension: string, value: string) => void) | undefined;
    onfieldblur?: ((dimension: string) => void) | undefined;
    onstatuschange?: ((status: ResultStatus) => void) | undefined;
    onreasonchange?: ((reason: ReasonCode) => void) | undefined;
    onunitchange?: ((dimension: string) => void) | undefined;
    onsidechange?: ((side: Side) => void) | undefined;
    onstartingchange?: ((startingSide: StartingSide) => void) | undefined;
    oneffortchange?: ((choice: string) => void) | undefined;
    /**
     * Opens one more attempt on this row.
     *
     * The service copies the identity of the attempt it follows and opens
     * the new one with no values, so the row appears beside the first with
     * empty fields. REQUIREMENT 19.9.
     */
    onaddattempt?: (() => void) | undefined;
    /**
     * Deletes this attempt and closes the gap it leaves.
     *
     * Attempts above the deleted one move down one number, so the visible
     * list stays a run from 1. Destructive: the recorded values for this
     * attempt are gone.
     */
    ondeleteattempt?: (() => void) | undefined;
    /**
     * Copy this row's Last Time values into its own fields.
     *
     * The badge decides whether the arrow appears; this decides what a tap
     * does. Absent means the row cannot fill, so the arrow is not drawn.
     * REQUIREMENTS 19.4, 19.11.
     */
    onfilllasttime?: (() => void) | undefined;
  } = $props();

  const domId = (suffix: string): string => `${idPrefix}-${row.key}-${suffix}`;

  /**
   * Whether this row may take a fill.
   *
   * A row with no inputs has nowhere to put a value, and an unresolved row
   * has no exercise to fill from, so neither gets the arrow.
   */
  const rowFill = $derived(
    onfilllasttime === undefined || !row.recordable || row.unresolved || row.fields.length === 0
      ? undefined
      : () => onfilllasttime?.()
  );

  /** The status the row shows now, draft first. */
  const currentStatus = $derived(status ?? row.status);

  /** A reason code is only meaningful on a result that is not completed. */
  const showReason = $derived(currentStatus !== 'completed');

  /** A row with no inputs still shows its name, so the tree stays readable. */
  const showInputs = $derived(row.recordable && row.fields.length > 0 && !row.unresolved);

  /** The side the row records now, draft first. */
  const currentSide = $derived(side ?? row.side);

  /** The effort the row shows now, draft first. */
  const currentEffort = $derived(effortChoice ?? choiceForEffort(row.effort));

  /**
   * What the number in the reps field means, stated plainly.
   *
   * A typed `8` is eight for the set on a `both` row and eight per side on
   * a `left` row. Saying it here is what keeps the counting honest.
   */
  const meaning = $derived(
    repsMeaning({ side: currentSide, startingSide }, row.fields, overrides)
  );

  const errorProps = $derived({
    title: `This exercise is not in the current build: ${row.exerciseId}`,
    family: 'static-exercise',
    detail: 'The row stays so the workout reads whole. Recorded values are kept.',
    rawJson: JSON.stringify({ exerciseId: row.exerciseId, nodeKey: row.nodeKey }, null, 2)
  });
</script>

{#snippet resultControls()}
  {#if showInputs}
    <SideControl
      {row}
      side={currentSide}
      startingSide={startingSide}
      {overrides}
      {disabled}
      {idPrefix}
      onsidechange={(nextSide: Side) => onsidechange?.(nextSide)}
      onstartingchange={(next: StartingSide) => onstartingchange?.(next)}
    />

    {#if row.effortTarget !== undefined}
      <EffortControl
        target={row.effortTarget}
        value={currentEffort}
        {disabled}
        id={domId('effort')}
        onchange={(event: Event) => {
          const target = event.target as HTMLSelectElement;
          oneffortchange?.(target.value);
        }}
      />
    {/if}
  {/if}

  <ChipGroup
    label="Status"
    options={STATUS_OPTIONS}
    value={currentStatus}
    {disabled}
    idPrefix={domId('status')}
    onchange={(value: string) => onstatuschange?.(value as ResultStatus)}
  />

  {#if showReason}
    <ChipGroup
      label="Reason"
      options={REASON_OPTIONS}
      value={row.reasonCode ?? 'not_completed'}
      {disabled}
      idPrefix={domId('reason')}
      onchange={(value: string) => onreasonchange?.(value as ReasonCode)}
    />
  {/if}

  {#if canAddAttempt(row) || canDeleteAttempt(row)}
    <div class="exercise-row__attempt">
      {#if canAddAttempt(row)}
        <Button variant="secondary" disabled={disabled || busy} onclick={() => onaddattempt?.()}>
          {busy ? 'Opening…' : 'Add another attempt'}
        </Button>
      {/if}
      {#if canDeleteAttempt(row)}
        <Button variant="danger" disabled={disabled || busy} onclick={() => ondeleteattempt?.()}>
          {busy ? 'Deleting…' : 'Delete attempt'}
        </Button>
      {/if}
    </div>
  {/if}
{/snippet}

<div
  class="exercise-row"
  class:exercise-row--compact={compact}
  class:exercise-row--cell={cell}
  class:exercise-row--unresolved={row.unresolved}
  class:exercise-row--missing={missing}
  id={domId('row')}
  role="group"
  aria-label={cell
    ? cellLabel === ''
      ? row.exerciseName
      : `${row.exerciseName}, ${cellLabel}`
    : row.exerciseName}
>
  {#if cell}
    {#if cellLabel !== ''}
      <span class="exercise-row__cell-label">{cellLabel}</span>
    {/if}
    <!-- A cell still has to say it needs attention. The linear head does this
         with a left border; a cell has no left border of its own, so the
         label carries the message and the cell background carries the color. -->
    {#if missing}<span class="exercise-row__missing-label">Needs attention</span>{/if}
  {:else if compact}
    <div class="exercise-row__set-head">
      <span class="exercise-row__set-label">{setLabel}</span>
      {#if showExerciseName}
        <span class="exercise-row__set-name">{row.exerciseName}</span>
        <LastTimeBadge
          lastTime={row.lastTime}
          exerciseName={row.exerciseName}
          {disabled}
          onfill={rowFill}
        />
      {/if}
      {#if missing}<span class="exercise-row__missing-label">Needs attention</span>{/if}
    </div>
  {:else}
    {#if row.showCompactPath && row.compactPathLabel !== ''}
      <p class="exercise-row__path">{row.compactPathLabel}</p>
    {/if}

    <div class="exercise-row__head">
      <h4 class="exercise-row__name">{row.exerciseName}</h4>
      {#if missing}<span class="exercise-row__missing-label">Needs attention</span>{/if}
      <LastTimeBadge
        lastTime={row.lastTime}
        exerciseName={row.exerciseName}
        {disabled}
        onfill={rowFill}
      />
    </div>
  {/if}

  <!-- A cell skips the prescription: the matrix row header states it, and a
       round that asks for something different says so on the cell. -->
  {#if row.prescriptionText !== '' && !cell}
    <p class="exercise-row__prescription">{row.prescriptionText}</p>
  {/if}

  {#if row.unresolved}
    <DataError props={errorProps} />
  {:else if !row.recordable}
    <p class="exercise-row__hint">
      Recorded as part of the block score above.
    </p>
  {:else}
    {#if showInputs}
      <div class="exercise-row__fields">
        {#each row.fields as field (field.dimension)}
          {@const display = fieldDisplay(field, overrides)}
          <ValueInput
            field={{ ...field, value: display }}
            id={domId(field.dimension)}
            {disabled}
            value={display}
            error={fieldErrors[field.dimension]}
            oninput={(event: Event) => {
              const target = event.target as HTMLInputElement;
              onfieldchange?.(field.dimension, target.value);
            }}
            onblur={() => onfieldblur?.(field.dimension)}
            onunit={() => onunitchange?.(field.dimension)}
          />
        {/each}
      </div>

      <!-- The counting meaning rides right under the field it explains. -->
      {#if meaning !== ''}
        <p class="exercise-row__meaning">{meaning}</p>
      {/if}
    {/if}

    {#if compact}
      <details
        class="exercise-row__options"
        open={panelOpen}
        ontoggle={(event: Event) => {
          const target = event.target as HTMLDetailsElement;
          onpaneltoggle?.(row.key, target.open);
        }}
      >
        <summary class="exercise-row__options-summary">Set options · {currentStatus}</summary>
        <div class="exercise-row__options-body">{@render resultControls()}</div>
      </details>
    {:else}
      {@render resultControls()}
    {/if}
  {/if}
</div>
