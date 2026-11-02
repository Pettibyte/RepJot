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
  // Route outlet. Phase 17 registers the Active Workout screen, so a started
  // session opens into the editor instead of the typed not-found state. Phase
  // 18 registers the summary, history, and exercise-history screens. Phase 19
  // registers the Settings screen.

  import { onMount, setContext, tick } from 'svelte';
  import type { Readable } from 'svelte/store';
  import AppHeader from './ui/components/AppHeader.svelte';
  import BackHeader from './ui/components/BackHeader.svelte';
  import Button from './ui/components/Button.svelte';
  import DataError from './ui/components/DataError.svelte';
  import type { DataErrorProps } from './ui/components/data-error-types';
  import LandingScreen from './ui/screens/LandingScreen.svelte';
  import NotFoundScreen from './ui/screens/NotFoundScreen.svelte';
  import RawJsonScreen from './ui/screens/RawJsonScreen.svelte';
  import SettingsScreen from './ui/screens/SettingsScreen.svelte';
  import ActiveWorkoutScreen from './ui/screens/ActiveWorkoutScreen.svelte';
  import ExerciseHistoryScreen from './ui/screens/ExerciseHistoryScreen.svelte';
  import WorkoutHistoryScreen from './ui/screens/WorkoutHistoryScreen.svelte';
  import WorkoutSummaryScreen from './ui/screens/WorkoutSummaryScreen.svelte';
  import WorkoutChooserScreen from './ui/screens/WorkoutChooserScreen.svelte';
  import WorkoutOverviewScreen from './ui/screens/WorkoutOverviewScreen.svelte';
  import Tabs from './ui/components/Tabs.svelte';
  import { parentRoute, formatRoute, isTabRoot, type Route } from './routing/routes';
  import { getRouter } from './routing/router-registry';
  import {
    createScrollController, manageScrollRestoration, windowScrollEnv
  } from './routing/scroll-position';
  import {
    SCREEN_READINESS_CONTEXT, SCREEN_NAVIGATION_CONTEXT, type ScreenReadyReporter
  } from './routing/screen-ready';
  import type { NavigationInfo } from './routing/hash-router';
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
  // Keep a real link for bookmarks, modified clicks, and no-router rendering.
  // Ordinary clicks traverse the previous app entry instead of pushing a URL.
  const backRoute = $derived(getRouter()?.originFor(current) ?? parentRoute(current));
  const backHref = $derived(formatRoute(backRoute));
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
    {
      href: '#/',
      label: 'Workout',
      icon: 'fitness_center',
      current: current.name === 'home'
    },
    {
      href: '#/history',
      label: 'History',
      icon: 'receipt_long',
      current: current.name === 'history'
    },
    {
      href: '#/settings',
      label: 'Settings',
      icon: 'settings',
      current: current.name === 'settings'
    }
  ]);

  /**
   * True when a sign-in failure belongs on the landing page, not the banner.
   *
   * A denied consent comes back as an `authentication` error while the user is
   * still anonymous on `#/`. Showing it inside the landing page puts the reason
   * beside the control that failed, so **Continue with Google** is right there.
   * Everywhere else the banner carries it. REQUIREMENTS 2.10, 2.12.
   */
  const signInFailureInline = $derived(
    current.name === 'home' && account === null && $activeError?.kind === 'authentication'
  );

  const signInNotice = $derived(signInFailureInline ? ($activeError?.message ?? '') : '');

  /** The banner error, with the sign-in failure pulled out to the landing page. */
  const bannerError = $derived(signInFailureInline ? null : $activeError);

  const scrollController = createScrollController();
  let handledNavigation: NavigationInfo | null = null;
  let departureCapturedFor: NavigationInfo | null = null;
  let readinessNavigation = $state.raw<NavigationInfo | null>(null);
  let readyNavigation = $state.raw<NavigationInfo | null>(null);

  setContext(SCREEN_NAVIGATION_CONTEXT, () => readinessNavigation);
  setContext<ScreenReadyReporter>(SCREEN_READINESS_CONTEXT, (key) => {
    if (key === formatRoute(current)) readyNavigation = readinessNavigation;
  });

  $effect.pre(() => {
    const key = formatRoute(current);
    const nav = getRouter()?.lastNavigation() ?? null;
    if (nav !== null && formatRoute(nav.to) === key && readinessNavigation !== nav) {
      readinessNavigation = nav;
      readyNavigation = null;
    }
  });

  // Async screens report after their content (or error state) has rendered.
  // Other screens have no initial async content that affects their height.
  $effect(() => {
    const router = getRouter();
    const nav = router?.lastNavigation() ?? null;
    if (router === null || nav === null || $startupStatus === 'loading_static') return;
    const key = formatRoute(current);
    if (formatRoute(nav.to) !== key) return;
    const blocked = ($startupStatus === 'static_failed' || $startupStatus === 'blocked') &&
      current.name !== 'raw-json';
    const waitsForContent = !blocked && (current.name === 'session-active' ||
      current.name === 'session-summary' || current.name === 'exercise-history' ||
      current.name === 'history');
    if (waitsForContent && readyNavigation !== nav) return;
    let cancelled = false;
    void tick().then(() => {
      if (cancelled || router.lastNavigation() !== nav) return;
      scrollController.handle(nav, router.scrollForCurrent());
      handledNavigation = nav;
      router.saveScroll(windowScrollEnv.getY());
    });
    return () => { cancelled = true; };
  });

  function saveScroll(): void {
    const router = getRouter();
    // Ignore layout clamping while a different entry is loading.
    if (router === null || router.lastNavigation() !== handledNavigation) return;
    router.saveScroll(windowScrollEnv.getY());
  }

  function saveDepartingScroll(): void {
    const router = getRouter();
    const nav = router?.lastNavigation();
    // The address has changed, but Svelte still shows the departing DOM. Save
    // by entry ID so this cannot overwrite the destination's scroll snapshot.
    if (router === null || nav === null || nav === undefined || handledNavigation === null ||
        nav === handledNavigation || nav === departureCapturedFor ||
        nav.fromEntryId !== handledNavigation.entryId) return;
    departureCapturedFor = nav;
    router.saveScroll(windowScrollEnv.getY(), handledNavigation.entryId);
  }

  function goBack(event: MouseEvent): void {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey ||
        event.ctrlKey || event.shiftKey || event.altKey) return;
    const router = getRouter();
    if (router === null) return;
    event.preventDefault();
    saveScroll();
    router.back();
  }

  onMount(() => {
    const restoreMode = manageScrollRestoration();
    const cancelRestore = (): void => {
      scrollController.cancel(getRouter()?.lastNavigation() ?? null);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) {
        cancelRestore();
      }
    };
    // Capture links before the router sees their fragment navigation.
    document.addEventListener('click', saveScroll, true);
    window.addEventListener('scroll', saveScroll, { passive: true });
    window.addEventListener('pagehide', saveScroll);
    window.addEventListener('popstate', saveDepartingScroll);
    window.addEventListener('hashchange', saveDepartingScroll);
    window.addEventListener('wheel', cancelRestore, { passive: true });
    window.addEventListener('touchstart', cancelRestore, { passive: true });
    window.addEventListener('pointerdown', cancelRestore, { passive: true });
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', saveScroll, true);
      window.removeEventListener('scroll', saveScroll);
      window.removeEventListener('pagehide', saveScroll);
      window.removeEventListener('popstate', saveDepartingScroll);
      window.removeEventListener('hashchange', saveDepartingScroll);
      window.removeEventListener('wheel', cancelRestore);
      window.removeEventListener('touchstart', cancelRestore);
      window.removeEventListener('pointerdown', cancelRestore);
      window.removeEventListener('keydown', onKey);
      restoreMode();
    };
  });
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
      <BackHeader href={backHref} title={headerTitle} backLabel="Back" status={saveStatusBadge} onclick={goBack} />
    {/if}

    {#if bannerError !== null}
      <div class="shell__banner" role="alert">
        <p class="shell__banner-text">{bannerError.message}</p>
        <div class="shell__banner-actions">
          <Button variant="secondary" onclick={clearError}>Dismiss</Button>
        </div>
      </div>
    {/if}

    <main class="shell__outlet">
      {#if current.name === 'home'}
        {#if account === null}
          <LandingScreen {clientId} signInNotice={signInNotice} {onSignIn} />
        {:else}
          <WorkoutChooserScreen />
        {/if}
      {:else if current.name === 'workout-overview'}
        <WorkoutOverviewScreen workoutId={current.workoutId} />
      {:else if current.name === 'session-active'}
        <ActiveWorkoutScreen sessionId={current.sessionId} />
      {:else if current.name === 'session-summary'}
        <WorkoutSummaryScreen sessionId={current.sessionId} />
      {:else if current.name === 'history'}
        <WorkoutHistoryScreen />
      {:else if current.name === 'exercise-history'}
        <ExerciseHistoryScreen exerciseId={current.exerciseId} />
      {:else if current.name === 'raw-json'}
        <RawJsonScreen source={current.source} />
      {:else if current.name === 'settings'}
        <SettingsScreen {clientId} {onSignIn} />
      {:else}
        <NotFoundScreen attempted={attemptedAddress} />
      {/if}
    </main>
  </div>
{/if}
