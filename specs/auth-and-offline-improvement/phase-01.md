# Phase 01: Requirements and State Contracts

## Purpose

This phase defines the product and code contracts for local continuation.
It separates Google authorization from local account access.

This phase does not change the OAuth protocol or expiry behavior.
Later phases implement authorization loss, paused synchronization, startup, and user interface behavior.

## Required Reading

- [ ] Read `AGENTS.md`.
- [ ] Read `specs/auth-and-offline-improvement.md`.
- [ ] Read Sections 2, 3, 4, 14, and 21 of `docs/REQUIREMENTS.md`.
- [ ] Read Sections 8 through 16 of `docs/ARCHITECTURE.md`.
- [ ] Read the storage and security sections of `docs/CAPABILITIES-kindle-scribe.md`.
- [ ] Read `src/state/app-state.ts`.
- [ ] Read `src/auth/storage-keys.ts`.
- [ ] Read `src/auth/oauth-redirect-adapter.ts`.
- [ ] Read `src/auth/auth-service.ts`.
- [ ] Read `src/storage/local-store.ts`.
- [ ] Read `src/sync/sync-coordinator.ts`.
- [ ] Read `tests/app-state.test.ts` and `tests/oauth-redirect-adapter.test.ts`.

## Preconditions

- [ ] Record the existing working-tree changes before implementation.
- [ ] Run `bun run check`.
- [ ] Run `bun run test`.
- [ ] Make sure that the current OAuth redirect tests pass.
- [ ] Make sure that the current local-first synchronization tests pass.
- [ ] Do not overwrite unrelated working-tree changes.

## Product Contracts

### Authorization boundary

Google authorization controls Drive operations.
A live Google bind is not necessary for later local access on the same browser profile.

A prior successful bind creates a credential-free local account selection.
That selection can open one exact account namespace after the token expires.

Explicit sign-out clears the local selection.
Confirmed disconnect follows the approved local-cache removal policy.

### Local security boundary

The browser profile is the local security boundary.
REP JOT does not add a local password or local encryption in this work.

The requirements and privacy policy must state this limitation.
Phase 06 updates the public privacy policy.

### State separation

The implementation must represent these facts separately:

- Local account selection.
- Google connection state.
- Local-write state.
- Remote-sync state.
- Local-store persistence.

A single `signedIn` boolean or `SaveStatus` value cannot carry all five facts.

## Message Contracts

Define these messages now so later phases use one wording.
Do not render them in this phase.

### Local-only notice

> Google connection expired. You can keep using workouts on this device. Changes are saved here and will sync after you reconnect.

### Account mismatch

> This device's local data belongs to another Google account. Reconnect with that account, or sign out to use a different account.

### Pending sign-out warning

> Unsynced changes will stay on this device. Reconnect with the same Google account to sync them.

Rules:

- [ ] Do not include a Drive permission ID.
- [ ] Do not include an access token.
- [ ] Do not use the term refresh token for an access token.
- [ ] Use the brand name **REP JOT** in user-facing text.

## Documentation Changes

### `docs/REQUIREMENTS.md`

- [ ] State that Google authorization controls Drive access.
- [ ] State that a prior bind can authorize later local access.
- [ ] Keep a live bind mandatory before each connected account context starts.
- [ ] Keep a live token mandatory before every Drive request.
- [ ] Add a credential-free local account selection.
- [ ] State that expiry and Drive `401` retain that selection.
- [ ] State that explicit sign-out clears that selection.
- [ ] State that a reconnect must bind before account comparison.
- [ ] Require exact permission-ID equality before synchronization resumes.
- [ ] Prohibit namespace discovery through IndexedDB enumeration.
- [ ] Add connected, local-only, and mismatch startup paths.
- [ ] Separate local-write, remote-sync, and connection status requirements.
- [ ] Require persistent storage before **Saved on this device** appears.
- [ ] Keep the existing full-page current-window OAuth redirect.
- [ ] Keep GIS, PKCE, popups, refresh tokens, and a backend out of scope.
- [ ] Require live Google access for Drive export, deletion, and disconnect.

### `docs/ARCHITECTURE.md`

- [ ] Add the local account selection to the state-layer diagram.
- [ ] Separate credentials from the local account selection.
- [ ] Add connected, local-only, reconnecting, and anonymous states.
- [ ] Add local-save and remote-sync state layers.
- [ ] Document the browser profile as the local boundary.
- [ ] Add connected, local-only, and mismatch startup sequences.
- [ ] Add an account-scoped token-source rule.
- [ ] Add an authorization-generation rule.
- [ ] Add the paused coordinator design.
- [ ] Add shared-profile, stale-history, mismatch, and late-response risks.
- [ ] State that normal expiry does not use the dismissible error banner.
- [ ] Update the authentication and synchronization test strategy.

