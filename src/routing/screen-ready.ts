import { getContext, tick } from 'svelte';
import { getRouter } from './router-registry';
import { formatRoute } from './routes';
import type { NavigationInfo } from './hash-router';

/** The shell supplies this callback during component initialization. */
export type ScreenReadyReporter = (routeKey: string) => void;
export const SCREEN_READINESS_CONTEXT = Symbol('screen-readiness');

/** The shell getter tracks published navigation, including same-key traversal. */
export type ScreenNavigationGetter = () => NavigationInfo | null;
export const SCREEN_NAVIGATION_CONTEXT = Symbol('screen-navigation');

/**
 * Capture the shell callback during screen initialization. Call the returned
 * function from an effect only after the current route's content has loaded.
 * Return its cleanup from that effect to cancel reports on navigation or reload.
 * The shell must also reject keys from an obsolete navigation generation.
 * A paged screen can supply loadMore while it has older data. On traversal
 * or initial load, expand until the saved offset fits the committed content.
 * Each load must change the screen's reactive paging state so its effect runs
 * again. Stop offering loadMore on exhaustion or error; no timer retries run.
 * Without a provider (for example in isolated screen tests), reports are a no-op.
 */
export function createScreenReadyReporter(): (
  routeKey: string,
  loadMore?: () => void
) => () => void {
  const report = getContext<ScreenReadyReporter | undefined>(SCREEN_READINESS_CONTEXT);
  const getNavigation = getContext<ScreenNavigationGetter | undefined>(SCREEN_NAVIGATION_CONTEXT);
  return (routeKey, loadMore) => {
    const router = getRouter();
    // Read inside the screen's effect, not initialization: a new entry can
    // reuse the same route and component but need more rendered history rows.
    const navigation = getNavigation ? getNavigation() : router?.lastNavigation();
    const targetY = router?.scrollForCurrent?.() ?? 0;
    let cancelled = false;
    void tick().then(() => {
      if (cancelled || router?.lastNavigation() !== navigation) return;
      if (
        loadMore !== undefined && navigation != null &&
        (navigation.traversed || navigation.from === null) &&
        formatRoute(navigation.to) === routeKey && targetY > 0 &&
        typeof document !== 'undefined'
      ) {
        const root = document.documentElement;
        const height = Math.max(root.scrollHeight, document.body?.scrollHeight ?? 0);
        const viewport = window.innerHeight || root.clientHeight;
        if (targetY > Math.max(0, height - viewport) + 1) {
          loadMore();
          return;
        }
      }
      report?.(routeKey);
    });
    return () => { cancelled = true; };
  };
}
