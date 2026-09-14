// Duplicate Drive file consolidation.
// Phase 11. REQUIREMENTS 4.22 through 4.26, 22.2.10.
// ARCHITECTURE ADR-010, section 11 "Catalog and duplicate files".
// specs/storage-and-lookup.md "Duplicate file consolidation".
//
// Drive allows two files with the same name, so one logical REP JOT file can
// exist twice in the app-data folder. The client clears a duplicate recognized
// name automatically. It never ignores the group and never asks the person to
// choose a file.
//
// Two rules shape every path in this module.
//
// 1. Nothing is deleted before the primary provably holds the consolidated
//    data. The write, the read-back, and the comparison all come before the
//    first delete call. REQUIREMENTS 4.25, 4.26.
// 2. A group that cannot be consolidated safely is blocked, not guessed at.
//    The blocked outcome names the offending file so the `DataError` component
//    can show it, and this module writes nothing at all. REQUIREMENTS 4.23.
//
// The winner of a conflicting entry is chosen by the tuple
// `(updatedAtUtc, Drive file ID)`, greatest first. The rule gives cleanup a
// deterministic result when Drive holds no shared base document, which is the
// normal case here: two copies written by two devices that never shared a
// baseline. Normal synchronization still follows the last-synchronizer-wins
// rule in REQUIREMENTS 4.11; this tuple rule is only for duplicate cleanup.
// REQUIREMENTS 4.24.

import { logDiagnostic } from '../diagnostics/diagnostic-log';
import { AppError, isAppError } from '../domain/errors';
import { parseUtc } from '../domain/time';
import { processDocument } from '../documents/document-pipeline';
import { semanticStageFor } from '../documents/semantic-stage';
import type { LoadedStaticData } from '../documents/static-loader';
import type { DocFamily } from '../validation/schema-validator';
import type { DriveAdapter, DriveFileMeta } from '../drive/drive-interface';
import { clone } from './patcher';
import { remoteMarker } from './cache-records';
import { familyForName } from './recognized-names';

/** Why a group could not be consolidated. REQUIREMENTS 4.23, 4.26. */
export type BlockedReason =
  | 'corrupt_copy'
  | 'unsupported_version'
  | 'wrong_family'
  | 'changed_during_cleanup';

/** One recognized logical name that Drive holds more than once. */
export interface DuplicateGroup {
  /** The recognized file name every copy shares. */
  logicalName: string;
  /** Every copy, sorted by stable Drive file ID. Length 2 or more. */
  copies: DriveFileMeta[];
}

/**
 * The one file a consolidated group left behind, in the state the
 * consolidation confirmed.
 *
 * The marker and the content both come out of the write-and-read-back, so a
 * repointed local row describes the surviving file as it actually is. Carrying
 * the old row's marker across instead would let a later load mistake local text
 * for a clean copy of the primary.
 */
export interface RemainingFile {
  /** The surviving Drive file ID. */
  driveFileId: string;
  /** The remote marker read back from that file. */
  remoteEtag: string;
  /** The consolidated content the primary now holds. */
  contentText: string;
  /** Schema version that content declares. */
  schemaVersion: number;
}

/**
 * What one consolidation returned.
 *
 * `remainingId` carries the result of the relist in step 12. It is the single
 * surviving Drive file ID only when the relist found exactly one recognized
 * file under the group's name. A `null` means the caller must record nothing
 * locally, because the folder did not come down to one file. REQUIREMENTS 4.25.
 *
 * `primaryMeta` is the metadata the primary update returned, and `contentText`
 * is the bytes that write and read back carried. The caller uses them so a later
 * write in the same pass works from a confirmed marker rather than a stale one.
 */
export type ConsolidationOutcome =
  | {
      kind: 'consolidated';
      primaryId: string;
      primaryMeta: DriveFileMeta;
      contentText: string;
      schemaVersion: number;
      deletedIds: string[];
      remainingId: string | null;
    }
  | { kind: 'blocked'; reason: BlockedReason; fileId: string }
  | { kind: 'no_duplicates' };

/** A logical file a blocked group stops the client from writing. */
export interface BlockedLogicalFile {
  logicalName: string;
  reason: BlockedReason;
  /** The copy that made the group unsafe. */
  fileId: string;
}

/**
 * The catalog after consolidation, plus what the caller must know.
 *
 * `catalog` has every deleted copy removed and every surviving primary entry
 * replaced with the metadata the update returned, so a caller never aims a
 * later write at a file ID this module already deleted.
 *
 * `remaining` maps a consolidated logical name to its one surviving Drive file
 * ID. A name absent from the map means the relist did not prove a single file,
 * so nothing is recorded.
 */
