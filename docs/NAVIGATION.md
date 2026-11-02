# Navigation and scroll position

REP JOT keeps canonical hash URLs. Exercise History does not add a session ID to its URL.

## History entries

Each browser history entry has its own ID, predecessor, and scroll position. The router stores entry metadata in a namespaced field of `history.state`. It preserves unrelated state fields, including during OAuth URL cleanup.

The router saves current scroll positions in `sessionStorage`, keyed by entry ID. This avoids frequent `replaceState` calls during scrolling. Storage failures leave the in-memory position available, but reload can lose the latest position.

A fragment link can emit both `popstate` and `hashchange`. The router identifies a traversal from the destination entry metadata, not from the event name. It processes each entry change once, including traversals between entries with the same URL.

The top-nav Back control traverses to the previous app entry. Its `href` remains available for modified clicks. Without a known predecessor, Back replaces the current entry with the static parent route. It does not traverse to an unknown external page.

A replacement retains the predecessor of the replaced entry. If that predecessor already has the target URL, the router returns to that entry instead of creating a duplicate target.

## Scroll position

A new route opens at the top. A traversal restores the destination entry's saved position. Reload restores the current entry's saved position.

The shell waits for the destination screen to report that its content or error state has rendered. This prevents restoration against the shorter outgoing screen. History screens load older pages until the saved position fits or the data ends. The shell ignores obsolete readiness reports and repeated reports for a handled navigation.

The shell uses manual native scroll restoration only when the browser exposes `history.scrollRestoration`. Without that capability, it still applies the saved position after the destination content renders. The Kindle Scribe capability report does not yet confirm this API. A physical-device test remains necessary.

A user scroll gesture cancels pending restoration. Scroll events from an unfinished navigation do not overwrite the saved position of the outgoing entry.

## Regression tests

Run `bun run test` in the devcontainer. The command includes unit, DOM, and Chromium tests.

The browser tests must use local fixtures with fake services. They must not use production credentials or untrusted URLs.

For the original bug reports, verify this sequence on the Kindle Scribe:

1. Open an active workout.
2. Scroll to a later exercise.
3. Click that exercise's **View history** link.
4. Verify that Exercise History opens at the top with its canonical URL.
5. Click the top-nav **Back** control.
6. Verify that the same active workout returns to its saved position.
7. Click **Back** again.
8. Verify that the workout's entry point opens without a navigation loop.
9. Repeat with browser Back and Forward.
10. Repeat after a reload.

Chromium tests also cover delayed content, distinct entries with the same URL, and completed or abandoned workouts.
