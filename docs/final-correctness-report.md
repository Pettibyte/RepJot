# Final correctness assessment

## Scope

This assessment covers checklist areas 1, 2, 3, 4, 5, 6, 13, 14, 15, 17, 18, and 19.

No implementation code was changed. Six new audit test files reproduce the findings.

## Summary

| Severity | Count |
| --- | ---: |
| High | 2 |
| Medium | 6 |

The existing suite passed before the audit tests were added:

- Unit suite: 1,399 passed, 0 failed.
- DOM suite: 25 passed, 0 failed.
- Focused existing tests for the assessed areas: 383 passed, 0 failed.
- `bun run check`: 0 errors and 0 warnings.

The new audit suite has 9 expected failures across 6 files.

```sh
bun test tests/audit-*.test.ts
```

## Findings

### F-01 — High — A Drive read can pair stale content with new metadata

**Areas:** 3 and 4

`src/drive/drive-rest-adapter.ts` reads file content before it reads file metadata. Another device can write between those requests.

The adapter can then return old bytes with the marker for the new content. The synchronization preflight accepts that pair as current. A later upload can overwrite a remote session that the local client never merged.

**Requirement trace:**

- `docs/REQUIREMENTS.md` 4.6 requires the client to read the latest Drive content before upload.
- `docs/REQUIREMENTS.md` 4.7 through 4.9 require independent keyed entries from that remote content to participate in the merge.
- `specs/storage-and-lookup.md`, synchronization preflight, requires the content and metadata used by the merge to describe the same remote state.

**New failing test:**

- `tests/audit-correctness-areas-4-6-drive-schema-utc.test.ts`
- Test: `a preflight read does not pair stale bytes with newer metadata and lose a remote session`

**Reproduce:**

```sh
bun test tests/audit-correctness-areas-4-6-drive-schema-utc.test.ts
```

The final Drive document contains the local session but not the concurrent remote session.

---

### F-02 — High — Disconnect can erase a pending edit after synchronization fails

**Areas:** 1 and 14

`runDisconnect()` calls `coordinator.flush()` before revocation. The flush waits for synchronization, but it swallows synchronization failures.

The disconnect flow then revokes access and clears the local namespace. This removes the only remaining copy of the pending edit.

**Requirement trace:**

- `docs/REQUIREMENTS.md` 4.4 states that a failed Drive synchronization must not discard local edits.
- `docs/REQUIREMENTS.md` 4.20 requires all pending local edits to remain after the retry limit.
- `docs/implementation/PHASE-19.md` defines disconnect as a separate flow and says pending work must reach Drive before revocation.

**New failing test:**

- `tests/audit-disconnect-pending-sync-failure.test.ts`
- Test: `disconnect does not discard an edit whose Drive synchronization failed`

**Reproduce:**

```sh
bun test tests/audit-disconnect-pending-sync-failure.test.ts
```

The test receives `disconnected`. The revoke runs, and the pending record is cleared after all upload attempts fail.

---

### F-03 — Medium — A successful file sync hides another file's unresolved failure

**Areas:** 1 and 3

The save status is global. A successful reconciliation sets it to `saved` without examining pending failures for other logical files.

A failed preference upload can remain pending while a successful result-shard upload changes the visible state from `sync_failed` to `saved`.

**Requirement trace:**

- `docs/REQUIREMENTS.md` 4.3 requires the `Saving`, `Saved`, and `Sync failed` states.
- `docs/REQUIREMENTS.md` 4.20 requires `Sync failed` after three failed attempts while pending edits remain.
- `docs/ARCHITECTURE.md` §11 defines `Sync failed` as durable local data whose Drive synchronization failed.

**New failing test:**

- `tests/audit-correctness-areas-1-3-sync-status.test.ts`
- Test: `a successful commit cannot hide another logical file whose sync failed`

**Reproduce:**

```sh
bun test tests/audit-correctness-areas-1-3-sync-status.test.ts
```

The preference delta remains pending, but the reported state is `saved`.

---

### F-04 — Medium — Duplicate cleanup loses fractional timestamp precision

**Areas:** 4 and 6

Duplicate cleanup converts `updatedAtUtc` to JavaScript milliseconds. RFC 3339 timestamps can contain more precise fractions.

For example, `.0001Z` and `.0002Z` become the same millisecond. The Drive file ID then breaks a tie that does not exist and can select the older session.

**Requirement trace:**

- `docs/REQUIREMENTS.md` 3.5 permits RFC 3339 UTC timestamps ending in `Z`.
- `docs/REQUIREMENTS.md` 4.24 requires the value with the greatest `(updatedAtUtc, Drive file ID)` tuple.

