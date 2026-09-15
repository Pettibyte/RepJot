<script lang="ts">
  // The application shell.
  // ARCHITECTURE section 9. REQUIREMENTS 4.3, 16.1, 16.2.
  //
  // The shell owns four things and nothing else: the header variant, the tab bar,
  // the route outlet, and the error banner. Every screen is a child. The shell
  // reads state; it never writes user data.
  //
  // Header variant. A tab root renders the REP JOT header with the Workout,
  // History, and Settings tabs. Every other route renders the compact back
  // header, which keeps the tab bar away from a screen the user is working in.
  // REQUIREMENTS 16.1 and 16.2.
  //
  // Startup gate. The shell renders no screen until `startupStatus` says the
  // static bundle is good. A static-data failure renders the blocker instead,
  // because a half-loaded bundle cannot answer any question a screen asks. The
  // raw viewer is the one exception: **View Raw JSON** must work from the
  // blocker, so the raw route renders the viewer through the normal outlet.
  // REQUIREMENTS 6.9.
  //
  // Route outlet. Phase 15 ships the home screen and the raw viewer. The routes
  // that later phases own resolve to the not-found screen until their component
  // is registered here, so an unbuilt address never renders a blank page.

  import type { Readable } from 'svelte/store';
  import AppHeader from './ui/components/AppHeader.svelte';
  import BackHeader from './ui/components/BackHeader.svelte';
  import Button from './ui/components/Button.svelte';
  import DataError from './ui/components/DataError.svelte';
  import type { DataErrorProps } from './ui/components/data-error-types';
  import HomeScreen from './ui/screens/HomeScreen.svelte';
  import NotFoundScreen from './ui/screens/NotFoundScreen.svelte';
  import RawJsonScreen from './ui/screens/RawJsonScreen.svelte';
  import Tabs from './ui/components/Tabs.svelte';
  import { parentRoute, formatRoute, isTabRoot, type Route } from './routing/routes';
  import {
    activeError,
    clearError,
    saveStatus,
    startupStatus,
    type SaveStatus
  } from './state/app-state';
  import type { ShellAccount } from './app-types';

  let {
    route,
    account = null,
    clientId = '',
    onSignIn = (): void => {}
  }: {
    /** The live route published by the router. */
    route: Readable<Route>;
    /** The bound account, or `null` while anonymous. */
    account?: ShellAccount | null;
    /** The OAuth client id. Empty means this build has none. */
    clientId?: string;
    /** Start the Google redirect. */
    onSignIn?: ((options: { remember: boolean }) => void) | undefined;
  } = $props();

  /** Back-header titles. A tab root needs none because the wordmark names the app. */
  const HEADER_TITLES: Record<string, string> = {
    'workout-overview': 'Workout',
    'session-active': 'Active Workout',
    'session-summary': 'Workout Summary',
    'exercise-history': 'Exercise History',
    'raw-json': 'Raw JSON',
    'not-found': 'Not found'
  };

  const current = $derived($route);
  const tabRoot = $derived(isTabRoot(current));
  const backHref = $derived(formatRoute(parentRoute(current)));
  const headerTitle = $derived(HEADER_TITLES[current.name] ?? '');

  /**
   * The address to show on the not-found screen.
   *
   * A route the parser could not match carries the text the user typed. A route
   * that parsed but has no component yet shows its own canonical hash, so the
   * screen names the address the user asked for either way.
   */
  const attemptedAddress = $derived(
    current.name === 'not-found' ? current.attempted : formatRoute(current)
  );

  /** The save badge text. `idle` shows nothing, so the header stays quiet. */
  function saveStatusLabel(status: SaveStatus): string {
    if (status === 'saving') return 'Saving…';
    if (status === 'saved') return 'Saved';
    if (status === 'sync_failed') return 'Sync failed';
    return '';
  }

  /** Read one numeric field out of an error's safe detail record. */
  function numberField(detail: Record<string, string | number>, key: string): number | undefined {
    const value = detail[key];
    return typeof value === 'number' ? value : undefined;
  }

  /**
   * The blocker card for a startup failure.
   *
   * The card reports the error family and message, and carries a serialized copy
   * of the safe error fields as its raw text. The serialization holds only the
   * typed kind, the safe detail record, and the message, so **View Raw JSON**
   * shows what the app knew without inventing document bytes.
   */
  const blockerProps = $derived.by((): DataErrorProps => {
    const error = $activeError;
    if (error === null) {
      return {
        title: 'REP JOT could not load its bundled data.',
        detail: 'Reload the page to try again.',
        rawJson: ''
      };
    }
    return {
      title: 'REP JOT could not load its bundled data.',
      family: error.kind,
      declaredVersion: numberField(error.detail, 'declaredVersion'),
      maxSupportedVersion: numberField(error.detail, 'maxSupportedVersion'),
      detail: `${error.message} Reload the page to try again.`,
      rawJson: JSON.stringify(
        { kind: error.kind, detail: error.detail, message: error.message },
        null,
        2
      )
    };
  });

  /** The tab items, with the current route marked. */
  const tabItems = $derived([
    { href: '#/', label: 'Workout', current: current.name === 'home' },
    { href: '#/history', label: 'History', current: current.name === 'history' },
    { href: '#/settings', label: 'Settings', current: current.name === 'settings' }
  ]);
</script>

{#snippet saveStatusBadge()}
  <span class="save-status" role="status" aria-live="polite">
    {saveStatusLabel($saveStatus)}
  </span>
{/snippet}

{#if $startupStatus === 'loading_static'}
  <div class="screen">
    <p class="shell__loading" role="status">Loading REP JOT…</p>
  </div>
{:else if ($startupStatus === 'static_failed' || $startupStatus === 'blocked') && current.name !== 'raw-json'}
  <div class="screen screen--narrow">
    <div class="blocker">
      <h1 class="blocker__title">REP JOT cannot start</h1>
      <p class="blocker__intro">
        The bundled data did not load, so the app cannot show a workout. Nothing you recorded is lost.
      </p>
      <DataError props={blockerProps} />
      <div class="blocker__actions">
        <Button variant="primary" href="./">Reload the page</Button>
      </div>
    </div>
  </div>
{:else}
  <div class="shell">
    {#if tabRoot}
      <AppHeader status={saveStatusBadge} />
      <Tabs items={tabItems} label="Sections" />
    {:else}
      <BackHeader href={backHref} title={headerTitle} backLabel="Back" status={saveStatusBadge} />
    {/if}

    {#if $activeError !== null}
      <div class="shell__banner" role="alert">
        <p class="shell__banner-text">{$activeError.message}</p>
        <div class="shell__banner-actions">
          <Button variant="secondary" onclick={clearError}>Dismiss</Button>
        </div>
      </div>
    {/if}

    <main class="shell__outlet">
      {#if current.name === 'home'}
        <HomeScreen {account} {clientId} {onSignIn} />
      {:else if current.name === 'raw-json'}
        <RawJsonScreen source={current.source} />
      {:else}
        <NotFoundScreen attempted={attemptedAddress} />
      {/if}
    </main>
  </div>
{/if}
