# Phase 04: Local-Only Bootstrap and Hydration

## Purpose

This phase adds explicit startup paths for anonymous, connected, local-only, and mismatched accounts.
It also restores cached private data without a live Google token.

Startup must open only the namespace from a validated local account record.
It must never guess an account by enumerating browser databases.

## Required Reading

- [ ] Read `AGENTS.md` and the parent specification.
- [ ] Read Phases 01 through 03.
- [ ] Read `src/bootstrap.ts` completely.
- [ ] Read `src/app-types.ts` and `src/services/registry.ts`.
- [ ] Read `src/auth/local-account.ts`.
- [ ] Read `src/auth/auth-service.ts` bind and mismatch behavior.
- [ ] Read `src/auth/oauth-redirect-adapter.ts` return-route behavior.
- [ ] Read `src/sync/warm-result-shards.ts`.
- [ ] Read `src/sync/cache-records.ts` and `recognized-names.ts`.
- [ ] Read `src/indexes/lookup-service.ts` and `index-builder.ts`.
- [ ] Read `src/sessions/session-service.ts` shard lookup behavior.
- [ ] Read bootstrap and warm-result-shards tests.

## Preconditions

- [ ] Complete Phases 01 through 03.
- [ ] A selected local account has a validated versioned envelope.
- [ ] Credential clearing preserves that envelope.
- [ ] A coordinator can start paused with `drive: null`.
- [ ] Local records can load through strict validation.
- [ ] Account-scoped credential sources exist.

## Startup Classification

Add this type in `src/bootstrap.ts` or a small startup module:

```ts
export type StartupPath =
  | 'anonymous'
  | 'connected'
  | 'local_only'
  | 'account_mismatch';
```

Extend `BootstrapResult` with:

```ts
startupPath: StartupPath;
store: LocalStore | null;
```

Use this decision table:

| Live callback or token | Local selection | Bound result | Path |
| --- | --- | --- | --- |
| None | None | None | Anonymous |
| None or expired | A | None | Local-only A |
| Live token | None | A | Connected A and create selection |
| Live token | A | A | Connected A and refresh selection |
| Callback token | A | B | Mismatch and local-only A |
| Bind network failure | A | None | Local-only A |
| Malformed selection | Invalid | None | Anonymous |
| Rejected callback | A | None | Local-only A with safe notice |
| Rejected callback | None | None | Anonymous with sign-in error |

A stored token account key is not a live bind.
Connected startup still requires the Drive profile bind.

## Bootstrap Ports

Extend `BootstrapPorts` with testable identity and adapter seams:

```ts
readLocalAccount: () => LocalAccountState;
writeLocalAccount: (account: SelectedLocalAccount) => void;
clearOAuthCredentialState: () => void;
createDrive: (
  source: AuthorizationLeaseSource,
  options?: DriveRestAdapterOptions
) => DriveAdapter;
```

Recommended internal helpers:

- `resolveStartupIdentity()`.
- `startAnonymous()`.
- `startConnected()`.
- `startLocalOnly()`.
- `startAccountMismatch()`.
- `buildAccountServices()`.
- `hydrateBeforeMount()`.
- `startConnectedWarmup()`.

Keep identity comparison in bootstrap or an auth service.
Do not put this comparison in a Svelte component.

## Shared Startup Prefix

Required order:

1. Set static loading state.
2. Load and validate the static bundle.
3. Consume the OAuth callback.
4. Strip the callback fragment.
5. Read and validate the local account selection.
6. Restore and bind a live token with the unbound adapter.
7. Compare bound and selected account identities.
8. Select one startup path.
9. Open no private namespace before path selection.

A static-data failure opens no private namespace.

## Connected Startup

Preconditions:

- A token bound to account A.
- No local selection, or an existing selection for A.
- An account-scoped token source for A.

Checklist:

- [ ] Create or refresh selection A.
- [ ] Open only account A's local store.
- [ ] Create a connected coordinator for A.
- [ ] Create lookup, preferences, and session services.
- [ ] Parse the restored route before mount.
- [ ] Hydrate a private session route from local cache before mount.
- [ ] Publish services.
- [ ] Start the router and mount the shell.
- [ ] Start `coordinator.syncAll()` for pending work.
- [ ] Start remote-only shard warming after pending reconciliation starts.
- [ ] Arm the exact expiry watcher.