**New failing test:**

- `tests/audit-correctness-areas-4-6-drive-schema-utc.test.ts`
- Test: `duplicate cleanup orders RFC 3339 fractional instants beyond milliseconds`

**Reproduce:**

```sh
bun test tests/audit-correctness-areas-4-6-drive-schema-utc.test.ts
```

The consolidated document keeps the `.0001Z` version instead of the `.0002Z` version.

---

### F-05 — Medium — The migration framework does not contain input mutation

**Area:** 5

The document pipeline passes its source object directly to each migration. An accidentally impure migration can change the source object before validation reports the problem.

No production migration exists at this time. This is a scaffolding and future-upgrade risk, not a current v1 data mutation.

**Requirement trace:**

- `docs/REQUIREMENTS.md` 5.2 and 5.8 require the family migration chains defined by the schema-versioning specification.
- `specs/schema-versioning.md`, “Migration chain,” states that every migration must produce a new object without changing its input.
- `docs/ARCHITECTURE.md` §12 requires pure migrations.

**New failing test:**

- `tests/audit-correctness-areas-4-6-drive-schema-utc.test.ts`
- Test: `a migration cannot mutate its source object`

**Reproduce:**

```sh
bun test tests/audit-correctness-areas-4-6-drive-schema-utc.test.ts
```

The registered test migration changes the original input object.

---

### F-06 — Medium — The user interface has no Sign out action

**Area:** 14

The authentication service implements `signOut()`, but the signed-in Settings screen exposes only deletion and disconnect.

The user cannot end the REP JOT session while retaining the local cache and pending edits. Disconnect has different effects and is not an equivalent action.

**Requirement trace:**

- `docs/REQUIREMENTS.md` 2.12 defines the required sign-out behavior.
- `docs/ARCHITECTURE.md` §10 defines Sign out, Disconnect, and Delete All User Data as distinct operations.
- `docs/implementation/PHASE-19.md` Goal 5 requires disconnect to remain separate from sign out and deletion.
- `docs/implementation/PHASE-19-MANUAL-TESTS.md` §9 instructs the user to sign out.

**New failing test:**

- `tests/audit-account-action-separation-2026-areas13-15.test.ts`
- Test: `signed-in Settings exposes a Sign out action as well as delete and disconnect`

**Reproduce:**

```sh
bun test tests/audit-account-action-separation-2026-areas13-15.test.ts
```

The rendered Settings screen has no `Sign out` action.

---

### F-07 — Medium — The production origin gate misses two browser network surfaces

**Area:** 19

The origin scanner does not recognize these network-capable forms:

- `element.setAttribute('src', remoteUrl)`
- CSS `url(remoteUrl)`

The compatibility gate can approve a prohibited remote asset dependency. The current CSP can block the request, but the affected UI will then fail at runtime.

No prohibited URL was found in the current application source. This finding concerns the release control that is intended to prevent future additions.

**Requirement trace:**

- `docs/ARCHITECTURE.md` §14 prohibits remote UI dependencies and runtime remote SVG or data from JSON.
- `docs/ARCHITECTURE.md` §17 release gate 7 requires no unexpected remote code in the bundle.
- `docs/implementation/PHASE-20.md` traces its compatibility gate to Architecture §§14 and 17.

**New failing tests:**

- `tests/audit-areas17-19-origin-coverage.test.ts`
- Test: `rejects a remote asset assigned with setAttribute`
- Test: `rejects a remote stylesheet URL`

**Reproduce:**

```sh
bun test tests/audit-areas17-19-origin-coverage.test.ts
```

Both planted remote hosts pass the scanner undetected.

---

### F-08 — Medium — The release gate does not run the separate DOM suite

**Area:** 19

The package command `bun run test` runs the unit suite and then runs the DOM suite from `tests/dom`.

`scripts/release-check.ts` runs `bun test` directly. In this workspace, that command runs the root unit suite but not the separate DOM suite. The gate still reports that unit and DOM tests passed.

**Requirement trace:**

- `docs/ARCHITECTURE.md` §16 requires Svelte route, status, error, export, deletion, and accessibility coverage.
- `docs/ARCHITECTURE.md` §17 names `bun run test` as the release test command.
- `docs/ARCHITECTURE.md` §17 release gate 2 requires unit and integration tests to pass.
- `docs/implementation/PHASE-20.md` traces `release:check` to Architecture §17.

**New failing test:**

- `tests/audit-release-gate-dom-suite.test.ts`
- Test: `the release gate runs the package test script that includes DOM tests`

