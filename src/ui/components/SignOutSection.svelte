<!--
  The Sign out section.
  REQUIREMENTS 2.12. ARCHITECTURE section 10 "Sign out, disconnect, and
  deletion". PHASE-19 Goal 5.

  Sign out ends this REP JOT session on this device. It is not Disconnect, and
  it is not Delete All User Data. The three actions do different things, and a
  person has to be able to tell them apart before pressing one.

  | Action                | Google grant | Drive files | Local cache |
  | --------------------- | ------------ | ----------- | ----------- |
  | Sign out              | kept         | kept        | kept        |
  | Disconnect            | revoked      | kept        | cleared     |
  | Delete All User Data  | revoked      | removed     | cleared     |

  Sign out keeps the local cache and any pending edit on purpose. The next time
  the same Drive account authorizes, REP JOT picks up where this session
  stopped. That is also why this section sits outside the Danger Zone: nothing
  here destroys anything, and pressing it while an upload is in flight does not
  put work at risk. The flush runs first, so a queued edit reaches local
  storage before the session ends.

  The control is one press with no confirmation. A confirmation gate is for an
  action a person cannot undo. Signing out is undone by signing in again.
-->
<script lang="ts">
  import Button from './Button.svelte';

  let {
    busy = false,
    onconfirm = (): void => {}
  }: {
    /** True while a destructive flow runs, so nothing starts beside it. */
    busy?: boolean;
    /** Run the sign out. */
    onconfirm?: () => void;
  } = $props();

  function confirm(): void {
    if (busy) return;
    onconfirm();
  }
</script>

<div class="settings-section" role="region" aria-label="Sign out">
  <h2 class="settings-section__title">Sign out</h2>

  <p class="settings-section__hint">
    End this REP JOT session on this device. Your files stay in your Google
    Drive folder, and this device keeps its local copy and any pending change.
    Sign in with the same Google account to pick up where you left off.
  </p>

  <div class="settings-section__actions">
    <Button variant="secondary" disabled={busy} onclick={confirm}>Sign out</Button>
  </div>
</div>
