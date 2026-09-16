// The two destructive Settings flows.
// Phase 19. REQUIREMENTS 21.3 through 21.7. ARCHITECTURE ADR-018, §10
// "Sign out, disconnect, and deletion".
//
// The order inside each flow is the whole safety of it, so the order lives in
// one module a test can drive, instead of inside a component this build
// cannot reach.
//
// Delete All User Data:
//
//   1. `coordinator.reset()`. It flushes queued edits and drains uploads
//      already started, then drops the in-memory documents. The queue is
//      empty when the remote delete runs.
//   2. `deleteAllUserData`. The remote files go, then the local namespace.
//   3. The revoke. The user asked for the data gone; leaving a live grant on
//      the device leaves the door open to the same folder.
//
//   Step 1 cannot move after step 2. The router runs `coordinator.flush()`
//   ahead of every route change, so a delete followed by a live queue pushes
//   the pending edits straight back up and re-creates the files the user
//   just removed.
//
// Disconnect:
//
//   1. `coordinator.flush()`. Disconnect keeps the remote files, so a
//      pending edit belongs there before the grant goes away.
//   2. `coordinator.pendingEdits()`. A row still pending after the flush
//      never reached Drive, and the flow stops there. See `runDisconnect`.
//   3. The revoke.
//   4. The local namespace clears, and only after the revoke confirms.
//
//   Step 1 cannot move after step 3. Once the grant is gone the device
//   cannot write, and an edit left only on this device is the one thing the
//   user could not get back by signing in again.
//
// This module holds no token. The revoke arrives as a thunk the caller wires
// to the auth service, which reads the token itself. A delete or disconnect
// run therefore cannot carry a credential into a result record or a log.
// REQUIREMENTS 12.12.

import { clearAccountNamespace, deleteAllUserData } from './delete-all-data';
import type { DriveAdapter } from '../drive/drive-interface';
import type { LocalStore } from '../storage/local-store';
import type { Coordinator } from '../sync/sync-coordinator';

/** What both flows need. */
export interface AccountFlowDeps {
  /** The Drive adapter for the signed-in account. */
  drive: DriveAdapter;
  /** The local store for the same account. */
  store: LocalStore;
  /** The bound account key. */
  accountKey: string;
  /** The coordinator, or `null` when none was built. */
  coordinator: Coordinator | null;
  /**
   * Revoke the grant and report whether Google confirmed.
   *
   * `true` means confirmed. `false` means unconfirmed, and the caller shows
   * the Google Account connections link. The thunk must not throw for a
   * plain revocation failure; it returns `false` instead.
   */
  revoke: () => Promise<boolean>;
  /**
   * Called after each delete with the running count. Optional. Drives the
   * progress line in the confirmation.
   */
  onProgress?: (deleted: number) => void;
}

/** How the delete flow ended. */
export interface DeleteFlowResult {
  /**
   * `complete` when the folder cleared and the grant revoked. `partial` when
   * recognized files remain. `revoke_failed` when the folder cleared but
   * Google would not confirm the revoke.
   */
  kind: 'complete' | 'partial' | 'revoke_failed';
  /** Names still in the folder after a partial run. Empty otherwise. */
  remainingRecognized: string[];
  /** Files this run deleted. */
  deletedFileIds: string[];
}

/** How the disconnect flow ended. */
export interface DisconnectFlowResult {
  /**
   * `disconnected` when Google confirmed and nothing was left behind.
   * `revoke_failed` when the flow stopped before it could safely cut the
   * grant. That covers an unconfirmed revoke and a flush that could not
   * upload a pending edit.
   */
  kind: 'disconnected' | 'revoke_failed';
  /**
   * Why the flow stopped. `pending_sync_failed` means a local edit never
   * reached Drive, so revoking would leave the only copy of that edit on a
   * device that can no longer send it. `revoke_unconfirmed` means Google
   * did not confirm the revoke. Absent on a completed run.
   */
  reason?: 'pending_sync_failed' | 'revoke_unconfirmed';
  /** Logical files whose edit is still pending here after a failed flush. */
  pendingNames?: string[];
}

/**
 * Run Delete All User Data, then cut the grant.
 *
 * A partial delete stops before the revoke. The local data stays so the
 * user can retry, and revoking the grant over a half-finished delete takes
 * away the only way to finish it.
 *
 * @throws Anything the reset, the list, or a delete throws. Nothing local
 *         clears on that path, so a retry starts from the same state.
 */
export async function runDeleteAllUserData(deps: AccountFlowDeps): Promise<DeleteFlowResult> {
  if (deps.coordinator !== null) {
    await deps.coordinator.reset();
  }

  const deletion = await deleteAllUserData({
    drive: deps.drive,
    store: deps.store,
    accountKey: deps.accountKey,
    ...(deps.onProgress === undefined ? {} : { onProgress: deps.onProgress })
  });

  if (deletion.kind === 'partial') {
    return {
      kind: 'partial',
      remainingRecognized: deletion.remainingRecognized,
      deletedFileIds: deletion.deletedFileIds
    };
  }

  if (!(await deps.revoke())) {
    return {
      kind: 'revoke_failed',
      remainingRecognized: [],
      deletedFileIds: deletion.deletedFileIds
    };
  }

  return { kind: 'complete', remainingRecognized: [], deletedFileIds: deletion.deletedFileIds };
}

/**
 * Run Disconnect Google Account.
 *
 * The flush comes first so pending edits reach Drive while the grant still
 * works. The flush waits for the network and swallows its failures, because
 * its other caller is a hidden page with nobody to report to. That is not
 * good enough here: a pending edit that never landed is the one thing the
 * user cannot get back after the grant is gone and the local namespace is
 * cleared. So the flow reads the pending rows back after the flush and
 * stops when any remain.
 *
 * Stopping is the safe half-answer. The grant stays live, the local rows
 * stay, and the user can retry once Drive answers again. Revoking over an
 * unsent edit would destroy it, and REQUIREMENTS 4.4 and 4.20 say a failed
 * synchronization must not discard local edits.
 *
 * @throws Anything the flush throws. Nothing is revoked on that path.
 */
export async function runDisconnect(deps: AccountFlowDeps): Promise<DisconnectFlowResult> {
  if (deps.coordinator !== null) {
    await deps.coordinator.flush();

    // A pending row that survived the flush did not reach Drive. Disconnect
    // would remove the only path it had left.
    const pending = await deps.coordinator.pendingEdits();
    if (pending.length > 0) {
      return { kind: 'revoke_failed', reason: 'pending_sync_failed', pendingNames: pending };
    }
  }

  if (!(await deps.revoke())) {
    return { kind: 'revoke_failed', reason: 'revoke_unconfirmed' };
  }

  await clearAccountNamespace(deps.store);
  return { kind: 'disconnected' };
}
