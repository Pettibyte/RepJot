# Chromium navigation and scroll regressions

## Run

Run `bun run test:browser` in the devcontainer. The full `bun run test` command also runs these tests.

The devcontainer installs Chromium and its system libraries. Outside that setup, run `bunx --bun playwright install --with-deps chromium` first.

## Fixture

The script starts Vite on loopback and opens only the local fixture in headless Chromium. Chromium runs with `--no-sandbox`. Do not replace the fixture address with an untrusted URL.

The fixture mounts the real REP JOT `App`, stylesheet, router, and session service. Fake Drive supplies the data. Repeated workout groups and earlier sessions provide real document height. The tests do not mock layout, scroll offsets, or browser history events.

The fixture retains `window.backTestRouter`. Its `window.backTestDelays` gates pause `queueFlush` and `sessionService.load` on the service from `getServices()`. Tests release each gate explicitly.

## Coverage

The tests cover these paths:

- Home Resume anchor → Active Workout at Y6000 → real View history badge → canonical exercise history URL at Y0.
- Top-nav Back → the same active session at Y6000 → next Back → Home without a loop.
- Native Back and Forward restore independent entry positions.
- Reload preserves the entry ID, predecessor, unrelated history state, and scroll position.
- Restoration waits for a delayed flush and a delayed session load, even while the document is too short.
- Real wheel input during a delayed session load cancels pending restoration.
- A browser without the `history.scrollRestoration` property still restores after content readiness.
- Expanded exercise history loads enough rows before restoration beyond the first page.
- Forward to a distinct marked entry with the same route reruns readiness and expands history before restoration.
- Repeated visits to the same route retain separate positions.
- Same-hash popstate followed by Forward does not corrupt later navigation detection, with either marked or unknown history state.
- Summary → real Edit anchor → Finish has no self-Back or editor origin.
- Immediate browser Back after finish, abandon, or deletion does not reopen the replaced screen.
- Browser traversal to a replaced entry retains its marker and predecessor.
- A fresh exercise deep link retains its static parent after reload.

The original badge and Back paths use actual anchor clicks. Programmatic navigation supplies setup for additional history sequences. Position assertions wait for the requested offset and check it again after animation frames. A short document fails instead of silently accepting a clamped offset.

## Original regression

Chromium emits `popstate` before `hashchange` for a new fragment link. The old router treated the event as a traversal and omitted the origin. The exercise Back link then targeted `#/history`, not the active workout.

Fake browser environments did not reproduce that event sequence. Chromium also supplies the layout that DOM-only tests cannot measure.

The Kindle Scribe still needs a manual pass. These tests do not emulate Silk 80.