export interface ConsolidateResult {
  catalog: DriveFileMeta[];
  blocked: BlockedLogicalFile[];
  remaining: Record<string, RemainingFile>;
}

/** Everything consolidation needs. */
export interface ConsolidateDeps {
  drive: DriveAdapter;
  staticData: LoadedStaticData;
}

/** The consolidation hook the coordinator runs over a freshly listed catalog. */
export type ConsolidateHook = (catalog: DriveFileMeta[]) => Promise<ConsolidateResult>;

/** One copy's content and the metadata read with it. */
interface CopyDoc {
  meta: DriveFileMeta;
  doc: Record<string, unknown>;
}

/** A candidate winner for one conflicting entry. */
interface Candidate {
  value: unknown;
  updatedAtUtc: unknown;
  fileId: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Compare two Drive file IDs. Stable and lexicographic. */
function compareIds(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * Compare two `(updatedAtUtc, Drive file ID)` tuples, greatest first.
 *
 * The time is compared as an instant, not as text. Two RFC 3339 stamps that
 * differ only by a fractional part compare wrong as text, because `'Z'` sorts
 * above `'.'`. A stamp that does not parse loses to one that does, so a broken
 * value never beats a good one, and two broken values still resolve by file ID.
 * REQUIREMENTS 4.24.
 */
function greaterTuple(candidate: Candidate, current: Candidate): boolean {
  const candidateTime = instantOf(candidate.updatedAtUtc);
  const currentTime = instantOf(current.updatedAtUtc);

  if (candidateTime !== null && currentTime !== null && candidateTime !== currentTime) {
    return candidateTime > currentTime;
  }
  if (candidateTime === null && currentTime !== null) return false;
  if (candidateTime !== null && currentTime === null) return true;
  return compareIds(candidate.fileId, current.fileId) > 0;
}

/** Milliseconds for an RFC 3339 stamp, or `null` when it does not parse. */
function instantOf(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  try {
    return parseUtc(value).getTime();
  } catch {
    return null;
  }
}

/**
 * Group every duplicate recognized name in the catalog.
 *
 * REQUIREMENTS 4.22 treats the whole set of same-named files as one group, so
 * three copies of `preferences.json` arrive as one group of three, never as
 * three pairs. Unknown names are left out: they are not REP JOT files and this
 * module never touches them.
 */
export function findDuplicateGroups(catalog: DriveFileMeta[]): DuplicateGroup[] {
  const byName = new Map<string, DriveFileMeta[]>();

  for (const meta of catalog) {
    if (familyForName(meta.name) === null) continue;
    const bucket = byName.get(meta.name);
    if (bucket === undefined) {
      byName.set(meta.name, [meta]);
    } else {
      bucket.push(meta);
    }
  }

  const groups: DuplicateGroup[] = [];
  for (const logicalName of Array.from(byName.keys()).sort()) {
    const copies = byName.get(logicalName);
    if (copies === undefined || copies.length < 2) continue;
    groups.push({ logicalName, copies: copies.slice().sort((a, b) => compareIds(a.id, b.id)) });
  }
  return groups;
}

/**
 * Every catalog name REP JOT does not recognize.
 *
 * Diagnostics only. An unknown file is never consolidated, rewritten, or
 * deleted, so the report exists to explain a folder the client did not make.
 */
export function findUnknownNames(catalog: DriveFileMeta[]): string[] {
  const names = new Set<string>();
  for (const meta of catalog) {
    if (familyForName(meta.name) === null) names.add(meta.name);
  }
  return Array.from(names).sort();
}

/**
 * Map a pipeline throw to a blocked reason.
 *
 * A document-level failure names a reason and blocks the group. Anything else
 * is a transport or storage fault the coordinator already retries, so it goes
 * back out unchanged rather than being reported as a corrupt file.
 */
function blockedReasonFor(error: unknown): BlockedReason | null {
  if (!isAppError(error)) return null;

  if (error.kind === 'unsupported_schema') return 'unsupported_version';
  if (error.kind === 'invalid_document') {
    return error.detail.reason === 'family' ? 'wrong_family' : 'corrupt_copy';
  }
  if (error.kind === 'semantic_reference' || error.kind === 'migration') return 'corrupt_copy';
  return null;
}

/**
 * Read one copy through the full pipeline.
 *
 * @returns The copy's document, or the blocked reason the pipeline reported.
 * @throws Anything the pipeline raised that is not a document verdict.
 */
async function loadCopy(
  drive: DriveAdapter,
  staticData: LoadedStaticData,
  family: DocFamily,
  logicalName: string,
  meta: DriveFileMeta
): Promise<CopyDoc | { blocked: BlockedReason }> {
  const read = await drive.readFile(meta.id);
  try {
    const processed = processDocument<Record<string, unknown>>(
      read.text,
      family,
      semanticStageFor(logicalName, staticData)
    );
    if (!isPlainObject(processed.document)) {
      return { blocked: 'corrupt_copy' };
    }
    return { meta, doc: processed.document };
  } catch (error: unknown) {
    const reason = blockedReasonFor(error);
    if (reason === null) throw error;
    return { blocked: reason };
  }
}

/** The timestamp one entry carries, falling back to its document's stamp. */
function entryUpdatedAt(entry: unknown, doc: Record<string, unknown>): unknown {
  if (isPlainObject(entry) && typeof entry.updatedAtUtc === 'string') {
    return entry.updatedAtUtc;
  }
  return doc.updatedAtUtc;
}

/**
 * Union the session maps of every copy.
 *
 * Different session IDs all survive. One ID present in more than one copy
 * resolves by the tuple rule, so the newest copy wins and an equal stamp
 * resolves by the greater Drive file ID. REQUIREMENTS 4.24.
 */
function mergeSessionMaps(copies: CopyDoc[]): Record<string, unknown> {
  const winners = new Map<string, Candidate>();

  for (const copy of copies) {
    const sessions = copy.doc.sessions;
    if (!isPlainObject(sessions)) continue;
    for (const sessionId of Object.keys(sessions)) {
      const candidate: Candidate = {
        value: sessions[sessionId],
        updatedAtUtc: entryUpdatedAt(sessions[sessionId], copy.doc),
        fileId: copy.meta.id
      };
      const current = winners.get(sessionId);
      if (current === undefined || greaterTuple(candidate, current)) {
        winners.set(sessionId, candidate);
      }
    }
  }

  const merged: Record<string, unknown> = {};
  for (const sessionId of Array.from(winners.keys()).sort()) {
    const winner = winners.get(sessionId);
    if (winner !== undefined) merged[sessionId] = clone(winner.value);
  }
  return merged;
}

/**
 * Merge the preference mappings of every copy.
 *
 * Different `exerciseId` and `dimension` pairs all survive. One pair present
 * in more than one copy resolves by the tuple rule. A mapping carries no
 * timestamp of its own, so the document's `updatedAtUtc` stands in for it.
 * REQUIREMENTS 4.24.
 */
function mergePreferenceMaps(copies: CopyDoc[]): Record<string, unknown> {
  const winners = new Map<string, Candidate & { exerciseId: string; dimension: string }>();

  for (const copy of copies) {
    const units = copy.doc.exerciseUnits;
    if (!isPlainObject(units)) continue;
    for (const exerciseId of Object.keys(units)) {
      const dimensions = units[exerciseId];
      if (!isPlainObject(dimensions)) continue;
      for (const dimension of Object.keys(dimensions)) {
        const key = `${exerciseId}/${dimension}`;
        const candidate = {
          value: dimensions[dimension],
          updatedAtUtc: copy.doc.updatedAtUtc,
          fileId: copy.meta.id,
          exerciseId,
          dimension
        };
        const current = winners.get(key);
        if (current === undefined || greaterTuple(candidate, current)) {
          winners.set(key, candidate);
        }
      }
    }
  }

  const merged: Record<string, unknown> = {};
  for (const key of Array.from(winners.keys()).sort()) {
    const winner = winners.get(key);
    if (winner === undefined) continue;
    const exerciseMap = merged[winner.exerciseId];
    if (!isPlainObject(exerciseMap)) {
      merged[winner.exerciseId] = {};
    }
    (merged[winner.exerciseId] as Record<string, unknown>)[winner.dimension] = winner.value;
  }
  return merged;
}

/** The copy whose envelope the consolidated document keeps. */
function envelopeCopy(family: DocFamily, copies: CopyDoc[]): CopyDoc {
  if (family === 'repjot/results') {
    return copies[0] as CopyDoc;
  }
  let best = copies[0] as CopyDoc;
  let bestCandidate: Candidate = {
    value: null,
    updatedAtUtc: best.doc.updatedAtUtc,
    fileId: best.meta.id
  };
  for (const copy of copies.slice(1)) {
    const candidate: Candidate = { value: null, updatedAtUtc: copy.doc.updatedAtUtc, fileId: copy.meta.id };
    if (greaterTuple(candidate, bestCandidate)) {
      best = copy;
      bestCandidate = candidate;
    }
  }
  return best;
}

/** The highest `revision` any copy declares, or `null` when none carries one. */
function maxRevision(copies: CopyDoc[]): number | null {
  let best: number | null = null;
  for (const copy of copies) {
    const revision = copy.doc.revision;
    if (typeof revision === 'number' && Number.isFinite(revision)) {
      if (best === null || revision > best) best = revision;
    }
  }
  return best;
}

/**
 * Build the consolidated document for one valid group.
 *
 * The envelope comes from one copy and the content map is the merged one, so
 * the result is a whole document rather than a patch. For preferences the
 * envelope is the newest copy's and `revision` is the highest any copy
 * declares, so consolidation never moves a revision backwards even when the
 * primary is the oldest file in the group.
 */
function buildConsolidated(family: DocFamily, copies: CopyDoc[]): Record<string, unknown> {
  const envelope = clone(envelopeCopy(family, copies).doc);
  if (family === 'repjot/results') {
    envelope.sessions = mergeSessionMaps(copies);
  } else {
    envelope.exerciseUnits = mergePreferenceMaps(copies);
    const revision = maxRevision(copies);
    if (revision !== null) envelope.revision = revision;
  }
  return envelope;
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
 * Consolidate one duplicate group.
 *
 * The procedure is the nine-step sequence in ARCHITECTURE section 11 and
 * specs/storage-and-lookup.md, in that order:
 *
 * 1. Download every copy and run the pipeline over it.
 * 2. Block the group when any copy is corrupt, wrong-family, or unsupported.
 * 3. Block the group when the semantic validator reports a fatal issue.
 * 4. Take the lexicographically smallest Drive file ID as the primary.
 * 5. Merge the content map with the `(updatedAtUtc, Drive file ID)` rule.
 * 6. Validate the consolidated document through the pipeline again.
 * 7. Re-read every copy's metadata and block on any change.
 * 8. Update the primary, read it back, and compare.
 * 9. Delete the redundant copies, then list the name again.
 *
 * Nothing is deleted before step 8 passes. A blocked outcome writes nothing.
 */
export async function consolidateGroup(
  group: DuplicateGroup,
  deps: ConsolidateDeps
): Promise<ConsolidationOutcome> {
  const family = familyForName(group.logicalName);
  if (family === null || group.copies.length < 2) {
    return { kind: 'no_duplicates' };
  }

  const copies: CopyDoc[] = [];
  for (const meta of group.copies) {
    const loaded = await loadCopy(deps.drive, deps.staticData, family, group.logicalName, meta);
    if ('blocked' in loaded) {
      logDiagnostic({
        severity: 'error',
        code: 'duplicate_group_blocked',
        context: { logicalName: group.logicalName, reason: loaded.blocked, fileId: meta.id }
      });
      return { kind: 'blocked', reason: loaded.blocked, fileId: meta.id };
    }
    copies.push(loaded);
  }

  const primary = group.copies.reduce(
    (best: DriveFileMeta, meta: DriveFileMeta): DriveFileMeta =>
      compareIds(meta.id, best.id) < 0 ? meta : best,
    group.copies[0] as DriveFileMeta
  );

  const consolidated = buildConsolidated(family, copies);

  // Step 6. The consolidated document is validated the same way a read is, so
  // a merge that produced something this build cannot read stops here instead
  // of reaching Drive.
  const text = JSON.stringify(consolidated);
  let schemaVersion: number;
  try {
    schemaVersion = processDocument(text, family, semanticStageFor(group.logicalName, deps.staticData))
      .sourceVersion;
  } catch (error: unknown) {
    const reason = blockedReasonFor(error);
    if (reason === null) throw error;
    // A distinct code, because every copy passed this same check. The failure
    // belongs to the merged document, not to one file on Drive, so the log
    // must not read as "copy X is corrupt". The blocked union in the spec has
    // no member for that, so `fileId` names the primary, the file a repair
    // would have to inspect, and the code carries the truth. REQUIREMENTS 4.23.
    logDiagnostic({
      severity: 'error',
      code: 'duplicate_merge_invalid',
      context: { logicalName: group.logicalName, reason, fileId: primary.id }
    });
    return { kind: 'blocked', reason, fileId: primary.id };
  }

  // Step 7. Re-read every copy's metadata. A copy that moved during cleanup
  // means this consolidation was built from bytes that are no longer current,
  // so it stops and the next synchronization retries. A copy that vanished is
  // treated the same way: its content is not something this run can prove.
  // REQUIREMENTS 4.26.
  const relisted = await deps.drive.listCatalog();
  for (const copy of copies) {
    const fresh = relisted.find((meta: DriveFileMeta): boolean => meta.id === copy.meta.id);
    if (
      fresh === undefined ||
      fresh.version !== copy.meta.version ||
      fresh.modifiedTime !== copy.meta.modifiedTime
    ) {
      logDiagnostic({
        severity: 'warn',
        code: 'duplicate_group_blocked',
        context: {
          logicalName: group.logicalName,
          reason: 'changed_during_cleanup',
          fileId: copy.meta.id
        }
      });
      return { kind: 'blocked', reason: 'changed_during_cleanup', fileId: copy.meta.id };
    }
  }

  // Step 8. Write the primary, read it back, and compare before anything is
  // deleted. REQUIREMENTS 4.25.
  const written = await deps.drive.updateFile(primary.id, text);
  const readBack = await deps.drive.readFile(primary.id);
  if (!sameJson(readBack.text, text)) {
    logDiagnostic({
      severity: 'error',
      code: 'duplicate_group_blocked',
      context: {
        logicalName: group.logicalName,
        reason: 'changed_during_cleanup',
        fileId: primary.id
      }
    });
    return { kind: 'blocked', reason: 'changed_during_cleanup', fileId: primary.id };
  }

  // Step 9. Delete the redundant copies by stable Drive file ID.
  const deletedIds: string[] = [];
  for (const copy of copies) {
    if (copy.meta.id === primary.id) continue;
    await deps.drive.deleteFile(copy.meta.id);
    deletedIds.push(copy.meta.id);
  }

  // Step 10. List the name again. Only a folder that came down to exactly one
  // recognized file is recorded locally, and only when that file is the primary
  // this procedure just wrote and read back. A lone leftover that is some other
  // file would pair this content and the primary's marker with a file that holds
  // neither, so nothing is recorded and the next synchronization retries.
  // REQUIREMENTS 4.25, 4.26.
  const after = await deps.drive.listCatalog();
  const stillThere = after.filter((meta: DriveFileMeta): boolean => meta.name === group.logicalName);
  const remainingId =
    stillThere.length === 1 && (stillThere[0] as DriveFileMeta).id === primary.id ? primary.id : null;

  logDiagnostic({
    severity: 'info',
    code: 'duplicate_group_consolidated',
    context: {
      logicalName: group.logicalName,
      primaryId: primary.id,
      deleted: deletedIds.length,
      remaining: stillThere.length
    }
  });

  return {
    kind: 'consolidated',
    primaryId: primary.id,
    primaryMeta: written,
    contentText: text,
    schemaVersion,
    deletedIds,
    remainingId
  };
}

/**
 * Build the consolidation hook the coordinator runs over a fresh catalog.
 *
 * The hook consolidates every duplicate group it finds, then returns the
 * catalog with deleted copies removed and each surviving primary replaced with
 * the metadata its update returned. A blocked group stays in the catalog
 * untouched and is reported in `blocked`, so the coordinator can refuse the
 * logical file while every other file keeps synchronizing.
 */
export function createConsolidateHook(deps: ConsolidateDeps): ConsolidateHook {
  return async (catalog: DriveFileMeta[]): Promise<ConsolidateResult> => {
    const unknown = findUnknownNames(catalog);
    if (unknown.length > 0) {
      logDiagnostic({
        severity: 'info',
        code: 'drive_unknown_files',
        context: { count: unknown.length, names: unknown.join(',').slice(0, 200) }
      });
    }

    const blocked: BlockedLogicalFile[] = [];
    const remaining: Record<string, RemainingFile> = {};
    const removed = new Set<string>();
    const refreshed = new Map<string, DriveFileMeta>();

    for (const group of findDuplicateGroups(catalog)) {
      const outcome = await consolidateGroup(group, deps);
      if (outcome.kind === 'blocked') {
        blocked.push({
          logicalName: group.logicalName,
          reason: outcome.reason,
          fileId: outcome.fileId
        });
        continue;
      }
      if (outcome.kind !== 'consolidated') continue;

      refreshed.set(outcome.primaryId, outcome.primaryMeta);
      for (const id of outcome.deletedIds) removed.add(id);
      if (outcome.remainingId !== null) {
        remaining[group.logicalName] = {
          driveFileId: outcome.remainingId,
          remoteEtag: remoteMarker(outcome.primaryMeta),
          contentText: outcome.contentText,
          schemaVersion: outcome.schemaVersion
        };
      }
    }

    if (removed.size === 0 && refreshed.size === 0) {
      return { catalog, blocked, remaining };
    }

    const nextCatalog = catalog
      .filter((meta: DriveFileMeta): boolean => !removed.has(meta.id))
      .map((meta: DriveFileMeta): DriveFileMeta => refreshed.get(meta.id) ?? meta);

    return { catalog: nextCatalog, blocked, remaining };
  };
}
