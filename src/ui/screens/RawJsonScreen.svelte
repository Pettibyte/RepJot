<script lang="ts">
  // Read-only raw JSON viewer.
  // ARCHITECTURE section 12.9 "raw inspection" and section 14.
  //
  // The screen prints the stored bytes and interprets nothing. It does not parse,
  // re-serialize, pretty-print, sort keys, or highlight. What the file holds is
  // what the user reads, because the whole point of the view is to see the bytes
  // the app refused.
  //
  // The text reaches the page through interpolation inside a `<pre>`. This file
  // injects no markup of any kind, so a payload that holds markup stays inert
  // text. A test greps this file for the injection forms and fails on a match.

  import { getRawPayload } from '../../state/raw-payload-store';

  let { source = '' }: {
    /** The payload key carried by the `#/raw/:source` route. */
    source?: string;
  } = $props();

  /**
   * The payload text.
   *
   * The store is a plain in-memory map, so this read resolves once per mount.
   * `undefined` means the key is unknown, which is the normal result of a reload
   * because the store does not survive a page load.
   */
  const text = $derived(getRawPayload(source));
</script>

<div class="screen screen--narrow">
  {#if text === undefined}
    <p class="raw-json__missing" role="status">
      REP JOT no longer holds this payload. The raw viewer keeps bytes in memory only, so a reload clears them.
      Open the file again from the card that reported the problem.
    </p>
  {:else}
    <pre class="raw-json">{text}</pre>
  {/if}
</div>