**Reproduce:**

```sh
bun test tests/audit-release-gate-dom-suite.test.ts
```

For direct observation, compare these commands:

```sh
bun test
bun run test
```

Only the second command starts the separate `tests/dom` run.

## Areas with no additional issue found

### Area 2 — Account isolation

The bootstrap binds the token before it opens the account store. Local databases and coordinator locks use the bound account key. Raw payloads clear during account changes.

Existing coverage includes `tests/auth-service.test.ts`, `tests/bootstrap.test.ts`, and `tests/local-store.test.ts`.

### Area 13 — Delete All User Data

The deletion loop deletes recognized names by stable Drive file ID. It leaves unknown files unchanged, re-lists the folder, retains local data after partial deletion, and clears local records only after completion.

Existing coverage includes `tests/delete-all-data.test.ts` and `tests/account-flows.test.ts`.

### Area 15 — Accepted resurrection and conflict behavior

The merge tests cover last-synchronizer wins, edit-beats-delete, no tombstones, and convergence after edits stop. The deletion copy warns about recreation by another device.

Existing coverage includes `tests/merge-results.test.ts`, `tests/sync-convergence.test.ts`, and the Phase 19 manual test sheet.

### Area 17 — Credential and sensitive-data containment

The reviewed paths remove callback fragments, keep tokens out of Drive errors, sanitize diagnostic contexts, and clear raw payloads during sign-out and account changes.

Existing coverage includes `tests/oauth-redirect-adapter.test.ts`, `tests/drive-rest-adapter.test.ts`, `tests/diagnostic-log.test.ts`, and `tests/auth-service.test.ts`.

### Area 18 — Untrusted content rendering

Raw JSON, notes, labels, and error details use text interpolation. No application component uses `innerHTML` or Svelte raw HTML.

Existing coverage includes `tests/data-error.test.ts` and the raw-viewer tests.

## Files added by this assessment

- `tests/audit-account-action-separation-2026-areas13-15.test.ts`
- `tests/audit-areas17-19-origin-coverage.test.ts`
- `tests/audit-correctness-areas-1-3-sync-status.test.ts`
- `tests/audit-correctness-areas-4-6-drive-schema-utc.test.ts`
- `tests/audit-disconnect-pending-sync-failure.test.ts`
- `tests/audit-release-gate-dom-suite.test.ts`

No implementation file was modified.

---

# Resolution Record

This section records the fixes for the eight findings. All fixes landed on
2026-08-04. Each fix has a regression test that fails without it.

## F-01 — Torn Drive read pairing

**Fix.** `src/sync/sync-coordinator.ts` gained two checks. `readIsPaired()`
compares the byte length of a read against the size its metadata reports.
`readMatchesCatalog()` compares the marker of the read against the marker of
the catalog row listed before the read. The coordinator applies both at the
preflight read in `loadDoc()` and `attemptOnce()`. A mismatch throws a
retryable network error, so the attempt starts again with a fresh read.

The size check catches a write that changes the file length. The catalog
check catches a write that does not. Both are needed.

**Tests.** `tests/audit-correctness-areas-4-6-drive-schema-utc.test.ts` and
`tests/audit-drive-read-pairing-equal-length.test.ts`.

## F-02 — Disconnect over an unsent edit

**Fix.** The `Coordinator` interface gained `pendingEdits()`. It returns the
logical files whose pending row still holds a record. A cleared row is a
`null` value, not a missing key, so the method reads each row back.
`runDisconnect()` calls it after the flush. If any file is still pending,
the flow returns `revoke_failed` with reason `pending_sync_failed` and does
not call the revoke.

**Tests.** `tests/audit-disconnect-pending-sync-failure.test.ts` and
`tests/audit-disconnect-pending-edit.test.ts`.

## F-03 — Save badge hides another file's failure

**Fix.** The coordinator keeps a `failedFiles` set. `reconcileOne()` adds a
name when its attempts run out and removes it when a commit succeeds. The
badge now reads `settledStatus()`, which returns `sync_failed` while any
name stays in the set. `reset()` clears the set.

**Tests.** `tests/audit-correctness-areas-1-3-sync-status.test.ts`.

## F-04 — Sub-millisecond timestamps collapse

**Fix.** `src/sync/consolidate-duplicates.ts` replaced the millisecond
number with an `Instant` record of `{ ms, subMillisecond }`. `instantOf()`
splits the RFC 3339 fraction at the millisecond boundary. `Date` carries
the part up to it; the leftover digits stay as a string.
`compareInstants()` orders the millisecond value first, then the leftover
digits, padded on the right so `.1` and `.10` compare equal.