Suggested architecture decisions:

- [ ] Add an ADR for local access after a prior successful bind.
- [ ] Add an ADR for the versioned local account record.
- [ ] Add an ADR for account-scoped credential access.
- [ ] Add an ADR for authorization-generation fencing.
- [ ] Add an ADR for separate local and remote save facts.

## Local Account Record

### New file: `src/auth/local-account.ts`

Create a module that exclusively owns the local account envelope.
No other module can parse or serialize this envelope.

Use this contract:

```ts
export interface SelectedLocalAccount {
  accountKey: string;
  displayName?: string;
  lastBoundAtUtc: string;
}

export interface LocalAccountEnvelopeV1 {
  version: 1;
  account: SelectedLocalAccount;
}

export type LocalAccountState =
  | { kind: 'none' }
  | { kind: 'selected'; account: SelectedLocalAccount };

export function readLocalAccount(): LocalAccountState;
export function writeLocalAccount(account: SelectedLocalAccount): void;
export function clearLocalAccount(): void;
export function isLocalAccountEnvelope(
  value: unknown
): value is LocalAccountEnvelopeV1;
```

### Modify `src/auth/storage-keys.ts`

Add this key:

```ts
export const LOCAL_ACCOUNT_STORAGE_KEY =
  'repjot.auth.local-account.v1';
```

The key must not enter the list of OAuth credential keys.
The existing `SELECTED_ACCOUNT_KEY` becomes legacy metadata.
Do not reuse its unversioned string format.

### Envelope invariants

- [ ] Store the envelope in `localStorage` only.
- [ ] Include `version: 1`.
- [ ] Validate `accountKey` with the existing account-key rules.
- [ ] Require a valid UTC `lastBoundAtUtc` value ending in `Z`.
- [ ] Omit an empty display name.
- [ ] Reject unknown versions.
- [ ] Reject malformed JSON.
- [ ] Reject extra credential fields.
- [ ] Return `{ kind: 'none' }` after malformed input.
- [ ] Do not open an IndexedDB database while reading the envelope.
- [ ] Do not enumerate IndexedDB databases.
- [ ] Store no token, scope, route, Drive file, or pending delta.
- [ ] Convert browser storage exceptions to `AppError('storage')`.

## State Contracts

### Modify `src/storage/local-store.ts`

Add the persistence capability to the storage contract:

```ts
export type LocalStorePersistence = 'persistent' | 'memory';

export interface LocalStore {
  readonly persistence: LocalStorePersistence;
  // Existing methods remain.
}
```

- [ ] Mark the IndexedDB store as `persistent`.
- [ ] Mark the memory store as `memory`.
- [ ] Update all fake stores.
- [ ] Keep this capability inside the storage contract.
- [ ] Do not infer persistence from a constructor name.

### Modify `src/state/app-state.ts`

Import `LocalStorePersistence` from `src/storage/local-store.ts`.
Add these types or equivalent discriminated unions:

```ts
export type ConnectionState =
  | { kind: 'anonymous' }
  | { kind: 'connected'; accountKey: string; expiresAtUtc: string }
  | {
      kind: 'local_only';
      accountKey: string;
      reason: 'expired' | 'unauthorized';
    }
  | { kind: 'reconnecting'; accountKey: string };

export type LocalSaveState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | {
      kind: 'saved';
      savedAtUtc: string;
      persistence: LocalStorePersistence;
    }
  | { kind: 'failed' };

export type RemoteSyncState =
  | { kind: 'idle'; pending: false }
  | { kind: 'pending'; pending: true }
  | { kind: 'syncing'; pending: true }
  | { kind: 'synced'; pending: false }
  | { kind: 'failed'; pending: true }
  | {
      kind: 'paused_auth';
      pending: boolean;
      reason: 'expired' | 'unauthorized';
    };
```

Expose read-only stores and controlled setters.
Keep `activeError` independent from these stores.

Add a pure derived-status function:

```ts
export type SaveStatus =
  | 'idle'
  | 'saving'
  | 'saved'
  | 'saved_on_device'
  | 'sync_failed';

export function deriveSaveStatus(
  local: LocalSaveState,
  remote: RemoteSyncState,
  connection: ConnectionState
): SaveStatus;
```

