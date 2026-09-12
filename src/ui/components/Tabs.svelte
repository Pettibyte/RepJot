<script lang="ts">
  import Icon from './Icon.svelte';

  interface TabItem {
    /** Hash route, for example `#/workout`. */
    href: string;
    label: string;
    /** Optional glyph name from the icon manifest. */
    icon?: string;
    current?: boolean;
  }

  let {
    items,
    label = 'Sections',
    class: className = ''
  }: {
    items: TabItem[];
    /** Accessible name for the navigation landmark. */
    label?: string;
    class?: string;
  } = $props();

  const classes = $derived(['tabs', className].filter(Boolean).join(' '));
</script>

<nav class={classes} aria-label={label}>
  {#each items as item (item.href)}
    <a
      class={['tabs__item', item.current ? 'tabs__item--current' : ''].filter(Boolean).join(' ')}
      href={item.href}
      aria-current={item.current ? 'page' : undefined}
    >
      {#if item.icon}
        <Icon name={item.icon} decorative />
      {/if}
      {item.label}
    </a>
  {/each}
</nav>
