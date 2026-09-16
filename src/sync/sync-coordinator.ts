// The sync coordinator. One object owns the save path, the reconciliation
// cycle, and the save status for one account. Phase 10.
// REQUIREMENTS 4.1 through 4.21. ARCHITECTURE section 11, section 15.
//
// Three rules shape every path in this file.
//
// 1. Local first. A user edit lands in the local store before this module
//    issues a network request, so a Drive failure cannot lose an edit.
//    REQUIREMENTS 4.1, 4.4.
// 2. Never discard. The working document, the base copy, and the pending
//    delta survive a failed upload, a lost response, and a page reload. The
//    coordinator gives up on the network, never on the user's intent.
//    REQUIREMENTS 4.15, 4.20.
// 3. Prove the write. Drive offers no conditional content write, so the
//    coordinator reads the file back and compares bytes. REQUIREMENTS 4.17,
//    4.18.
//
// The three local slots for one logical file:
//
// | Slot | Key prefix | Holds |
// | --- | --- | --- |
// | working | `doc:` | This device's current document text, plus the marker of the last confirmed remote state. |
// | base | `base:` | Content from the last successful synchronization. |
// | pending | `pending:` | The delta from base to working. Cleared by a confirmed commit. |
//
// While nothing is pending the three agree, and the working slot is a plain
// remote cache row. While an edit is pending the working slot holds local
// text that Drive has never seen. REQUIREMENTS 4.5.

import { logDiagnostic } from '../diagnostics/diagnostic-log';
import { decodeUtf8 } from '../bytes/utf8';
import { AppError, type AppErrorKind } from '../domain/errors';
import type { ResultsShard } from '../domain/types';
import { shardName } from '../domain/time';
import type { LoadedStaticData } from '../documents/static-loader';
import { semanticStageFor } from '../documents/semantic-stage';
import { processDocument, type SemanticStage } from '../documents/document-pipeline';
import type { DriveAdapter, DriveFileContent, DriveFileMeta } from '../drive/drive-interface';
import { setSaveStatus, type SaveStatus } from '../state/app-state';
import { baseKey, cacheKey, pendingKey, type LocalStore, type LocalStoreEntry } from '../storage/local-store';
import { highestSupportedVersion, type DocFamily } from '../validation/schema-validator';
import { validatePreferences, validateShard } from '../validation/semantic-validator';
import {
  createConsolidateHook,
  type BlockedLogicalFile,
  type ConsolidateResult,
  type RemainingFile
} from './consolidate-duplicates';
import { mergeDocuments, type MergeFamily } from './merge-documents';
import { PREFERENCES_FILE_NAME, familyForName } from './recognized-names';
import { clone, patcher, applyDelta } from './patcher';
import {
  applyPendingDelta,
  computePendingDelta,
  isPendingDelta,
  makeBaseRecord,
  makeCachedRecord,
  makePendingRecord,
  readRecords,
  remoteMarker,
  type PendingDelta,
  type RecordSet
} from './cache-records';
import {
  debouncedEdit,
  flushOnPagehide,
  pageTarget,
  wallClock,
  type EditQueue,
  type EventTargetLike,
  type TimerSet
} from './debounce';

/** Upload attempts before the coordinator gives up and reports `sync_failed`. */
export const MAX_UPLOAD_ATTEMPTS = 3;

/** Production quiet period before one logical file synchronizes to Drive. */
export const DEFAULT_SYNC_DEBOUNCE_MS = 5_000;

/** The preferences logical file name. */
export const PREFERENCES_NAME = PREFERENCES_FILE_NAME;

/**
 * The Phase 11 consolidation seam.
 *
 * ARCHITECTURE section 11 step 3 consolidates duplicate Drive names before
 * any normal write. Phase 11 owns that module, and `createCoordinator` builds
 * the real hook from the coordinator's own `drive` and `staticData`, so every
 * coordinator consolidates with no extra wiring. A caller can still pass its
 * own hook through `SyncDeps.consolidate`.
 *
 * The hook returns the catalog plus the groups it could not consolidate. A
 * blocked group is the coordinator's signal to refuse that logical file: the
 * copies stay on Drive untouched and the pending local edit stays durable.
 * REQUIREMENTS 4.23.
 */
export type ConsolidateHook = (catalog: DriveFileMeta[]) => Promise<ConsolidateResult>;

/** Everything the coordinator needs. */
export interface SyncDeps {
  /** Local key-value store for this account. */
  store: LocalStore;
  /** Drive adapter for this account. */
  drive: DriveAdapter;
  /** Validated static bundle, for the semantic stage. */
  staticData: LoadedStaticData;
  /** Account namespace key. Scopes the locks and the store. */
  accountKey: string;
  /** Duplicate-name consolidation. Phase 11 supplies this. */
  consolidate?: ConsolidateHook;
  /** Quiet period for `queueEdit`. */
  debounceMs?: number;
  /** Maximum time that continuous input can delay a local write. */
  debounceMaxMs?: number;
  /**
   * Quiet period before a durable local edit synchronizes to Drive.
   *
   * The coordinator default is zero for API compatibility. Production passes
   * `DEFAULT_SYNC_DEBOUNCE_MS` from bootstrap.
   */
  syncDebounceMs?: number;
  /** Maximum time that durable edits can delay Drive synchronization. */
  syncDebounceMaxMs?: number;
  /** Base delay between upload retries. Zero keeps tests immediate. */
  retryBaseDelayMs?: number;
  /** Timer pair. Injectable so tests need no wall clock. */
  timers?: TimerSet;
  /** `pagehide` target. Defaults to `window` when the host has one. */
  pagehideTarget?: EventTargetLike | null;
}

/**
 * What `edit` returns: durable now, synchronized later.
 *
 * `edit` resolves once the local write is durable, because that is the
 * moment the user's intent is safe. `synced` carries the network outcome. A
 * caller that only saves ignores it; a caller that must know Drive accepted
 * the edit awaits it. A rejected `synced` never means the edit was lost.
 */
export interface EditHandle {
  /** Always `true` when `edit` resolves. The local write landed. */
  localDurable: true;
  /** Resolves when this edit commits to Drive. Rejects with the sync failure. */
  synced: Promise<void>;
}

/** The coordinator surface. */
export interface Coordinator {
  /** Load one logical file into memory, downloading and migrating when needed. */
  ensureLoaded(logicalName: string): Promise<unknown>;
  /** Apply a pure edit, persist it locally, then synchronize. */
  edit(logicalName: string, mutate: (doc: unknown) => unknown): Promise<EditHandle>;
  /** Queue one debounced edit. Normal typing goes through here. */
  queueEdit(logicalName: string, mutate: (doc: unknown) => unknown): void;
  /** Reconcile every known logical file for this account. */
  syncAll(): Promise<void>;
  /**
   * The logical files that still hold a pending local delta.
   *
   * A caller that must not leave local intent behind reads this after a flush.
   * A name in the list means the delta is durable here and has not been
   * confirmed on Drive. REQUIREMENTS 4.4, 4.20.
   */
  pendingEdits(): Promise<string[]>;
  /** Flush pending edits to local storage without waiting for Drive. */
  flushLocal(): Promise<void>;
  /** Flush local edits and wait for scheduled Drive synchronization. */
  flush(): Promise<void>;
  /**
   * Forget in-memory state for this account. The local rows stay.
   *
   * `reset` flushes the edit queue first, so every queued mutator reaches
   * local storage before the maps clear. A reset that cannot flush rejects
   * instead of discarding an edit. REQUIREMENTS 4.4.
   */
  reset(): Promise<void>;
  /** Read the in-memory working document. `undefined` when not loaded. */
  peek(logicalName: string): unknown;
}

