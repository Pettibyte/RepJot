# Phase 02: Authorization Loss and Account-Scoped Credentials

## Purpose

This phase separates token loss from explicit sign-out.
It also prevents one account coordinator from using another account's token.

Expiry and Drive `401` will remove Drive authorization.
They will keep the selected local account and mounted local services.

Phase 03 adds complete network pause behavior.
Phase 04 adds local-only startup after a page reload.

## Required Reading

- [ ] Read `AGENTS.md`.
- [ ] Read the parent specification.
- [ ] Read `phase-01.md` and its completed changes.
- [ ] Read `src/auth/auth-service.ts` completely.
- [ ] Read `src/auth/oauth-redirect-adapter.ts` completely.
- [ ] Read `src/auth/storage-keys.ts`.
- [ ] Read `src/auth/local-account.ts` from Phase 01.
- [ ] Read `src/bootstrap.ts` completely.
- [ ] Read `src/drive/drive-rest-adapter.ts` and `src/drive/errors.ts`.
- [ ] Read `src/sync/sync-coordinator.ts` around reconciliation and commit.
- [ ] Read `src/data/account-flows.ts`.
- [ ] Read `src/services/registry.ts`.
- [ ] Read the related auth, Drive, bootstrap, and coordinator tests.

## Preconditions

- [ ] Complete Phase 01.
- [ ] Make sure that the local account key is outside credential clearing.
- [ ] Make sure that state stores from Phase 01 are available.
- [ ] Make sure that the current bind-before-private-read tests pass.
- [ ] Make sure that fake Drive can delay an upload response.
- [ ] Record existing working-tree changes.

## Core Contracts

### Authorization lease

Add these types and functions to `src/auth/auth-service.ts`, or to a dedicated credential module:

```ts
export interface AuthorizationLease {
  accessToken: string;
  accountKey: string | null;
  generation: number;
}

export function getUnboundAuthorizationLease():
  AuthorizationLease | null;

export function getAccountAuthorizationLease(
  accountKey: string
): AuthorizationLease | null;

export function isAuthorizationLeaseCurrent(
  lease: AuthorizationLease
): boolean;

export function getAuthorizationGeneration(): number;
```

The unbound lease is only for the initial profile request.
An account lease requires exact account-key equality.

Lease rules:

- [ ] Capture one token and generation for one Drive operation.
- [ ] Never replace the lease midway through an operation.
- [ ] Invalidate old leases before credential removal.
- [ ] Keep tokens and permission IDs out of errors and diagnostics.
- [ ] Return no scoped lease when the bound session disagrees.

### Authorization-loss transition

Replace `expireSession()` with one idempotent operation:

```ts
export type AuthorizationLossReason =
  | 'expired'
  | 'unauthorized';

export interface AuthorizationLossResult {
  changed: boolean;
  generation: number;
}

export function loseAuthorization(
  reason: AuthorizationLossReason
): AuthorizationLossResult;
```

First-call preconditions:

- A token can exist or already be unusable.
- A selected local account can exist.
- Drive work can still be in flight.

First-call postconditions:

- The authorization generation increased.
- Old leases are stale.
- OAuth credential state is clear.
- The versioned local account selection remains.
- The in-memory token session is clear.
- The account database remains.
- The service registry remains.
- The current route remains.
- Raw payloads remain for the selected local account.
- Connection state is `local_only` when a selection exists.
- Connection state is `anonymous` when no selection exists.
- Normal expiry does not replace `activeError`.

Repeated calls return `changed: false`.
They must not increment the generation or publish repeated notices.

### Credential clearing

Add this operation in `src/auth/oauth-redirect-adapter.ts`:

```ts
export function clearOAuthCredentialState(): void;
```

It clears:

- `OAUTH_STATE_KEY`.
- `OAUTH_RECEIPT_KEY`.
- `SESSION_TOKEN_KEY`.
- `LOCAL_TOKEN_KEY`.
- Legacy `SELECTED_ACCOUNT_KEY`.

It does not clear `LOCAL_ACCOUNT_STORAGE_KEY`.

Explicit `signOut()` clears both credentials and the local account selection.
`beginAuthorization()` must preserve the local account selection.

## File Plan

### Modify `src/auth/auth-service.ts`

- [ ] Own the authorization generation.
- [ ] Add scoped and unbound lease getters.
- [ ] Replace `expireSession()` with `loseAuthorization()`.
- [ ] Make authorization loss idempotent.
- [ ] Keep the local selection on expiry and `401`.
- [ ] Create or refresh the selection after a successful bind.
- [ ] Publish connected state after a successful bind.
- [ ] Clear the selection only during explicit sign-out or approved disconnect.
- [ ] Keep database rows after sign-out.
- [ ] Preserve unconfirmed disconnect state for retry.

