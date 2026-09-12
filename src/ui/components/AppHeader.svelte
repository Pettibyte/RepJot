<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    status = undefined,
    class: className = ''
  }: {
    /** Slot for the save-status line, for example "Saved" or "Saving…". */
    status?: Snippet;
    class?: string;
  } = $props();

  const classes = $derived(['app-header', className].filter(Boolean).join(' '));
</script>

<header class={classes}>
  <span class="wordmark">REP JOT</span>
  {#if status}
    <div class="app-header__status">
      {@render status()}
    </div>
  {/if}
</header>