/** One logical file held in memory. */
interface LoadedDoc {
  logicalName: string;
  family: MergeFamily;
  /** Working document. This device's current value. */
  doc: unknown;
  /** Serialized working document. What the next upload sends. */
  workingText: string;
  /** Content from the last successful synchronization, or `null` when none. */
  baseText: string | null;
  /** Retained Drive file ID, or `null` before the file exists. */
  driveFileId: string | null;
  /** Marker of the last confirmed remote state. */
  remoteEtag: string | null;
  /** Schema version the working text declares. */
  schemaVersion: number;
  /** Uncommitted delta from base to working, or `null`. */
  pending: PendingDelta | null;
}

/** The monthly shard name that holds one session start. */
export function logicalNameForShard(startedAtUtc: string): string {
  return shardName(startedAtUtc);
}

/**
 * Map a logical file name to its merge family.
 *
 * The rule is the one in `recognized-names.ts`, so the coordinator and
 * duplicate consolidation can never disagree about what a REP JOT logical
 * file is. Any other name is refused instead of guessing a family for it.
 */
function familyFor(logicalName: string): MergeFamily {
  const family = familyForName(logicalName);
  if (family === null) {
    throw new AppError(
      'invalid_document',
      { reason: 'unrecognized_logical_name' },
      'This file name is not a REP JOT logical file.'
    );
  }
  return family;
}

/** True when `catalog` holds this stable Drive file ID. */
function catalogHas(catalog: DriveFileMeta[], id: string): boolean {
  return catalog.some((meta: DriveFileMeta): boolean => meta.id === id);
}

/** The catalog entry for one logical name. Consolidation ran first, so at most
 * one recognized file with this name should remain by the time we read here. */
function catalogEntry(catalog: DriveFileMeta[], logicalName: string): DriveFileMeta | null {
  for (const meta of catalog) {
    if (meta.name === logicalName) return meta;
  }
  return null;
}

/**
 * The blocked entry for one logical name, if consolidation reported one.
 *
 * A blocked duplicate group is not a transport fault, so retrying cannot fix
 * it. The coordinator turns it into a `duplicate_drive_file` error, which
 * `classifyAttempt` stops on, and the `DataError` component names the file.
 * REQUIREMENTS 4.23, 22.2.10.
 */
function blockedFor(
  result: ConsolidateResult,
  logicalName: string
): BlockedLogicalFile | null {
  for (const entry of result.blocked) {
    if (entry.logicalName === logicalName) return entry;
  }
  return null;
}

/** Throw the blocked error for one logical name when consolidation reported it. */
function guardBlocked(result: ConsolidateResult, logicalName: string): void {
  const blocked = blockedFor(result, logicalName);
  if (blocked !== null) {
    throw new AppError(
      'duplicate_drive_file',
      { reason: blocked.reason, fileId: blocked.fileId },
      'Drive holds duplicate copies this client cannot safely consolidate.'
    );
  }
}

/**
 * True when `error` means the write got no answer.
 *
 * The Drive adapter answers a definite failure with an HTTP status in the
 * error detail, and a request that never got an answer with a `network`
 * kind that carries none. Only the second case is ambiguous: the write may
 * have committed even though the answer never arrived. ARCHITECTURE §15.
 */
function isResponseLost(error: AppError): boolean {
  if (error.kind !== 'network') return false;
  return !('status' in error.detail);
}

/**
 * True when one Drive read's bytes and metadata describe the same remote state.
 *
 * `readFile` issues a media request and then a metadata request, so a write
 * from another device between them can hand back old bytes under the marker of
 * new content. That pair is not a lie the merge can detect from the content,
 * but the metadata carries the size the bytes should have. A length that
 * disagrees with the metadata is proof the two halves came from different
 * states, so the read is refused and taken again.
 *
 * A metadata size of zero means Drive reported no size. There is then nothing
 * to check the bytes against, and the read passes.
 *
 * REQUIREMENTS 4.6, 4.16. `specs/storage-and-lookup.md`, synchronization
 * preflight.
 */
function readIsPaired(read: DriveFileContent): boolean {
  if (read.meta.size <= 0) return true;
  return read.bytes.byteLength === read.meta.size;
}

/**
 * True when a read still agrees with the catalog row it was taken from.
 *
 * The catalog is listed before the file is read, so it carries the marker the
 * file held at the start of the window. A read whose metadata reports a
 * different marker moved during that window, and the bytes behind it cannot
 * be trusted to match. This catches what the size check cannot: a concurrent
 * write that left the file the same length, where the bytes and the metadata
 * are each internally consistent and describe different states.
 *
 * REQUIREMENTS 4.6, 4.8, 4.16.
 */
function readMatchesCatalog(
  entry: DriveFileMeta | null,
  read: DriveFileContent | null
): boolean {
  if (entry === null || read === null) return true;
  return remoteMarker(entry) === remoteMarker(read.meta);
}

/**
 * Throw the retryable error for a read whose halves came from different states.
 *
 * The retry is the whole remedy. The next attempt lists the catalog again and
 * reads the file again, and a fresh read of a settled folder pairs correctly.
 */
function stalePairError(logicalName: string): AppError {
  return new AppError(
    'network',
    { reason: 'read_pair_mismatch', logicalName },
    'The content read from Drive did not match the metadata read with it.'
  );
}

/**
 * The empty document for one logical file.
 *
 * A brand-new shard or a first preferences file starts here. The value
 * carries the family envelope and an empty content map, so it passes the
 * schema and the semantic stage. REQUIREMENTS 4.1.
 */
function emptyDocumentFor(family: MergeFamily, logicalName: string): unknown {
  const schemaVersion = highestSupportedVersion(family);
  if (family === 'repjot/preferences') {
    return {
      format: 'repjot/preferences',
      schemaVersion,
      revision: 0,
      updatedAtUtc: new Date().toISOString(),
      exerciseUnits: {}
    };
  }
  const match = /^results-(\d{4}-\d{2})\.json$/.exec(logicalName);
  return {
    format: 'repjot/results',
    schemaVersion,
    yearMonthUtc: match === null ? '' : match[1],
    sessions: {}
  };
}

/** Compare two JSON texts ignoring key order and whitespace. */
function sameJson(a: string, b: string): boolean {
  if (a === b) return true;
  try {
    return JSON.stringify(JSON.parse(a)) === JSON.stringify(JSON.parse(b));
  } catch {
    return false;
  }
}

/**
 * Classify one failed attempt.
 *
 * A validation failure cannot be fixed by retrying, because the candidate is
 * wrong on this device, so it stops the loop at once. A lost response after
 * a write is `ambiguous_upload`: the write may have committed, so the next
 * attempt must read Drive before it writes again. Everything else retries.
 * REQUIREMENTS 4.19, ARCHITECTURE section 15.
 */
function classifyAttempt(error: unknown): { kind: AppErrorKind; retryable: boolean } {
  if (error instanceof AppError) {
    if (error.kind === 'ambiguous_upload') return { kind: 'ambiguous_upload', retryable: true };
    if (
      error.kind === 'invalid_document' ||
      error.kind === 'unsupported_schema' ||
      error.kind === 'semantic_reference' ||
      error.kind === 'migration' ||
      error.kind === 'storage' ||
      error.kind === 'duplicate_drive_file' ||
      error.kind === 'authentication' ||
      error.kind === 'authorization' ||
      error.kind === 'drive_quota'
    ) {
      return { kind: error.kind, retryable: false };
    }
    return { kind: error.kind, retryable: true };
  }
  return { kind: 'network', retryable: true };
}

/**
 * Create the coordinator for one account.
 *
 * The coordinator holds the in-memory documents, the two per-file locks, and
 * the debounced edit queue. Nothing crosses an account boundary, because
 * `accountKey` scopes every lock key and the store is already per-account.
 */
