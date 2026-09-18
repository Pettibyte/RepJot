<!--
  The side control for one exercise row.
  Phase 17. REQUIREMENTS 11.5, 11.6, 11.7.

  A unilateral exercise can record `left`, `right`, `both`, or
  `alternating`. The side is not decoration: it is part of the result key,
  so a set recorded as `left` lives under a different key than the same set
  recorded as `both`. Without this control a user cannot record a one-sided
  set at all, and the app ships unilateral exercises.

  The chips come from `ChipGroup`, which replaces the native `<select>`.
  See that component for why: the targeted e-ink browser renders a select
  popup as a blank white rectangle.

  The starting-side chips appear only on an alternating set. The schema
  allows `startingSide` on nothing else, and an alternating total cannot be
  split per side without knowing which side went first.

  The per-side line under the control is the alternating split REQUIREMENT
  11.7 asks for: `10 total / 5 each`, or `9 total / 5 left / 4 right`. It
  reads the reps the row currently shows, so it tracks what the user typed.
-->
<script lang="ts">
  import ChipGroup from './ChipGroup.svelte';
  import type { Side, StartingSide } from '../../domain/enums';
  import { sidesForRow } from '../viewmodels/activeWorkoutModel';
  import type { ActiveExerciseRow } from '../viewmodels/activeWorkoutModel';

  let {
    row,
    side = 'both',
    startingSide = 'left',
    overrides = {},
    disabled = false,
    idPrefix = 'row',
    onsidechange = undefined,
    onstartingchange = undefined
  }: {
    /** The row this control writes. */
    row: ActiveExerciseRow;
    /** The side the row currently records, draft included. */
    side?: Side;
    /** The side an alternating set starts on. */
    startingSide?: StartingSide;
    /** Draft field text, so the split line follows what the user typed. */
    overrides?: Record<string, string>;
    disabled?: boolean;
    /** Prefix for element ids, so two trees on one page stay addressable. */
    idPrefix?: string;
    onsidechange?: ((side: Side) => void) | undefined;
    onstartingchange?: ((startingSide: StartingSide) => void) | undefined;
  } = $props();

  /** A bilateral row records `both` and shows nothing. */
  const show = $derived(sidesForRow(row).length > 1);

  const showStarting = $derived(side === 'alternating');

  /** What each side value reads as on screen. */
  const SIDE_LABELS: Record<Side, string> = {
    left: 'Left',
    right: 'Right',
    both: 'Both',
    alternating: 'Alternate'
  };

  const sideOptions = $derived(
    sidesForRow(row).map((value) => ({ value, label: SIDE_LABELS[value] }))
  );

  const startingOptions = [
    { value: 'left', label: 'Left' },
    { value: 'right', label: 'Right' }
  ];
</script>

{#if show}
  <div class="side-control">
    <ChipGroup
      label="Side"
      options={sideOptions}
      value={side}
      {disabled}
      idPrefix={`${idPrefix}-${row.key}-side`}
      onchange={(value: string) => onsidechange?.(value as Side)}
    />

    {#if showStarting}
      <ChipGroup
        label="Starts on"
        options={startingOptions}
        value={startingSide}
        {disabled}
        idPrefix={`${idPrefix}-${row.key}-starting`}
        onchange={(value: string) => onstartingchange?.(value as StartingSide)}
      />
    {/if}
    <!--
      The per-side split is not drawn here. `repsMeaning` renders it under
      the reps field, where it sits beside the number it explains and shows
      whether the options panel is open or not. Drawing it here too would
      put the same line on screen twice.
    -->
  </div>
{/if}
