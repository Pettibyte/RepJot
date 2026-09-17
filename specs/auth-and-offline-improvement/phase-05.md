# Phase 05: Reconnect User Interface

## Purpose

This phase adds the user interface for local continuation and reconnection.
It keeps the active workout mounted after authorization loss.

This phase does not change the OAuth protocol.
Reconnect uses the existing full-page redirect in the current window.

## Required Reading

- [ ] Read `AGENTS.md` and the parent specification.
- [ ] Read Phases 01 through 04.
- [ ] Read `src/App.svelte`.
- [ ] Read `src/app-types.ts`.
- [ ] Read `src/bootstrap.ts` reconnect and mount code.
- [ ] Read `src/ui/screens/ActiveWorkoutScreen.svelte` completely.
- [ ] Read `src/ui/screens/SettingsScreen.svelte` completely.
- [ ] Read `DataExportSection.svelte`, `DisconnectSection.svelte`, and `SignOutSection.svelte`.
- [ ] Read `src/ui/styles/components.css` and the style checks.
- [ ] Read shell, settings, and active-workout tests.
- [ ] Read the DOM harness and all current DOM tests.

## Preconditions

- [ ] Complete Phases 01 through 04.
- [ ] Connection state is reactive.
- [ ] Local and remote save facts are separate.
- [ ] Expiry and `401` keep local services available.
- [ ] The coordinator supports local flush, pause, resume, and pending queries.
- [ ] Local store persistence is available through the registry.
- [ ] Local-only startup and mismatch startup work.
- [ ] Active-session routes hydrate before mount.

## Postconditions

- [ ] The local-only notice appears on every normal route.
- [ ] Token expiry does not unmount the active workout.
- [ ] Reconnect commits valid screen drafts before navigation.
- [ ] Invalid or unsaved drafts block the redirect.
- [ ] Pending memory-only data blocks the redirect.
- [ ] Settings keeps local actions available.
- [ ] Drive-only Settings actions are unavailable.
- [ ] Sign-out warns about pending data.
- [ ] Mismatch text shows no permission ID.
- [ ] Save text never claims false Drive success.

## Shell Reconnect Contract

### Modify `src/app-types.ts`

Add:

```ts
export type ReconnectBlockedReason =
  | 'invalid_draft'
  | 'local_save_failed'
  | 'not_redirect_safe';

export type ReconnectResult =
  | { kind: 'redirect_started' }
  | { kind: 'busy' }
  | {
      kind: 'blocked';
      reason: ReconnectBlockedReason;
      message: string;
    };
```

Extend `ShellProps`:

```ts
onReconnect: () => Promise<ReconnectResult>;
```

Rules:

- `onSignIn` remains the anonymous first-bind action.
- `onReconnect` applies only to a selected local account.
- Reconnect keeps the prior remember policy.
- A second press during preparation returns `busy`.
- A blocked result starts no redirect.

## Active-Screen Preparation Contract

### Add `src/ui/reconnect/reconnect-preparation.ts`

```ts
export type ReconnectPreparationResult =
  | { kind: 'ready' }
  | {
      kind: 'blocked';
      reason: 'invalid_draft' | 'local_save_failed';
      message: string;
    };

export type ReconnectPreparation =
  () => Promise<ReconnectPreparationResult>;

export function registerReconnectPreparation(
  preparation: ReconnectPreparation
): () => void;

export function prepareActiveScreenForReconnect():
  Promise<ReconnectPreparationResult>;
```

Rules:

- [ ] Permit one active handler.
- [ ] Return an unregister function.
- [ ] Return ready when no screen handler exists.
- [ ] Remove the handler on screen destruction.
- [ ] Never run a stale handler after navigation.
- [ ] Keep OAuth and Drive logic out of this module.

## Presentation State

### Reconnect issue

Add this presentation state to `src/state/app-state.ts` if earlier phases did not add it:

```ts
export type ReconnectIssue =
  | { kind: 'none' }
  | { kind: 'account_mismatch'; displayName?: string };
```

Expose a read-only store and controlled setters.
Never store either raw permission ID in this state.

### Save badge mapper

Add `src/ui/viewmodels/saveStatusModel.ts`.

```ts
export type SaveBadgeStatus =
  | 'idle'
  | 'saving'
  | 'saved'
  | 'saved_on_device'
  | 'sync_failed';

export function saveBadgeStatus(input: {
  local: LocalSaveState;
  remote: RemoteSyncState;
  connection: ConnectionState;
}): SaveBadgeStatus;
```

Precedence:

1. Active local write gives `saving`.
2. Failed local write gives `idle` and leaves the storage error visible.
3. Persistent pending work in local-only mode gives `saved_on_device`.
4. Connected remote failure gives `sync_failed`.
5. Durable local work without pending data gives `saved`.
6. Other combinations give `idle`.

Never return `saved_on_device` for memory storage.

## Exact User Messages

### Expired or unauthorized

> Google connection expired. You can keep using workouts on this device. Changes are saved here and will sync after you reconnect.

Button: **Reconnect Google Account**

### Account mismatch

> This device's local data belongs to another Google account. Reconnect with that account, or sign out to use a different account.

