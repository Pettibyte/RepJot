<!--
  The anonymous landing page.
  REQUIREMENTS 2.1, 2.8, 16.1, PHASE-16.

  One job: carry an anonymous visitor to Google and back. The page states what
  the app does, states where the data lives, links the privacy policy, and offers
  the sign-in control. It shows no workout content, because an anonymous
  visitor has no history to show and no reason to wait for one.

  The remember choice keeps its meaning from the Phase 15 stopgap: checked holds
  the refresh token on the device, unchecked holds it for the browser session
  only. REQUIREMENTS 2.8.

  The sign-in failure text is set by the shell through the `signInNotice` prop,
  which carries the reason the redirect came back bad. The screen never names a
  token or an account id in the notice. REQUIREMENTS 2.12.
-->
<script lang="ts">
  import Button from '../components/Button.svelte';

  let {
    clientId = '',
    remember = false,
    signInNotice = '',
    onSignIn = (): void => {}
  }: {
    /** The OAuth client id. Empty means this build has none. */
    clientId?: string;
    /** Initial state of the remember choice. */
    remember?: boolean;
    /** Sign-in failure text set by the shell. Empty means no failure to report. */
    signInNotice?: string;
    /** Start the Google redirect with the remember choice. */
    onSignIn?: ((options: { remember: boolean }) => void) | undefined;
  } = $props();

  // Seeded once from the prop. The checkbox is the source of truth after the
  // first render, so a later prop change must not overwrite a choice the user
  // just made.
  // svelte-ignore state_referenced_locally
  let rememberChecked = $state(remember);

  /** True when the build carries a usable client id. */
  const configured = $derived(
    clientId.length > 0 && clientId.indexOf('YOUR_CLIENT_ID') !== 0
  );
</script>

<div class="screen screen--narrow landing">
  <h1 class="landing__wordmark">REP JOT</h1>

  <p class="landing__intro">
    Track the workout you did, not the one you planned to. REP JOT keeps your log
    in your own private Google Drive folder.
  </p>

  <ul class="landing__points">
    <li class="landing__point">Your history is yours. REP JOT asks for app-data access only.</li>
    <li class="landing__point">No other app can read that folder, and REP JOT shows no ads.</li>
    <li class="landing__point">Sign in on any device and your log follows you.</li>
  </ul>

  {#if signInNotice !== ''}
    <p class="landing__notice" role="alert">{signInNotice}</p>
  {/if}

  {#if configured}
    <label class="field landing__remember">
      <span class="field__label">
        <input type="checkbox" bind:checked={rememberChecked} />
        Remember me on this device
      </span>
      <span class="field__hint">
        Leave this off on a shared device. REP JOT then forgets the sign-in when you
        close the browser.
      </span>
    </label>

    <div class="landing__actions">
      <Button variant="primary" block onclick={() => onSignIn({ remember: rememberChecked })}>
        Continue with Google
      </Button>
    </div>
  {:else}
    <p class="landing__unconfigured" role="status">
      This build has no Google client id. Set VITE_GOOGLE_CLIENT_ID and build again.
    </p>
  {/if}

  <p class="landing__privacy">
    <a class="landing__privacy-link" href="./privacy.html">Privacy policy</a>
    <span aria-hidden="true"> · </span>
    <a class="landing__privacy-link" href="./terms.html">Terms of service</a>
  </p>
</div>
