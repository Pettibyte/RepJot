<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import {
    createHelloWorld,
    deleteHelloWorld,
    DriveHttpError,
    findHelloWorldFile,
    readHelloWorld,
    updateHelloWorld,
    type DriveAccount,
    type HelloWorldDocument
  } from './google-drive';
  import {
    beginAuthorization,
    hasStoredToken,
    isTokenRemembered,
    type CallbackResult
  } from './auth/oauth-redirect-adapter';
  import {
    disconnect as disconnectAccount,
    expireSession,
    millisecondsUntilExpiry,
    restoreAndBind,
    signOut as clearDeviceSession,
    type AuthSession
  } from './auth/auth-service';
  import {
    bindAccountWithProfile,
    GOOGLE_ACCOUNT_CONNECTIONS_URL,
    probeRejected,
    revokeToken
  } from './auth/drive-operations';
  import { activeError, clearError } from './state/app-state';

  export let initialCallback: CallbackResult | null = null;

  const clientId: string = import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim() ?? '';
  const configured: boolean = clientId.length > 0 && !clientId.startsWith('YOUR_CLIENT_ID');

  let session: AuthSession | null = null;
  let account: DriveAccount | null = null;
  // True when a live token record sits in browser storage. The view keys off this,
  // not off `session`, so a token that failed to bind still exposes a way to
  // erase it. REQUIREMENTS 2.12.
  let storedToken: boolean = hasStoredToken();
  let fileId: string | null = null;
  let helloWorld = 'Hello, world!';
  let remember = false;
  let busy = false;
  let showRevocationFallback = false;
  let expiryTimer: number | null = null;
  let status = configured
    ? 'Authorize REP JOT to use its private Google Drive app data.'
    : 'Set VITE_GOOGLE_CLIENT_ID in .env.local. Then restart the development server.';

  function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  function clearExpiryTimer(): void {
    if (expiryTimer !== null) {
      window.clearTimeout(expiryTimer);
      expiryTimer = null;
    }
  }

  function clearView(message: string): void {
    clearExpiryTimer();
    session = null;
    account = null;
    fileId = null;
    busy = false;
    storedToken = hasStoredToken();
    status = message;
  }

  function startExpiryTimer(): void {
    clearExpiryTimer();
    const delay = millisecondsUntilExpiry();
    if (delay === 0) {
      expireSession('expired');
      clearView('Google access expired. Sign in to REP JOT again.');
      return;
    }
    expiryTimer = window.setTimeout(() => {
      expireSession('expired');
      clearView('Google access expired. Sign in to REP JOT again.');
    }, delay);
  }

  function handleDriveError(error: unknown): void {
    if (error instanceof DriveHttpError && error.status === 401) {
      expireSession('unauthorized');
      clearView('Google access expired. Sign in to REP JOT again.');
      return;
    }
    status = `Error: ${errorMessage(error)}`;
  }

  async function loadFromDrive(token: string): Promise<void> {
    const file = await findHelloWorldFile(token);
    if (file === null) {
      fileId = null;
      status = 'Authorized. No saved prototype document exists.';
    } else {
      fileId = file.id;
      const document: HelloWorldDocument = await readHelloWorld(token, file.id);
      helloWorld = document.helloWorld;
      status = 'Authorized and loaded from Google Drive.';
    }
  }

  async function afterSignedIn(current: AuthSession): Promise<void> {
    session = current;
    account = {
      accountKey: current.accountKey,
      ...(current.displayName === undefined ? {} : { displayName: current.displayName })
    };
    storedToken = true;
    remember = isTokenRemembered();
    startExpiryTimer();
    busy = true;
    status = 'Loading the prototype document from Google Drive…';
    try {
      await loadFromDrive(current.accessToken);
    } catch (error: unknown) {
      handleDriveError(error);
    } finally {
      busy = false;
    }
  }

  async function restore(fallbackMessage: string = 'Sign in to REP JOT with Google.'): Promise<void> {
    // A new sign-in attempt starts. Drop the error the previous attempt left on
    // screen before this one reports its own result.
    clearError();
    busy = true;
    status = 'Restoring your REP JOT session…';
    try {
      const restored = await restoreAndBind({ bind: bindAccountWithProfile });
      if (restored === null) {
        clearView(fallbackMessage);
        return;
      }
      await afterSignedIn(restored);
    } catch (error: unknown) {
      handleDriveError(error);
    }
  }

  function authorize(selectAccount = false): void {
    if (!configured || busy) return;
    clearError();
    busy = true;
    status = 'Redirecting to Google in this window…';
    try {
      beginAuthorization(clientId, {
        remember,
        returnRoute: window.location.hash,
        selectAccount
      });
    } catch (error: unknown) {
      status = `Error: ${errorMessage(error)}`;
      busy = false;
    }
  }

  function switchAccount(): void {
    clearDeviceSession();
    clearView('Switching Google account…');
    authorize(true);
  }

  function signOut(): void {
    clearDeviceSession();
    clearView('Signed out from REP JOT. The Google grant remains active.');
  }

  function retryAccountBinding(): void {
    void restore();
  }

  function callbackErrorText(result: CallbackResult): string {
    if (result.error === 'access_denied') {
      return 'Google authorization was denied. No access token was saved.';
    }
    if (result.kind === 'invalid_state') {
      return 'Google returned an unexpected state. Sign in again.';
    }
    return `Google authorization did not complete (${result.error ?? 'unknown'}). Try again.`;
  }

  onMount(() => {
    const callback = initialCallback;
    if (callback !== null && callback.kind !== 'accepted' && callback.kind !== 'duplicate') {
      // A rejected callback does not erase a stored token. Try the stored token
      // first, and show the denial only when nothing restores. REQUIREMENTS 2.10.
      void restore(callbackErrorText(callback));
      return;
    }
    // An accepted or duplicate callback already stored its token. Bind it before
    // any private data opens. REQUIREMENTS 2.11.
    void restore();
  });

  onDestroy(clearExpiryTimer);

  async function save(): Promise<void> {
    if (session === null || account === null) return;
    busy = true;
    status = 'Saving to Google Drive…';
    try {
      const document: HelloWorldDocument = { helloWorld };
      if (fileId === null) {
        const file = await createHelloWorld(session.accessToken, document);
        fileId = file.id;
      } else {
        await updateHelloWorld(session.accessToken, fileId, document);
      }
      status = 'Saved to Google Drive.';
    } catch (error: unknown) {
      handleDriveError(error);
    } finally {
      busy = false;
    }
  }

  async function remove(): Promise<void> {
    if (session === null || fileId === null) return;
    busy = true;
    status = 'Deleting from Google Drive…';
    try {
      await deleteHelloWorld(session.accessToken, fileId);
      fileId = null;
      status = 'Deleted from Google Drive.';
    } catch (error: unknown) {
      handleDriveError(error);
    } finally {
      busy = false;
    }
  }

  async function disconnect(): Promise<void> {
    if (session === null || account === null) return;
    busy = true;
    showRevocationFallback = false;
    status = 'Asking Google to revoke REP JOT access…';
    try {
      const result = await disconnectAccount({ revoke: revokeToken, probeRejected });
      if (result.kind === 'revoked') {
        clearView('Google confirmed the revocation. REP JOT is disconnected.');
      } else {
        showRevocationFallback = true;
        status = 'Error: Google did not confirm the revocation. Use the Google Account connections page.';
      }
    } finally {
      busy = false;
    }
  }