Optional second sentence:

> Reconnect as {displayName}.

### Invalid draft

> Correct the highlighted value before you reconnect.

### Local save failure

> REP JOT did not save your latest change on this device. Correct the problem and try again.

### Nonpersistent storage

> This browser cannot keep your pending changes during sign-in. Keep this page open and resolve the storage problem before you reconnect.

### Pending sign-out

> Unsynced changes will stay on this device. Reconnect with the same Google account to sync them.

Confirmation label: **Sign out and keep changes on this device**

## New Component

### Add `src/ui/components/ConnectionNotice.svelte`

Props:

- `connection`.
- `issue`.
- `busy`.
- `errorText`.
- `onreconnect`.

Behavior:

- [ ] Show on local-only and reconnecting states.
- [ ] Show mismatch text when applicable.
- [ ] Show no dismiss action.
- [ ] Use `role="status"` for normal local-only text.
- [ ] Use `role="alert"` for mismatch and blocked reconnect text.
- [ ] Disable the button while reconnect preparation runs.
- [ ] Change button text to **Reconnecting…** while busy.
- [ ] Do not expose token or account key values.

## Shell Changes

### Modify `src/App.svelte`

- [ ] Import and render `ConnectionNotice`.
- [ ] Render it outside the route outlet.
- [ ] Keep it after the header or tabs.
- [ ] Keep it before the dismissible error banner.
- [ ] Read connection and reconnect-issue stores.
- [ ] Use the pure save-badge mapper.
- [ ] Render **Saved on this device** for `saved_on_device`.
- [ ] Keep normal errors independently dismissible.
- [ ] Do not key or replace the route outlet when connection changes.
- [ ] Keep the active component instance mounted after expiry.
- [ ] Pass `onReconnect` to the notice.

## Reconnect Orchestration

### Modify `src/bootstrap.ts`

Supply `onReconnect` to every shell mount.
Anonymous and static-failure mounts return a safe blocked result.

Required reconnect order:

1. Refuse a second concurrent action.
2. Close or keep closed the coordinator network gate.
3. Publish `reconnecting` state.
4. Call `prepareActiveScreenForReconnect()`.
5. Stop when the screen reports invalid data.
6. Flush the session-service edit queue.
7. Flush coordinator local work.
8. Stop after a local storage failure.
9. Read pending logical names.
10. If pending exists in memory storage, block the redirect.
11. Preserve the current hash in OAuth state.
12. Start the existing full-page redirect.

If preparation fails, return to `local_only`.
Keep every pending row and screen draft.

The reconnect action must explicitly await local persistence.
The `pagehide` flush is not sufficient because the browser does not await it.

## Active Workout Changes

### Modify `src/ui/screens/ActiveWorkoutScreen.svelte`

Add a `commitDraftsForReconnect()` function.
Reuse the current validation and save operations.

Required behavior:

- [ ] Validate each visible exercise draft.
- [ ] Validate container score drafts.
- [ ] Find the first invalid control.
- [ ] Focus that control.
- [ ] Keep invalid text and existing errors visible.
- [ ] Queue every valid changed draft.
- [ ] Await `sessionService.queueFlush()`.
- [ ] Return a typed blocked result after local failure.
- [ ] Register the function when the screen mounts.
- [ ] Unregister the function when the screen is destroyed.

Local-only mode must permit:

- [ ] Exercise-result edits.
- [ ] Unit changes.
- [ ] Attempt creation and editing.
- [ ] Container scores.
- [ ] Session finish.
- [ ] Session abandon.
- [ ] Corrections to terminal sessions.

Starting another workout is also permitted through the normal service path.

## Settings Changes

### Modify `src/ui/screens/SettingsScreen.svelte`

Replace the current combined `signedIn` calculation with:

- `hasLocalAccount`.
- `hasLiveGoogleAccess`.

In local-only mode:

- [ ] Show Exercise Units.
- [ ] Permit local preference changes.
- [ ] Show diagnostics export.
- [ ] Show Sign out.
- [ ] Disable raw Drive export.
- [ ] Disable Delete All User Data.
- [ ] Disable Disconnect Google Account.
- [ ] Start no Drive or revoke request.

Before sign-out:

1. Query `coordinator.pendingEdits()`.
2. Show the warning when names exist.
3. Flush local work only in local-only mode.
4. Clear credentials and local selection after confirmation.
5. Keep the account database and pending rows.
6. Reload into anonymous startup.

### Modify `src/ui/components/DataExportSection.svelte`

Add:

```ts
available: boolean;
unavailableReason?: string;
```

Use this explanation:

> Reconnect your Google account to download files from Drive.

### Modify `src/ui/components/DisconnectSection.svelte`

Add an availability prop.
Use this explanation:

> Reconnect your Google account before you disconnect it.

### Modify `src/ui/components/SignOutSection.svelte`

- [ ] Add pending-edit confirmation state.
- [ ] Accept pending file names or a boolean without showing raw content.
- [ ] Provide cancel and confirm actions.
- [ ] Keep ordinary sign-out simple when nothing is pending.

## Styles

