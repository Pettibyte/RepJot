<script lang="ts">
  import {
    createHelloWorld,
    findHelloWorldFile,
    readHelloWorld,
    updateHelloWorld,
    type HelloWorldDocument
  } from './google-drive';
  import { requestDriveAccessToken } from './google-identity';

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

  async function signIn(): Promise<void> {
    if (!configured) return;
    busy = true;
    status = 'Signing in…';
    try {
      accessToken = await requestDriveAccessToken(clientId);
      status = 'Loading from Google Drive…';
      const file = await findHelloWorldFile(accessToken);
      if (file === null) {
        fileId = null;
        status = 'Signed in. No saved document yet.';
      } else {
        fileId = file.id;
        const document: HelloWorldDocument = await readHelloWorld(accessToken, file.id);
        helloWorld = document.helloWorld;
        status = 'Loaded from Google Drive.';
      }
    } catch (error: unknown) {
      accessToken = null;
      status = `Error: ${errorMessage(error)}`;
    } finally {
      busy = false;
    }
  }

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
</script>

<main>
  <h1>Google Drive hello world</h1>

  {#if accessToken === null}
    <button type="button" onclick={signIn} disabled={!configured || busy}>Sign in with Google</button>
  {:else}
    <label for="hello-world">Hello-world text</label>
    <input id="hello-world" bind:value={helloWorld} disabled={busy} />
    <button type="button" onclick={save} disabled={busy}>Save to Google Drive</button>
  {/if}

  <p>{status}</p>

  <p><a href="/capabilities.html">Run browser capability report</a></p>
</main>