**Tests.** `tests/audit-correctness-areas-4-6-drive-schema-utc.test.ts`.

## F-05 — Migration mutates the caller's object

**Fix.** `src/documents/document-pipeline.ts` added `deepCopy()`, a JSON
round trip. The pipeline runs it on the value before the first migration
step, and only when a step will run. A migration owns its argument. A
rejected document leaves the caller's object unchanged.

**Tests.** `tests/audit-correctness-areas-4-6-drive-schema-utc.test.ts`.

## F-06 — Sign-out and Disconnect share one control

**Fix.** A new `src/ui/components/SignOutSection.svelte` holds Sign Out.
`SettingsScreen.svelte` calls `signOut()` for it, which keeps local data.
Disconnect stays a separate section with its own confirmation.
`DisconnectSection.svelte` gained `failureReason` and `pendingNames` props.
The screen shows a distinct message for an unsent edit and for an
unconfirmed revoke.

**Tests.** `tests/audit-account-action-separation-2026-areas13-15.test.ts`.

## F-07 — Compat scan misses injected network origins

**Fix.** `scripts/compat-scan.ts` added patterns for the two ways a URL
reaches the DOM without a literal attribute in source:
`setAttribute('src', url)` and a CSS `url(...)` built at runtime. Both
enter `NETWORK_CONTEXT_PATTERNS` and `CALL_SHAPES`. The call shape type
changed from `group: number` to `groups: number[]` so a shape can carry
more than one capture group.

**Tests.** `tests/audit-areas17-19-origin-coverage.test.ts`.

## F-08 — Release gate skips the DOM suite

**Fix.** `scripts/release-check.ts` changed the test gate argv from
`['bun', 'test']` to `['bun', 'run', 'test']`. The npm script runs the
unit suite and the DOM suite. The gate now runs both.

**Tests.** `tests/audit-release-gate-dom-suite.test.ts`.

## Verification

| Check | Result |
| --- | --- |
| `bun run test` | 1411 unit tests pass, 25 DOM tests pass |
| `bun test tests/audit-*.test.ts` | 12 audit tests pass |
| `bun run check` | 0 errors, 0 warnings |
| `bun run release:check` | All automated gates pass |

Manual gates stay open. Record them in `docs/RELEASE.md`.

---

# Judge Retest Record

This section records an independent adversarial retest of the eight fixes in
commit `62a8162`. The judge read the code, wrote throwaway probe tests, ran
them, and deleted them. The judge changed no implementation file and no
shipped test. All probes ran against the tree at `62a8162` with a clean
`git status`.

## F-01 — Torn Drive read pairing

**Verdict:** `VERIFIED FIXED`

**What you ran.** The judge read `readIsPaired()` and `readMatchesCatalog()`
in `src/sync/sync-coordinator.ts`, then wrote six probes that attack the
pairing check from angles the shipped tests do not cover.

Probe 1 zeroed the reported size so `readIsPaired()` short-circuits to
`true`, and relied on the catalog check alone. The catalog check caught it.

```
  P1 err=  remoteOnlyPresent= true
```

Probe 2 made every single read torn. The coordinator never silently accepted
a stale pair. The pending delta survived.

```
  P2 threw= true pendingEdits= ["results-2026-08.json"]
```

Probe 3 tore the very first read inside `ensureLoaded()`, not the
reconciliation read. The load refused it.

```
  P3b ensureLoaded threw= YES: The content read from Drive did not match the metadata read with it.
```

Probe 4 stripped `md5Checksum` from both the catalog row and the read, so
`remoteMarker()` fell back to `version`. The equal-length concurrent write
was still caught, and the remote session survived.

```
  F01b remoteOnlyPresent= true localPresent= false
```

Probe 5 returned bytes one byte longer than the metadata reported.

```
  F01c readCount= 4 threw= The content read from Drive did not match the metadata read with it.
```

Probe 6 asked whether probe 4's `localPresent= false` meant data loss. It
did not. The local edit stayed durable in the pending row, and a later
`syncAll()` carried both sessions up.

```
  syncErr= The content read from Drive did not match the metadata read
  pending row = PRESENT
  pendingEdits = ["results-2026-08.json"]
  AFTER syncAll: local(30)= true remote(99)= true
  AFTER syncAll NOTES = [null,"remote-only","loc"]
```

**Residual risk.** None that the judge could reach. The one undetectable case
is a file whose bytes changed while both `md5Checksum` and `version` stayed
identical. Drive does not produce that pair. The judge also notes that
`consolidate-duplicates.ts` reads file bytes without a pairing check. That
path is duplicate cleanup, not the merge preflight, and a stale read there
selects a loser in a group the client is about to rewrite anyway. The judge
does not call it a defect.

