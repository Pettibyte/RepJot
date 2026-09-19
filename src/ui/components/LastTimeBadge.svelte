<!--
  The Last Time badge.
  Phase 17. REQUIREMENTS 19.3, 19.4, 19.5.

  Sits beside an exercise and answers "what did I do last time" without the
  user leaving the screen. The badge is a link to Exercise History, so the
  deeper list is one tap away and this stays a one-line summary.

  The model already resolved the value. This component only draws, including
  the `No history` case, which is a plain span because there is nothing to
  link to.

  One control rides beside the link: **Fill with last time data**. It copies
  the values the badge shows into the row, or into every set of the exercise
  when the badge sits over a grid. The badge itself still reports; the
  button acts, and it appears only when a caller passes `onfill`, so a
  badge drawn without one stays the read-only summary it always was.
-->
<script lang="ts">
  import type { LastTimeModel } from '../viewmodels/activeWorkoutModel';

  let {
    lastTime,
    exerciseName = '',
    disabled = false,
    onfill = undefined
  }: {
    lastTime: LastTimeModel;
    exerciseName?: string;
    /** True while a save is in flight, so a double tap cannot fill twice. */
    disabled?: boolean;
    /**
     * Runs when the fill arrow is tapped.
     *
     * Absent means no arrow. A caller that cannot record — a finished
     * session, a row with no fields — leaves this out rather than drawing a
     * control that would do nothing.
     */
    onfill?: (() => void) | undefined;
  } = $props();

  const label = $derived(
    lastTime.kind === 'value'
      ? `${exerciseName === '' ? '' : `${exerciseName}: `}Last time${
          lastTime.dateLabel === undefined ? '' : ` ${lastTime.dateLabel}`
        }: ${lastTime.text}`
      : `${exerciseName === '' ? '' : `${exerciseName}: `}No history`
  );

  /** The arrow carries no readable text, so its name is spelled out. */
  const fillLabel = $derived(
    exerciseName === ''
      ? 'Fill with last time data.'
      : `Fill ${exerciseName} with last time data.`
  );

  /**
   * Whether the arrow may be drawn.
   *
   * A badge with no recorded values has nothing to copy, so the control
   * would be a promise the model cannot keep.
   */
  const canFill = $derived(lastTime.kind === 'value' && onfill !== undefined);

  function handleFill(event: MouseEvent): void {
    // The badge sits in a heading, not a form, but a stray submit is worse
    // than a stopped one.
    event.preventDefault();
    if (disabled) return;
    onfill?.();
  }
</script>

{#if lastTime.kind === 'value'}
  <span class="last-time__group">
    {#if lastTime.href !== undefined}
      <a class="last-time last-time--link" href={lastTime.href}>
        <span class="last-time__caption">Last time</span>
        <span class="last-time__values">{lastTime.text}</span>
        {#if lastTime.dateLabel !== undefined}
          <span class="last-time__date">{lastTime.dateLabel}</span>
        {/if}
        <span class="last-time__action">View history</span>
      </a>
    {:else}
      <span class="last-time last-time--plain" aria-label={label}>
        <span class="last-time__caption">Last time</span>
        <span class="last-time__values">{lastTime.text}</span>
        {#if lastTime.dateLabel !== undefined}
          <span class="last-time__date">{lastTime.dateLabel}</span>
        {/if}
      </span>
    {/if}
    {#if canFill}
      <button
        type="button"
        class="pill chip chip--on last-time__fill"
        title="Fill with last time data."
        aria-label={fillLabel}
        {disabled}
        onclick={handleFill}
      >&#x1F872;</button>
    {/if}
  </span>
{:else}
  <span class="last-time last-time--none">{label}</span>
{/if}
