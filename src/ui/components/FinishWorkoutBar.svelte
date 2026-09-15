<!--
  Finish Workout bar.
  Phase 17. REQUIREMENTS 11.12, 11.15, 19.10.

  Sits at the end of the workout. Two actions and one prompt.

  **Finish Workout** ends the session. When prescribed work is missing the
  button does not end anything: it opens the prompt instead, and the user
  chooses. That is REQUIREMENT 11.15 read as a rule about order, not about
  labels — the missing-work question must come before the terminal write,
  because a session cannot be un-finished.

  **Return to workout** closes the prompt and changes nothing. **Finish as
  incomplete** ends the session with the gaps left as they are. The recorded
  results keep their own statuses, so the gaps stay visible in the summary.

  **Abandon** is separate from Finish. Abandon means the workout did not
  happen; Finish with gaps means it happened and some of it was skipped.
  Both are terminal and neither is reversible in release one, so both ask.
-->
<script lang="ts">
  import Button from './Button.svelte';
  import type { MissingWorkItem } from '../../sessions/session-service';

  let {
    missing = [],
    disabled = false,
    busy = false,
    promptOpen = false,
    onFinish = undefined,
    onReturn = undefined,
    onFinishIncomplete = undefined,
    onAbandon = undefined
  }: {
    /** Prescribed work with no completed result. */
    missing?: MissingWorkItem[];
    disabled?: boolean;
    busy?: boolean;
    /** True while the missing-work prompt is showing. */
    promptOpen?: boolean;
    onFinish?: (() => void) | undefined;
    onReturn?: (() => void) | undefined;
    onFinishIncomplete?: (() => void) | undefined;
    onAbandon?: (() => void) | undefined;
  } = $props();

  const hasMissing = $derived(missing.length > 0);
</script>

<div class="finish-bar">
  {#if promptOpen && hasMissing}
    <div class="finish-bar__prompt" role="alert">
      <h3 class="finish-bar__prompt-title">
        {missing.length} {missing.length === 1 ? 'item is' : 'items are'} not recorded
      </h3>
      <ul class="finish-bar__list">
        {#each missing as item, index (`missing-${index}`)}
          <li class="finish-bar__item">
            <span class="finish-bar__item-path">
              {item.compactPathLabel === '' ? 'Workout' : item.compactPathLabel}
            </span>
            <span class="finish-bar__item-reason">{item.reason}</span>
          </li>
        {/each}
      </ul>
      <p class="finish-bar__note">
        Finishing as incomplete keeps these gaps. You can record them later by
        opening the workout from History.
      </p>
      <div class="finish-bar__actions">
        <Button variant="primary" disabled={disabled || busy} onclick={() => onReturn?.()}>
          Return to workout
        </Button>
        <Button
          variant="secondary"
          disabled={disabled || busy}
          onclick={() => onFinishIncomplete?.()}
        >
          Finish as incomplete
        </Button>
      </div>
    </div>
  {:else}
    <div class="finish-bar__main">
      <Button
        variant="primary"
        block
        disabled={disabled || busy}
        onclick={() => onFinish?.()}
      >
        {busy ? 'Finishing…' : 'Finish Workout'}
      </Button>
      <Button variant="secondary" block disabled={disabled || busy} onclick={() => onAbandon?.()}>
        Abandon workout
      </Button>
    </div>
  {/if}
</div>