## F-02 — Disconnect over an unsent edit

**Verdict:** `VERIFIED FIXED`

**What you ran.** The judge read `runDisconnect()` in
`src/data/account-flows.ts` and `pendingEdits()` in
`src/sync/sync-coordinator.ts`, then wrote six probes.

Probe 1 drove a real unsent edit through a permanently failing upload,
then ran the flow.

```
  F02-P1 kind= revoke_failed reason= pending_sync_failed revoked= false
```

Probe 2 stored an empty object as the pending row. The guard counted it.

```
  F02-P2 kind= revoke_failed revoked= false pending= ["preferences.json"]
```

Probe 3 stored a literal `null` pending row, the shape a cleared delta
leaves behind. The guard correctly ignored it and the flow completed.

```
  F02-P3 kind= disconnected revoked= true
```

Probe 4 made `flush()` throw instead of failing quietly. The exception
propagated and nothing was revoked.

```
  F02-P4 threw= Error: flush boom revoked= false
```

Probe 5 stored an empty string as the pending row. The guard counted it,
because the test is `row !== null && row !== undefined`.

```
  F02-P5 kind= revoke_failed revoked= false pending= ["preferences.json"]
```

Probe 6 passed `coordinator: null` while a pending row sat in the store.
The whole guard sits inside `if (deps.coordinator !== null)`, so the flow
revoked and cleared the namespace over a live pending row.

```
  F02-P6 kind= disconnected revoked= true pendingRowAfter= GONE
```

**Residual risk.** Probe 6 is not reachable through the shipped app. The
judge checked every `setServices()` call in `src/bootstrap.ts`. The four
call sites either publish `store` together with `coordinator`, or publish
neither. A caller that passes a `store` without a `coordinator` would lose
the guard, but no such caller exists today. The judge records this as a
latent API-shape hazard for a future caller, not as a live defect.

## F-03 — Save badge hides another file's failure

**Verdict:** `FIXED WITH GAP`

**What you ran.** The judge read `failedFiles`, `settledStatus()`,
`reconcileOne()`, `syncAll()`, `reset()`, and `edit()` in
`src/sync/sync-coordinator.ts`, then wrote seven probes.

Five probes passed. The aggregation works on the paths the fix touched.

```
  F03-P2 failed= sync_failed afterRecovery= saved
  F03-P3 failed= sync_failed afterReset+freshSuccess= saved
  F03-P4 afterShardOk= saved afterPrefsFail= sync_failed
  F03-P5 afterFail= sync_failed afterSyncAll(now healthy)= saved
  F03-P6 failed= sync_failed afterNewSuccess= saved
```

The judge also probed the local-write failure path inside `edit()`, which
the fix did not touch. It found a real gap.

```
  GAP A: afterRemote=sync_failed localThrew=true afterLocal=idle prefsPending=YES
```

The judge then tested whether the badge can stick at `sync_failed` after the
pending delta disappears. It cannot. A reverted edit clears the delta and
the badge recovers on its own.

```
  GAP B: failed=sync_failed pendingRow=NONE afterRevert=saved afterSyncAll=saved
```

**Gap A, concrete.** File `src/sync/sync-coordinator.ts`, function `edit()`,
the `catch` block at line 1295. That block calls `setSaveStatus('idle')`
unconditionally. The fix routed the three success paths through
`settledStatus()` so they report the worst state across all files. The
local-failure path kept a hardcoded `'idle'`. So when one logical file holds
an unresolved remote failure and a *different* file's local write throws,
the badge drops from `sync_failed` to `idle`. The unresolved failure
disappears from the badge while its pending delta is still on disk. The
judge observed `prefsPending=YES` alongside `afterLocal=idle`.

The minimal fix is for that `catch` block to call
`setSaveStatus(settledStatus() === 'sync_failed' ? 'sync_failed' : 'idle')`
instead of `setSaveStatus('idle')`. The local edit itself never became
durable, so the new edit must not read as `sync_failed`. But an *older*
file's failure must still show.

**Residual risk.** The badge is one global value over every file, so it
cannot tell the user *which* file failed. That is a design limit, not a
regression. The judge found no other path that overwrites `sync_failed`
incorrectly.

## F-04 — Sub-millisecond timestamp precision

**Verdict:** `VERIFIED FIXED`

