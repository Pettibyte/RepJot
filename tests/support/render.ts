import type { Component } from 'svelte';
import { render } from 'svelte/server';

/** Render a component to an HTML string through the Svelte server renderer. */
export function html(
  component: Component<Record<string, unknown>>,
  props: Record<string, unknown> = {},
): string {
  const { body } = render(component, { props });
  return body;
}
