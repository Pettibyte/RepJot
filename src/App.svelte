<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import {
    createHelloWorld,
    deleteHelloWorld,
    DriveHttpError,
    findHelloWorldFile,
    getDriveAccount,
    readHelloWorld,
    updateHelloWorld,
    type DriveAccount,
    type HelloWorldDocument
  } from './google-drive';
  import {
    GOOGLE_ACCOUNT_CONNECTIONS_URL,
    beginDriveAuthorization,
    bindDriveAuthorization,
    clearDriveAuthorization,
    millisecondsUntilExpiry,
    restoreDriveAuthorization,
    revokeDriveAuthorization,
    type DriveAuthorization
  } from './google-identity';

  export let initialAuthorization: DriveAuthorization | null = null;
  export let initialAuthorizationError: string | null = null;

  const clientId: string = import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim() ?? '';
  const configured: boolean = clientId.length > 0 && !clientId.startsWith('YOUR_CLIENT_ID');

  let authorization: DriveAuthorization | null = null;
  let account: DriveAccount | null = null;
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

  function signOutWithStatus(message: string): void {
    clearExpiryTimer();
    clearDriveAuthorization();
    authorization = null;
    account = null;
    fileId = null;
    busy = false;
    status = message;
  }

  function startExpiryTimer(current: DriveAuthorization): void {
    clearExpiryTimer();
    const delay = millisecondsUntilExpiry(current);
    if (delay === 0) {
      signOutWithStatus('Google Drive access expired. Authorize REP JOT again.');
      return;
    }
    expiryTimer = window.setTimeout(() => {
      signOutWithStatus('Google Drive access expired. Authorize REP JOT again.');
    }, delay);
  }

  function handleDriveError(error: unknown): void {
    if (error instanceof DriveHttpError && error.status === 401) {
      signOutWithStatus('Google Drive access expired. Authorize REP JOT again.');
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

  async function bindAccountAndLoad(current: DriveAuthorization): Promise<void> {
    authorization = current;
    remember = current.remember;
    startExpiryTimer(current);
    if (authorization === null) return;
    busy = true;
    status = 'Binding this token to its Google Drive account…';
    try {
      const driveAccount = await getDriveAccount(current.accessToken);
      if (authorization !== current) return;
      authorization = bindDriveAuthorization(current, driveAccount.accountKey);
      account = driveAccount;
      status = 'Loading the prototype document from Google Drive…';
      await loadFromDrive(current.accessToken);
    } catch (error: unknown) {
      handleDriveError(error);
    } finally {
      busy = false;
    }
  }

  function authorize(selectAccount = false): void {
    if (!configured || busy) return;
    busy = true;
    status = 'Redirecting to Google in this window…';
    try {
      beginDriveAuthorization(clientId, {
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
    clearDriveAuthorization();
    account = null;
    authorization = null;
    fileId = null;
    authorize(true);
  }

  function signOut(): void {
    signOutWithStatus('Signed out from REP JOT. The Google grant remains active.');
  }

  function retryAccountBinding(): void {
    const current = authorization;
    if (current !== null) void bindAccountAndLoad(current);
  }

  onMount(() => {
    if (initialAuthorizationError !== null) {
      status = `Error: ${initialAuthorizationError}`;
      return;
    }

    const current = initialAuthorization === null
      ? restoreDriveAuthorization()
      : initialAuthorization;
    if (current !== null) void bindAccountAndLoad(current);
  });

  onDestroy(clearExpiryTimer);

  async function save(): Promise<void> {
    if (authorization === null || account === null) return;
    busy = true;
    status = 'Saving to Google Drive…';
    try {
      const document: HelloWorldDocument = { helloWorld };
      if (fileId === null) {
        const file = await createHelloWorld(authorization.accessToken, document);
        fileId = file.id;
      } else {
        await updateHelloWorld(authorization.accessToken, fileId, document);
      }
      status = 'Saved to Google Drive.';
    } catch (error: unknown) {
      handleDriveError(error);
    } finally {
      busy = false;
    }
  }

  async function remove(): Promise<void> {
    if (authorization === null || fileId === null) return;
    busy = true;
    status = 'Deleting from Google Drive…';
    try {
      await deleteHelloWorld(authorization.accessToken, fileId);
      fileId = null;
      status = 'Deleted from Google Drive.';
    } catch (error: unknown) {
      handleDriveError(error);
    } finally {
      busy = false;
    }
  }

  async function disconnect(): Promise<void> {
    if (authorization === null || account === null) return;
    busy = true;
    showRevocationFallback = false;
    status = 'Asking Google to revoke REP JOT access…';
    try {
      await revokeDriveAuthorization(authorization.accessToken);
      signOutWithStatus('Google confirmed the revocation. REP JOT is disconnected.');
    } catch (error: unknown) {
      showRevocationFallback = true;
      status = `Error: ${errorMessage(error)} Use the Google Account connections page.`;
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
    {#if authorization !== null}
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
        <dd>{authorization?.remember ? 'Remembered on this device' : 'This browser session only'}</dd>
        <dt>Expires at UTC</dt>
        <dd>{authorization?.expiresAtUtc}</dd>
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

  {#if showRevocationFallback}
    <p>
      REP JOT kept the local authorization state because Google did not confirm revocation.
      <a href={GOOGLE_ACCOUNT_CONNECTIONS_URL}>Open Google Account connections</a>.
    </p>
  {/if}

  <p><a href="./capabilities.html">Run browser capability report</a></p>
</main>