**What you ran.** The judge read `Instant`, `instantOf()`,
`compareSubMillisecond()`, `compareInstants()`, and `greaterTuple()` in
`src/sync/consolidate-duplicates.ts`. The judge first confirmed how `Date`
parses each fraction shape.

```
2026-08-10T08:30:00.1Z 1786350600100
2026-08-10T08:30:00.10Z 1786350600100
2026-08-10T08:30:00.1000Z 1786350600100
2026-08-10T08:30:00.999Z 1786350600999
2026-08-10T08:30:00.0001Z 1786350600000
```

Then the judge ran eight consolidation probes. Each gave the newer stamp
the *smaller* Drive file ID, so a lost comparison would flip the winner to
the older session.

```
  2026-08-12T01:00:00.0002Z vs .0001Z       -> A-newer   (pass)
  2026-08-12T01:00:00.00009Z vs .0001Z      -> B-older   (pass)
  2026-08-12T01:00:00.999Z vs .1000Z        -> A-newer   (pass)
  2026-08-12T01:00:00.1234Z vs .1235Z       -> B-older   (pass)
  2026-08-12T01:00:00.5Z vs .5000001Z       -> B-older   (pass)
  2026-08-12T01:00:00.001Z vs .0009Z        -> A-newer   (pass)
  .1Z vs .10Z (same instant, tie on file id) -> B-older   (pass)
  unparseable vs parseable                    -> A-newer   (pass)
```

The judge also checked the offset form. `parseUtc()` rejects any stamp that
does not end in `Z`, so `instantOf()` returns `null` for `+02:00` input
and the parseable stamp wins. That matches REQUIREMENTS 3.5, which permits
UTC only. The probe could not be built as a live consolidation because the
offset copy fails the schema first, so the group blocks. The judge verified
the ordering rule by reading `greaterTuple()` instead.

**Residual risk.** None. The right-pad rule in `compareSubMillisecond()` is
correct for positional fraction digits. The judge tried `.00009` against
`.0001`, which is the case where a naive string compare would flip, and it
ordered correctly.

## F-05 — Migration mutation containment

**Verdict:** `VERIFIED FIXED`

**What you ran.** The judge read `deepCopy()` and the stage 6 block in
`src/documents/document-pipeline.ts`, then wrote six probes.

A migration that mutates a nested object left the caller's object intact.

```
  P2 threw= AppError: This document does not match its schema.
  input after migration = {"format":"repjot/preferences","schemaVersion":1,"exerciseUnits":{"back-squat":{"weight":"kg"}}}
```

A migration that mutates and is then rejected by the schema left the
caller's object intact.

```
  P3 threw= true input= {"format":"repjot/preferences","schemaVersion":1,"exerciseUnits":{}}
```

A two-step chain where both steps mutate left the original untouched.

```
  P4 input= {"format":"repjot/preferences","schemaVersion":1}
     out= {"format":"repjot/preferences","schemaVersion":3,"s1":"a","s2":"b"}
```

An array inside the document was copied, not shared.

```
  P5 input.list= ["x"] out.list= ["x","added"] sharedArray= false
```

**Residual risk.** Two facts the judge observed and does not call defects,
but records because they are unproven against future change.

First, the no-migration path returns the caller's object by reference.

```
  P1 returned===input ? true migrated= false
```

That is the documented hot-path choice. It holds today because no migration
exists and no caller mutates the result.

Second, the semantic stage runs on the caller's object on that same
no-migration path, so a mutating semantic callback reaches the caller.

```
  P6 (no migration) input= {"format":"repjot/preferences","schemaVersion":1,"SEMANTIC_SCAR":"yes"} unchanged= false
```

The finding covers migrations, and migrations are contained. The semantic
callback is a caller-supplied function over the caller's own value. The
judge reports this as residual surface, not as a break of F-05.

## F-06 — Sign out separated from Disconnect

**Verdict:** `VERIFIED FIXED`

**What you ran.** The judge read `SignOutSection.svelte`,
`DisconnectSection.svelte`, and `confirmSignOut()` plus
`confirmDisconnect()` in `SettingsScreen.svelte`. The judge then mounted
the real `SettingsScreen` in client mode over the real coordinator and
tapped the buttons.

Sign Out kept the local cache row and exited once.

```
  before: pendingRow= NONE cacheRow= PRESENT
  after SignOut: exited= 1 pendingRow= NONE cacheRow= PRESENT
```

Sign Out kept a live pending edit. The judge forced the upload to fail so a
pending row existed, then signed out.

```
  before SignOut pendingRow= PRESENT
  after SignOut pendingRow= PRESENT
```

Sign Out never touched the revoke endpoint.

