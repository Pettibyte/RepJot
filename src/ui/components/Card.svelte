<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    title = 'Card',
    variant = 'raised',
    flush = false,
    children,
    class: className = '',
    ...rest
  }: {
    /** Accessible name for the region. */
    title?: string;
    variant?: 'raised' | 'sunken';
    /** Removes inner padding. Use when the card holds a table or a full-bleed row. */
    flush?: boolean;
    children?: Snippet;
    class?: string;
    [key: `aria-${string}`]: unknown;
  } = $props();

  const classes = $derived(
    ['card', variant === 'sunken' ? 'card--sunken' : '', flush ? 'card--flush' : '', className]
      .filter(Boolean)
      .join(' '),
  );
</script>

<div class={classes} role="region" aria-label={title} {...rest}>
  {@render children?.()}
</div>
