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
import { AppError, type AppErrorKind } from '../domain/errors';
import type { ResultsShard } from '../domain/types';
import { shardName } from '../domain/time';
import type { LoadedStaticData } from '../documents/static-loader';
import { processDocument, type SemanticStage } from '../documents/document-pipeline';
import type { DriveAdapter, DriveFileMeta } from '../drive/drive-interface';
import { setSaveStatus } from '../state/app-state';
import { baseKey, cacheKey, pendingKey, type LocalStore, type LocalStoreEntry } from '../storage/local-store';
import { highestSupportedVersion, type DocFamily } from '../validation/schema-validator';
import { validatePreferences, validateShard } from '../validation/semantic-validator';
import { mergeDocuments, type MergeFamily } from './merge-documents';
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
  type EditQueue,
  type EventTargetLike,
  type TimerSet
} from './debounce';

/** Upload attempts before the coordinator gives up and reports `sync_failed`. */
export const MAX_UPLOAD_ATTEMPTS = 3;

/** The preferences logical file name. */
export const PREFERENCES_NAME = 'preferences.json';

/**
 * The Phase 11 consolidation seam.
 *
 * ARCHITECTURE section 11 step 3 consolidates duplicate Drive names before
 * any normal write. Phase 11 owns that module. The coordinator hands the
 * hook the catalog it just listed and works from whatever the hook returns,
 * so Phase 11 wires in without a change here. The default returns the
 * catalog untouched, which is correct while no duplicate exists.
 */
export type ConsolidateHook = (catalog: DriveFileMeta[]) => Promise<DriveFileMeta[]>;

/** The default hook: no consolidation. */
const noConsolidation: ConsolidateHook = async (
  catalog: DriveFileMeta[]
): Promise<DriveFileMeta[]> => catalog;

