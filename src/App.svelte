<script lang="ts">
  import { onMount } from 'svelte';
  import {
    createHelloWorld,
    deleteHelloWorld,
    findHelloWorldFile,
    readHelloWorld,
    updateHelloWorld,
    type HelloWorldDocument
  } from './google-drive';
  import { beginDriveAuthorization, consumeDriveAuthorizationResponse } from './google-identity';

  const clientId: string = import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim() ?? '';
  const configured: boolean = clientId.length > 0 && !clientId.startsWith('YOUR_CLIENT_ID');

  let accessToken: string | null = null;
  let fileId: string | null = null;
  let helloWorld = 'Hello, world!';
  let busy = false;
  let status = configured
    ? 'Sign in to load your saved message.'
    : 'Set VITE_GOOGLE_CLIENT_ID in .env.local, then restart the development server.';

  function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  async function loadFromDrive(token: string): Promise<void> {
    const file = await findHelloWorldFile(token);
    if (file === null) {
      fileId = null;
      status = 'Signed in. No saved document yet.';
    } else {
      fileId = file.id;
      const document: HelloWorldDocument = await readHelloWorld(token, file.id);
      helloWorld = document.helloWorld;
      status = 'Loaded from Google Drive.';
    }
  }

  function signIn(): void {
    if (!configured) return;
    busy = true;
    status = 'Redirecting to Google…';
    try {
      beginDriveAuthorization(clientId);
    } catch (error: unknown) {
      status = `Error: ${errorMessage(error)}`;
      busy = false;
    }
  }

  onMount(() => {
    let returnedToken: string | null;
    try {
      returnedToken = consumeDriveAuthorizationResponse();
    } catch (error: unknown) {
      status = `Error: ${errorMessage(error)}`;
      return;
    }

    if (returnedToken === null) return;

    accessToken = returnedToken;
    busy = true;
    status = 'Loading from Google Drive…';
    loadFromDrive(returnedToken).catch((error: unknown) => {
      accessToken = null;
      status = `Error: ${errorMessage(error)}`;
    }).finally(() => {
      busy = false;
    });
  });

  async function save(): Promise<void> {
    if (accessToken === null) return;
    busy = true;
    status = 'Saving to Google Drive…';
    try {
      const document: HelloWorldDocument = { helloWorld };
      if (fileId === null) {
        const file = await createHelloWorld(accessToken, document);
        fileId = file.id;
      } else {
        await updateHelloWorld(accessToken, fileId, document);
      }
      status = 'Saved to Google Drive.';
    } catch (error: unknown) {
      status = `Error: ${errorMessage(error)}`;
    } finally {
      busy = false;
    }
  }

  async function remove(): Promise<void> {
    if (accessToken === null || fileId === null) return;
    busy = true;
    status = 'Deleting from Google Drive…';
    try {
      await deleteHelloWorld(accessToken, fileId);
      fileId = null;
      status = 'Deleted from Google Drive.';
    } catch (error: unknown) {
      status = `Error: ${errorMessage(error)}`;
    } finally {
      busy = false;
    }
  }
</script>

<main>
  <h1>Google Drive hello world</h1>

  {#if accessToken === null}
    <button type="button" onclick={signIn} disabled={!configured || busy}>Sign in with Google</button>
  {:else}
    <label for="hello-world">Hello-world text</label>
    <input id="hello-world" bind:value={helloWorld} disabled={busy} />
    <button type="button" onclick={save} disabled={busy}>Save to Google Drive</button>
    <button type="button" onclick={remove} disabled={busy || fileId === null}>Delete from Google Drive</button>
  {/if}

  <p>{status}</p>

  <p><a href="./capabilities.html">Run browser capability report</a></p>
</main>