Postconditions:

- The bind and identity comparison occurred before private access.
- An active callback route can load its session immediately.
- Pending work gets priority over remote history warming.

## Local-Only Startup

Preconditions:

- No usable bound token.
- A valid selected local account A.

Checklist:

- [ ] Open only account A's store.
- [ ] Create a paused coordinator with `drive: null`.
- [ ] Create preferences, lookup, and session services.
- [ ] Parse the current route before mount.
- [ ] Load local preferences.
- [ ] Load cached result shards through local validation.
- [ ] Rebuild lookup indexes from validated documents.
- [ ] Hydrate active and summary routes before mount.
- [ ] Publish services with `drive: null`.
- [ ] Publish actual store persistence.
- [ ] Set connection state to `local_only`.
- [ ] Start router and mount the normal shell.
- [ ] Do not call `warmResultShards()`.
- [ ] Do not call `syncAll()`.

Postconditions:

- No Drive method ran.
- Normal account-scoped workout services exist.
- All private data came from namespace A.

## New Local Warm Module

### Add `src/sync/warm-local-data.ts`

Use a contract equivalent to:

```ts
export interface WarmLocalDataDeps {
  store: LocalStore;
  coordinator: Coordinator;
  lookup: LookupService;
  route: Route;
  onShardLoaded?: (logicalName: string) => void;
}

export interface WarmLocalDataResult {
  planned: string[];
  loaded: string[];
  failed: string[];
  activeSessionFound: boolean;
}

export function planLocalShardLoad(
  keys: readonly string[],
  route: Route
): string[];

export function warmLocalData(
  deps: WarmLocalDataDeps
): Promise<WarmLocalDataResult>;
```

Responsibilities:

- [ ] Read only the supplied account store.
- [ ] List `doc:` keys.
- [ ] Accept only recognized result-shard names.
- [ ] Load through `ensureLocalLoaded()`.
- [ ] Validate before lookup publication.
- [ ] Load sequentially.
- [ ] Prefer newest month names first.
- [ ] Publish each valid shard progressively.
- [ ] Record a failed shard without hiding valid shards.
- [ ] Start no Drive request.

Keep `warmResultShards()` connected-only.
Do not overload it with nullable Drive behavior.

## Active-Route Hydration

Routes `session-active` and `session-summary` require their result shard before mount.

Algorithm:

1. List recognized cached result shards.
2. Sort newest month first.
3. Load one shard at a time locally.
4. Extend the lookup after each valid shard.
5. Search the session index for the requested ID.
6. Stop blocking mount when the session appears.
7. Continue optional local warming after mount.
8. Use the existing unknown-session error when no shard contains it.

Forbidden behavior:

- [ ] Do not derive a month from the session UUID.
- [ ] Do not search another account namespace.
- [ ] Do not use `indexedDB.databases()`.
- [ ] Do not mount the active screen before hydration settles.

A durable session-to-shard locator is an optional optimization.
If added, store it inside the account namespace and validate its target shard.

## Wrong-Account Callback

Assume local selection A and callback account B.

Required order:

1. Bind B before trusting its identity.
2. Compare B with A before opening a store.
3. Clear B's credential and bound session.
4. Keep local selection A.
5. Open only A's local store.
6. Create A's paused coordinator.
7. Hydrate A's local data.
8. Publish local-only state for A.
9. Publish a safe mismatch issue.
10. Mount the normal local-only UI.

Forbidden outcomes:

- Opening account B's namespace.
- Replacing selection A with B.
- Uploading A data through B.
- Showing either raw permission ID.

Require explicit sign-out before account B can become the new local selection.

## Registry Contract

### Modify `src/services/registry.ts`

Add persistence and retain a nullable Drive adapter:

```ts
storePersistence: LocalStorePersistence | null;
```

Local-only registry fields:

- `lookup`: present.
- `sessionService`: present.
- `preferences`: present.
- `coordinator`: present and paused.
- `staticData`: present.
- `store`: present.
- `accountKey`: selected account.
- `drive`: null.
- `storePersistence`: actual value.

Connected registry adds Drive and connected coordinator behavior.

### Modify `src/app-types.ts`

Clarify that `ShellAccount` identifies the selected local account.
It does not prove that Google authorization is currently usable.

