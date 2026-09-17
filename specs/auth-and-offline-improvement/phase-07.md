# Phase 07: Validation and Release

## Purpose

This phase proves the complete authentication and local-continuation design.
It combines automated tests, compatibility gates, browser tests, Kindle tests, and release records.

No feature is complete until this phase passes.

## Required Reading

- [ ] Read `AGENTS.md` and the parent specification.
- [ ] Read all six earlier phase documents.
- [ ] Read `docs/RELEASE.md`.
- [ ] Read `scripts/release-check.ts`.
- [ ] Read `scripts/smoke-local-store.ts`.
- [ ] Read `scripts/check-browser-compat.ts`.
- [ ] Read the complete test list in `package.json`.
- [ ] Read `docs/PHASE-0-AUTHORIZATION-PROOF.md`.
- [ ] Read `docs/CAPABILITIES-kindle-scribe.md`.

## Preconditions

- [ ] Complete Phases 01 through 06.
- [ ] Make sure that requirements and architecture are current.
- [ ] Make sure that all new code uses TypeScript or Svelte with TypeScript.
- [ ] Make sure that all commands use Bun.
- [ ] Make sure that two Google test accounts are available.
- [ ] Make sure that a physical Kindle Scribe is available.
- [ ] Prepare a method to inspect fake and real Drive outcomes.
- [ ] Record the source commit under test.

## Observable Safety Contract

Automated tests must directly observe these facts:

- Drive call count and operation names.
- Opened account namespace keys.
- OAuth redirect count and saved return route.
- Working, base, and pending local rows.
- Authorization generation and coordinator epoch.
- Connection-state transitions.
- Local-save and remote-sync transitions.
- Save-badge text.
- Active route and mounted component continuity.
- Local selection before and after account actions.
- Pending logical names before and after reconnect.

A test cannot pass only because a fire-and-forget promise did not settle.
Use deterministic barriers and explicit promise drains.

## Tests

### Test Infrastructure

#### Extend the fake Drive

Find the repository's shared fake Drive or add one under `tests/fakes/`.
It must support:

- [ ] Pause before upload.
- [ ] Pause after remote commit but before response.
- [ ] Pause before read-back.
- [ ] Return `401`, `403`, `429`, quota, and network failures separately.
- [ ] Return different account profiles during bind.
- [ ] Record catalog, read, create, update, delete, profile, and revoke calls.
- [ ] Release one paused operation deterministically.
- [ ] Keep deterministic file IDs.

### Restart contract

A restart test creates a new runtime stack.
It must not reuse:

- Coordinator.
- Session service.
- Preference service.
- Lookup service.
- Svelte component.
- In-memory authorization session.

It can reuse persistent browser storage, IndexedDB state, static data, and fake Drive state.

### Wrong-account contract

The wrong-account test must prove all these facts:

- The returned token binds before comparison.
- Returned and selected account keys differ.
- The returned token is cleared.
- The original local selection remains.
- The returned account database never opens.
- The original database opens only in paused mode.
- No Drive data call occurs after mismatch.
- No UI text contains either raw account key.

## New Integration Tests

### Add `tests/auth-offline-integration.test.ts`

Cover complete expiry, restart, reconnect, and mismatch paths.

### Add `tests/auth-generation-fence.test.ts`

Cover late response, ambiguous upload, and stale generation behavior.

### Add `tests/local-account-lifecycle.test.ts`

Cover migration, corruption, sign-out, disconnect, and deletion boundaries.

### Add `tests/local-only-bootstrap.test.ts`

Cover anonymous, connected, local-only, active-route, and mismatch startup.

### Add `tests/reconnect-route.test.ts`

Cover OAuth route storage, callback cleanup, hydration, and route restoration.

### Add `tests/dom/auth-offline-workout-lifecycle.test.ts`

Cover mounted editing, finish, abandon, reload, and local restart.

Retain the Phase 05 DOM tests for reconnect and Settings.
Retain the Phase 06 privacy-copy test.

