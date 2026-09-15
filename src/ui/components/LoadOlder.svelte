<!--
  The **Load older** control.
  Phase 18. REQUIREMENTS 20.1, 20.4.

  A history list shows one page and stops. This control asks for the next page
  and reports what the list already holds, so the user can tell a short list
  from a list that has not finished loading.

  The control renders nothing when there is nothing older to load. An inert
  button that does nothing reads as a broken app, so the owner hides the whole
  component instead.

  The busy state disables the button rather than hiding it. Hiding it mid-load
  makes the list jump, and the user cannot tell whether the press registered.
-->
<script lang="ts">
  import Button from './Button.svelte';

  let {
    loadedCount = 0,
    hasMore = false,
    busy = false,
    exhaustedText = '',
    onloadolder = (): void => {}
  }: {
    /** Rows already on screen. Shown so the count matches what the user sees. */
    loadedCount?: number;
    /** True when older rows exist or may exist past this page. */
    hasMore?: boolean;
    /** True while the older page is in flight. */
    busy?: boolean;
    /** Text shown once no older rows exist. Empty hides the line. */
    exhaustedText?: string;
    /** Ask for the next older page. */
    onloadolder?: () => void;
  } = $props();
</script>

{#if hasMore}
  <div class="load-older">
    <Button variant="secondary" block disabled={busy} onclick={onloadolder}>
      {busy ? 'Loading…' : 'Load older'}
    </Button>
    <p class="load-older__count">{loadedCount} shown</p>
  </div>
{:else if exhaustedText !== ''}
  <p class="load-older__end">{exhaustedText}</p>
{/if}