```
  revokeToken calls during Sign Out = 0
```

Disconnect still needs two taps. One tap opened the confirmation and did
nothing else.

```
  after 1 tap: exited= 0
  buttons after 1 tap = ["lb","m","s","Refresh file list",
    "Download diagnostic log","Sign out","Delete All User Data",
    "Cancel","Disconnect Google Account"]
```

Sign Out sits outside the Danger Zone, so the two actions are visually
separate.

```
  dangerZone present= true signoutRegions= 1
  signout inside danger zone = false
```

**Residual risk.** None found. The judge could not make Sign Out clear local
data, and could not make Disconnect skip its confirmation. The
`failureReason` and `pendingNames` props render a distinct message for an
unsent edit, and the `uploadBlocked` derived value selects it correctly.

## F-07 — Compat scan origin coverage

**Verdict:** `VERIFIED FIXED`

**What you ran.** The judge read `NETWORK_CONTEXT_PATTERNS` and
`CALL_SHAPES` in `scripts/compat-scan.ts`, then ran twelve probes against
`disallowedHosts()`. Both surfaces named in the finding are now caught,
along with four adjacent forms.

```
  [setAttribute src (named)]        caught=true
  [CSS url() (named)]              caught=true
  [setAttribute srcset]            caught=true
  [setAttribute xlink:href]        caught=true
  [setAttribute action]            caught=true
  [bare local url()]               caught=false   (correct: local asset)
```

The judge also confirmed the two shipped audit probes pass, and that the
full `check:compat` gate still passes over the real `src/` and `dist/`
trees with no false positive from the new patterns.

**Residual risk.** The scanner still misses six network surfaces. None was
named in F-07, and none appears in the current source. The judge lists them
so a future change knows the gate is not exhaustive.

```
  [srcset ASSIGNMENT]      el.srcset = 'https://evil.example/...'   caught=false
  [form.action ASSIGNMENT] form.action = 'https://evil.example/...' caught=false
  [dynamic import]         await import('https://evil.example/...') caught=false
  [EventSource]           new EventSource('https://evil.example/') caught=false
  [wss WebSocket]         new WebSocket('wss://evil.example/sock') caught=false
  [protocol-relative src] img.src = '//evil.example/a.png'        caught=false
```

The `srcset` and `form.action` assignment forms are the closest misses.
The scanner catches `src` and `href` assignment but not those two. The
`wss://` and protocol-relative cases fall outside `hostOf()`, which matches
`https?://` only. The judge reports these as uncovered, not as a
regression, because F-07 named exactly two surfaces and both are fixed.

## F-08 — Release gate runs the DOM suite

**Verdict:** `VERIFIED FIXED`

**What you ran.** The judge read the `tests` gate in
`scripts/release-check.ts` and confirmed the argv.

```
  argv: ['bun', 'run', 'test']
```

The judge confirmed the package script really chains both suites.

```
  test = bun run test:unit && bun run test:dom
  test:unit = bun test
  test:dom  = cd tests/dom && bun test
```

Then the judge planted a deliberately failing DOM test and confirmed the
package command fails on it.

```
 1 tests failed:
(fail) DELIBERATE DOM FAILURE for gate verification [0.09ms]
 29 pass
 1 fail
error: script "test:dom" exited with code 1
error: script "test" exited with code 1
```

Then the judge ran the whole gate with that failing DOM test in place and
confirmed the gate stops on it.

```
Release gate stopped at "tests".
  install        PASS   0.0s     The lockfile installs with no drift.
  type check     PASS   2.9s     TypeScript and Svelte types are clean.
  tests          FAIL   2.4s     Unit tests and DOM tests pass.
error: script "release:check" exited with code 1
```

With the planted failure removed, the full gate passes on a clean tree.

**Residual risk.** The shipped regression test for F-08 asserts on the
*text* of `release-check.ts`. It checks that the string
`argv: ['bun', 'run', 'test']` is present and that
`argv: ['bun', 'test']` is absent. That test would still pass if the gate
were rewired to a script that skips the DOM suite, as long as the literal
stayed. The judge's live run closes that hole for today. A stronger test
would spawn the gate against a fixture with a failing DOM test. The judge
did not change the test, per the rules of this retest.

## Final test counts

The judge ran every command on a clean tree at `62a8162`, after deleting
all probe files.

