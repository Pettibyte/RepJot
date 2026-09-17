# Phase 03: Paused Synchronization Coordinator

## Purpose

This phase makes the account coordinator usable without Google authorization.
Paused synchronization permits local edits and starts no Drive request.

The existing working, base, and pending record formats remain unchanged.
The existing three-way merge remains the reconnect mechanism.

## Required Reading

- [ ] Read `AGENTS.md` and the parent specification.
- [ ] Read `phase-01.md` and `phase-02.md`.
- [ ] Read `src/sync/sync-coordinator.ts` completely.
- [ ] Read `src/sync/cache-records.ts`.
- [ ] Read `src/sync/debounce.ts`.
- [ ] Read `src/sync/consolidate-duplicates.ts`.
- [ ] Read every file under `src/storage/`.
- [ ] Read `src/sessions/session-service.ts` load and flush contracts.
- [ ] Read `src/preferences/preference-service.ts` load and save contracts.
- [ ] Read coordinator, cache, debounce, and local-store tests.

## Preconditions

- [ ] Complete Phases 01 and 02.
- [ ] Make sure that authorization loss is idempotent.
- [ ] Make sure that the Phase 02 authorization fence exists.
- [ ] Make sure that Drive `401` reaches one authorization-loss handler.
- [ ] Make sure that the token source is account-scoped.
- [ ] Make sure that local and remote state stores are separate.

## Public Coordinator Contract

Modify `src/sync/sync-coordinator.ts`.

```ts
export type SyncMode = 'connected' | 'paused_auth';

export interface SyncDeps {
  store: LocalStore;
  drive: DriveAdapter | null;
  staticData: LoadedStaticData;
  accountKey: string;
  initialMode?: SyncMode;
  authorizationFence?: AuthorizationFence;
  onAuthorizationLost?: (
    reason: 'expired' | 'unauthorized'
  ) => void | Promise<void>;
  // Existing timing seams remain.
}

export interface Coordinator {
  ensureLoaded(logicalName: string): Promise<unknown>;
  ensureLocalLoaded(logicalName: string): Promise<unknown>;
  pauseSync(reason: 'expired' | 'unauthorized'): Promise<void>;
  resumeSync(drive?: DriveAdapter): Promise<void>;
  syncMode(): SyncMode;
  // Existing edit, queue, flush, sync, reset, and peek methods remain.
}
```

A connected coordinator requires a Drive adapter.
A paused coordinator can start with `drive: null`.

The coordinator owns a local network epoch.
The epoch changes on pause and resume.
It is separate from the authorization generation from Phase 02.
A remote result must pass both fences before local commit.

## Storage Persistence Contract

Phase 01 adds `LocalStore.persistence` and updates both storage engines.
This phase consumes and verifies that capability.

- [ ] Require `persistent` before redirect-safe durability is reported.
- [ ] Treat the memory store as same-page storage only.
- [ ] Keep factory fallback behavior in `create-local-store.ts`.
- [ ] Make sure that all new test stores declare persistence.
- [ ] Do not infer persistence in UI code.

## Strict Local Record Loading

### Modify `src/sync/cache-records.ts`

Add a strict local reader:

```ts
export function readRecordsStrict(
  store: LocalStore,
  logicalName: string
): Promise<RecordSet>;
```

Rules:

- An absent key is valid.
- A `pending:` value of `null` means no pending delta.
- A present malformed record is a typed storage error.
- A malformed pending record never becomes “no pending work.”
- Errors include only safe slot and logical-name context.
- The reader starts no Drive request.

The connected cache path can retain its documented tolerant behavior.
Local-only publication must use the strict reader.

## Internal Coordinator State

Add state equivalent to:

```ts
let mode: SyncMode;
let activeDrive: DriveAdapter | null;
let networkEpoch = 0;
let authorizationLossReported = false;
```

Add internal helpers:

- [ ] `captureNetworkEpoch()`.
- [ ] `isCurrentNetworkEpoch(epoch)`.
- [ ] `requireConnectedDrive(epoch)`.
- [ ] `cancelAllScheduledSync()`.
- [ ] `settlePausedSyncWaiters()`.
- [ ] `restoreLocalStrict(logicalName, family)`.
- [ ] `handleAuthorizationFailure(error)`.

