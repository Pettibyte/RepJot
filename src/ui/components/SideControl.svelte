<!--
  The side control for one exercise row.
  Phase 17. REQUIREMENTS 11.5, 11.6, 11.7.

  A unilateral exercise can record `left`, `right`, `both`, or
  `alternating`. The side is not decoration: it is part of the result key,
  so a set recorded as `left` lives under a different key than the same set
  recorded as `both`. Without this control a user cannot record a one-sided
  set at all, and the app ships unilateral exercises.

  The starting-side select appears only on an alternating set. The schema
  allows `startingSide` on nothing else, and an alternating total cannot be
  split per side without knowing which side went first.

  The per-side line under the control is the alternating split REQUIREMENT
  11.7 asks for: `10 total / 5 each`, or `9 total / 5 left / 4 right`. It
  reads the reps the row currently shows, so it tracks what the user typed.
-->
<script lang="ts">
  import type { Side, StartingSide } from '../../domain/enums';
  import { alternatingLine, sidesForRow } from '../viewmodels/activeWorkoutModel';
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

  const domId = (suffix: string): string => `${idPrefix}-${row.key}-${suffix}`;

  /** A bilateral row records `both` and shows nothing. */
  const show = $derived(sidesForRow(row).length > 1);

  const showStarting = $derived(side === 'alternating');

  const splitLine = $derived(alternatingLine({ side, startingSide }, row.fields, overrides));
</script>

{#if show}
  <div class="side-control">
    <div class="side-control__fields">
      <div class="side-control__group">
        <label class="side-control__label" for={domId('side')}>Side</label>
        <select
          class="side-control__select"
          id={domId('side')}
          {disabled}
          value={side}
          onchange={(event: Event) => {
            const target = event.target as HTMLSelectElement;
            onsidechange?.(target.value as Side);
          }}
        >
          {#each sidesForRow(row) as option (option)}
            <option value={option}>{option}</option>
          {/each}
        </select>
      </div>

      {#if showStarting}
        <div class="side-control__group">
          <label class="side-control__label" for={domId('starting')}>Starts on</label>
          <select
            class="side-control__select"
            id={domId('starting')}
            {disabled}
            value={startingSide}
            onchange={(event: Event) => {
              const target = event.target as HTMLSelectElement;
              onstartingchange?.(target.value as StartingSide);
            }}
          >
            <option value="left">Left</option>
            <option value="right">Right</option>
          </select>
        </div>
      {/if}
    </div>

    {#if splitLine !== ''}
      <p class="side-control__split">{splitLine}</p>
    {/if}
  </div>
{/if}
