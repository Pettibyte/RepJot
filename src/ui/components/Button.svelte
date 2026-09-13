<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';

  let {
    variant = 'primary',
    href = undefined,
    type = 'button',
    disabled = false,
    block = false,
    icon = undefined,
    iconLabel = undefined,
    children,
    class: className = '',
    ...rest
  }: {
    variant?: 'primary' | 'secondary' | 'danger';
    /** Renders an `<a>` when set. Use for navigation. */
    href?: string;
    /** `<button type>` when `href` is not set. */
    type?: 'button' | 'submit' | 'reset';
    disabled?: boolean;
    /** Full-width block button. */
    block?: boolean;
    /** Icon name. The visible text label still carries the action. */
    icon?: string;
    /** Accessible name for the icon. Omit when the button text already names the action. */
    iconLabel?: string;
    children?: Snippet;
    class?: string;
    [key: `aria-${string}`]: unknown;
  } = $props();

  const classes = $derived(
    ['btn', `btn--${variant}`, block ? 'btn--block' : '', className].filter(Boolean).join(' '),
  );
</script>

{#if href !== undefined}
  <!--
    A disabled link drops its `href`. `aria-disabled` alone reports the state and
    leaves the navigation live, so keyboard activation and click would still leave
    the page. With no `href` the anchor is inert and takes no tab focus.
    `.btn[aria-disabled="true"]` carries the disabled look.
  -->
  <a
    class={classes}
    href={disabled ? undefined : href}
    aria-disabled={disabled ? 'true' : undefined}
    {...rest}
  >
    {#if icon}
      <Icon name={icon} label={iconLabel ?? ''} decorative={iconLabel === undefined} />
    {/if}
    {@render children?.()}
  </a>
{:else}
  <button class={classes} {type} {disabled} {...rest}>
    {#if icon}
      <Icon name={icon} label={iconLabel ?? ''} decorative={iconLabel === undefined} />
    {/if}
    {@render children?.()}
  </button>
{/if}