## Authentication and Account Checklist

- [ ] Exact expiry clears only OAuth credentials.
- [ ] Exact expiry keeps local selection.
- [ ] Exact expiry keeps the account database.
- [ ] Exact expiry keeps the active route.
- [ ] Concurrent `401` responses cause one transition.
- [ ] Network failure keeps connected classification.
- [ ] Generic `403` does not become local-only.
- [ ] A long expiry delay rearms.
- [ ] A capped timer does not expire early.
- [ ] Sign-out clears token and selection.
- [ ] Sign-out keeps pending database rows.
- [ ] Confirmed disconnect follows the approved clear policy.
- [ ] Unconfirmed disconnect preserves retry state.
- [ ] Completed deletion clears selection and selected namespace.
- [ ] Malformed selection opens no private database.
- [ ] Legacy migration creates no Drive authorization.
- [ ] No code stores a refresh token or client secret.

## Coordinator Checklist

- [ ] Paused edits use one local transaction.
- [ ] Paused edits write working, base, and pending rows.
- [ ] Paused edits make no Drive request.
- [ ] Pause cancels scheduled synchronization.
- [ ] New monthly shards work while paused.
- [ ] Preferences remain editable while paused.
- [ ] Local loading makes no catalog request.
- [ ] Resume flushes local work first.
- [ ] Resume reconciles every pending file.
- [ ] A late old-generation response cannot clear pending data.
- [ ] Abort is not treated as proof of no remote commit.
- [ ] A committed upload with lost response keeps local intent.
- [ ] Reconnect converges after an ambiguous upload.
- [ ] Same-session conflict behavior remains unchanged.
- [ ] Preference conflict behavior remains unchanged.

## Bootstrap Checklist

- [ ] Anonymous startup opens no namespace.
- [ ] Connected startup binds before private access.
- [ ] Local-only startup opens only the selected namespace.
- [ ] Local-only startup makes no Drive call.
- [ ] Cached preferences load locally.
- [ ] Cached result shards load locally.
- [ ] Lookup indexes rebuild from validated data.
- [ ] Corrupt cache uses the existing data-error path.
- [ ] A session route hydrates before mount.
- [ ] No code derives a shard from the session UUID.
- [ ] Wrong-account startup opens no returned-account namespace.
- [ ] Same-account startup resumes pending synchronization.
- [ ] Failed bind keeps pending local data.

## User Interface Checklist

- [ ] The connection notice persists across routes.
- [ ] The notice is not dismissible.
- [ ] The notice does not replace storage errors.
- [ ] The active workout remains mounted.
- [ ] Workout edits remain locally durable.
- [ ] Finish works in local-only mode.
- [ ] Abandon works in local-only mode.
- [ ] Another workout can start in local-only mode.
- [ ] History identifies the local and potentially incomplete state.
- [ ] **Saved on this device** requires persistent storage.
- [ ] Drive-only Settings controls make no Drive call.
- [ ] Sign-out warns about pending edits.
- [ ] Mismatch text contains no account key.

## Redirect Preparation Checklist

- [ ] Reconnect keeps the network gate closed.
- [ ] Reconnect validates active drafts.
- [ ] Reconnect commits valid drafts.
- [ ] Reconnect waits for local persistence.
- [ ] A local write failure prevents redirect.
- [ ] Pending memory-only data prevents redirect.
- [ ] Reconnect stores the current hash.
- [ ] Reconnect uses the current window.
- [ ] Callback restores the hash.
- [ ] Pending reconciliation starts before remote-only history loading.

## End-to-End Scenarios

### Scenario A: Exact expiry and restart

- [ ] Start a connected workout.
- [ ] Save one result before expiry.
- [ ] Trigger exact expiry.
- [ ] Save another result after expiry.
- [ ] Make sure that no Drive request starts.
- [ ] Destroy the complete runtime.
- [ ] Start a new runtime with the same persistent storage.
- [ ] Open the active route.
- [ ] Make sure that both results are present.
- [ ] Finish the workout locally.
- [ ] Reconnect with the same account.
- [ ] Make sure that the pending shard reaches Drive.
- [ ] Make sure that pending clears only after read-back.

