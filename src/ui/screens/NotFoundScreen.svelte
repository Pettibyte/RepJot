<script lang="ts">
  // The typed not-found screen.
  // ARCHITECTURE section 9: "The hash router shows a typed not-found state for
  // an invalid route or unavailable ID."
  //
  // The screen echoes the address the user asked for. Showing it turns a silent
  // fallback into an answer the user can act on, and it makes a mistyped hash
  // obvious instead of dropping the user on the home screen.

  import Button from '../components/Button.svelte';

  let { attempted = '#/' }: {
    /** The address that produced this state, as the user typed it. */
    attempted?: string;
  } = $props();
</script>

<div class="screen">
  <h1 class="not-found__title">No screen for that address</h1>
  <p class="not-found__detail">
    REP JOT does not have a page at <code class="not-found__address">{attempted}</code>.
  </p>
  <p class="not-found__hint">
    The address may be mistyped, or the screen may not be part of this release.
  </p>
  <div class="not-found__actions">
    <Button variant="primary" href="#/">Go to REP JOT home</Button>
  </div>
</div>
