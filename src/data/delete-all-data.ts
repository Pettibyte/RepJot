// Delete All User Data.
// REQUIREMENTS 21.3, 21.4. ARCHITECTURE ADR-018, §10 "Delete All User Data".
//
// The delete removes the files REP JOT owns in the app-data folder, by stable
// Drive file ID. A file whose name REP JOT does not recognize is never touched,
// so a file a person put in the folder by hand survives. REQUIREMENTS 4.22.
//
// Two rules shape the loop.
//
// 1. Re-list until nothing recognized remains. A delete that reports success
//    but leaves the file, and a second device that re-creates a file mid-run,
//    both read the same way: the next list still shows a recognized name, so
//    the loop runs again. The first list that comes back clean ends it.
//    specs/storage-and-lookup.md "User data deletion".
//
// 2. The loop is bounded. A Drive that never answers clean must not spin
//    forever. When the bound is reached the result is `partial`, the local
//    data stays in place for a retry, and the caller reports what is left.
//
// The result never claims the data is gone forever. Another device that still
// holds a signed-in session and pending edits writes these files back on its
// next sync. REQUIREMENTS 21.4.

import type { DriveAdapter, DriveFileMeta } from '../drive/drive-interface';
import { isRecognizedName } from '../sync/recognized-names';
import type { LocalStore } from '../storage/local-store';

/**
 * Passes of list-then-delete before the run gives up.
 *
 * One pass clears a normal folder. The extra passes cover a delete that did not
 * land and a concurrent writer. Past the bound, more passes cost the user time
 * without changing the answer, so the run stops and reports.
 */
const MAX_DELETE_PASSES = 5;

/**
 * Local key prefixes that hold REP JOT account data.
 *
 * `doc:` caches a downloaded document, `base:` holds the base copy a merge
 * reads, and `pending:` holds an edit not yet uploaded. Clearing all three
 * leaves no local copy of the user's workout data and no local intent to
 * upload. REQUIREMENTS 3.21, 21.3.
 */
const ACCOUNT_KEY_PREFIXES: readonly string[] = ['doc:', 'base:', 'pending:'];

/** The outcome of a delete-all run. */
export interface DeletionResult {
  /**
   * `complete` when no recognized file remains. `partial` when the pass bound
   * was reached with recognized files still present.
   */
  kind: 'complete' | 'partial';
  /** Every file ID this run deleted, in delete order. */
  deletedFileIds: string[];
  /** Names still present after a partial run. Empty when complete. */
  remainingRecognized: string[];
}

/** What a delete-all run needs. */
export interface DeleteAllDataDeps {
  /** The Drive adapter for the signed-in account. */
  drive: DriveAdapter;
  /** The local store for the same account. */
  store: LocalStore;
  /** The bound account key. Carried so the run is traceable to one account. */
  accountKey: string;
  /** Called after each delete with the running count. Drives the progress line. */
  onProgress?: (deleted: number) => void;
}

/**
 * Delete every recognized REP JOT file in the app-data folder.
 *
 * On a complete run, the local account namespace clears too, so the device
 * holds no cached copy and no pending edit of what was just deleted.
 *
 * On a partial run, the local data stays. Wiping the local copy while remote
 * files still exist would leave the user worse off: the retry could not find
 * its own pending edits.
 *
 * @throws AppError `storage` when a Drive list or delete fails. The caller
 *         keeps whatever local data it has and reports the failure.
 */
export async function deleteAllUserData(deps: DeleteAllDataDeps): Promise<DeletionResult> {
  const deletedFileIds: string[] = [];

  for (let pass = 0; pass < MAX_DELETE_PASSES; pass += 1) {
    const catalog = await listRecognized(deps.drive);
    if (catalog.length === 0) {
      await clearAccountNamespace(deps.store);
      return { kind: 'complete', deletedFileIds, remainingRecognized: [] };
    }

    for (const file of catalog) {
      // A delete that throws stops the whole run. The caller keeps the local
      // data, so the user retries with nothing lost. Deleting around a failure
      // would report a partial result the user cannot act on.
      await deps.drive.deleteFile(file.id);
      deletedFileIds.push(file.id);
      deps.onProgress?.(deletedFileIds.length);
    }
  }

  // The pass bound is reached. Report what the last list still saw. The local
  // data stays, so the user can run the delete again.
  const remaining = await listRecognized(deps.drive);
  if (remaining.length === 0) {
    await clearAccountNamespace(deps.store);
    return { kind: 'complete', deletedFileIds, remainingRecognized: [] };
  }
  return {
    kind: 'partial',
    deletedFileIds,
    remainingRecognized: remaining.map((file: DriveFileMeta): string => file.name)
  };
}

/**
 * Drop every local row that holds this account's REP JOT data.
 *
 * Shared by the delete-all flow and the disconnect flow, which clears the
 * same namespace without touching the remote files.
 *
 * Returns the keys it removed, so a caller can report the count.
 */
export async function clearAccountNamespace(store: LocalStore): Promise<string[]> {
  const removed: string[] = [];
  for (const prefix of ACCOUNT_KEY_PREFIXES) {
    const keys = await store.listKeys(prefix);
    for (const key of keys) {
      await store.delete(key);
      removed.push(key);
    }
  }
  return removed;
}

/** The catalog filtered to the names REP JOT owns. */
async function listRecognized(drive: DriveAdapter): Promise<DriveFileMeta[]> {
  const catalog = await drive.listCatalog();
  return catalog.filter((file: DriveFileMeta): boolean => isRecognizedName(file.name));
}