### Scenario B: Wrong-account reconnect

- [ ] Create pending work for account A.
- [ ] Reconnect with account B.
- [ ] Make sure that B binds before comparison.
- [ ] Make sure that B's token clears.
- [ ] Make sure that B's namespace never opens.
- [ ] Make sure that no local data uploads.
- [ ] Make sure that A remains selected.
- [ ] Sign out explicitly.
- [ ] Bind B again.
- [ ] Make sure that B starts as a separate account.

### Scenario C: Ambiguous upload

- [ ] Create a pending edit.
- [ ] Pause after Drive commits the upload.
- [ ] Lose the response.
- [ ] Trigger authorization loss.
- [ ] Release the old operation.
- [ ] Make sure that the stale response does not clear pending.
- [ ] Reconnect.
- [ ] Read and reconcile the remote file.
- [ ] Make sure that local and remote documents converge.

### Scenario D: Memory fallback

- [ ] Remove IndexedDB from the test host.
- [ ] Start with the memory store.
- [ ] Create an edit.
- [ ] Enter local-only mode.
- [ ] Press reconnect.
- [ ] Make sure that redirect does not start.
- [ ] Make sure that **Saved on this device** does not appear.
- [ ] Make sure that the draft remains visible.

### Scenario E: Shared browser profile

- [ ] Start local-only with pending data.
- [ ] Sign out.
- [ ] Restart the runtime.
- [ ] Make sure that private local data does not open automatically.
- [ ] Reconnect with the same account.
- [ ] Make sure that the original namespace reopens.
- [ ] Make sure that pending work synchronizes.

## Storage Smoke Gate

### Modify `scripts/smoke-local-store.ts`

- [ ] Print and validate persistent capability.
- [ ] Prove that IndexedDB is redirect-safe.
- [ ] Prove that memory storage is not redirect-safe.
- [ ] Keep atomic rollback coverage.
- [ ] Keep account-isolation coverage.

### Modify `scripts/release-check.ts`

- [ ] Add `bun run smoke:store` after the test suite.
- [ ] Stop after smoke failure.
- [ ] Update the gate description.
- [ ] Keep all commands on Bun.

## Release Runner

The release gate must run these tasks or their repository equivalents:

```text
bun ci
bun run check
bun run test
bun run smoke:store
bun run check:schemas
bun run check:static
bun run check:styles
bun run seed:check
bun run build
bun run check:compat
```

Rules:

- [ ] Do not use `node`.
- [ ] Do not use `npm`.
- [ ] Do not skip the DOM suite.
- [ ] Do not edit `dist/` directly.
- [ ] Stop after a failed gate.
- [ ] Record the exact command and failure.
- [ ] Rebuild before bundle measurement.

## Physical Kindle Checklist

Record PASS or FAIL, date, operator, source commit, and release tag.

1. [ ] Full-page authorization completes without a popup.
2. [ ] Callback replay remains idempotent.
3. [ ] Remember checked restores only before exact expiry.
4. [ ] Remember unchecked follows session-storage behavior.
5. [ ] Exact expiry keeps the active workout visible.
6. [ ] The persistent notice appears once.
7. [ ] The notice does not cover workout controls.
8. [ ] A post-expiry edit shows **Saved on this device**.
9. [ ] A post-expiry edit survives reload.
10. [ ] A post-expiry edit survives browser restart.
11. [ ] A local-only workout can finish.
12. [ ] A local-only workout can be abandoned.
13. [ ] A new local-only workout can start.
14. [ ] Local-only unit changes survive restart.
15. [ ] Drive export is unavailable in local-only mode.
16. [ ] Delete All User Data is unavailable in local-only mode.
17. [ ] Disconnect is unavailable in local-only mode.
18. [ ] Diagnostics export remains available.
19. [ ] An invalid field blocks reconnect.
20. [ ] Same-account reconnect restores the route.
21. [ ] Same-account reconnect synchronizes pending work.
22. [ ] Wrong-account reconnect uploads nothing.
23. [ ] Wrong-account text shows no permission ID.
24. [ ] Sign-out prevents automatic local access after restart.
25. [ ] Long-workout scrolling remains responsive.
26. [ ] No CSP violation appears.
27. [ ] No secondary window opens.
28. [ ] The privacy page loads and scrolls correctly.

