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
//   2. The revoke.
//   3. The local namespace clears, and only after the revoke confirms.
//
//   Step 1 cannot move after step 2. Once the grant is gone the device
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
  /** `disconnected` when Google confirmed. `revoke_failed` when it did not. */
  kind: 'disconnected' | 'revoke_failed';
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
 * works. The local namespace clears only after the revoke confirms, so a
 * failed revoke leaves the device exactly as it was and the user can retry.
 *
 * @throws Anything the flush throws. Nothing is revoked on that path.
 */
export async function runDisconnect(deps: AccountFlowDeps): Promise<DisconnectFlowResult> {
  if (deps.coordinator !== null) {
    await deps.coordinator.flush();
  }

  if (!(await deps.revoke())) {
    return { kind: 'revoke_failed' };
  }

  await clearAccountNamespace(deps.store);
  return { kind: 'disconnected' };
}
