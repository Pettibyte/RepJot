# Phase 15 — Router, shell, bootstrap, and `DataError`

Replace the Phase 0 prototype page with the real application shell: hash routing,
startup sequence, header variants, and the single data-error component.

## Prerequisites

- Phases 01 through 14. This phase wires them together.
- Phase 06 `app-state` stores and Phase 05 `loadStaticData`.

## Goals

1. Provide reload-safe and bookmark-safe routes with a hand-written hash router.
2. Run the startup sequence and gate the UI on static data and auth state.
3. Provide the tab-root header and the compact back header.
4. Provide the one `DataError` component with **View Raw JSON** and **Dismiss**.
5. Retire the prototype `App.svelte` screen set.

## Interfaces

### Files

| Path | Purpose |
| --- | --- |
| `src/routing/hash-router.ts` | Route table, parse, match, and navigate. |
| `src/routing/routes.ts` | Route definitions and typed params. |
| `src/bootstrap.ts` | Startup sequence and mount. |
| `src/App.svelte` | Shell: header variant, tab bar, route outlet, status bar, error banner. |
| `src/ui/components/DataError.svelte` | The single data-error card. |
| `src/ui/screens/RawJsonScreen.svelte` | Read-only raw JSON viewer. |
| `src/main.ts` | Thin entry that calls `bootstrap()`. |

### Signatures

```ts
// src/routing/routes.ts
export type Route =
  | { name: 'home' }
  | { name: 'workout-overview'; workoutId: string }
  | { name: 'session-active'; sessionId: string }
  | { name: 'session-summary'; sessionId: string }
  | { name: 'history' }
  | { name: 'exercise-history'; exerciseId: string }
  | { name: 'settings' }
  | { name: 'raw-json'; source: string }
  | { name: 'not-found'; attempted: string };

export const TAB_ROOTS: ReadonlyArray<'home' | 'history' | 'settings'>;
export function parseHash(hash: string): Route;
export function formatRoute(route: Route): string;   // '#/sessions/xyz/active'
```

```ts
// src/routing/hash-router.ts
export interface Router {
  current(): Readable<Route>;
  navigate(route: Route): void;
  start(): void;                 // subscribes to hashchange
  stop(): void;
}
export function createRouter(): Router;
```

```ts
// src/bootstrap.ts
export interface BootstrapDeps {
  clientId: string;
  fetchImpl?: typeof fetch;
}
export async function bootstrap(deps: BootstrapDeps): Promise<void>;
// 1 loadStaticData. On failure set startupStatus 'static_failed' and render the blocker.
// 2 consumeCallback. Accept only a matching unexpired state, then strip the fragment.
// 3 restoreToken and restoreAndBind before any private cache access.
// 4 create LocalStore for the account namespace and the Drive adapter.
// 5 create the coordinator, preference service, and lookup service.
// 6 warm the cache: preferences, current shard, shards that can hold in_progress.
// 7 start the router and mount the shell.
// 8 register the pagehide flush.
```

```svelte
<!-- src/ui/components/DataError.svelte -->
<script lang="ts">
  export type DataErrorProps = {
    title: string;
    family?: string;
    declaredVersion?: number;
    maxSupportedVersion?: number;
    detail?: string;          // safe text only
    rawJson: string;          // shown through the raw viewer, never injected as HTML
  };
  export let props: DataErrorProps;
</script>
<!-- Buttons: "View Raw JSON" navigates to the raw-json route. "Dismiss" hides the card. -->
```

### Route table

| Route | Screen | Header | Requires |
| --- | --- | --- | --- |
| `/#/` | Anonymous landing or workout chooser | Tab root | Static data, optional account index |
| `/#/workouts/:workoutId` | Workout Overview | Back | Static workout |
| `/#/sessions/:sessionId/active` | Active Workout | Back | Session shard and current tree |
| `/#/sessions/:sessionId/summary` | Workout Summary | Back | Session shard and static lookups |
| `/#/history` | Workout History | Tab root | Loaded history indexes |
| `/#/exercises/:exerciseId/history` | Exercise History | Back | Exercise lookup and history |
| `/#/settings` | Settings | Tab root | Authorized account |
| `/#/raw/:source` | Raw JSON viewer | Back | Cached raw payload key |
| anything else | Not found | Back | — |

