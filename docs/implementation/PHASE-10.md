# Phase 10 — Sync coordinator

Wire storage, Drive, the pipeline, and the merge into one coordinator that saves
locally first, reconciles with Drive, retries, and commits cache state.

## Prerequisites

- Phase 03 pipeline, Phase 04 semantic validation, Phase 06 local store and status,
  Phase 08 Drive adapter, Phase 09 merge.
- Phase 05 static data, because the semantic stage needs it.

## Goals

1. Make every user edit durable before any network call.
2. Reconcile the Drive catalog against the account cache on each sync.
3. Run the preflight, upload, read-back, and bounded retry cycle.
4. Commit confirmed content as both working document and base in one transaction.
5. Report `Saving`, `Saved`, and `Sync failed` without ever discarding local intent.

## Interfaces

### Files

| Path | Purpose |
| --- | --- |
| `src/sync/sync-coordinator.ts` | The coordinator, its mutex, and its public API. |
| `src/sync/cache-records.ts` | Read and write helpers for cached, base, and pending records. |
| `src/sync/debounce.ts` | Debounce, blur save, and `pagehide` flush helpers. |

### Signatures

```ts
// src/sync/sync-coordinator.ts
export interface SyncDeps {
  store: LocalStore;
  drive: DriveAdapter;
  staticData: LoadedStaticData;
  accountKey: string;
}
export interface Coordinator {
  /** Load one logical file into memory, downloading and migrating when needed. */
  ensureLoaded(logicalName: string): Promise<unknown>;
  /** Apply a pure edit, persist it locally, then synchronize. */
  edit(logicalName: string, mutate: (doc: unknown) => unknown): Promise<void>;
  /** Reconcile every known logical file for this account. */
  syncAll(): Promise<void>;
  /** Flush pending local edits. Called on pagehide. */
  flush(): Promise<void>;
  /** Forget in-memory state for this account. */
  reset(): void;
}
export function createCoordinator(deps: SyncDeps): Coordinator;
export function logicalNameForShard(startedAtUtc: string): string;  // 'results-2026-09.json'
```

### Reconciliation sequence

1. Acquire the in-memory mutex for `(accountKey, logicalName)`.
2. List the Drive catalog.
3. Drop cache and base records whose `driveFileId` no longer appears in the catalog.
4. Read the cached, base, and pending records.
5. Reuse the cached document when its remote metadata is unchanged and it has no
   pending delta.
6. Download changed, missing, or pending files and run the document pipeline.
7. When a pending delta exists, compare base, local, and latest remote.
8. Merge with `mergeDocuments` when remote differs from base.
9. Validate the merged candidate with the pipeline and the semantic validator.
10. Serialize, parse, and validate the candidate again.
11. Recheck Drive metadata immediately before upload.
12. Update the retained file ID, or create the file when it is missing.
13. Read the file back and compare the bytes with what was written.
14. On success, one `setMany` writes the confirmed content as working and base and
    clears the pending delta.
15. On mismatch or error, re-read, rebuild the base, and retry. Retry at most three
    times, then set `sync_failed`.

### Save path

1. `edit` applies the mutation to the in-memory working document.
2. Compute the pending delta from base to local.
3. One `setMany` writes working, base, and pending. Set `saved`.
4. Start the reconciliation for that logical file.
5. A Drive error leaves all three records in place and sets `sync_failed`.

## Requirements traceability