## Conventional Browser Matrix

Run the main scenarios in:

- [ ] Current Chromium.
- [ ] Current Firefox.
- [ ] Current Safari, when available.
- [ ] Chromium with IndexedDB forced to fail.
- [ ] A profile with two Google test accounts.

Record:

- Browser version.
- Source commit.
- Persistence result.
- Same-account reconnect result.
- Wrong-account reconnect result.
- Restart result.
- Console errors.
- Network calls after local-only transition.

## Release-Blocking Risks

| Risk | Required proof | Release rule |
| --- | --- | --- |
| Cross-account upload | Wrong-account end-to-end test | Any upload blocks release |
| Lost pending edit | Restart and reconnect test | Any missing value blocks release |
| Late response clears intent | Generation-fence test | Any cleared pending row blocks release |
| Early timer expiry | Long-delay timer test | Early expiry blocks release |
| Network misclassified | Network-failure test | Local-only transition blocks release |
| False durable label | Memory-store test | Durable label blocks release |
| Redirect loses draft | No-blur reconnect test | Lost text blocks release |
| Active screen unmounts | Mounted expiry DOM test | Route reset blocks release |
| Kindle popup regression | Physical authorization test | New window blocks release |
| Shared-profile disclosure | Sign-out restart test | Automatic access blocks release |
| Privacy mismatch | Source and built policy test | Incorrect text blocks release |
| Bundle incompatibility | Compatibility gate | Any failure blocks release |

## Release Record

### Modify `docs/RELEASE.md`

Record:

| Field | Required value |
| --- | --- |
| Version | Release version |
| Source commit | Full commit SHA |
| Pages commit | Full commit SHA |
| Tag | Signed or annotated tag |
| `app.js` raw bytes | Measured value |
| `app.js` gzip bytes | Level-9 value |
| `dist/` file count | Measured value |
| Local-store smoke | PASS and date |
| Conventional browsers | Versions and result |
| Kindle Scribe | PASS, date, and operator |
| Same-account reconnect | PASS |
| Wrong-account reconnect | PASS |
| Restart with pending data | PASS |
| Privacy review | Approver and date |
| Published by | Name |
| Published on | UTC timestamp |

The live-site smoke test must include one connected save and one local-only reconnect.

## Final Acceptance Criteria

- [ ] Token expiry never removes the active workout.
- [ ] A post-expiry edit becomes durable without Drive access.
- [ ] Pending edits survive browser restart.
- [ ] Same-account reconnect synchronizes pending edits.
- [ ] Wrong-account reconnect synchronizes nothing.
- [ ] Sign-out prevents automatic local access after restart.
- [ ] No code stores a refresh token or client secret.
- [ ] Kindle keeps the full-page OAuth redirect.
- [ ] Privacy text matches the implementation.
- [ ] Every automated and device gate passes.

## Postconditions

- [ ] All automated test suites pass.
- [ ] The local-store smoke gate passes.
- [ ] The compatibility and build gates pass.
- [ ] Same-account and wrong-account scenarios pass.
- [ ] Restart recovery passes with persistent storage.
- [ ] The physical Kindle checklist passes.
- [ ] The privacy policy matches the release behavior.
- [ ] The release record contains all required evidence.

## Completion Commands

```text
bun run release:check
bun run check
bun run test
bun run smoke:store
bun run check:compat
git diff --check
git status --short
```