### Modify `src/auth/oauth-redirect-adapter.ts`

- [ ] Split credential clearing from local-selection clearing.
- [ ] Keep local selection during token expiry cleanup.
- [ ] Keep local selection when authorization starts.
- [ ] Remove new writes of legacy `SELECTED_ACCOUNT_KEY`.
- [ ] Retain legacy reads only for the Phase 04 migration.
- [ ] Preserve callback state, replay, scope, and expiry checks.

### Modify `src/drive/drive-rest-adapter.ts`

Replace the bare string token source with a lease source:

```ts
export type AuthorizationLeaseSource =
  () => AuthorizationLease | null;

export interface DriveRestAdapterOptions {
  fetchImpl?: typeof fetch;
  requestTimeoutMs?: number;
  revokeTimeoutMs?: number;
  isLeaseCurrent?: (lease: AuthorizationLease) => boolean;
  onUnauthorized?: () => void;
}
```

Every authenticated operation captures one lease before its first request.
`readFile()` uses the same lease for media and metadata requests.

Before it publishes a successful result, the adapter checks the lease again.
A stale result throws a safe authentication error.

On `401`, call `onUnauthorized()` before the adapter throws.
Do not call it for `403`, network, rate-limit, or quota failures.

`revokeToken(accessToken)` remains an explicit exception.
Disconnect supplies the token directly.

### Modify `src/bootstrap.ts`

Build two adapters:

1. An unbound adapter for the initial account profile bind.
2. An account-scoped adapter for coordinator and Settings operations.

The unbound adapter must never enter the service registry.
The scoped adapter must use `session.accountKey`.

Add a shared authorization-loss handler.
A runtime `401` calls `loseAuthorization('unauthorized')`.
Phase 03 later adds coordinator pause to that handler.

Do not clear or remount services on ordinary authorization loss.

### Modify `src/sync/sync-coordinator.ts`

Add an injected authorization fence:

```ts
export interface AuthorizationFence {
  capture(): number;
  isCurrent(generation: number): boolean;
}
```

Capture the generation before reconciliation starts.
Check it before every local application of remote state.
Check it immediately before `commitConfirmed()` writes local records.

If the generation is stale:

- Do not update working rows.
- Do not update base rows.
- Do not clear pending rows.
- Do not publish remote synchronized state.
- Do not retry with the stale generation.
- Reject the network result as an authentication loss.

Phase 03 adds timer cancellation and a closed network gate.

### Modify `src/data/account-flows.ts`

- [ ] Keep sign-out distinct from disconnect and delete.
- [ ] Clear local selection only after confirmed disconnect.
- [ ] Keep local selection after revoke failure.
- [ ] Keep local selection when pending sync blocks disconnect.

## Exact Expiry Watch

The existing timer uses a capped delay as the final expiry delay.
Replace it with a rearming watcher.

Recommended contract:

```ts
export interface AuthTimerSet {
  setTimeout(run: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export function startExpiryWatch(
  timers?: AuthTimerSet
): () => void;
```

Behavior:

1. Read the exact expiry.
2. If the deadline passed, call `loseAuthorization('expired')`.
3. Otherwise, schedule the smaller of remaining time and the timer limit.
4. Recalculate when a capped segment fires.
5. Expire only at the exact deadline.
6. Return a cancellation function.
7. Invalidate an old watcher when the credential changes.

Use ordinary `setTimeout` for Kindle compatibility.

## Account-Mismatch Boundary

Phase 04 implements the complete mismatch startup path.
This phase establishes the lower-level protection.

If local account A exists and a token binds as account B:

- [ ] Do not overwrite local account A.
- [ ] Clear the returned B credential.
- [ ] Return no scoped lease for A from B.
- [ ] Return no scoped lease for B within A's coordinator.
- [ ] Keep both permission IDs out of messages.
- [ ] Start no upload through the mismatched credential.

## Tests

### Extend `tests/auth-service.test.ts`