## Requirements traceability

| Source | How this phase satisfies it |
| --- | --- |
| REQUIREMENTS 16.1, 16.2, 16.3 | `TAB_ROOTS` selects the tab header. Every other route uses the back header. |
| REQUIREMENTS 5.5, 6.8, 6.9 | `DataError` names family, declared version, and max version, and offers **View Raw JSON**. |
| REQUIREMENTS 6.10 | One error card per unresolved item. The list keeps rendering. |
| REQUIREMENTS 11.11 | Back navigation calls the coordinator flush before route change. |
| REQUIREMENTS 12.9 (raw inspection) | The raw viewer renders stored bytes with no interpretation. |
| ARCHITECTURE ADR-001 | Hand-written hash router, no routing dependency. |
| ARCHITECTURE §9 "Startup and loading" | The eight bootstrap steps match. |
| ARCHITECTURE §9 "Routes" | The route table above matches the architecture table. |
| ARCHITECTURE ADR-017 | One `DataError` component for all data problems. |
| ARCHITECTURE §14 | The raw viewer uses interpolation only. No `innerHTML`. |

## Checklist

### Implementation

- [ ] Implement `parseHash` and `formatRoute` for every route, including the
      not-found case.
- [ ] Implement `createRouter` with a `hashchange` subscription and a readable store.
- [ ] Implement `bootstrap` with the eight steps and typed failure handling.
- [ ] Render a static-data failure blocker when `startupStatus` is `static_failed`.
- [ ] Rewrite `src/App.svelte` as the shell: header variant, tab bar, route outlet,
      save-status indicator, and a dismissible error banner bound to `activeError`.
- [ ] Implement `DataError.svelte` using Phase 01 primitives. Keep visible text on
      both actions.
- [ ] Implement `RawJsonScreen.svelte` that renders the stored text inside a
      `<pre>` through interpolation.
- [ ] Add a `rawPayloadStore` in memory that holds the text a **View Raw JSON** action
      opens, keyed by a short id in the route.
- [ ] Strip the OAuth fragment with `history.replaceState` before any private read.
- [ ] Delete the prototype hello-world UI from `App.svelte`.
- [ ] Keep `src/capabilities.html` and its page untouched.

### Tests

- [ ] `tests/hash-router.test.ts`: each route parses to the typed `Route` and formats
      back to the same hash.
- [ ] `tests/hash-router.test.ts`: an unknown path parses to `not-found` with the
      attempted hash preserved.
- [ ] `tests/hash-router.test.ts`: a malformed session id segment parses to
      `not-found` rather than throwing.
- [ ] `tests/bootstrap.test.ts`: a static-data failure sets `static_failed` and never
      touches the account store.
- [ ] `tests/bootstrap.test.ts`: no private cache read happens before `restoreAndBind`
      resolves. Assert with call-order spies.
- [ ] `tests/data-error.test.ts`: the component renders family, declared version, and
      max supported version when present.
- [ ] `tests/data-error.test.ts`: **View Raw JSON** navigates to the raw route with
      the payload key.
- [ ] `tests/data-error.test.ts`: no code path sets `innerHTML`. Assert with a
      component render spy or a source grep test.

### Verification

- [ ] `bun run check` passes.
- [ ] `bun test` passes.
- [ ] `bun run build` passes.
- [ ] `bun run check:compat` passes.
- [ ] Manual in `bun run dev`: reload on each route, bookmark one, and confirm it
      restores. Confirm an invalid hash shows not-found.

## Exit criteria

The real shell runs. Every route reloads correctly, the startup gate holds, and one
component reports every data problem.