| Source | How this phase satisfies it |
| --- | --- |
| REQUIREMENTS 4.1, 4.2 | Local write precedes network. Debounce, blur, and `pagehide` flush. |
| REQUIREMENTS 4.3 | Status transitions come from this coordinator. |
| REQUIREMENTS 4.4, 4.20 | No path discards pending edits, including after three failures. |
| REQUIREMENTS 4.5, 4.15 | Base copy and pending delta persist across reload. |
| REQUIREMENTS 4.6, 4.16 | Steps 6, 7, and 11 form the preflight. |
| REQUIREMENTS 4.14 | No reconciliation UI. The coordinator resolves silently. |
| REQUIREMENTS 4.18, 4.19 | Steps 13 and 15 with a three-attempt cap. |
| REQUIREMENTS 4.21 | The residual race after read-back is accepted and documented. |
| REQUIREMENTS 3.14 | Step 14 uses one `setMany` transaction. |
| ARCHITECTURE §11 "Reconciliation and writes" | Steps 1–15 match the architecture list. |
| ARCHITECTURE §11 "Save status and diagnostics" | The three status definitions bind to `app-state`. |
| ARCHITECTURE §15 | `ambiguous_upload` handling on a lost response. |
| SPEC storage-and-lookup "Writes, preflight, and retry" | Same sequence, same retry cap. |

## Checklist

### Implementation

- [ ] Create `src/sync/cache-records.ts` with typed read and write helpers over the
      Phase 06 key scheme.
- [ ] Create `src/sync/debounce.ts` with `debouncedEdit`, `flushOnBlur`, and
      `flushOnPagehide` helpers.
- [ ] Implement `createCoordinator` with a `Map<string, Promise<void>>` mutex keyed
      by `(accountKey, logicalName)`.
- [ ] Implement `ensureLoaded` with steps 3–6.
- [ ] Implement `edit` with the save path above.
- [ ] Implement `reconcileOne` with steps 1–15.
- [ ] Implement the read-back comparison as an exact string compare of the serialized
      document.
- [ ] Implement the retry loop with attempt counting, a fresh base each attempt, and a
      cap of three.
- [ ] Treat a lost response after a committed write as `ambiguous_upload`: read Drive
      before retrying.
- [ ] Set `saveStatus` to `saving` before the local write and `saved` after it
      resolves.
- [ ] Set `sync_failed` after the third failed attempt and keep the pending delta.
- [ ] Register the `pagehide` flush in the coordinator constructor.
- [ ] Log one diagnostic per attempt with the logical name, attempt number, and error
      kind.

### Tests

- [ ] Add `tests/fakes/fake-drive.ts`: an in-memory Drive that can pause before
      upload and before read-back, can commit a write and lose the response, and can
      reject with any `AppErrorKind`.
- [ ] `tests/sync-coordinator.test.ts`: a local edit writes working, base, and
      pending in one `setMany` before any Drive call. Assert call order.
- [ ] `tests/sync-coordinator.test.ts`: a clean cached file with unchanged metadata
      and no pending delta causes no download.
- [ ] `tests/sync-coordinator.test.ts`: changed remote metadata triggers a download
      and a pipeline run.
- [ ] `tests/sync-coordinator.test.ts`: a cache record whose file ID vanished from
      the catalog is dropped.
- [ ] `tests/sync-coordinator.test.ts`: a successful cycle writes confirmed content as
      both working and base and clears pending.
- [ ] `tests/sync-coordinator.test.ts`: a read-back mismatch triggers a re-read, a
      fresh merge, and a second upload.
- [ ] `tests/sync-coordinator.test.ts`: three failed attempts set `sync_failed` and
      leave the pending delta intact.
- [ ] `tests/sync-coordinator.test.ts`: a lost response after a committed write is
      classified `ambiguous_upload` and resolved by a Drive read.
- [ ] `tests/sync-coordinator.test.ts`: two concurrent `edit` calls on one logical
      file serialize through the mutex.
- [ ] `tests/sync-coordinator.test.ts`: a reload simulation restores the pending
      delta from the store and completes the merge.
- [ ] `tests/sync-convergence.test.ts`: two fake clients with different session edits
      converge after both synchronize.

### Verification

- [ ] `bun test` passes.
- [ ] `bun run check` passes.
- [ ] `bun run build` passes.
- [ ] `bun run check:compat` passes.
- [ ] Manual against a live account: edit, kill the network before upload, confirm
      `Sync failed` with local data intact, restore the network, and confirm the
      pending delta commits.

## Exit criteria

A user edit is durable before the network, survives a reload and a failed upload, and
converges with Drive under the documented rules.