### Modify `src/ui/styles/components.css`

- [ ] Add `.connection-notice` classes.
- [ ] Use normal block flow.
- [ ] Use no fixed or sticky positioning.
- [ ] Use no CSS Grid for core layout.
- [ ] Use margins instead of flex `gap`.
- [ ] Use existing design tokens.
- [ ] Keep the button at least the minimum tap-target height.
- [ ] Keep the notice compact at 930 × 1132 CSS pixels.
- [ ] Keep active workout controls visible below the notice.

## Test Harness

### Modify `tests/dom/harness.ts`

Add helpers equivalent to:

- `startLocalOnly()`.
- `setConnection()`.
- `setReconnectIssue()`.
- A persistent or memory store choice.

A local-only harness publishes:

- Local account.
- Paused coordinator.
- Preferences.
- Session service.
- Lookup.
- Store.
- `drive: null`.

Reset all new state during teardown.

## Tests

### Add `tests/save-status-model.test.ts`

- [ ] Local writing has highest precedence.
- [ ] Persistent local-only pending work gives `saved_on_device`.
- [ ] Memory work never gives `saved_on_device`.
- [ ] Connected sync failure gives `sync_failed`.
- [ ] No pending work gives `saved` after local durability.

### Add `tests/connection-notice.test.ts`

- [ ] Normal notice uses the approved message.
- [ ] Mismatch notice contains no account key.
- [ ] Notice has no dismiss action.
- [ ] Reconnecting state disables the button.
- [ ] Blocked message uses alert semantics.

### Extend `tests/shell.test.ts`

- [ ] Notice appears on tab routes.
- [ ] Notice appears on active-workout routes.
- [ ] Notice remains after route-store changes.
- [ ] Active outlet remains mounted after state change.
- [ ] Badge shows **Saved on this device**.
- [ ] Normal errors remain independently dismissible.

### Extend `tests/settings.test.ts`

- [ ] Local-only mode shows units and diagnostics.
- [ ] Local-only mode shows sign-out.
- [ ] Local-only mode disables all Drive actions.
- [ ] Anonymous mode remains different from local-only mode.
- [ ] Connected mode retains all existing actions.
- [ ] Pending sign-out shows the approved warning.

### Extend `tests/active-workout-screen.test.ts`

- [ ] Local-only services permit editing.
- [ ] Finish and abandon remain available.
- [ ] Terminal corrections remain available.
- [ ] Invalid drafts return the blocked contract.

### Add `tests/dom/auth-offline-reconnect.test.ts`

- [ ] Expiry does not unmount the active screen.
- [ ] Valid typed text commits before reconnect.
- [ ] Invalid text blocks reconnect.
- [ ] Invalid text stays visible.
- [ ] The invalid field receives focus.
- [ ] Failed local transaction blocks reconnect.
- [ ] Memory-only pending data blocks reconnect.
- [ ] Successful preparation starts one redirect.
- [ ] A repeated press starts no second redirect.
- [ ] OAuth state stores the active-workout hash.
- [ ] No Drive call starts while paused.

### Add `tests/dom/auth-offline-settings.test.ts`

- [ ] Unit changes write locally.
- [ ] Raw export starts no Drive call.
- [ ] Delete starts no Drive call.
- [ ] Disconnect starts no revoke call.
- [ ] Diagnostics remains available.
- [ ] Pending sign-out shows warning.
- [ ] Cancel keeps local selection.
- [ ] Confirm clears selection and keeps pending rows.

## Acceptance and Risk Checks

- [ ] Expire while typing in an active workout.
- [ ] Make sure that route and component remain.
- [ ] Make sure that the badge says **Saved on this device** after local save.
- [ ] Type valid text and reconnect without blur.
- [ ] Make sure that the value survives callback and restart.
- [ ] Type invalid text and reconnect.
- [ ] Make sure that no redirect starts.
- [ ] Disable IndexedDB and create pending work.
- [ ] Make sure that redirect is blocked.
- [ ] Trigger several `401` responses.
- [ ] Make sure that one notice appears.
- [ ] Open Settings and try all Drive-only actions.
- [ ] Make sure that no Drive method runs.
- [ ] Sign out and restart.
- [ ] Make sure that private local data does not open automatically.
- [ ] Examine the 930 × 1132 layout for covered controls.

## Kindle Validation

- [ ] Open an active workout before expiry.
- [ ] Keep the page open through exact expiry.
- [ ] Enter and save a result after expiry.
- [ ] Scroll a long workout with the notice visible.
- [ ] Finish the workout without Google access.
- [ ] Reconnect with the same account.
- [ ] Make sure that the same hash route returns.
- [ ] Enter invalid text and make sure that reconnect is blocked.
- [ ] Examine local-only Settings restrictions.
- [ ] Make sure that no secondary window opens.

## Completion Commands

```text
bun test tests/save-status-model.test.ts tests/connection-notice.test.ts
bun test tests/shell.test.ts tests/settings.test.ts
bun test tests/active-workout-screen.test.ts
bun run test:dom
bun run check
bun run test
bun run check:styles
bun run check:compat
git diff --check
git status --short
```