Do not increment the Phase 02 authorization generation here.
The shared authorization-loss controller owns that operation.

## Paused-Mode Invariants

When `mode === 'paused_auth'`:

- [ ] No Drive debounce timer remains armed.
- [ ] A timer callback cannot start a Drive request.
- [ ] `syncAll()` makes no Drive call.
- [ ] `flush()` performs a local flush only.
- [ ] `ensureLoaded()` delegates to `ensureLocalLoaded()`.
- [ ] `edit()` writes working, base, and pending records locally.
- [ ] Pending rows remain until confirmed connected synchronization.
- [ ] A new monthly shard can start from an empty local document.
- [ ] No repeated authentication banner appears.
- [ ] No unresolved synchronization promise remains indefinitely.

## `pauseSync()` Contract

Precondition:

- The coordinator can have scheduled or in-flight Drive work.
- The local edit queue can contain field mutations.

Required order:

1. Change mode to `paused_auth` synchronously.
2. Increment the local network epoch.
3. Detach `activeDrive` from future operations.
4. Cancel quiet and maximum-delay timers.
5. Prevent `.finally()` callbacks from rearming timers.
6. Settle scheduled synchronization waiters with a typed deferred-auth result.
7. Flush the local edit queue without waiting for Drive.
8. Preserve in-memory documents and all local records.
9. Publish remote state as `paused_auth`.
10. Notify the authorization-loss handler once when necessary.

A repeated pause only flushes remaining local work.
It does not publish another notice.

Do not call `reset()`.
`reset()` clears in-memory state and drains network work.

## Edit Contract While Paused

1. Set local state to saving.
2. Load from memory or strict local records.
3. Apply and validate the mutation.
4. Compute the delta against the last synchronized base.
5. Write all local records in one `setMany()` transaction.
6. Update the in-memory document.
7. Publish local durable state.
8. Publish remote pending and paused state.
9. Start no synchronization timer.
10. Return an `EditHandle` whose sync result settles as deferred authorization.

The sync result must not imply Drive receipt.
A typed rejection or explicit `deferred_auth` result is permitted.
Update all callers and comments to match the selected contract.

## `ensureLocalLoaded()` Contract

1. Validate the logical name.
2. Acquire the local lock only.
3. Return an already loaded document when present.
4. Read slots with `readRecordsStrict()`.
5. Return the family empty document when all slots are absent.
6. Require a base for a patch pending envelope.
7. Permit a replace pending envelope without a base.
8. Prefer validated working text when available.
9. Otherwise replay pending data onto the base.
10. Run the normal document pipeline and semantic stage.
11. Publish to memory only after validation.
12. Start no Drive request.

An empty read must not create a stored document by itself.

## Network Fence Contract

Every connected operation captures:

- The Phase 02 authorization generation.
- The current coordinator network epoch.
- The active Drive adapter identity.

Check all three values before and after each awaited Drive operation.
Check them immediately before any local application of remote state.

If a fence is stale:

- [ ] Do not change in-memory documents.
- [ ] Do not update working or base rows.
- [ ] Do not clear pending rows.
- [ ] Do not publish synchronized state.
- [ ] Treat a possibly committed write as ambiguous.
- [ ] Leave reconciliation to a later resume.

Fence these paths:

- [ ] Catalog listing.
- [ ] Duplicate consolidation.
- [ ] Remote file reads.
- [ ] Pre-upload metadata reads.
- [ ] Create and update requests.
- [ ] Upload read-back.
- [ ] `dropVanished()` local changes.
- [ ] `commitConfirmed()`.

`AbortController` can reduce work.
It cannot prove that Drive did not accept a write.

## `resumeSync()` Contract

Preconditions:

- A live token was bound to the same account key.
- Bootstrap completed the account comparison.
- The supplied Drive adapter has an account-scoped lease source.

Required order:

1. Keep the gate closed.
2. Flush the local edit queue.
3. Install the verified Drive adapter.
4. Increment the network epoch.
5. Clear the per-transition loss marker.
6. Change mode to connected.
7. List pending logical files from local rows.
8. Reconcile them sequentially.
9. Continue when one file fails for a non-auth reason.
10. Pause immediately if another `401` occurs.
11. Keep unresolved pending rows.