- [ ] Exact expiry clears credentials and keeps local selection.
- [ ] Exact expiry leaves account database rows untouched.
- [ ] Drive `401` causes one local-only transition.
- [ ] Concurrent loss calls increment generation once.
- [ ] Repeated loss calls do not replace `activeError`.
- [ ] Successful first bind creates local selection.
- [ ] Same-account bind refreshes display name and timestamp.
- [ ] Different-account bind does not replace selection.
- [ ] Sign-out clears credentials and selection.
- [ ] Sign-out clears raw payloads.
- [ ] Sign-out retains account database rows.
- [ ] Confirmed disconnect clears selection.
- [ ] Unconfirmed disconnect keeps selection.
- [ ] A scoped lease is unavailable for a different account.
- [ ] An old lease becomes stale after loss.
- [ ] A long expiry delay rearms without early expiry.
- [ ] A replacement token is not expired by an old watcher.

### Extend `tests/oauth-redirect-adapter.test.ts`

- [ ] Credential clearing removes OAuth keys.
- [ ] Credential clearing keeps local selection.
- [ ] Authorization start keeps local selection.
- [ ] Expired-token cleanup keeps local selection.
- [ ] Existing callback security tests remain unchanged.

### Extend `tests/drive-rest-adapter.test.ts`

- [ ] Each operation captures one lease.
- [ ] `readFile()` uses one lease for both requests.
- [ ] `401` calls `onUnauthorized()` once.
- [ ] `403` does not call the callback.
- [ ] Network failure does not call the callback.
- [ ] Rate-limit and quota errors do not call the callback.
- [ ] A stale successful response is rejected.
- [ ] No fetch starts when the scoped source returns `null`.
- [ ] Errors expose no token or permission ID.

### Extend `tests/sync-coordinator.test.ts`

- [ ] Hold an upload response after the request starts.
- [ ] Advance the authorization generation.
- [ ] Release the successful response.
- [ ] Make sure that pending remains.
- [ ] Make sure that base does not advance.
- [ ] Make sure that remote synced state does not publish.
- [ ] Repeat around upload read-back.
- [ ] Reconcile successfully with a later generation.
- [ ] Preserve existing ambiguous-upload behavior.

### Extend `tests/bootstrap.test.ts`

- [ ] Initial bind uses the unbound adapter.
- [ ] Coordinator receives the scoped adapter.
- [ ] Expiry does not clear services.
- [ ] Expiry does not replace router or route.
- [ ] Expiry does not create a second store or coordinator.
- [ ] The watcher rearms after a capped segment.
- [ ] The watcher expires only at the exact deadline.
- [ ] Bind still finishes before private storage opens.

### Extend `tests/account-flows.test.ts`

- [ ] Sign-out keeps namespace rows and pending edits.
- [ ] Confirmed disconnect clears selection under the approved policy.
- [ ] Revoke failure keeps selection and namespace.
- [ ] Pending synchronization still blocks disconnect.
- [ ] Delete remains separate from sign-out and disconnect.

## Acceptance and Risk Checks

### Authorization loss

- [ ] Start on an active-workout route.
- [ ] Trigger exact expiry.
- [ ] Make sure that the route does not change.
- [ ] Make sure that services remain registered.
- [ ] Make sure that the account database remains open.
- [ ] Make sure that no request starts with a cleared token.

### In-flight upload

- [ ] Delay a response after Drive accepts an upload.
- [ ] Trigger authorization loss.
- [ ] Release the old response.
- [ ] Make sure that pending intent remains.
- [ ] Repeat with a request that never commits.
- [ ] Reconcile both cases with a fresh generation.

### Failure classification

- [ ] `401` enters local-only state once.
- [ ] `403` retains the current connection classification.
- [ ] Network failure retains connected state.
- [ ] Rate-limit failure retains connected state.
- [ ] Quota failure retains connected state.
- [ ] Storage failure remains a storage error.

### Compatibility

- [ ] Add no popup or `window.open()` call.
- [ ] Add no remote library.
- [ ] Add no service worker.
- [ ] Use no post-ES2019 syntax in the bundle.
- [ ] Keep abort as an optimization, not correctness evidence.

## Postconditions

- [ ] Expiry no longer means sign-out.
- [ ] Drive `401` retains local account selection.
- [ ] Sign-out remains the local-access boundary.
- [ ] Every account coordinator receives an account-scoped credential source.
- [ ] Late old-generation responses cannot clear pending work.
- [ ] Long token lifetimes cannot expire early from timer capping.
- [ ] Phase 03 remains required to stop all scheduled Drive work.

## Completion Commands

```text
bun test tests/auth-service.test.ts tests/oauth-redirect-adapter.test.ts
bun test tests/drive-rest-adapter.test.ts tests/sync-coordinator.test.ts
bun test tests/bootstrap.test.ts tests/account-flows.test.ts
bun run check
bun run test
bun run smoke:store
bun run check:compat
git diff --check
git status --short
```