export function createCoordinator(deps: SyncDeps): Coordinator {
  const consolidate: ConsolidateHook =
    deps.consolidate ?? createConsolidateHook({ drive: deps.drive, staticData: deps.staticData });
  const semantic = (logicalName: string): SemanticStage =>
    semanticStageFor(logicalName, deps.staticData);
  const retryBaseDelayMs = deps.retryBaseDelayMs ?? 0;

  async function waitBeforeRetry(attempt: number): Promise<void> {
    if (retryBaseDelayMs <= 0) return;
    const exponential = retryBaseDelayMs * Math.pow(2, Math.max(0, attempt - 1));
    const jittered = Math.round(exponential * (0.75 + Math.random() * 0.5));
    await new Promise<void>((resolve): void => {
      wallClock.setTimeout(resolve, jittered);
    });
  }

  /** In-memory working documents by logical name. */
  const docs = new Map<string, LoadedDoc>();

  /**
   * The two locks, one entry per `(accountKey, logicalName)`.
   *
   * `localLock` guards the in-memory map and the three local rows. Nothing
   * that runs inside it touches the network, so a slow or stalled Drive
   * cannot delay a local save. `syncLock` serializes reconciliations, which
   * is where every Drive call lives. Two reconciliations of one file must
   * not overlap: both would read the base, merge, and write the same three
   * records. REQUIREMENTS 4.1, 4.16.
   *
   * The nesting rule is always sync then local. No path takes the sync lock
   * while it holds the local lock, so the pair cannot deadlock. REQUIREMENTS
   * 4.4.
   */
  const localLock = new Map<string, Promise<void>>();
  const syncLock = new Map<string, Promise<void>>();
  const lockKey = (logicalName: string): string => `${deps.accountKey} ${logicalName}`;

  /**
   * Run `task` after the previous task in this lock for this file settles.
   *
   * The map keeps a never-rejecting tail, so one failed task cannot wedge
   * the file forever, while the caller still sees the real result.
   */
  function runQueued<T>(
    locks: Map<string, Promise<void>>,
    logicalName: string,
    task: () => Promise<T>
  ): Promise<T> {
    const key = lockKey(logicalName);
    const previous = locks.get(key) ?? Promise.resolve();
    const result = previous.then(task, task);
    const tail = result.then(
      () => undefined,
      () => undefined
    );
    locks.set(key, tail);
    void tail.then(() => {
      if (locks.get(key) === tail) locks.delete(key);
    });
    return result;
  }

  /** Serialize a local-state change. Never put a network call inside. */
  function withLocal<T>(logicalName: string, task: () => Promise<T>): Promise<T> {
    return runQueued(localLock, logicalName, task);
  }

  /**
   * Serialize one reconciliation, network included.
   *
   * Every owner of the sync lock registers here, so `flush` and `reset` can
   * wait for all of them. A lock cleared while one of its owners still runs
   * lets a later upload overlap an older one. REQUIREMENTS 4.4, 4.16.
   */
  function withSync<T>(logicalName: string, task: () => Promise<T>): Promise<T> {
    const result = runQueued(syncLock, logicalName, task);
    const tracked: Promise<void> = result.then(
      () => undefined,
      () => undefined
    );
    inFlight.add(tracked);
    void tracked.then(
      () => {
        inFlight.delete(tracked);
      },
      () => {
        inFlight.delete(tracked);
      }
    );
    return result;
  }

  /**
   * Logical files whose last reconciliation failed and whose local intent is
   * still unresolved.
   *
   * The save badge is one global value, but a failure belongs to one file. A
   * successful commit of a different file must not read as "everything is
   * synchronized" while a failed delta still sits in local storage waiting.
   * The badge reports the worst state any known file is in. REQUIREMENTS 4.3,
   * 4.20. ARCHITECTURE section 11.
   */
  const failedFiles = new Set<string>();

  /**
   * The badge for a settled account: `saved`, unless some file is still
   * failed. A failure outranks a success, because the failure is the state a
   * person has to act on.
   *
   * `fallback` is what the badge shows when no file is failed. A caller that
   * settled nothing passes `'idle'`, so a failed local write does not claim a
   * save that did not happen. A caller that committed a local write passes
   * nothing and gets `'saved'`. Either way another file's failure still
   * shows, because the badge is one value over every file this account
   * holds. REQUIREMENTS 4.3, 4.20.
   */
  function settledStatus(fallback: SaveStatus = 'saved'): SaveStatus {
    return failedFiles.size === 0 ? fallback : 'sync_failed';
  }

  /**
   * Counts the local writes that carry user intent, per logical file.
   *
   * A load captures the count before it reads Drive. When it comes back and
   * the count moved, a newer local save landed in between, so the load must
   * drop its remote view instead of writing it back. REQUIREMENTS 4.4.
   */
  const localWrites = new Map<string, number>();
  const writeCount = (logicalName: string): number => localWrites.get(logicalName) ?? 0;
  const countLocalWrite = (logicalName: string): void => {
    localWrites.set(logicalName, writeCount(logicalName) + 1);
  };

  /**
   * Reconciliations started and not finished, so `flush` and `reset` can
   * await them. One entry per started reconciliation, because several can
   * queue for one file.
   */
  const inFlight = new Set<Promise<void>>();

  /** Detach for the `pagehide` listener registered at the bottom. */
  let detachPagehide: () => void = () => undefined;

  /** One promise waiting for a specified local generation to reach Drive. */
  interface SyncWaiter {
    generation: number;
    resolve: () => void;
    reject: (error: unknown) => void;
  }

  /** Drive debounce state, keyed by logical file. */
  const syncDelayMs = deps.syncDebounceMs ?? 0;
  const syncMaxDelayMs = deps.syncDebounceMaxMs;
  const syncTimers = deps.timers ?? wallClock;
  const syncGeneration = new Map<string, number>();
  const syncHandles = new Map<string, unknown>();
  const syncMaxHandles = new Map<string, unknown>();
  const syncRunning = new Map<string, Promise<void>>();
  const syncWaiters = new Map<string, SyncWaiter[]>();

  function cancelSyncTimer(logicalName: string): void {
    const handle = syncHandles.get(logicalName);
    if (handle !== undefined) {
      syncTimers.clearTimeout(handle);
      syncHandles.delete(logicalName);
    }
    const maxHandle = syncMaxHandles.get(logicalName);
    if (maxHandle !== undefined) {
      syncTimers.clearTimeout(maxHandle);
      syncMaxHandles.delete(logicalName);
    }
  }

  function settleSyncWaiters(logicalName: string, generation: number, error?: unknown): void {
    const waiting = syncWaiters.get(logicalName) ?? [];
    const later: SyncWaiter[] = [];
    for (const waiter of waiting) {
      if (waiter.generation > generation) {
        later.push(waiter);
      } else if (error === undefined) {
        waiter.resolve();
      } else {
        waiter.reject(error);
      }
    }
    if (later.length === 0) syncWaiters.delete(logicalName);
    else syncWaiters.set(logicalName, later);
  }

  function armSync(logicalName: string): void {
    if (syncRunning.has(logicalName)) return;
    const quietHandle = syncHandles.get(logicalName);
    if (quietHandle !== undefined) syncTimers.clearTimeout(quietHandle);
    syncHandles.delete(logicalName);
    if (syncDelayMs <= 0) {
      void startScheduledSync(logicalName).catch((): void => undefined);
      return;
    }
    syncHandles.set(
      logicalName,
      syncTimers.setTimeout((): void => {
        syncHandles.delete(logicalName);
        void startScheduledSync(logicalName).catch((): void => undefined);
      }, syncDelayMs)
    );
  }

  /** Start one reconciliation for all edits known at this instant. */
  function startScheduledSync(logicalName: string): Promise<void> {
    const active = syncRunning.get(logicalName);
    if (active !== undefined) return active;

    cancelSyncTimer(logicalName);
    const generation = syncGeneration.get(logicalName) ?? 0;
    const task = withSync(logicalName, async (): Promise<void> => {
      await reconcileOne(logicalName);
    });
    syncRunning.set(logicalName, task);

    void task.then(
      (): void => settleSyncWaiters(logicalName, generation),
      (error: unknown): void => settleSyncWaiters(logicalName, generation, error)
    ).finally((): void => {
      if (syncRunning.get(logicalName) === task) syncRunning.delete(logicalName);
      if ((syncGeneration.get(logicalName) ?? 0) > generation) armSync(logicalName);
    });
    return task;
  }

  /** Schedule one Drive synchronization and return its generation promise. */
  function scheduleSync(logicalName: string): Promise<void> {
    const generation = (syncGeneration.get(logicalName) ?? 0) + 1;
    syncGeneration.set(logicalName, generation);
    const synced = new Promise<void>((resolve, reject): void => {
      const waiting = syncWaiters.get(logicalName) ?? [];
      waiting.push({ generation, resolve, reject });
      syncWaiters.set(logicalName, waiting);
    });
    if (syncMaxDelayMs !== undefined && !syncMaxHandles.has(logicalName)) {
      syncMaxHandles.set(
        logicalName,
        syncTimers.setTimeout((): void => {
          const quiet = syncHandles.get(logicalName);
          if (quiet !== undefined) syncTimers.clearTimeout(quiet);
          syncHandles.delete(logicalName);
          syncMaxHandles.delete(logicalName);
          void startScheduledSync(logicalName).catch((): void => undefined);
        }, syncMaxDelayMs)
      );
    }
    // Keep fire-and-forget save callers from creating an unhandled rejection.
    // The original promise still rejects for callers that await `synced`.
    void synced.catch((): void => undefined);
    armSync(logicalName);
    return synced;
  }

  /** Force all scheduled generations for one file through the sync lock. */
  async function flushScheduledSync(logicalName: string): Promise<void> {
    cancelSyncTimer(logicalName);
    for (;;) {
      const active = syncRunning.get(logicalName);
      if (active !== undefined) {
        await active.catch((): void => undefined);
        continue;
      }
      if ((syncWaiters.get(logicalName)?.length ?? 0) === 0) return;
      await startScheduledSync(logicalName).catch((): void => undefined);
    }
  }

  /**
   * Debounced edit queue. Normal typing lands here.
   *
   * One drained batch becomes one local transaction. The local edit schedules
   * Drive separately, so a slow upload cannot delay local durability.
   */
  const queue: EditQueue = debouncedEdit(
    async (logicalName: string, mutate: (doc: unknown) => unknown): Promise<void> => {
      const handle = await edit(logicalName, mutate);
      void handle.synced.catch((): void => undefined);
    },
    { delayMs: deps.debounceMs, maxDelayMs: deps.debounceMaxMs, timers: deps.timers }
  );

  /** Read the three local slots for one logical file. */
  function readSlots(logicalName: string): Promise<RecordSet> {
    return readRecords(deps.store, logicalName);
  }

  /** List the catalog and run the consolidation hook over it. */
  async function loadCatalog(logicalName: string): Promise<ConsolidateResult> {
    const catalog = await deps.drive.listCatalog();
    const result = await consolidate(catalog);
    // A blocked duplicate group stops this logical file before any read or
    // write of it. Other logical files keep their own entries and keep
    // synchronizing. REQUIREMENTS 4.23.
    guardBlocked(result, logicalName);
    return result;
  }

  /**
   * Drop the cached row whose Drive file ID left the catalog.
   *
   * A file deleted on Drive must not keep a live cached row, or the next
   * write would target a dead ID. The pending row stays: local intent
   * survives a remote delete and re-creates the file. The base row also
   * stays while a pending delta exists, because that delta is a `patch`
   * against the base and cannot replay without it. Dropping the base would
   * strand the pending edit forever. REQUIREMENTS 4.4, 4.20.
   *
   * A consolidation records its surviving file ID instead of dropping the
   * row. When step 12 of consolidation proved exactly one recognized file
   * remains, the cached and base rows are repointed to that ID and keep the
   * content they already hold, so this device does not re-download a document
   * it just wrote. REQUIREMENTS 4.25.
   */
  async function dropVanished(
    logicalName: string,
    catalog: DriveFileMeta[],
    survivor: RemainingFile | null
  ): Promise<void> {
    const slots = await readSlots(logicalName);
    const dropped: string[] = [];
    const repointed: string[] = [];

    const cachedGone =
      slots.cached !== null &&
      slots.cached.driveFileId !== null &&
      !catalogHas(catalog, slots.cached.driveFileId);
    if (cachedGone && slots.cached !== null) {
      if (survivor === null) {
        await deps.store.delete(cacheKey(logicalName));
        dropped.push('cached');
      } else {
        // With nothing pending the row is a plain remote cache, so it takes the
        // content and the marker the consolidation read back. Carrying the
        // deleted file's marker instead would let `isCleanRow` mistake stale
        // local text for a clean copy of the survivor and skip the download.
        // With a pending delta the row holds this device's working text, which
        // Drive has never seen, so replacing it would discard an edit. Only the
        // file ID moves. REQUIREMENTS 4.4, 4.5, 4.15, 4.20, 4.25.
        const carryConfirmed = slots.pending === null;
        await deps.store.set(
          cacheKey(logicalName),
          makeCachedRecord(
            logicalName,
            survivor.driveFileId,
            carryConfirmed ? survivor.remoteEtag : slots.cached.remoteEtag,
            carryConfirmed ? survivor.contentText : slots.cached.contentText,
            carryConfirmed ? survivor.schemaVersion : slots.cached.schemaVersion,
            new Date().toISOString()
          )
        );
        repointed.push('cached');
      }
    }

    const keepBase = slots.pending !== null;
    const baseGone =
      !keepBase &&
      slots.base !== null &&
      slots.base.driveFileId !== null &&
      !catalogHas(catalog, slots.base.driveFileId);
    if (baseGone && slots.base !== null) {
      if (survivor !== null) {
        await deps.store.set(
          baseKey(logicalName),
          makeBaseRecord(survivor.contentText, survivor.driveFileId)
        );
        repointed.push('base');
      } else {
        await deps.store.delete(baseKey(logicalName));
        dropped.push('base');
      }
    }

    if (repointed.length > 0 && survivor !== null) {
      logDiagnostic({
        severity: 'info',
        code: 'sync_records_repointed',
        context: { logicalName, repointed: repointed.join(','), driveFileId: survivor.driveFileId }
      });
    }
    if (dropped.length > 0) {
      logDiagnostic({
        severity: 'info',
        code: 'sync_records_dropped',
        context: { logicalName, dropped: dropped.join(',') }
      });
    }
  }

  /** Run the full read pipeline for one logical file. */
  function parseDoc(logicalName: string, family: MergeFamily, text: string): { doc: unknown; schemaVersion: number } {
    const processed = processDocument<unknown>(text, family, semantic(logicalName));
    return { doc: processed.document, schemaVersion: processed.sourceVersion };
  }

  /**
   * True when the cached row still matches Drive and nothing is pending.
   *
   * A row that passes this test needs no download: the cached text is the
   * remote text, and no local edit is waiting. REQUIREMENTS 4.15.
   */
  function isCleanRow(slots: RecordSet, entry: DriveFileMeta | null): boolean {
    return (
      slots.cached !== null &&
      slots.pending === null &&
      entry !== null &&
      remoteMarker(entry) === slots.cached.remoteEtag
    );
  }

  /**
   * The in-memory state for a logical file this device has never held.
   *
   * The base holds the same empty document, not nothing. A three-way merge
   * with no base at all takes the local document whole and replaces whatever
   * another device already wrote, so an offline first save could erase a
   * shard another device created. With the empty document as the base, the
   * local content reads as an addition and the remote content survives.
   * REQUIREMENTS 4.1, 4.9.
   */
  function emptyLoaded(logicalName: string, family: MergeFamily): LoadedDoc {
    const emptyText = JSON.stringify(emptyDocumentFor(family, logicalName));
    const parsed = parseDoc(logicalName, family, emptyText);
    return {
      logicalName,
      family,
      doc: parsed.doc,
      workingText: emptyText,
      baseText: emptyText,
      driveFileId: null,
      remoteEtag: null,
      schemaVersion: parsed.schemaVersion,
      pending: null
    };
  }

  /**
   * Load one logical file. Steps 2 through 7 of the reconciliation list.
   *
   * A clean cached row whose marker still matches the catalog needs no
   * download. A changed, missing, or pending file is downloaded and run
   * through the pipeline. REQUIREMENTS 4.15.
   *
   * The Drive reads run outside the local lock, and the result is applied
   * inside it. Applying re-reads the local rows, so a save that landed
   * while this load was on the network wins over the remote view the load
   * brought back. REQUIREMENTS 4.4.
   */
  async function loadDoc(logicalName: string): Promise<LoadedDoc> {
    const family = familyFor(logicalName);
    const result = await loadCatalog(logicalName);
    const catalog = result.catalog;
    const survivor = result.remaining[logicalName] ?? null;
    const entry = catalogEntry(catalog, logicalName);

    // Decide before the network whether the cached row is still clean, so a
    // clean file costs no download. The check runs again inside the lock on
    // fresh rows. REQUIREMENTS 4.15.
    const cleanBefore = isCleanRow(await readSlots(logicalName), entry);
    const writesBefore = writeCount(logicalName);
    const remote = cleanBefore || entry === null ? null : await deps.drive.readFile(entry.id);
    // The two halves of a read are taken in sequence, so a write from another
    // device between them can return old bytes under the marker of new
    // content. The merge would then treat content this device never read as
    // the remote state. The size the metadata reports is what the bytes must
    // match, and the catalog row listed before the read must still carry the
    // marker the read reports. REQUIREMENTS 4.6, 4.8, 4.16.
    if (remote !== null && (!readIsPaired(remote) || !readMatchesCatalog(entry, remote))) {
      throw stalePairError(logicalName);
    }

    return withLocal(logicalName, async (): Promise<LoadedDoc> => {
      // A local save landed while this load read Drive. That save is newer
      // than anything in the remote view, so the view is dropped and the
      // current local state is returned untouched. REQUIREMENTS 4.4.
      if (writeCount(logicalName) !== writesBefore) {
        const current = docs.get(logicalName);
        return current ?? (await restoreLocal(logicalName, family));
      }

      await dropVanished(logicalName, catalog, survivor);
      const slots = await readSlots(logicalName);

      // Step 6: clean cached row, unchanged marker, no pending delta.
      const cached = slots.cached;
      if (cached !== null && isCleanRow(slots, entry)) {
        const parsed = parseDoc(logicalName, family, cached.contentText);
        const loaded: LoadedDoc = {
          logicalName,
          family,
          doc: parsed.doc,
          workingText: cached.contentText,
          baseText: cached.contentText,
          driveFileId: cached.driveFileId,
          remoteEtag: cached.remoteEtag,
          schemaVersion: parsed.schemaVersion,
          pending: null
        };
        return remember(loaded);
      }

      // Step 7: the file changed or is missing, so use the content read
      // above. Only a file with no pending delta is cached, because a local
      // edit must not be overwritten by the remote view. REQUIREMENTS 4.4.
      if (entry !== null) {
        const loaded = remember(
          restoreFrom(
            logicalName,
            family,
            slots,
            remote === null ? null : decodeUtf8(remote.bytes),
            remote === null ? null : remote.meta
          )
        );
        if (loaded.pending === null) {
          await deps.store.setMany([
            {
              name: cacheKey(logicalName),
              value: makeCachedRecord(
                logicalName,
                loaded.driveFileId,
                loaded.remoteEtag,
                loaded.workingText,
                loaded.schemaVersion,
                new Date().toISOString()
              )
            },
            { name: baseKey(logicalName), value: makeBaseRecord(loaded.baseText ?? '', loaded.driveFileId) }
          ]);
        }
        return loaded;
      }

      // No remote file and no local row: there is nothing to load.
      if (slots.cached === null && slots.base === null && slots.pending === null) {
        throw new AppError(
          'invalid_document',
          { reason: 'nothing_to_load' },
          'This logical file exists neither on Drive nor in local storage.'
        );
      }
      return remember(restoreFrom(logicalName, family, slots, null, null));
    });
  }

  /**
   * Rebuild the in-memory document from the local slots and the remote read.
   *
   * With no pending delta the remote text, or the cached text when no remote
   * exists, is the working text. With a pending delta the working text is
   * the local text from the working row, or the delta replayed onto the base.
   * A remote read never overwrites unsynchronized local content.
   * REQUIREMENTS 4.4, 4.15.
   */
  function restoreFrom(
    logicalName: string,
    family: MergeFamily,
    slots: RecordSet,
    remoteText: string | null,
    remoteMeta: DriveFileMeta | null
  ): LoadedDoc {
    const driveFileId =
      remoteMeta !== null
        ? remoteMeta.id
        : slots.cached !== null
          ? slots.cached.driveFileId
          : slots.base !== null
            ? slots.base.driveFileId
            : null;
    const remoteEtag =
      remoteMeta !== null
        ? remoteMarker(remoteMeta)
        : slots.cached !== null
          ? slots.cached.remoteEtag
          : null;

    if (slots.pending === null) {
      const text = remoteText !== null ? remoteText : slots.cached !== null ? slots.cached.contentText : '';
      const parsed = parseDoc(logicalName, family, text);
      return {
        logicalName,
        family,
        doc: parsed.doc,
        workingText: text,
        baseText: text,
        driveFileId,
        remoteEtag,
        schemaVersion: parsed.schemaVersion,
        pending: null
      };
    }

    // A pending delta exists. Restore the local document it describes.
    const baseText = slots.base === null ? null : slots.base.contentText;
    const baseDoc = baseText === null ? undefined : parseDoc(logicalName, family, baseText).doc;
    if (!isPendingDelta(slots.pending.delta)) {
      throw new AppError(
        'storage',
        { reason: 'pending_envelope_unknown' },
        'The stored pending record has no readable delta envelope.'
      );
    }
    const envelope: PendingDelta = slots.pending.delta;
    const localText =
      slots.cached !== null && slots.cached.contentText.length > 0
        ? slots.cached.contentText
        : JSON.stringify(
            applyPendingDelta(
              baseDoc,
              slots.pending,
              (base: unknown, delta: unknown): unknown => applyDelta(base, delta),
              (value: unknown): unknown => clone(value)
            )
          );
    const parsed = parseDoc(logicalName, family, localText);
    return {
      logicalName,
      family,
      doc: parsed.doc,
      workingText: localText,
      baseText,
      driveFileId,
      remoteEtag,
      schemaVersion: parsed.schemaVersion,
      pending: envelope
    };
  }

  /** Store one loaded document and return it. */
  function remember(loaded: LoadedDoc): LoadedDoc {
    docs.set(loaded.logicalName, loaded);
    return loaded;
  }

  /** Increment the preferences revision and stamp the update time. */
  function bumpPreferences(candidate: unknown): unknown {
    const doc = clone(candidate) as { revision?: number; updatedAtUtc?: string };
    doc.revision = (typeof doc.revision === 'number' ? doc.revision : 0) + 1;
    doc.updatedAtUtc = new Date().toISOString();
    return doc;
  }

  /**
   * One upload attempt. Steps 8 through 14.
   *
   * Reads the latest remote content, merges when it differs from the base,
   * validates the candidate twice, rechecks Drive metadata, writes, and
   * reads back. Throws on any failure so the caller can retry.
   */
  async function attemptOnce(
    logicalName: string,
    family: MergeFamily,
    loaded: LoadedDoc
  ): Promise<{ text: string; meta: DriveFileMeta }> {
    const catalog = (await loadCatalog(logicalName)).catalog;
    const entry = catalogEntry(catalog, logicalName);
    const remote = entry === null ? null : await deps.drive.readFile(entry.id);
    // The preflight read is the one the merge is built from, so its two halves
    // must describe one remote state. A write from another device between the
    // media request and the metadata request makes them disagree, and the
    // merge would then run against content this device never read while the
    // marker says it read the newest. The size the metadata reports is what
    // the bytes must match, and the catalog row listed before the read must
    // still carry the marker the read reports.
    // REQUIREMENTS 4.6, 4.8, 4.16.
    if (remote !== null && (!readIsPaired(remote) || !readMatchesCatalog(entry, remote))) {
      throw stalePairError(logicalName);
    }
    const remoteText = remote === null ? null : decodeUtf8(remote.bytes);
    const remoteMeta = remote === null ? null : remote.meta;

    const baseText = loaded.baseText;
    const baseDoc = baseText === null ? undefined : parseDoc(logicalName, family, baseText).doc;
    const localDoc = parseDoc(logicalName, family, loaded.workingText).doc;

    // Steps 8 and 9: merge only when the remote differs from the base. With
    // no base at all the merge takes the local document whole, which is the
    // documented rule for two devices that never shared a baseline.
    let candidate: unknown = localDoc;
    if (remoteText !== null && !sameJson(remoteText, baseText ?? '')) {
      const remoteDoc = parseDoc(logicalName, family, remoteText).doc;
      const merged = mergeDocuments({
        family,
        base: baseDoc,
        local: localDoc,
        remote: remoteDoc
      });
      // The merge found no local delta, so the remote text is the answer and
      // no write is needed. Settling the pending row is still the caller's job.
      if (!merged.needsUpload) {
        return { text: remoteText, meta: remoteMeta ?? requireTarget(entry) };
      }
      candidate = merged.merged;
    }

    // The preferences family stamps its revision on the upload candidate.
    if (family === 'repjot/preferences') {
      candidate = bumpPreferences(candidate);
    }

    // Steps 10 and 11: validate, serialize, parse, and validate again. The
    // second pass proves the bytes that go on the wire are bytes this build
    // accepts.
    const text = JSON.stringify(parseDoc(logicalName, family, JSON.stringify(candidate)).doc);

    // Step 12: recheck Drive metadata immediately before the upload. Any
    // change since the preflight read restarts the attempt, because this
    // attempt has not read the file it would now write to. A file that
    // appeared was never read, so writing to it would drop its content.
    // A file that vanished leaves no target. REQUIREMENTS 4.6, 4.8, 4.9.
    const fresh = catalogEntry((await loadCatalog(logicalName)).catalog, logicalName);
    const appeared = remoteMeta === null && fresh !== null;
    const vanished = remoteMeta !== null && fresh === null;
    const changedMarker =
      remoteMeta !== null && fresh !== null && remoteMarker(fresh) !== remoteMarker(remoteMeta);
    if (appeared || vanished || changedMarker) {
      throw new AppError(
        'network',
        { reason: 'remote_changed_before_upload' },
        'Drive changed between the preflight read and the upload.'
      );
    }

    // Drive already holds exactly the bytes this attempt would write. That is
    // how a lost response after a committed write shows up, so settle it from
    // the read instead of writing again. REQUIREMENTS 4.18, ARCHITECTURE 15.
    if (fresh !== null && remoteText !== null && remoteText === text) {
      return { text, meta: fresh };
    }

    // Step 13: update the retained file, or create the missing one. A lost
    // response after this point is `ambiguous_upload`, because the write may
    // have committed even though the answer never arrived.
    const targetId = fresh !== null ? fresh.id : remoteMeta === null ? null : remoteMeta.id;
    let written: DriveFileMeta;
    try {
      written =
        targetId === null
          ? await deps.drive.createFile(logicalName, text)
          : await deps.drive.updateFile(targetId, text);
    } catch (error: unknown) {
      // The adapter's own kind is a definite answer, so it crosses this
      // boundary unchanged. Only a request that got no answer at all is
      // ambiguous, and the adapter already distinguishes that case by
      // carrying no HTTP status. ARCHITECTURE §15.
      if (error instanceof AppError && !isResponseLost(error)) throw error;
      if (error instanceof AppError && error.kind === 'ambiguous_upload') throw error;
      throw new AppError(
        'ambiguous_upload',
        { reason: 'response_lost' },
        'The upload answer never arrived. The write may have committed.'
      );
    }

    // Step 14: read the bytes back and compare exactly.
    const readBack = await deps.drive.readFile(written.id);
    if (decodeUtf8(readBack.bytes) !== text) {
      throw new AppError(
        'network',
        { reason: 'read_back_mismatch' },
        'The content read back from Drive differs from what was written.'
      );
    }

    return { text, meta: written };
  }

  /** A write needs a target file. Guard for the no-target case. */
  function requireTarget(entry: DriveFileMeta | null): DriveFileMeta {
    if (entry === null) {
      throw new AppError('network', { reason: 'no_target_file' }, 'No Drive file to write.');
    }
    return entry;
  }

  /**
   * Commit content Drive confirmed, under the local lock. REQUIREMENTS 3.14.
   *
   * When this device made no local edit while the upload ran, the confirmed
   * content becomes working, base, and remote state, and the pending row
   * clears.
   *
   * When it did, the newer edits are reapplied onto the confirmed content
   * by the conflict-unit merge. The older working document is never kept
   * as-is: it holds none of the remote entries the merge just brought in,
   * so keeping it would turn every remote addition into a local deletion.
   * REQUIREMENTS 4.4, 4.8, 4.9.
   */
  async function commitConfirmed(
    logicalName: string,
    family: MergeFamily,
    confirmed: { text: string; meta: DriveFileMeta },
    attempt: number,
    localTextAtUpload: string
  ): Promise<'committed' | 'superseded'> {
    return withLocal(logicalName, async (): Promise<'committed' | 'superseded'> => {
      const confirmedDoc = parseDoc(logicalName, family, confirmed.text);
      const uploadDoc = parseDoc(logicalName, family, localTextAtUpload);
      const current = docs.get(logicalName) ?? (await restoreLocal(logicalName, family));
      const nowIso = new Date().toISOString();

      const currentDoc =
        current.workingText === localTextAtUpload
          ? uploadDoc
          : parseDoc(logicalName, family, current.workingText);

      let workingText = confirmed.text;
      let workingDoc = confirmedDoc;
      let pending: PendingDelta | null = null;

      if (!sameJson(current.workingText, localTextAtUpload)) {
        // Reapply this device's edits onto the confirmed content through the
        // conflict-unit merge. The base is the text this upload started
        // with, the local side is this device's newer text, and the remote
        // side is the confirmed content. A session this device touched is
        // then replaced with its complete local version, never field-merged
        // with the remote version, and entries only the remote side holds
        // stay. REQUIREMENTS 4.7, 4.8, 4.11.
        const rebased = mergeDocuments({
          family,
          base: uploadDoc.doc,
          local: currentDoc.doc,
          remote: confirmedDoc.doc
        });
        if (rebased.needsUpload) {
          // Validate the result before any row changes hands. A result this
          // build rejects leaves the stored records as they were.
          const rebasedDoc = parseDoc(
            logicalName,
            family,
            JSON.stringify(rebased.merged)
          );
          pending = computePendingDelta(confirmedDoc.doc, rebasedDoc.doc, (
            base: unknown,
            local: unknown
          ): unknown => patcher.diff(base, local));
          if (pending !== null) {
            workingText = JSON.stringify(rebasedDoc.doc);
            workingDoc = rebasedDoc;
          }
        }
      }

      await deps.store.setMany([
        {
          name: cacheKey(logicalName),
          value: makeCachedRecord(
            logicalName,
            confirmed.meta.id,
            remoteMarker(confirmed.meta),
            workingText,
            workingDoc.schemaVersion,
            nowIso
          )
        },
        { name: baseKey(logicalName), value: makeBaseRecord(confirmed.text, confirmed.meta.id) },
        { name: pendingKey(logicalName), value: pending === null ? null : makePendingRecord(pending, nowIso) }
      ]);
      countLocalWrite(logicalName);

      remember({
        logicalName,
        family,
        doc: workingDoc.doc,
        workingText,
        baseText: confirmed.text,
        driveFileId: confirmed.meta.id,
        remoteEtag: remoteMarker(confirmed.meta),
        schemaVersion: workingDoc.schemaVersion,
        pending
      });

      logDiagnostic({
        severity: 'info',
        code: pending === null ? 'sync_committed' : 'sync_base_advanced',
        context: { logicalName, attempt }
      });
      return pending === null ? 'committed' : 'superseded';
    });
  }

  /**
   * Reconcile one logical file. Steps 1 through 15 with the retry loop.
   *
   * Three attempts, each with a fresh read of Drive. After the third failure
   * the coordinator sets `sync_failed` and keeps the pending delta.
   * REQUIREMENTS 4.19, 4.20.
   */
  async function reconcileOne(logicalName: string): Promise<void> {
    const family = familyFor(logicalName);
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= MAX_UPLOAD_ATTEMPTS; attempt += 1) {
      try {
        // A fresh load each attempt. The load lists the catalog, drops rows
        // whose file vanished, and downloads a file that is changed, missing,
        // or pending. REQUIREMENTS 4.19.
        const loaded = await loadDoc(logicalName);

        // Nothing pending and no local delta: step 6 reuse, no upload.
        if (loaded.pending === null) {
          return;
        }

        const confirmed = await attemptOnce(logicalName, family, loaded);

        // Step 15: commit the confirmed content. A newer local edit that
        // landed while this upload was in flight keeps its own working text
        // and its own pending delta, and its own reconciliation carries it
        // to Drive. The commit never rolls a newer edit back.
        // REQUIREMENTS 4.4, 4.5.
        await commitConfirmed(logicalName, family, confirmed, attempt, loaded.workingText);
        // A successful reconciliation supersedes an earlier failure for this
        // file. The newest edit is durable and its pending delta has either
        // committed or remains represented by a newer queued reconciliation.
        // Another file's unresolved failure still shows, because the badge is
        // one value over every file this account holds.
        failedFiles.delete(logicalName);
        setSaveStatus(settledStatus());
        return;
      } catch (error: unknown) {
        lastError = error;
        const classified = classifyAttempt(error);
        logDiagnostic({
          severity: classified.retryable ? 'warn' : 'error',
          code: 'sync_attempt_failed',
          context: {
            logicalName,
            attempt,
            errorKind: classified.kind,
            retryable: classified.retryable ? 1 : 0
          }
        });
        if (!classified.retryable) break;
        // Drop the in-memory copy so the next attempt rebuilds from a fresh
        // read of Drive. The drop runs under the local lock, because that
        // lock owns the map. REQUIREMENTS 4.19.
        await withLocal(logicalName, async (): Promise<void> => {
          docs.delete(logicalName);
        });
        if (attempt < MAX_UPLOAD_ATTEMPTS) await waitBeforeRetry(attempt);
      }
    }

    failedFiles.add(logicalName);
    setSaveStatus('sync_failed');
    throw lastError instanceof Error
      ? lastError
      : new AppError('network', { reason: 'sync_failed' }, 'Synchronization failed.');
  }

  /**
   * The save path. Local write first, then reconciliation.
   *
   * The read-modify-write half runs under the local lock, which holds no
   * network call. Two edits to one file that both read the same base and
   * then both wrote would lose the first, so the whole read-modify-write
   * must be atomic, not just the upload. Because the local lock stays free
   * of Drive, a stalled upload cannot stop the next edit from becoming
   * durable. REQUIREMENTS 4.1, 4.16.
   */
  async function edit(logicalName: string, mutate: (doc: unknown) => unknown): Promise<EditHandle> {
    const family = familyFor(logicalName);

    setSaveStatus('saving');

    // The save path reads local state only: the in-memory document, the
    // local rows, or the family empty document. No network call sits inside
    // the local lock, so a stalled Drive cannot delay durability, and a
    // first save of a brand-new shard lands offline. A failure here is a
    // local-layer failure: the edit never became durable, so the badge must
    // not stay at `saving`, and it must not read as a sync failure either.
    // The caller sees the thrown error. REQUIREMENTS 4.1, 4.3, 4.4.
    try {
      await withLocal(logicalName, async (): Promise<unknown> => {
        const loaded = docs.get(logicalName) ?? (await restoreLocal(logicalName, family));

        const localDoc = mutate(clone(loaded.doc));
        const localText = JSON.stringify(localDoc);
        // Validate the edited document before it is stored. A rejected edit
        // leaves the previous three records untouched.
        const validated = parseDoc(logicalName, family, localText);
        const validatedText = JSON.stringify(validated.doc);

        const baseDoc =
          loaded.baseText === null
            ? undefined
            : parseDoc(logicalName, family, loaded.baseText).doc;
        const pending: PendingDelta | null = computePendingDelta(
          baseDoc,
          validated.doc,
          (base: unknown, local: unknown): unknown => patcher.diff(base, local)
        );
        const nowIso = new Date().toISOString();

        // The base slot holds only content a successful synchronization put
        // there. With no base, this device has no shared baseline, so the row
        // stays absent and the pending `replace` envelope carries the whole
        // local document. Back-filling the base with the local text would
        // make the local edit and the base identical, and the merge would
        // then report "no local change" and commit the remote text instead.
        // REQUIREMENTS 4.5.
        const entries: Array<LocalStoreEntry> = [
          {
            name: cacheKey(logicalName),
            value: makeCachedRecord(
              logicalName,
              loaded.driveFileId,
              loaded.remoteEtag,
              validatedText,
              validated.schemaVersion,
              nowIso
            )
          }
        ];
        if (loaded.baseText !== null) {
          entries.push({
            name: baseKey(logicalName),
            value: makeBaseRecord(loaded.baseText, loaded.driveFileId)
          });
        }
        entries.push({
          name: pendingKey(logicalName),
          value: pending === null ? null : makePendingRecord(pending, nowIso)
        });

        await deps.store.setMany(entries);
        // Record the write, so a load that is still on the network learns
        // that its remote view went stale. REQUIREMENTS 4.4.
        countLocalWrite(logicalName);

        return remember({
          ...loaded,
          doc: validated.doc,
          workingText: validatedText,
          baseText: loaded.baseText,
          schemaVersion: validated.schemaVersion,
          pending
        });
      });
    } catch (error: unknown) {
      // The local half failed, so the edit never became durable. The badge
      // must not stay at `saving` with no work in flight, and this file's own
      // failure must not read as `sync_failed`, which means the edit is safe
      // but unsynchronized. The fallback is `idle` for that reason. It is
      // still not the whole answer: another file can sit in `sync_failed`
      // with a pending delta on disk, and this failed write must not clear
      // that. The caller still sees the real error. REQUIREMENTS 4.3, 4.4.
      setSaveStatus(settledStatus('idle'));
      logDiagnostic({
        severity: 'error',
        code: 'local_edit_failed',
        context: {
          logicalName,
          errorKind: error instanceof AppError ? error.kind : 'storage'
        }
      });
      throw error;
    }

    // The local write is durable. The user's intent is safe from here on. The
    // badge reports the worst state any known file is in, so a save here does
    // not hide another file's unresolved failure. REQUIREMENTS 4.3, 4.20.
    setSaveStatus(settledStatus());

    // Drive synchronization has its own per-file quiet period. All edits in
    // that period share one reconciliation generation instead of adding one
    // complete preflight/upload/read-back cycle per field.
    const synced = scheduleSync(logicalName);

    return { localDurable: true, synced };
  }

  /**
   * Rebuild one logical file from the local rows alone. No network.
   *
   * The save path calls this when the in-memory copy is gone, so a device
   * with no connection still writes the edit to local storage first. The
   * reconciliation that follows reads Drive and merges against whatever it
   * finds there. REQUIREMENTS 4.1, 4.4.
   *
   * The caller holds the local lock. This function reads rows and returns a
   * value. It writes nothing, so it cannot fight the caller's own write.
   */
  async function restoreLocal(logicalName: string, family: MergeFamily): Promise<LoadedDoc> {
    const slots = await readSlots(logicalName);

    if (slots.cached === null && slots.base === null && slots.pending === null) {
      // A brand-new logical file. The first workout of a new month names a
      // shard that exists neither on Drive nor in local storage, so the
      // save path starts from the family's empty document. Throwing here
      // would block the first save of every new file. REQUIREMENTS 4.1.
      return emptyLoaded(logicalName, family);
    }
    return restoreFrom(logicalName, family, slots, null, null);
  }

  /** Names with in-memory state or a local row, sorted. */
  async function listKnownNames(): Promise<string[]> {
    const names = new Set<string>(docs.keys());
    for (const prefix of ['doc:', 'base:', 'pending:']) {
      for (const key of await deps.store.listKeys(prefix)) {
        const name = key.slice(prefix.length);
        if (name.length > 0) names.add(name);
      }
    }
    return Array.from(names).sort();
  }

  /**
   * Reconcile every logical file this account knows about.
   *
   * The set comes from the local rows, which is what survives a reload.
   * Unrecognized Drive names never enter it. One file's failure does not stop
   * the others; the status reports the failure at the end. REQUIREMENTS 4.15.
   */
  async function syncAll(): Promise<void> {
    await flushLocal();
    const names = await listKnownNames();
    let failed = false;
    for (const name of names) {
      try {
        if (
          syncHandles.has(name) ||
          syncMaxHandles.has(name) ||
          syncRunning.has(name) ||
          syncWaiters.has(name)
        ) {
          await flushScheduledSync(name);
        } else {
          await withSync(name, async (): Promise<void> => {
            await reconcileOne(name);
          });
        }
      } catch {
        failed = true;
      }
    }
    if (!failed && names.length > 0) setSaveStatus(settledStatus());
  }

  /**
   * Wait for every reconciliation this coordinator started.
   *
   * Failures are swallowed, because the caller is draining, not reporting.
   * The loop repeats while new work appears, so work a drained edit starts
   * is waited out too.
   */
  async function drainInFlight(): Promise<void> {
    for (;;) {
      // Examine network work and local writes together, and examine them
      // again after each wait. A local write that finishes during the drain
      // starts its own reconciliation, and that work must be drained too,
      // or reset could clear a lock that an upload still owns.
      // REQUIREMENTS 4.4, 4.16.
      const network = Array.from(inFlight);
      const local = Array.from(localLock.values());
      if (network.length === 0 && local.length === 0) return;
      await Promise.all(
        network
          .concat(local)
          .map((p: Promise<void>): Promise<unknown> => p.catch((error: unknown): unknown => error))
      );
    }
  }

  /** Flush queued edits through IndexedDB only. */
  async function flushLocal(): Promise<void> {
    await queue.flush();
  }

  /** Flush local edits, start delayed synchronizations, and drain the network. */
  async function flush(): Promise<void> {
    await flushLocal();
    const names = new Set<string>([
      ...Array.from(syncHandles.keys()),
      ...Array.from(syncMaxHandles.keys()),
      ...Array.from(syncRunning.keys()),
      ...Array.from(syncWaiters.keys())
    ]);
    await Promise.all(
      Array.from(names).map(
        (logicalName: string): Promise<void> => flushScheduledSync(logicalName)
      )
    );
    await drainInFlight();
  }

  /**
   * Forget in-memory state. The local rows stay.
   *
   * The queue flushes first, then every started reconciliation is drained.
   * A reset that cleared the locks while an upload still owned one would
   * let a later edit start beside it, and the older upload would then write
   * over the newer content. Draining closes that window. A reset that
   * cannot flush rejects instead of dropping the edit. The `pagehide`
   * flush is re-registered, so a coordinator reused after sign-out still
   * flushes. REQUIREMENTS 4.2, 4.4, 4.5.
   */
  async function reset(): Promise<void> {
    await flush();
    const timerNames = new Set<string>([
      ...Array.from(syncHandles.keys()),
      ...Array.from(syncMaxHandles.keys())
    ]);
    for (const logicalName of timerNames) cancelSyncTimer(logicalName);
    docs.clear();
    localLock.clear();
    syncLock.clear();
    failedFiles.clear();
    inFlight.clear();
    syncGeneration.clear();
    syncMaxHandles.clear();
    syncRunning.clear();
    syncWaiters.clear();
    detachPagehide();
    registerPagehide();
  }

  /** Register the `pagehide` flush on the current target. */
  function registerPagehide(): void {
    detachPagehide = flushOnPagehide(
      deps.pagehideTarget === undefined ? pageTarget() : deps.pagehideTarget,
      flushLocal
    );
  }

  // Register the `pagehide` flush now, so a screen that forgets to wire it
  // still flushes. REQUIREMENTS 4.2.
  registerPagehide();

  return {
    // A load takes the sync lock, so it cannot land beside a reconciliation
    // of the same file and replace newer local rows with an older remote
    // view. REQUIREMENTS 4.4.
    ensureLoaded: async (logicalName: string): Promise<unknown> =>
      (await withSync(logicalName, async (): Promise<LoadedDoc> => await loadDoc(logicalName))).doc,
    edit,
    queueEdit: (logicalName: string, mutate: (doc: unknown) => unknown): void => {
      setSaveStatus('saving');
      queue.schedule(logicalName, mutate);
    },
    syncAll,
    pendingEdits: async (): Promise<string[]> => {
      const names: string[] = [];
      for (const key of await deps.store.listKeys('pending:')) {
        const name = key.slice('pending:'.length);
        if (name.length === 0) continue;
        // A cleared delta is written as a null row, not removed, so the key
        // alone does not mean work is waiting. Only a row that still holds a
        // record counts. REQUIREMENTS 4.4.
        const row: unknown = await deps.store.get(key);
        if (row !== null && row !== undefined) names.push(name);
      }
      return names.sort();
    },
    flushLocal,
    flush,
    reset,
    peek: (logicalName: string): unknown => {
      const loaded = docs.get(logicalName);
      return loaded === undefined ? undefined : loaded.doc;
    }
  };
}