| Command | Result |
| --- | --- |
| `bun test` (unit) | 1411 pass, 0 fail, 20524 expect() calls, 78 files |
| `bun run test:dom` | 25 pass, 0 fail, 66 expect() calls, 5 files |
| `bun run test` (both) | 1411 unit pass + 25 DOM pass, 0 fail |
| `bun test tests/audit-*.test.ts` | 12 pass, 0 fail, 34 expect() calls, 8 files |
| `bun run check` | svelte-check found 0 errors and 0 warnings |
| `bun run release:check` | All 9 automated gates PASS |

Manual gates stay open, exactly as the Resolution Record states.

## Judge Summary

| Finding | Severity | Verdict |
| --- | --- | --- |
| F-01 Torn Drive read pairing | High | VERIFIED FIXED |
| F-02 Disconnect over an unsent edit | High | VERIFIED FIXED |
| F-03 Save badge hides another file's failure | Medium | FIXED WITH GAP |
| F-04 Sub-millisecond timestamp precision | Medium | VERIFIED FIXED |
| F-05 Migration mutation containment | Medium | VERIFIED FIXED |
| F-06 Sign out separated from Disconnect | Medium | VERIFIED FIXED |
| F-07 Compat scan origin coverage | Medium | VERIFIED FIXED |
| F-08 Release gate runs the DOM suite | Medium | VERIFIED FIXED |

Remaining defects, in order:

1. **F-03 gap A.** `src/sync/sync-coordinator.ts`, `edit()`, the local
   write `catch` block at line 1295. It calls `setSaveStatus('idle')`
   unconditionally. When another logical file holds an unresolved remote
   failure, that call drops the badge from `sync_failed` to `idle` while
   the other file's pending delta is still on disk. The fix routed the
   success paths through `settledStatus()` but left this path hardcoded.
   Make it keep `sync_failed` when `settledStatus()` reports one, and use
   `idle` otherwise.

Not defects, but recorded for the fixer's awareness:

- `runDisconnect()` skips its pending guard when `coordinator` is `null`.
  Not reachable today, because `src/bootstrap.ts` never publishes `store`
  without `coordinator`. Latent hazard for a future caller.
- `compat-scan.ts` still misses `srcset` assignment, `form.action`
  assignment, dynamic `import()`, `EventSource`, `wss://`, and
  protocol-relative URLs. None is named in F-07 and none is present in the
  current source.
- The F-08 regression test asserts on source text rather than on gate
  behavior. The judge's live run covers today but not a future rewrite.

---

# Fixer Record For Judge Gap A

The judge reported one remaining defect. It is fixed.

## F-03 gap A — Failed local write dropped the badge to `idle`

**Confirmed before the fix.** The probe reproduced the judge's result:

```
afterRemote=sync_failed localThrew=true afterLocal=idle pending=["preferences.json"]
```

The preferences file held a pending delta on disk. A failed local write to
the shard dropped the badge to `idle`, so the failure disappeared from view.

**Fix.** `settledStatus()` in `src/sync/sync-coordinator.ts` now takes a
fallback argument:

```ts
function settledStatus(fallback: SaveStatus = 'saved'): SaveStatus {
  return failedFiles.size === 0 ? fallback : 'sync_failed';
}
```

The local-write `catch` in `edit()` calls `setSaveStatus(settledStatus('idle'))`.
A failed local write now reads `idle` when nothing else is failed, and keeps
`sync_failed` when another file still holds an unresolved delta. The
success paths keep the default `'saved'`.

**Tests.** `tests/audit-badge-local-write-failure.test.ts`, two cases:

| Case | Badge after the failed local write |
| --- | --- |
| Another file is `sync_failed` with a pending delta | `sync_failed` |
| No file is failed | `idle` |

The second case guards the opposite mistake. A failed local write must not
claim `saved`.

## Judge awareness items

The judge listed three notes that are not defects. No change was made. Each
stays recorded here so a later pass can judge them on its own merits.

1. `runDisconnect()` skips its pending guard when `coordinator` is `null`.
   `src/bootstrap.ts` never publishes `store` without `coordinator`, so no
   caller reaches it today.
2. `compat-scan.ts` does not cover `srcset` assignment, `form.action`
   assignment, dynamic `import()`, `EventSource`, `wss://`, or
   protocol-relative URLs. None of these appear in the source today, and
   none are named in F-07.
3. The F-08 regression test asserts on the source text of
   `scripts/release-check.ts` rather than on gate behavior.

## Final Verification After Gap A Fix

| Check | Result |
| --- | --- |
| `bun run test` | 1413 unit tests pass, 25 DOM tests pass |
| `bun test tests/audit-*.test.ts` | 14 audit tests pass |
| `bun run check` | 0 errors, 0 warnings |
| `bun run release:check` | All 9 automated gates pass |

All eight findings are fixed. No remaining defects.
