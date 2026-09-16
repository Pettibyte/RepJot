<!--
  The Settings screen.
  Phase 19. REQUIREMENTS 12.3, 12.10, 12.11, 21.1 through 21.7.
  ARCHITECTURE §9, §10 "Sign out, disconnect, and deletion".

  This screen assembles five sections and owns the two flows that reach across
  services: Delete All User Data and Disconnect Google Account. The sections
  are presentational. The screen holds the ordering rules, because the order
  of those two flows is the whole safety of them.

  Ordering rule. Both destructive flows settle local state before they touch
  Drive, and both leave through a full page reload.

  - Delete: `coordinator.reset()` first. It flushes queued edits and drains
    uploads already started, so the queue is empty when the remote delete
    runs. A delete followed by a flush would push the pending edits back up
    and re-create the files the user just removed.
  - Disconnect: `coordinator.flush()` first. Disconnect keeps the remote
    files, so the user's pending edits belong there.
  - Both: reload after the local clear. The shell's `account` prop is fixed
    at mount, so a route change alone would leave the signed-in shell on
    screen with no services under it. A reload rebuilds the page from the
    anonymous state and takes the coordinator, its `pagehide` flush, and every
    held document with it.

  A delete whose revoke comes back unconfirmed is treated as finished for
  local-state purposes. The files are gone, so the services clear and the
  write path dies with them. Only the grant stays uncertain, and that is not
  something this page can settle: the confirmation stays open with the
  Google Account connections link and the user finishes there.
  REQUIREMENTS 21.7.

  Anonymous visitors get the license line and a sign-in control. The other
  sections need a Drive folder, a local store, and a preference service, and
  an anonymous visitor has none of them. Showing empty sections would read as
  "you have no data" instead of "you are not signed in".
