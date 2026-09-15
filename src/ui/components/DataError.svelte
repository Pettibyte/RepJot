<script lang="ts">
  // The one data-error card.
  // ARCHITECTURE ADR-017. REQUIREMENTS 6.8, 6.9, 6.10.
  //
  // Every data problem the app reports renders through this component: a corrupt
  // document, a future schema version, a duplicate Drive file, an unresolved
  // reference. One card per unresolved item, and the list around it keeps
  // rendering. REQUIREMENTS 6.10.
  //
  // The card names the family, the declared version, and the highest version this
  // build reads, so the user sees what the app refused and why. Both actions
  // carry visible text: **View Raw JSON** opens the stored bytes in the raw
  // viewer, **Dismiss** hides the card.
  //
  // `rawJson` never reaches the page as markup. It goes to the payload store and
  // the viewer prints it inside a `<pre>` through interpolation. This component
  // injects no markup of any kind. A test greps this file for the injection forms
  // and fails on a match, so a future edit cannot add one quietly.

  import { openRawJson } from '../../routing/open-raw-json';
  import Button from './Button.svelte';
  import { dataErrorIdentity, type DataErrorProps } from './data-error-types';

  let {
    props,
    onDismiss = undefined
  }: {
    /** What this card reports. */
    props: DataErrorProps;
    /** Runs after the card hides, so the owner can clear its error state. */
    onDismiss?: (() => void) | undefined;
  } = $props();

  /**
   * Local hide state, keyed to the reported item.
   *
   * A dismissal hides one problem, not every problem this instance may go on
   * to report. When the host swaps `props` to a different error, the identity
   * changes and the card shows again. REQUIREMENTS 6.10.
   */
  let dismissedKey = $state<string | null>(null);
  const identity = $derived(dataErrorIdentity(props));
  const hidden = $derived(dismissedKey === identity);

  /** The raw action appears only when there are bytes to show. */
  const hasRaw = $derived(props.rawJson.length > 0);

  function dismiss(): void {
    dismissedKey = identity;
    if (onDismiss !== undefined) onDismiss();
  }

  function showRaw(): void {
    openRawJson(props.rawJson);
  }
</script>

{#if !hidden}
  <section class="data-error" role="alert">
    <h2 class="data-error__title">{props.title}</h2>

    <dl class="data-error__facts">
      {#if props.family !== undefined && props.family.length > 0}
        <div class="data-error__fact">
          <dt>Family</dt>
          <dd>{props.family}</dd>
        </div>
      {/if}
      {#if props.declaredVersion !== undefined}
        <div class="data-error__fact">
          <dt>Declared version</dt>
          <dd>{props.declaredVersion}</dd>
        </div>
      {/if}
      {#if props.maxSupportedVersion !== undefined}
        <div class="data-error__fact">
          <dt>Max supported version</dt>
          <dd>{props.maxSupportedVersion}</dd>
        </div>
      {/if}
    </dl>

    {#if props.detail !== undefined && props.detail.length > 0}
      <p class="data-error__detail">{props.detail}</p>
    {/if}

    <div class="data-error__actions">
      {#if hasRaw}
        <Button variant="secondary" onclick={showRaw}>View Raw JSON</Button>
      {/if}
      <Button variant="secondary" onclick={dismiss}>Dismiss</Button>
    </div>
  </section>
{/if}
