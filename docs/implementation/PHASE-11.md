# Phase 11 — Duplicate Drive file consolidation

Drive allows two files with the same name. The client clears a duplicate recognized
name automatically, never ignores it, and never asks the user to choose.

## Prerequisites

- Phase 03 pipeline and Phase 04 semantic validation.
- Phase 08 catalog listing.
- Phase 10 coordinator, which calls consolidation before any normal write.

## Goals

1. Detect every duplicate group in the `appDataFolder` catalog.
2. Consolidate a group when every copy is valid.
3. Choose a deterministic primary and a deterministic winner per conflicting entry.
4. Prove the primary holds the consolidated data before deleting anything.
5. Block the logical file when safe consolidation is impossible.

## Interfaces

### Files

| Path | Purpose |
| --- | --- |
| `src/sync/consolidate-duplicates.ts` | Group detection and the consolidation procedure. |
| `src/sync/recognized-names.ts` | `preferences.json` and `results-YYYY-MM.json` recognition. |

### Signatures

```ts
// src/sync/recognized-names.ts
export type RecognizedName =
  | { kind: 'preferences'; name: 'preferences.json' }
  | { kind: 'shard'; name: string; yearMonthUtc: string }
  | null;
export function recognize(name: string): RecognizedName;

// src/sync/consolidate-duplicates.ts
export interface DuplicateGroup {
  logicalName: string;
  copies: DriveFileMeta[];        // length >= 2
}
export type ConsolidationOutcome =
  | { kind: 'consolidated'; primaryId: string; deletedIds: string[] }
  | { kind: 'blocked'; reason: 'corrupt_copy' | 'unsupported_version'
                   | 'wrong_family' | 'changed_during_cleanup'; fileId: string }
  | { kind: 'no_duplicates' };

export function findDuplicateGroups(catalog: DriveFileMeta[]): DuplicateGroup[];
export function consolidateGroup(
  group: DuplicateGroup,
  deps: { drive: DriveAdapter; staticData: LoadedStaticData }
): Promise<ConsolidationOutcome>;
```

### Consolidation procedure

1. Download every copy. Run the pipeline on each.
2. If any copy fails to parse, has the wrong family, or uses an unsupported version,
   return `blocked` naming that file.
3. Run the semantic validator on each copy. A fatal issue blocks the group.
4. Select the lexicographically smallest Drive file ID as the primary.
5. For a result shard, union the session maps. For a session ID present in more than
   one copy, keep the entry from the copy with the greatest
   `(updatedAtUtc, driveFileId)` tuple.
6. For preferences, merge the mappings. For a mapping present in more than one copy,
   apply the same tuple rule.
7. Validate the consolidated document with the pipeline and the semantic validator.
8. Re-read the metadata of every copy. If any `version` or `modifiedTime` changed,
   return `blocked` with `changed_during_cleanup`.
9. Update the primary file with the consolidated content and read it back.
10. Compare the read-back content with the consolidated document. A mismatch blocks
    the group and deletes nothing.
11. Delete the redundant copies by stable Drive file ID.
12. List the name again. Record one remaining file ID locally only when exactly one
    recognized file remains.

## Requirements traceability

| Source | How this phase satisfies it |
| --- | --- |
| REQUIREMENTS 4.22 | `findDuplicateGroups` treats the whole set as one group. |
| REQUIREMENTS 4.23 | Step 2 and step 3 block a group with a corrupt, wrong-family, or unsupported copy while pending edits stay durable. |
| REQUIREMENTS 4.24 | Steps 5 and 6 keep every distinct entry and apply the tuple rule. |
| REQUIREMENTS 4.25 | Steps 9, 10, 11, and 12 write, read back, then delete, then relist. |
| REQUIREMENTS 4.26 | Step 8 blocks a copy that changes during cleanup. |
| REQUIREMENTS 22.2.10 | The blocked outcome feeds the single `DataError` component in Phase 15. |
| ARCHITECTURE ADR-010 | Deterministic primary, merge, read back, then delete. |
| ARCHITECTURE §11 "Duplicate files" | The nine listed steps match the procedure above. |
| SPEC storage-and-lookup "Duplicate file consolidation" | Same rule set and same ordering. |

## Checklist

### Implementation

- [ ] Create `src/sync/recognized-names.ts` with `recognize` for
      `preferences.json` and the `results-YYYY-MM.json` pattern.
- [ ] Implement `findDuplicateGroups` over the catalog, grouping by recognized name.
- [ ] Implement the tuple comparator for `(updatedAtUtc, driveFileId)`.
- [ ] Implement the session-map union with the tuple rule.
- [ ] Implement the preference-mapping merge with the tuple rule.
- [ ] Implement steps 8 through 12 in that order. Never delete before the read-back
      comparison passes.
- [ ] Return the blocked outcome without deleting anything when any guard fails.
- [ ] Call `consolidateGroup` from the coordinator between the catalog list and any
      normal write.
- [ ] Report unknown files in the catalog as diagnostics only. Never delete them.
- [ ] Leave the local cache untouched for a blocked group so the next sync retries.

### Tests

- [ ] `tests/recognized-names.test.ts`: `results-2026-09.json` recognizes as a shard
      with `yearMonthUtc: '2026-09'`. An unknown name returns `null`.
- [ ] `tests/consolidate-duplicates.test.ts`: two valid shard copies with disjoint
      sessions consolidate to the union, keep the smallest ID as primary, and delete
      the other.
- [ ] `tests/consolidate-duplicates.test.ts`: the same session ID in two copies keeps
      the copy with the greater `updatedAtUtc`.
- [ ] `tests/consolidate-duplicates.test.ts`: equal `updatedAtUtc` resolves by the
      greater Drive file ID.
- [ ] `tests/consolidate-duplicates.test.ts`: preferences with different mappings
      merge. A conflicting mapping follows the tuple rule.
- [ ] `tests/consolidate-duplicates.test.ts`: one corrupt copy blocks the group and
      produces zero delete calls.
- [ ] `tests/consolidate-duplicates.test.ts`: a future schema version in one copy
      blocks with `unsupported_version`.
- [ ] `tests/consolidate-duplicates.test.ts`: a copy whose metadata changed at step 8
      blocks with `changed_during_cleanup` and produces zero delete calls.
- [ ] `tests/consolidate-duplicates.test.ts`: a read-back mismatch blocks and
      produces zero delete calls.
- [ ] `tests/consolidate-duplicates.test.ts`: the relist step records one remaining
      file ID only when exactly one recognized file remains.
- [ ] `tests/consolidate-duplicates.test.ts`: an unknown Drive file in the folder is
      never deleted.

### Verification

- [ ] `bun test` passes.
- [ ] `bun run check` passes.
- [ ] `bun run build` passes.
- [ ] `bun run check:compat` passes.
- [ ] Manual against a live account: create a duplicate `preferences.json` in
      `appDataFolder` by hand, run a sync, and confirm the client consolidates to one
      file and deletes the other.

## Exit criteria

A duplicate recognized name cannot survive a sync when every copy is valid, and
cannot be touched when any copy is unsafe.