-->
<script lang="ts">
  import Button from '../components/Button.svelte';
  import DataExportSection from '../components/DataExportSection.svelte';
  import DeleteAllDataDialog from '../components/DeleteAllDataDialog.svelte';
  import DiagnosticSection from '../components/DiagnosticSection.svelte';
  import DisconnectSection from '../components/DisconnectSection.svelte';
  import ExerciseUnitsSection from '../components/ExerciseUnitsSection.svelte';
  import { services, clearServices } from '../../services/registry';
  import { runDeleteAllUserData, runDisconnect, type AccountFlowDeps } from '../../data/account-flows';
  import { GOOGLE_ACCOUNT_CONNECTIONS_URL, disconnect } from '../../auth/auth-service';
  import { isRecognizedName } from '../../sync/recognized-names';

  /**
   * Leave to the landing screen and rebuild the page.
   *
   * Injectable so a test can watch the exit without a browser. The default
   * sets the hash to the tab root and reloads.
   */
  function defaultExitToLanding(): void {
    if (typeof window === 'undefined') return;
    window.location.hash = '#/';
    window.location.reload();
  }

  let {
    clientId = '',
    onSignIn = (): void => {},
    onExitToLanding = defaultExitToLanding
  }: {
    /** The OAuth client id. Empty means this build has none. */
    clientId?: string;
    /** Start the Google redirect. */
    onSignIn?: ((options: { remember: boolean }) => void) | undefined;
    /** Leave to the landing screen after a disconnect or a delete. */
    onExitToLanding?: () => void;
  } = $props();

  /** True when the Delete All User Data confirmation is open. */
  let deleteOpen = $state(false);
  /** True while the delete runs. */
  let deleteBusy = $state(false);
  /** Failure text from the last delete attempt. */
  let deleteError = $state('');
  /** Recognized files counted when the confirmation opened. */
  let recognizedCount = $state(0);
  /** Files the running delete has removed. Drives the progress line. */
  let deletedCount = $state(0);
  /**
   * Set when the delete finished but Google would not confirm the revoke.
   * The dialog turns this into a link the user can finish the job from.
   */
  let deleteHelpHref = $state('');
  /**
   * True once a delete has cleared this device.
   *
   * The flag is what keeps the confirmation on screen after the services
   * are gone, and it turns Cancel into "leave". Without it a completed
   * delete would drop the user back onto a Settings screen whose sections
   * have all just disappeared, help link included.
   */
  let deleteClearedLocal = $state(false);

  /** True while the disconnect revoke runs. */
  let disconnectBusy = $state(false);
  /** True when Google did not confirm the revocation. */
  let revokeFailed = $state(false);

  const accountKey = $derived($services.accountKey);
  const drive = $derived($services.drive);
  const store = $derived($services.store);
  const signedIn = $derived(accountKey !== null && drive !== null && store !== null);

  /** True once either destructive flow is running, so nothing else starts. */
  const busy = $derived(deleteBusy || disconnectBusy);

  /**
   * Open the delete confirmation with a live count.
   *
   * The count comes from a fresh list, not from a cached one. The user is
   * about to remove everything, so the number they confirm has to be the
   * number on the folder right now. REQUIREMENTS 21.3.
   */
  async function openDelete(): Promise<void> {
    if (drive === null || busy) return;
    deleteBusy = true;
    deleteError = '';
    deleteHelpHref = '';
    deletedCount = 0;
    try {
      const catalog = await drive.listCatalog();
      recognizedCount = catalog.filter((file): boolean => isRecognizedName(file.name)).length;
      deleteOpen = true;
    } catch {
      deleteError = 'REP JOT could not read the file list. Try again.';
    } finally {
      deleteBusy = false;
    }
  }

  function closeDelete(): void {
    if (deleteBusy) return;
    const cleared = deleteClearedLocal;
    deleteOpen = false;
    deleteError = '';
    deleteHelpHref = '';
    deletedCount = 0;
    deleteClearedLocal = false;
    // The device is already cleared, so closing the confirmation is the
    // moment to leave. Staying would park the user on a Settings screen
    // with no services under it, which is the state the reload rule exists
    // to avoid.
    if (cleared) onExitToLanding();
  }

  /**
   * Revoke the grant and report whether Google confirmed.
   *
   * The flow module takes this as a thunk so it never holds a token. The
   * auth service reads the token itself and returns its own verdict.
   */
  async function revokeGrant(): Promise<boolean> {
    const driveAdapter = $services.drive;
    if (driveAdapter === null) return true;
    const result = await disconnect({
      revoke: (accessToken: string): Promise<void> => driveAdapter.revokeToken(accessToken)
    });
    return result.kind === 'revoked';
  }

  /** The deps both destructive flows take, read from the live registry. */
  function flowDeps(): AccountFlowDeps | null {
    const driveAdapter = $services.drive;
    const storeAdapter = $services.store;
    const key = $services.accountKey;
    if (driveAdapter === null || storeAdapter === null || key === null) return null;
    return {
      drive: driveAdapter,
      store: storeAdapter,
      accountKey: key,
      coordinator: $services.coordinator,
      revoke: revokeGrant,
      onProgress: (deleted: number): void => {
        deletedCount = deleted;
      }
    };
  }

  /**
   * Run the delete, then cut the grant.
   *
   * `runDeleteAllUserData` owns the ordering. This handler only reads the
   * result and says something true about it. A partial result leaves the
   * confirmation open with the remaining names, because the user has to
   * know the job is unfinished.
   */
  async function confirmDelete(): Promise<void> {
    const deps = flowDeps();
    if (deps === null || deleteBusy) return;
    deleteBusy = true;
    deleteError = '';
    deleteHelpHref = '';
    try {
      const result = await runDeleteAllUserData(deps);
      if (result.kind === 'partial') {
        deleteError = `Some files are still there: ${result.remainingRecognized.join(
          ', '
        )}. Your local data is kept so you can try again.`;
        return;
      }
      if (result.kind === 'revoke_failed') {
        // The files are gone. Treat that as a finished deletion locally:
        // clearing the services takes the preference service, the
        // coordinator, and the lookup index with them, so nothing on this
        // page can write a recognized file back into the folder the user
        // just emptied. The grant is the only thing left uncertain, and
        // the user finishes that where Google can see it.
        // REQUIREMENTS 21.3, 21.7.
        deleteHelpHref = GOOGLE_ACCOUNT_CONNECTIONS_URL;
        deleteError =
          'The files are deleted, but Google did not confirm the revoke. Remove REP JOT in your Google Account connections.';
        deleteClearedLocal = true;
        clearServices();
        return;
      }
      clearServices();
      onExitToLanding();
    } catch {
      deleteError = 'REP JOT could not finish the delete. Your local data is kept. Try again.';
    } finally {
      deleteBusy = false;
    }
  }

  /**
   * Cut the Google grant and clear this device's local copy.
   *
   * `runDisconnect` owns the ordering. A failed revoke leaves everything in
   * place and shows the Google Account connections link.
   */
  async function confirmDisconnect(): Promise<void> {
    const deps = flowDeps();
    if (deps === null || busy) return;
    disconnectBusy = true;
    revokeFailed = false;
    try {
      const result = await runDisconnect(deps);
      if (result.kind === 'revoke_failed') {
        revokeFailed = true;
        return;
      }
      clearServices();
      onExitToLanding();
    } catch {
      revokeFailed = true;
    } finally {
      disconnectBusy = false;
    }
  }

  /** True when this build carries a usable client id. */
  const canSignIn = $derived(
    clientId.length > 0 && clientId.indexOf('YOUR_CLIENT_ID') !== 0
  );
