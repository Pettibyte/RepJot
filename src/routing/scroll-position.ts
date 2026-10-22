// Scroll control for same-document route changes.
//
// Why this module exists. The scroll reset a reader expects belongs to document
// loading, not to navigation. On a normal page load the browser throws the old
// document away and starts a new one at the top. ADR-001 chose hash routing so a
// reload needs no server rewrite, which means REP JOT never throws the document
// away. Nothing else resets the scroll.
//
// `pushState` would not help either. The HTML standard runs the scroll routine
// only for a fragment navigation, and `pushState` sets a URL with no fragment, so
// the browser takes no scroll action at all.
//
// Named anchors cannot solve it either. The address has one fragment slot and the
// route already fills it. The browser matches the whole fragment against an
// element `id`, never a prefix, so `#/exercises/squat/history` never matches
// `id="main"`.
//
// The rule. Reset to the top on a forward navigation. On a back or forward
// traversal do nothing, because `history.scrollRestoration` is left at its
// default of `auto` and the browser restores the position for that entry by
// itself. Deliberately not setting `scrollRestoration` to `manual` keeps this
// off the list of browser capabilities that
// `docs/CAPABILITIES-kindle-scribe.md` does not cover. Only `window.scrollTo`
// needs a guard here.
//
// The environment is injected for the same reason `RouterEnv` is: a test drives
// it with a recorder and no layout engine. `happy-dom` performs no layout, so a
// real scroll position cannot be read or asserted there.

import { formatRoute } from './routes';
import type { NavigationInfo } from './hash-router';

/** The scroll surface this module needs. */
export interface ScrollEnv {
  /** Current vertical scroll offset in CSS pixels. */
  getY(): number;
  /** Scroll to `y` CSS pixels from the top of the document. */
  setY(y: number): void;
}

/** The real environment. Every call guards for a host with no `window`. */
export const windowScrollEnv: ScrollEnv = {
  getY(): number {
    if (typeof window === 'undefined') return 0;
    // `scrollY` is the modern name. `pageYOffset` covers an older host.
    const y = window.scrollY ?? window.pageYOffset ?? 0;
    return Number.isFinite(y) ? y : 0;
  },
  setY(y: number): void {
    if (typeof window === 'undefined') return;
    if (typeof window.scrollTo === 'function') {
      window.scrollTo(0, y);
    }
  }
};

/** Applies the scroll rule to one navigation. */
export interface ScrollController {
  handle(nav: NavigationInfo | null): void;
}

/**
 * Build the controller over one scroll environment.
 *
 * The four cases, in the order the checks run:
 *
 * | Case | Action |
 * |---|---|
 * | No navigation recorded | Do nothing |
 * | A back or forward traversal | Do nothing. The browser restores. |
 * | Same route in and out | Do nothing. The user did not change screen. |
 * | Already at the top | Do nothing. A write would fire a pointless scroll. |
 * | Otherwise | Scroll to the top |
 *
 * The same-route case covers a real path: `navigate` to the hash already in the
 * address bar publishes directly, and that must not jump the page.
 */
export function createScrollController(env: ScrollEnv = windowScrollEnv): ScrollController {
  return {
    handle(nav: NavigationInfo | null): void {
      if (nav === null) return;
      if (nav.traversed) return;
      if (nav.from !== null && formatRoute(nav.from) === formatRoute(nav.to)) return;
      if (env.getY() === 0) return;
      env.setY(0);
    }
  };
}
