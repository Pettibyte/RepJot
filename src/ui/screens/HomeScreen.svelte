<script lang="ts">
  // The `#/` screen for this build.
  //
  // Phase 16 owns the product landing page and the workout chooser. This screen
  // is the minimum that keeps the release usable: an anonymous visitor can reach
  // Google, and a signed-in visitor sees which account the shell bound. Without
  // the sign-in control here, the Phase 15 shell would have no way to authorize,
  // because the prototype page that carried it is retired.
  //
  // The remember choice keeps its meaning: an unchecked choice holds the token
  // for the browser session only. REQUIREMENTS 2.1 and 2.8.

  import Button from '../components/Button.svelte';
  import type { ShellAccount } from '../../app-types';

  let {
    account = null,
    clientId = '',
    onSignIn = (): void => {}
  }: {
    /** The bound account, or `null` while anonymous. */
    account?: ShellAccount | null;
    /** The OAuth client id. Empty means this build has none. */
    clientId?: string;
    /** Start the Google redirect with the remember choice. */
    onSignIn?: ((options: { remember: boolean }) => void) | undefined;
  } = $props();

  let remember = $state(false);

  /** True when the build carries a usable client id. */
  const configured = $derived(
    clientId.length > 0 && clientId.indexOf('YOUR_CLIENT_ID') !== 0,
  );
</script>

<div class="screen">
  {#if account === null}
    <h1 class="home__title">REP JOT</h1>
    <p class="home__intro">
      Track your workouts and keep the history in your own private Google Drive folder.
      REP JOT asks for app-data access only, so no other app can read it.
    </p>

    {#if configured}
      <label class="field home__remember">
        <span class="field__label">
          <input type="checkbox" bind:checked={remember} />
          Remember me on this device
        </span>
        <span class="field__hint">
          The access token stays on this device until it expires. Clear this option on a shared device.
        </span>
      </label>

      <div class="home__actions">
        <Button variant="primary" onclick={() => onSignIn({ remember })}>Continue with Google</Button>
      </div>
    {:else}
      <p class="home__unconfigured" role="status">
        This build has no Google client id. Set VITE_GOOGLE_CLIENT_ID and build again.
      </p>
    {/if}
  {:else}
    <h1 class="home__title">REP JOT</h1>
    <p class="home__signed-in">
      Signed in as {account.displayName ?? 'your Google account'}.
    </p>
    <p class="home__pending">
      The workout screens arrive in the next release. REP JOT is connected to your
      Google account and can read your private app-data folder.
    </p>
  {/if}
</div>
