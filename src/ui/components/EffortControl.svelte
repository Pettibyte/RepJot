<!--
  The effort control for one exercise row.
  Phase 17. REQUIREMENT 19.9.

  The app programs effort — `to failure`, `RIR 2`, `RPE 8` — and the
  Overview shows it. Without this control the Active Workout screen could
  promise effort and record none.

  The control appears only when the prescription carries an effort target,
  so a row with no programmed effort asks for nothing. The choices come
  from the target: a `to failure` set asks whether the user reached
  failure, an `RIR` set asks for a reserve count, and an `RPE` set asks
  for a perceived-exertion count.

  The control is a native `<select>`, not a custom widget. The targeted
  browser handles a native select well, and the choice list is short.
-->
<script lang="ts">
  import type { EffortTarget } from '../../domain/types';
  import { effortChoices } from '../screens/activeWorkoutActions';

  let {
    target,
    value = '',
    disabled = false,
    id = undefined,
    onchange = undefined
  }: {
    /** The programmed effort target. The control shows only when set. */
    target: EffortTarget | undefined;
    /** The encoded choice that shows the recorded effort. */
    value?: string;
    disabled?: boolean;
    id?: string;
    onchange?: ((event: Event) => void) | undefined;
  } = $props();

  /** No programmed effort means no control. */
  const show = $derived(target !== undefined);

  const choices = $derived(effortChoices(target));

  /** The label names the kind of effort, so the select reads as a question. */
  const label = $derived(
    target === undefined
      ? 'Effort'
      : target.type === 'failure'
        ? 'Effort: reached failure?'
        : target.type === 'rir'
          ? `Effort: reps in reserve (programmed RIR ${target.target})`
          : `Effort: perceived exertion (programmed RPE ${target.target})`
  );

  const selected = $derived(value);
</script>

{#if show}
  <div class="effort-control">
    <label class="effort-control__label" for={id}>{label}</label>
    <select
      class="effort-control__select"
      id={id}
      {disabled}
      value={selected}
      {onchange}
    >
      {#each choices as choice (choice.value)}
        <option value={choice.value}>{choice.label}</option>
      {/each}
    </select>
  </div>
{/if}
