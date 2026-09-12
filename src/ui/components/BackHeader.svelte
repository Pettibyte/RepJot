<script lang="ts">
  import Icon from './Icon.svelte';

  let {
    href = '#/',
    backLabel = 'Back',
    title = '',
    class: className = ''
  }: {
    /** Target for the back control, for example `#/workout`. */
    href?: string;
    /** Visible text for the back control. A glyph never carries the action alone. */
    backLabel?: string;
    /** Page title shown beside the back control. */
    title?: string;
    class?: string;
  } = $props();

  const classes = $derived(['back-header', className].filter(Boolean).join(' '));
</script>

<header class={classes}>
  <a class="back-header__back" {href}>
    <Icon name="arrow_back" decorative />
    {backLabel}
  </a>
  {#if title}
    <h1 class="back-header__title">{title}</h1>
  {/if}
</header>
