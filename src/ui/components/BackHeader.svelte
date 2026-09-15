<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';

  let {
    href = '#/',
    backLabel = 'Back',
    title = '',
    status = undefined,
    class: className = ''
  }: {
    /** Target for the back control, for example `#/workout`. */
    href?: string;
    /** Visible text for the back control. A glyph never carries the action alone. */
    backLabel?: string;
    /** Page title shown beside the back control. */
    title?: string;
    /** Slot for the save-status line, the same shape `AppHeader` accepts. */
    status?: Snippet;
    class?: string;
  } = $props();

  const classes = $derived(['back-header', className].filter(Boolean).join(' '));
</script>

<header class={classes}>
  <div class="back-header__row">
    <a class="back-header__back" {href}>
      <Icon name="arrow_back" decorative />
      {backLabel}
    </a>
    {#if status}
      <div class="back-header__status">{@render status()}</div>
    {/if}
  </div>
  {#if title}
    <h1 class="back-header__title">{title}</h1>
  {/if}
</header>
