<!--
  The Disconnect Google Account section.
  Phase 19. REQUIREMENTS 21.5, 21.6, 21.7. ARCHITECTURE §10 "Sign out,
  disconnect, and deletion".

  Disconnect is its own action. It is not sign out, which keeps the Google
  grant and the local cache, and it is not Delete All User Data, which removes
  the files but keeps the grant. This section cuts the grant and clears this
  device's local copy of the workout data. The files in Google Drive stay.

  The confirmation is a second press, not a typed phrase. A typed gate is for
  an action that destroys data. Disconnect destroys nothing: the user can sign
  in again and get the same folder back.

  When Google does not confirm the revocation, the section shows the Google
  Account connections link and keeps the local data. The revoke may still land
  later, and a user who cannot confirm it should finish the job where Google
  can see it. REQUIREMENTS 21.7.
-->
<script lang="ts">
  import Button from './Button.svelte';
  import { GOOGLE_ACCOUNT_CONNECTIONS_URL } from '../../auth/auth-service';

  let {
    busy = false,
    revokeFailed = false,
    onconfirm = (): void => {},
    oncancel = (): void => {}
  }: {
    /** True while the revoke call runs. */
    busy?: boolean;
    /** True when Google did not confirm the revocation. */
    revokeFailed?: boolean;
    /** Run the disconnect. */
    onconfirm?: () => void;
    /** Leave the confirmation open state. */
    oncancel?: () => void;
  } = $props();

  /** True while the second-step confirmation is showing. */
  let confirming = $state(false);

  function start(): void {
    confirming = true;
  }

  function cancel(): void {
    confirming = false;
    oncancel();
  }

  function confirm(): void {
    if (busy) return;
    onconfirm();
  }
</script>

<div class="settings-section" role="region" aria-label="Disconnect Google Account">
  <h2 class="settings-section__title">Disconnect Google Account</h2>

  {#if confirming}
    <p class="danger-confirm__warning">
      Disconnecting stops REP JOT from reaching your Google Drive folder and
      clears the workout history and preferences saved on this device. Your
      files stay in Google Drive. You can connect again later by signing in.
    </p>

    <div class="danger-confirm__actions">
      <Button variant="secondary" disabled={busy} onclick={cancel}>Cancel</Button>
      <Button variant="danger" disabled={busy} onclick={confirm}>
        {busy ? 'Disconnecting…' : 'Disconnect Google Account'}
      </Button>
    </div>
  {:else}
    <p class="settings-section__hint">
      Cut the link between REP JOT and your Google account, and clear this
      device's local copy of your history and preferences. Your files stay in
      your Google Drive folder.
    </p>

    <div class="settings-section__actions">
      <Button variant="secondary" disabled={busy} onclick={start}>Disconnect Google Account</Button>
    </div>
  {/if}

  {#if revokeFailed}
    <p class="settings-section__error" role="alert">
        Google did not confirm that it revoked REP JOT access. Your local data
      is still on this device. Open your Google Account connections and remove
      REP JOT there, then try again.
    </p>

    <div class="settings-section__actions">
      <Button variant="secondary" href={GOOGLE_ACCOUNT_CONNECTIONS_URL}>
        Open Google Account connections
      </Button>
    </div>
  {/if}
</div>