/** Everything the coordinator needs. */
export interface SyncDeps {
  /** Local key-value store for this account. */
  store: LocalStore;
  /** Drive adapter for this account. */
  drive: DriveAdapter;
  /** Validated static bundle, for the semantic stage. */
  staticData: LoadedStaticData;
  /** Account namespace key. Scopes the mutex and the store. */
  accountKey: string;
  /** Duplicate-name consolidation. Phase 11 supplies this. */
  consolidate?: ConsolidateHook;
  /** Quiet period for `queueEdit`. */
  debounceMs?: number;
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
  /** Flush pending local edits. Called on pagehide. */
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
 * `preferences.json` is the preferences family and `results-YYYY-MM.json` is
 * the results family. Any other name is not a REP JOT logical file, so the
 * coordinator refuses it instead of guessing a family for it.
 */
function familyFor(logicalName: string): MergeFamily {
  if (logicalName === PREFERENCES_NAME) return 'repjot/preferences';
  if (/^results-\d{4}-\d{2}\.json$/.test(logicalName)) return 'repjot/results';
  throw new AppError(
    'invalid_document',
    { reason: 'unrecognized_logical_name' },
    'This file name is not a REP JOT logical file.'
  );
}

/** True when `catalog` holds this stable Drive file ID. */
function catalogHas(catalog: DriveFileMeta[], id: string): boolean {
  return catalog.some((meta: DriveFileMeta): boolean => meta.id === id);
}

/** The catalog entry for one logical name. Phase 10 assumes at most one. */
function catalogEntry(catalog: DriveFileMeta[], logicalName: string): DriveFileMeta | null {
  for (const meta of catalog) {
    if (meta.name === logicalName) return meta;
  }
  return null;
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
      error.kind === 'storage'
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
 * The coordinator holds two maps, the in-memory documents and the per-file
 * mutex, plus the debounced edit queue. Nothing crosses an account boundary,
 * because `accountKey` scopes every mutex key and the store is already
 * per-account.
 */
export function createCoordinator(deps: SyncDeps): Coordinator {
  const consolidate = deps.consolidate === undefined ? noConsolidation : deps.consolidate;
  const semantic = (logicalName: string): SemanticStage => (doc: unknown, family: DocFamily): void => {
    if (family === 'repjot/results') {
      const report = validateShard(doc as ResultsShard, deps.staticData, { fileName: logicalName });
      if (report.issues.length > 0) {
        throw new AppError(
          'semantic_reference',
          { reason: 'semantic_invalid', code: report.issues[0].code },
          'The document failed semantic validation.'
        );
      }
      return;
    }
    if (family === 'repjot/preferences') {
      const units = (doc as { exerciseUnits?: Record<string, Record<string, string>> }).exerciseUnits;
      const report = validatePreferences({ exerciseUnits: units ?? {} }, deps.staticData.exercises);
      if (report.issues.length > 0) {
        throw new AppError(
          'semantic_reference',
          { reason: 'semantic_invalid', code: report.issues[0].code },
          'The preferences document failed semantic validation.'
        );
      }
    }
  };

  /** In-memory working documents by logical name. */
  const docs = new Map<string, LoadedDoc>();

  /**
   * The mutex, one entry per `(accountKey, logicalName)`.
   *
   * Two reconciliations of one file must not overlap: both would read the
   * base, merge, and write the same three records. The mutex serializes
   * them. REQUIREMENTS 4.16.
   */
  const mutex = new Map<string, Promise<void>>();
  const mutexKey = (logicalName: string): string => `${deps.accountKey} ${logicalName}`;

  /** Reconciliations started and not finished, so `flush` can await them. */
  const inFlight = new Map<string, Promise<void>>();

  /** Detach for the `pagehide` listener registered at the bottom. */
  let detachPagehide: () => void = () => undefined;

  /** Debounced edit queue. Normal typing lands here. */
  const queue: EditQueue = debouncedEdit(
    async (logicalName: string, mutate: (doc: unknown) => unknown): Promise<void> => {
      const handle = await edit(logicalName, mutate);
      await handle.synced;
    },
    { delayMs: deps.debounceMs, timers: deps.timers }
  );

  /**
   * Run `task` after the previous task for this logical file settles.
   *
   * The map keeps a never-rejecting tail, so one failed reconciliation
   * cannot wedge the file forever, while the caller still sees the real
   * result.
   */
  async function withMutex<T>(logicalName: string, task: () => Promise<T>): Promise<T> {
    const key = mutexKey(logicalName);
    const previous = mutex.get(key) ?? Promise.resolve();
    const result = previous.then(task, task);
    const tail = result.then(
      () => undefined,
      () => undefined
    );
    mutex.set(key, tail);
    void tail.then(() => {
      if (mutex.get(key) === tail) mutex.delete(key);
    });
    return result;
  }

  /** Read the three local slots for one logical file. */
  function readSlots(logicalName: string): Promise<RecordSet> {
    return readRecords(deps.store, logicalName);
  }

  /** List the catalog and run the consolidation hook over it. */
  async function loadCatalog(logicalName: string): Promise<DriveFileMeta[]> {
    const catalog = await deps.drive.listCatalog();
    const after = await consolidate(catalog);
    void logicalName;
    return after;
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
   */
  async function dropVanished(logicalName: string, catalog: DriveFileMeta[]): Promise<void> {
    const slots = await readSlots(logicalName);
    const dropped: string[] = [];
    if (slots.cached !== null && slots.cached.driveFileId !== null && !catalogHas(catalog, slots.cached.driveFileId)) {
      await deps.store.delete(cacheKey(logicalName));
      dropped.push('cached');
    }
    const keepBase = slots.pending !== null;
    if (
      !keepBase &&
      slots.base !== null &&
      slots.base.driveFileId !== null &&
      !catalogHas(catalog, slots.base.driveFileId)
    ) {
      await deps.store.delete(baseKey(logicalName));
      dropped.push('base');
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
   * Load one logical file. Steps 2 through 7 of the reconciliation list.
   *
   * A clean cached row whose marker still matches the catalog needs no
   * download. A changed, missing, or pending file is downloaded and run
   * through the pipeline. REQUIREMENTS 4.15.
   */
  async function loadDoc(logicalName: string): Promise<LoadedDoc> {
    const family = familyFor(logicalName);
    const catalog = await loadCatalog(logicalName);
    await dropVanished(logicalName, catalog);
    const slots = await readSlots(logicalName);
    const entry = catalogEntry(catalog, logicalName);

    // Step 6: clean cached row, unchanged marker, no pending delta.
    if (
      slots.cached !== null &&
      slots.pending === null &&
      entry !== null &&
      remoteMarker(entry) === slots.cached.remoteEtag
    ) {
      const parsed = parseDoc(logicalName, family, slots.cached.contentText);
      const loaded: LoadedDoc = {
        logicalName,
        family,
        doc: parsed.doc,
        workingText: slots.cached.contentText,
        baseText: slots.cached.contentText,
        driveFileId: slots.cached.driveFileId,
        remoteEtag: slots.cached.remoteEtag,
        schemaVersion: parsed.schemaVersion,
        pending: null
      };
      docs.set(logicalName, loaded);
      return loaded;
    }

    // Step 7: download the changed or missing file.
    if (entry !== null) {
      const remote = await deps.drive.readFile(entry.id);
      const loaded = remember(
        restoreFrom(logicalName, family, slots, remote.text, remote.meta)
      );
      // Persist the read so the next load can reuse it. Only a file with no
      // pending delta is cached, because a local edit must not be overwritten
      // by the remote view. REQUIREMENTS 4.4.
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
    const catalog = await loadCatalog(logicalName);
    const entry = catalogEntry(catalog, logicalName);
    const remote = entry === null ? null : await deps.drive.readFile(entry.id);
    const remoteText = remote === null ? null : remote.text;
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

    // Step 12: recheck Drive metadata immediately before the upload.
    const fresh = catalogEntry(await loadCatalog(logicalName), logicalName);
    if (remoteMeta !== null && fresh !== null && remoteMarker(fresh) !== remoteMarker(remoteMeta)) {
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
    if (readBack.text !== text) {
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

        // Step 15: one transaction commits the confirmed content as both
        // working and base and clears the pending delta. REQUIREMENTS 3.14.
        const nowIso = new Date().toISOString();
        await deps.store.setMany([
          {
            name: cacheKey(logicalName),
            value: makeCachedRecord(
              logicalName,
              confirmed.meta.id,
              remoteMarker(confirmed.meta),
              confirmed.text,
              parseDoc(logicalName, family, confirmed.text).schemaVersion,
              nowIso
            )
          },
          { name: baseKey(logicalName), value: makeBaseRecord(confirmed.text, confirmed.meta.id) },
          { name: pendingKey(logicalName), value: null }
        ]);

        const confirmedDoc = parseDoc(logicalName, family, confirmed.text);
        remember({
          logicalName,
          family,
          doc: confirmedDoc.doc,
          workingText: confirmed.text,
          baseText: confirmed.text,
          driveFileId: confirmed.meta.id,
          remoteEtag: remoteMarker(confirmed.meta),
          schemaVersion: confirmedDoc.schemaVersion,
          pending: null
        });

        logDiagnostic({
          severity: 'info',
          code: 'sync_committed',
          context: { logicalName, attempt }
        });
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
        // read of Drive. REQUIREMENTS 4.19.
        docs.delete(logicalName);
      }
    }

    setSaveStatus('sync_failed');
    throw lastError instanceof Error
      ? lastError
      : new AppError('network', { reason: 'sync_failed' }, 'Synchronization failed.');
  }

  /**
   * The save path. Local write first, then reconciliation.
   *
   * The read-modify-write half runs under the mutex. Two edits to one file
   * that both read the same base and then both wrote would lose the first,
   * so the whole read-modify-write must be atomic, not just the upload.
   * REQUIREMENTS 4.16.
   */
  async function edit(logicalName: string, mutate: (doc: unknown) => unknown): Promise<EditHandle> {
    const family = familyFor(logicalName);

    setSaveStatus('saving');

    // Phase one: read, modify, and write the three local records, under the
    // mutex, with no network call inside. A failure here is a local-layer
    // failure: the edit never became durable, so the badge must not stay at
    // `saving`, and it must not read as a sync failure either. The caller
    // sees the thrown error. REQUIREMENTS 4.3, 4.4.
    try {
      await withMutex(logicalName, async (): Promise<unknown> => {
        const loaded = docs.get(logicalName) ?? (await loadDocNoWrite(logicalName));

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
      // must not stay at `saving` with no work in flight, and a local
      // failure must not read as `sync_failed`, which means the edit is
      // safe but unsynchronized. The caller still sees the real error.
      // REQUIREMENTS 4.3, 4.4.
      setSaveStatus('idle');
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

    // The local write is durable. The user's intent is safe from here on.
    setSaveStatus('saved');

    const synced = withMutex(logicalName, async (): Promise<void> => {
      await reconcileOne(logicalName);
    });
    inFlight.set(logicalName, synced);
    const forget = (): void => {
      if (inFlight.get(logicalName) === synced) inFlight.delete(logicalName);
    };
    void synced.then(forget, forget);

    return { localDurable: true, synced };
  }

  /**
   * Load one logical file without the cache-write side effect.
   *
   * `edit` calls this inside the mutex, where the caller writes the records
   * itself. Caching inside that call would be a second write of the same
   * rows inside one critical section.
   */
  async function loadDocNoWrite(logicalName: string): Promise<LoadedDoc> {
    const family = familyFor(logicalName);
    const catalog = await loadCatalog(logicalName);
    await dropVanished(logicalName, catalog);
    const slots = await readSlots(logicalName);
    const entry = catalogEntry(catalog, logicalName);

    if (
      slots.cached !== null &&
      slots.pending === null &&
      entry !== null &&
      remoteMarker(entry) === slots.cached.remoteEtag
    ) {
      const parsed = parseDoc(logicalName, family, slots.cached.contentText);
      return {
        logicalName,
        family,
        doc: parsed.doc,
        workingText: slots.cached.contentText,
        baseText: slots.cached.contentText,
        driveFileId: slots.cached.driveFileId,
        remoteEtag: slots.cached.remoteEtag,
        schemaVersion: parsed.schemaVersion,
        pending: null
      };
    }

    if (entry !== null) {
      const remote = await deps.drive.readFile(entry.id);
      return restoreFrom(logicalName, family, slots, remote.text, remote.meta);
    }

    if (slots.cached === null && slots.base === null && slots.pending === null) {
      // A brand-new logical file. The first workout of a new month names a
      // shard that exists neither on Drive nor in local storage, so the
      // save path starts from the family's empty document. Throwing here
      // would block the first save of every new file. REQUIREMENTS 4.1.
      const emptyText = JSON.stringify(emptyDocumentFor(family, logicalName));
      const parsed = parseDoc(logicalName, family, emptyText);
      return {
        logicalName,
        family,
        doc: parsed.doc,
        workingText: emptyText,
        baseText: null,
        driveFileId: null,
        remoteEtag: null,
        schemaVersion: parsed.schemaVersion,
        pending: null
      };
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
    const names = await listKnownNames();
    let failed = false;
    for (const name of names) {
      try {
        await withMutex(name, async (): Promise<void> => {
          await reconcileOne(name);
        });
      } catch {
        failed = true;
      }
    }
    if (!failed && names.length > 0) setSaveStatus('saved');
  }

  /**
   * Flush queued edits and wait for the reconciliations already started.
   *
   * Called on `pagehide`. The local writes land inside `edit`; a network
   * failure is reported through `saveStatus` and swallowed here, because a
   * hidden page has no caller to report it to.
   */
  async function flush(): Promise<void> {
    await queue.flush();
    const pending = Array.from(inFlight.values());
    if (pending.length > 0) {
      await Promise.all(
        pending.map((p: Promise<void>): Promise<unknown> =>
          p.catch((error: unknown): unknown => error)
        )
      );
    }
  }

  /**
   * Forget in-memory state. The local rows stay.
   *
   * The queue flushes first, so every queued mutator reaches local storage
   * before the maps clear. A reset that cannot flush rejects instead of
   * dropping the edit. The `pagehide` flush is re-registered, so a
   * coordinator reused after sign-out still flushes. REQUIREMENTS 4.2, 4.4.
   */
  async function reset(): Promise<void> {
    await queue.flush();
    docs.clear();
    mutex.clear();
    inFlight.clear();
    detachPagehide();
    registerPagehide();
  }

  /** Register the `pagehide` flush on the current target. */
  function registerPagehide(): void {
    detachPagehide = flushOnPagehide(
      deps.pagehideTarget === undefined ? pageTarget() : deps.pagehideTarget,
      flush
    );
  }

  // Register the `pagehide` flush now, so a screen that forgets to wire it
  // still flushes. REQUIREMENTS 4.2.
  registerPagehide();

  return {
    ensureLoaded: async (logicalName: string): Promise<unknown> => (await loadDoc(logicalName)).doc,
    edit,
    queueEdit: (logicalName: string, mutate: (doc: unknown) => unknown): void => {
      queue.schedule(logicalName, mutate);
    },
    syncAll,
    flush,
    reset,
    peek: (logicalName: string): unknown => {
      const loaded = docs.get(logicalName);
      return loaded === undefined ? undefined : loaded.doc;
    }
  };
}