</script>

<main>
  <h1>REP JOT authorization continuity proof</h1>

  {#if account === null}
    <p>
      This prototype requests only private <code>drive.appdata</code> access. Google authorization replaces this page.
    </p>
    <label>
      <input type="checkbox" bind:checked={remember} disabled={busy} />
      Remember me on this device
    </label>
    <p>
      If selected, the access token remains in local browser storage until its exact expiry time. Clear this option on a shared device.
    </p>
    <button type="button" onclick={() => authorize(false)} disabled={!configured || busy}>
      Continue with Google
    </button>
    {#if session !== null || storedToken}
      <button type="button" onclick={retryAccountBinding} disabled={busy}>
        Retry account binding
      </button>
      <button type="button" onclick={signOut} disabled={busy}>Sign out from REP JOT</button>
    {/if}
  {:else}
    <section aria-labelledby="authorization-status">
      <h2 id="authorization-status">Authorized account</h2>
      <dl>
        <dt>Google account</dt>
        <dd>{account.displayName ?? 'Name not returned'}</dd>
        <dt>Account binding</dt>
        <dd>Bound to this access token</dd>
        <dt>Token storage</dt>
        <dd>{remember ? 'Remembered on this device' : 'This browser session only'}</dd>
        <dt>Expires at UTC</dt>
        <dd>{session?.expiresAtUtc}</dd>
      </dl>
    </section>

    <label for="hello-world">Prototype text</label>
    <input id="hello-world" bind:value={helloWorld} disabled={busy} />
    <button type="button" onclick={save} disabled={busy}>Save to Google Drive</button>
    <button type="button" onclick={remove} disabled={busy || fileId === null}>Delete from Google Drive</button>

    <h2>Authorization actions</h2>
    <button type="button" onclick={switchAccount} disabled={busy}>Switch Google account</button>
    <button type="button" onclick={signOut} disabled={busy}>Sign out from REP JOT</button>
    <button type="button" onclick={disconnect} disabled={busy}>Disconnect Google Account</button>
  {/if}

  <p role="status" aria-live="polite">{status}</p>

  {#if $activeError !== null}
    <p role="alert">{$activeError.message}</p>
  {/if}

  {#if showRevocationFallback}
    <p>
      REP JOT kept the local authorization state because Google did not confirm revocation.
      <a href={GOOGLE_ACCOUNT_CONNECTIONS_URL}>Open Google Account connections</a>.
    </p>
  {/if}

  <p><a href="./capabilities.html">Run browser capability report</a></p>
</main>
