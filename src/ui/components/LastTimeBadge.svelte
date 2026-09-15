<!--
  The Last Time badge.
  Phase 17. REQUIREMENTS 19.3, 19.4, 19.5.

  Sits beside an exercise and answers "what did I do last time" without the
  user leaving the screen. The badge is a link to Exercise History, so the
  deeper list is one tap away and this stays a one-line summary.

  The model already resolved the value. This component only draws, including
  the `No history` case, which is a plain span because there is nothing to
  link to.
-->
<script lang="ts">
  import type { LastTimeModel } from '../viewmodels/activeWorkoutModel';

  let { lastTime, exerciseName = '' }: { lastTime: LastTimeModel; exerciseName?: string } = $props();

  const label = $derived(
    lastTime.kind === 'value'
      ? `${exerciseName === '' ? '' : `${exerciseName}: `}Last time${
          lastTime.dateLabel === undefined ? '' : ` ${lastTime.dateLabel}`
        }: ${lastTime.text}`
      : `${exerciseName === '' ? '' : `${exerciseName}: `}No history`
  );
</script>

{#if lastTime.kind === 'value'}
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
{:else}
  <span class="last-time last-time--none">{label}</span>
{/if}