Pending reconciliation starts before remote-only history warming.
Sequential work protects Kindle memory and network capacity.

## Existing Modules to Review

### `src/sync/consolidate-duplicates.ts`

- [ ] Do not create a default consolidation hook while Drive is null.
- [ ] Give consolidation a fenced adapter.
- [ ] Fence read-back, deletion, and final relist.

### `src/sessions/session-service.ts`

- [ ] Keep callers free of connection branches.
- [ ] Let paused `ensureLoaded()` use local records.
- [ ] Preserve queue flush semantics.

### `src/preferences/preference-service.ts`

- [ ] Keep local preference edits available while paused.
- [ ] Preserve schema validation and pending-delta behavior.

## Tests

### Add `tests/sync-coordinator-paused.test.ts`

- [ ] Paused construction accepts `drive: null`.
- [ ] Connected construction rejects `drive: null`.
- [ ] A clean cached document loads locally.
- [ ] A pending patch restores from base and pending rows.
- [ ] A pending replace restores without a base.
- [ ] Malformed cached data causes a typed error.
- [ ] Malformed pending data causes a typed error.
- [ ] A patch without a base causes a typed error.
- [ ] Local documents pass schema and semantic validation.
- [ ] A paused edit writes atomically.
- [ ] A paused edit makes zero Drive calls.
- [ ] A paused preference edit remains pending.
- [ ] A new monthly shard starts while paused.
- [ ] Paused `syncAll()` makes zero Drive calls.
- [ ] Paused `flush()` performs only local work.
- [ ] Pause cancels both synchronization timers.
- [ ] Repeated pause reports authorization loss once.
- [ ] `401` pauses without normal retry.
- [ ] Network failure does not pause.
- [ ] Rate limit and quota failure do not pause.
- [ ] Generic `403` does not pause automatically.
- [ ] Resume reconciles every pending file.
- [ ] One failed file does not starve another file.
- [ ] Resume-time `401` pauses again.

### Extend `tests/sync-coordinator.test.ts`

- [ ] Pause after upload starts and before response.
- [ ] Release the response and make sure that pending remains.
- [ ] Make sure that base and working rows do not advance.
- [ ] Repeat around read-back.
- [ ] Repeat around duplicate consolidation.
- [ ] Make sure that old `.finally()` handlers do not rearm timers.
- [ ] Resume and make sure that later reconciliation converges.
- [ ] Preserve same-session and preference merge behavior.

### Extend `tests/local-store.test.ts`

- [ ] IndexedDB reports persistent storage.
- [ ] Memory store reports memory storage.
- [ ] Factory fallback reports memory storage.
- [ ] Atomic transaction tests remain unchanged.
- [ ] Account isolation remains unchanged.

### Update test fakes

- [ ] Add `persistence` to every fake local store.
- [ ] Let fake Drive block catalog, read, upload, and read-back.
- [ ] Let fake Drive emit a typed `401`.
- [ ] Record requests that start after the gate closes.

## Acceptance and Risk Checks

- [ ] A post-expiry edit causes no Drive request.
- [ ] The edit writes working, base, and pending rows atomically.
- [ ] Pending data survives coordinator reconstruction.
- [ ] A new result shard starts in paused mode.
- [ ] A late old-epoch response cannot clear pending data.
- [ ] A committed upload with a lost response converges after resume.
- [ ] Memory fallback never reports persistent storage.
- [ ] A network outage remains a synchronization problem, not auth loss.
- [ ] Existing connected synchronization tests remain green.
- [ ] Sequential resume does not exceed Kindle resource expectations.

## Postconditions

- [ ] Paused mode starts no Drive request.
- [ ] Local edits remain fully functional.
- [ ] Strict local loading rejects corrupt pending intent.
- [ ] Resume uses the existing merge and read-back protocol.
- [ ] The coordinator exposes persistence for reconnect safety.
- [ ] Phase 04 can construct a paused coordinator without Drive.

## Completion Commands

```text
bun test tests/sync-coordinator-paused.test.ts
bun test tests/sync-coordinator.test.ts tests/local-store.test.ts
bun run check
bun run test
bun run smoke:store
bun run check:compat
git diff --check
git status --short
```