Use this precedence:

1. A local write in progress gives `saving`.
2. A failed or absent local save gives `idle`.
3. Persistent pending work in local-only mode gives `saved_on_device`.
4. A remote failure with usable authorization gives `sync_failed`.
5. Durable local data without a pending delta gives `saved`.
6. Other combinations give `idle` until a later phase defines more detail.

### Modify `src/sync/sync-coordinator.ts`

This phase changes state publication only.
Do not add pause and resume behavior yet.

- [ ] Publish `LocalSaveState.saving` before the local transaction.
- [ ] Publish `LocalSaveState.saved` only after `setMany()` resolves.
- [ ] Publish `LocalSaveState.failed` after local storage failure.
- [ ] Publish `RemoteSyncState.pending` after a durable pending delta.
- [ ] Publish `RemoteSyncState.syncing` when reconciliation starts.
- [ ] Publish `RemoteSyncState.synced` after confirmed read-back and local commit.
- [ ] Publish `RemoteSyncState.failed` after final remote failure.
- [ ] Preserve all current local-first and merge behavior.

### Modify `src/App.svelte`

- [ ] Make the status-label function exhaustive for `saved_on_device`.
- [ ] Keep the visible label as **Saved** during this contract phase.
- [ ] Do not add the reconnect notice yet.
- [ ] Keep the current ARIA live-region behavior.

## Tests

### Add `tests/local-account.test.ts`

- [ ] A valid v1 envelope round-trips.
- [ ] An absent value returns `none`.
- [ ] Corrupt JSON returns `none`.
- [ ] A missing version returns `none`.
- [ ] An unknown version returns `none`.
- [ ] An invalid account key returns `none`.
- [ ] A non-UTC timestamp returns `none`.
- [ ] An empty display name follows the documented normalization.
- [ ] The stored JSON contains no credential fields.
- [ ] Clearing removes only the local-account key.
- [ ] Reading malformed data opens no account namespace.

### Extend `tests/local-store.test.ts`

- [ ] IndexedDB reports `persistent`.
- [ ] Memory storage reports `memory`.
- [ ] Factory fallback reports `memory`.
- [ ] Existing storage operations remain identical.

### Extend `tests/app-state.test.ts`

- [ ] Each connection variant publishes through a read-only store.
- [ ] Local and remote states change independently.
- [ ] A remote failure does not erase a successful local-save state.
- [ ] A local failure does not become `sync_failed`.
- [ ] Local saving has the highest status precedence.
- [ ] Persistent local-only pending work gives `saved_on_device`.
- [ ] Memory-only work never gives `saved_on_device`.
- [ ] Connected remote failure gives `sync_failed`.
- [ ] Durable data without pending work gives `saved`.

### Extend `tests/sync-coordinator.test.ts`

- [ ] Local saved state appears after the atomic local transaction.
- [ ] Local saved state appears before remote completion.
- [ ] A failed local transaction publishes local failure only.
- [ ] Final Drive failure retains local saved state.
- [ ] Confirmed synchronization publishes remote synced.
- [ ] Existing pending-delta and merge tests stay unchanged.

### Extend `tests/shell.test.ts`

- [ ] The new status union is exhaustive.
- [ ] Existing visible status labels remain stable in Phase 01.
- [ ] No reconnect notice appears.

## Acceptance and Risk Checks

- [ ] Inspect the stored envelope and make sure that it is credential-free.
- [ ] Insert malformed envelope JSON and reload.
- [ ] Make sure that no private namespace opens from malformed metadata.
- [ ] Make sure that no new external origin appears in the production bundle.
- [ ] Make sure that the app still uses a full-page redirect.
- [ ] Search `dist/` for embedded client-secret or refresh-token values.
- [ ] Run the Kindle compatibility gate.
- [ ] Make sure that no post-ES2019 syntax enters the bundle.

## Postconditions

- [ ] Requirements and architecture agree with the parent specification.
- [ ] The versioned local account format exists.
- [ ] The local account record contains no credential.
- [ ] Local-save, remote-sync, and connection state are separate.
- [ ] Existing connected behavior remains functional.
- [ ] Expiry remains unchanged until Phase 02.
- [ ] No runtime path opens private data without a live bind yet.

## Completion Commands

```text
bun test tests/local-account.test.ts tests/app-state.test.ts
bun test tests/local-store.test.ts tests/sync-coordinator.test.ts tests/shell.test.ts
bun run check
bun run test
bun run smoke:store
bun run check:compat
git diff --check
git status --short
```