</script>

<div class="screen screen--narrow settings-screen">
  <h1 class="settings-screen__title">Settings</h1>

  {#if !signedIn && !deleteOpen}
    <div class="settings-section" role="region" aria-label="Account">
      <h2 class="settings-section__title">Account</h2>
      <p class="settings-section__hint">
        Sign in with Google to reach your units, your files, and your history.
        REP JOT stores everything in your own private Google Drive folder.
      </p>
      {#if canSignIn}
        <div class="settings-section__actions">
          <Button variant="primary" block onclick={() => onSignIn({ remember: true })}>
            Continue with Google
          </Button>
        </div>
      {:else}
        <p class="settings-section__empty" role="status">
          This build has no Google client id. Set VITE_GOOGLE_CLIENT_ID and
          build again.
        </p>
      {/if}
    </div>
  {:else}
    <div class="settings-stack">
      <ExerciseUnitsSection preferences={$services.preferences} exercises={$services.staticData?.exercises ?? []} disabled={busy} />

      <DataExportSection drive={drive} />

      <DiagnosticSection disabled={busy} />
    </div>
  {/if}

  <div class="settings-section settings-license" role="region" aria-label="License">
    <p class="settings-license__text">
      For non-commercial use only. For commercial licensing, Contact Pettibyte LLC.
    </p>
    <p class="settings-license__text">
      <a href="./privacy.html">Privacy policy</a>. It explains how REP JOT
      accesses, stores, uses, exports, and deletes your data.
    </p>
  </div>

  {#if signedIn || deleteOpen}
    <div class="settings-section settings-danger" role="region" aria-label="Danger Zone">
      <h2 class="settings-section__title">Danger Zone</h2>

      {#if deleteOpen}
        <DeleteAllDataDialog
          {recognizedCount}
          {deletedCount}
          busy={deleteBusy}
          errorText={deleteError}
          helpHref={deleteHelpHref}
          onconfirm={() => void confirmDelete()}
          oncancel={closeDelete}
        />
      {:else}
        <p class="settings-section__hint">
          Delete All User Data removes the REP JOT files from your Google Drive
          folder and clears this device. Read the warning before you confirm.
        </p>

        <div class="settings-section__actions">
          <Button variant="danger" disabled={busy} onclick={() => void openDelete()}>
            Delete All User Data
          </Button>
        </div>

        {#if deleteError !== ''}
          <p class="settings-section__error" role="alert">{deleteError}</p>
        {/if}
      {/if}

      {#if signedIn}
        <div class="settings-danger__divider"></div>

        <DisconnectSection
          busy={disconnectBusy}
          {revokeFailed}
          onconfirm={() => void confirmDisconnect()}
          oncancel={(): void => {
            revokeFailed = false;
          }}
        />
      {/if}
    </div>
  {/if}
</div>
