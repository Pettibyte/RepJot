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

  The chips come from `ChipGroup`, which replaces the native `<select>`.
  See that component for why: the targeted e-ink browser renders a select
  popup as a blank white rectangle. An RIR or RPE row carries eleven chips,
  which is the longest list here. The labels are short and numeric, so the
  row wraps to two or three lines on the wide target and stays readable.
-->
<script lang="ts">
  import ChipGroup from './ChipGroup.svelte';
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

  /** The label names the kind of effort, so the group reads as a question. */
  const label = $derived(
    target === undefined
      ? 'Effort'
      : target.type === 'failure'
        ? 'Effort: reached failure?'
        : target.type === 'rir'
          ? `Effort: reps in reserve (programmed RIR ${target.target})`
          : `Effort: perceived exertion (programmed RPE ${target.target})`
  );

  /**
   * The old `onchange` handed the caller an `Event` and read
   * `event.target.value`. A chip has no event worth passing, so this
   * synthesises the shape the caller already expects and keeps the seam
   * unchanged.
   */
  function emit(chosen: string): void {
    if (onchange === undefined) return;
    const fake = { target: { value: chosen } } as unknown as Event;
    onchange(fake);
  }
</script>

{#if show}
  <div class="effort-control">
    <ChipGroup
      {label}
      options={choices}
      value={value}
      {disabled}
      idPrefix={id ?? 'effort'}
      onchange={emit}
    />
  </div>
{/if}