## OAuth Return Route

`beginAuthorization()` must preserve local selection and the current hash.
`consumeCallback()` must restore only a sanitized `#/...` route.

Bootstrap parses the route after callback consumption.
It hydrates a private session route before mount.

## Tests

### Extend `tests/bootstrap.test.ts`

#### Anonymous path

- [ ] No token and no selection opens no account store.
- [ ] Malformed selection opens no account store.
- [ ] Static lookup remains available.
- [ ] No database enumeration occurs.

#### Connected path

- [ ] Bind completes before store creation.
- [ ] First bind creates local selection.
- [ ] Same-account bind refreshes selection.
- [ ] Connected coordinator receives the matching account and adapter.
- [ ] Pending synchronization starts before remote shard warming.

#### Local-only path

- [ ] Valid selection opens exactly that namespace.
- [ ] Coordinator starts paused with no Drive adapter.
- [ ] Preferences load locally.
- [ ] Cached result shards enter the lookup.
- [ ] No Drive method runs.
- [ ] Normal account UI mounts.
- [ ] Store persistence enters the registry.

#### Mismatch path

- [ ] Selection A plus callback B clears B credential.
- [ ] Selection A remains.
- [ ] Store A opens.
- [ ] Store B never opens.
- [ ] No upload occurs.
- [ ] Mismatch state contains no raw key.
- [ ] Sign-out permits a later clean bind to B.

#### Bind failure

- [ ] Network bind failure plus selection starts local-only.
- [ ] Bind `401` plus selection starts local-only.
- [ ] Bind failure without selection starts anonymous.
- [ ] Pending rows remain untouched.

### Add `tests/warm-local-data.test.ts`

- [ ] Recognize only result-shard `doc:` keys.
- [ ] Ignore preference, base, pending, and unknown names for planning.
- [ ] Order newest shards first.
- [ ] Load shards sequentially.
- [ ] Start no Drive call.
- [ ] Publish only validated documents.
- [ ] Record bad shards and continue.
- [ ] Find an active session in cached data.
- [ ] Stop blocking after that session is found.
- [ ] Never interpret a UUID as a date.

### Extend auth adapter and service tests

- [ ] Reconnect authorization retains local selection.
- [ ] Callback restores an active-session route.
- [ ] Unsafe return routes normalize to `#/`.
- [ ] Mismatch credential rejection keeps selection.
- [ ] Mismatch drops the returned bound session.
- [ ] Mismatch clears raw payloads from that returned credential context.

### Add cross-restart integration coverage

- [ ] Seed account A with preferences, a shard, pending work, and an active session.
- [ ] Remove or expire the token.
- [ ] Bootstrap at the active-session route.
- [ ] Make sure that hydration finishes before mount.
- [ ] Save another local edit.
- [ ] Recreate the runtime with the same storage.
- [ ] Make sure that both edits remain.
- [ ] Bind A and reconcile pending work.
- [ ] Repeat callback binding as B and make sure that no upload occurs.

## Acceptance and Risk Checks

- [ ] Anonymous startup opens no private namespace.
- [ ] Local-only startup opens one exact namespace.
- [ ] Local-only startup makes zero Drive calls.
- [ ] Corrupt cached data follows the existing data-error path.
- [ ] Active route hydration completes before screen mount.
- [ ] Wrong-account callback opens no B namespace.
- [ ] Wrong-account callback uploads nothing.
- [ ] Mismatch messages contain no permission ID.
- [ ] Large local history loads sequentially on Kindle.
- [ ] Memory fallback is published as nonpersistent.
- [ ] Full-page redirect behavior remains unchanged.

## Postconditions

- [ ] All four startup paths are explicit and tested.
- [ ] A local account can reopen without a live token.
- [ ] Startup never guesses an account namespace.
- [ ] Active workout routes restore deterministically.
- [ ] Wrong-account callbacks fail closed.
- [ ] Phase 05 can add reconnect controls without changing startup security.

## Completion Commands

```text
bun test tests/bootstrap.test.ts tests/warm-local-data.test.ts
bun test tests/oauth-redirect-adapter.test.ts tests/auth-service.test.ts
bun run check
bun run test
bun run smoke:store
bun run check:compat
git diff --check
git status --short
```
