// The session mutation service. Phase 14.
// REQUIREMENTS 10.2-10.5, 10.13-10.18, 11.1-11.22. ARCHITECTURE §9.
//
// One object owns every write to a session document. A screen never touches a
// session record directly; it calls one method here, and this module turns that
// call into one validated edit of one monthly shard.
//
// Five rules shape the file.
//
// 1. Every mutation is one coordinator edit of the shard that holds the
//    session. The coordinator owns local-first durability, the merge, and the
//    upload. This module owns what a session edit means. REQUIREMENTS 4.1, 11.9.
// 2. The candidate is validated before it is written. `validateSession` runs
//    inside the mutator, so a rejected candidate throws before the coordinator
//    stores anything and the previous records stay untouched.
// 3. Terminal fields never move during a historical edit. `status`,
//    `startedAtUtc`, and `completedAtUtc` are copied back from the stored
//    session on every ordinary mutation. Only `complete` and `abandon` write
//    them, and they write them once. REQUIREMENTS 11.19, 11.20.
// 4. Saved child detail is authoritative. Once children exist under a scored
//    container, the container score is derived from them on every later edit,
//    because the semantic validator rejects a stored score the detail does not
//    reproduce. REQUIREMENTS 10.17, 10.18.
// 5. A mutation that changes nothing writes nothing. A blank draft, a clear of
//    an absent key, and an expand all return before the coordinator is called,
//    so no save status flickers and no shard is rewritten. REQUIREMENT 11.2.

import { logDiagnostic } from '../diagnostics/diagnostic-log';
import { AppError } from '../domain/errors';
import {
  containerResultKey,
  encodePath,
  exerciseResultKey,
  sameSegment,
  type PathSegment
} from '../domain/execution-path';
import { createSessionId } from '../domain/ids';
import { nowUtc, shardName, yearMonthUtc } from '../domain/time';
import type { ReasonCode, SessionStatus } from '../domain/enums';
import type {
  ContainerNode,
  ExerciseResult,
  ResultsShard,
  Score,
  Session,
  Workout,
  WorkoutNode
} from '../domain/types';
import type { LoadedStaticData } from '../documents/static-loader';
import type { Coordinator, EditHandle } from '../sync/sync-coordinator';
import type { LookupService } from '../indexes/lookup-service';
import type { PreferenceService } from '../preferences/preference-service';
import { validateSession } from '../validation/semantic-validator';
import { convert, type Dimension } from '../units/conversion';
import { clone } from '../sync/patcher';
import {
  isBlankContainerDraft,
  isBlankExerciseDraft,
  toContainerResult,
  toExerciseResult,
  type ContainerResultDraft,
  type ExerciseResultDraft
} from './drafts';
import { expandAggregateToDraft, type DraftChild } from './draft-expansion';
export type { DraftChild } from './draft-expansion';
import { deriveScore } from './scoring';
import { resolveTree, isUnderNoChildDetail, type ResolvedNode } from './tree-resolver';

/** One item of prescribed work a session has not recorded as completed. */
export interface MissingWorkItem {
  /** `<workoutId>|<nodeId>` for the occurrence with the gap. */
  nodeKey: string;
  /** The path a person reads, for example `Strength / Complex / Round 2`. */
  compactPathLabel: string;
  /** Why the item counts as missing. */
  reason: 'no_result' | 'incomplete' | 'skipped';
}

/** What the Finish Workout prompt reads before it offers its two choices. */
export interface MissingWorkReport {
  items: MissingWorkItem[];
  hasMissingWork: boolean;
}

/** The session mutation surface every screen calls through. */
export interface SessionService {
  /** Create one in-progress session in the current UTC shard. */
  start(workoutId: string): Promise<Session>;
  /** Read one session from its shard. */
  load(sessionId: string): Promise<Session>;
  /** Save one exercise draft. A blank draft records nothing. */
  saveExerciseResult(sessionId: string, draft: ExerciseResultDraft): Promise<void>;
  /** Drop one exercise result by its composite key. */
  clearExerciseResult(sessionId: string, key: string): Promise<void>;
  /** Open one more attempt on the exercise `fromKey` names. Returns the new key. */
  addAttempt(sessionId: string, fromKey: string): Promise<string>;
  /** Append one completed cycle under an AMRAP container and rescore it. */
  addAmrapRound(sessionId: string, containerPath: PathSegment[]): Promise<void>;
  /** Record or replace one container score. */
  setContainerScore(sessionId: string, draft: ContainerResultDraft): Promise<void>;
  /** Build the inferred draft set behind an aggregate-only container. Writes nothing. */
  expandAggregate(sessionId: string, containerKey: string): Promise<DraftChild[]>;
  /** Mark the session completed. */
  complete(sessionId: string): Promise<void>;
  /** Mark the session abandoned. */
  abandon(sessionId: string, reasonCode: ReasonCode): Promise<void>;
  /** Delete the session from its shard. No tombstone. */
  remove(sessionId: string): Promise<void>;
  /** Report the prescribed work a session has not recorded. */
  reportMissingWork(sessionId: string): Promise<MissingWorkReport>;
  /** Debounced `saveExerciseResult`. */
  queueSaveExerciseResult(sessionId: string, draft: ExerciseResultDraft): void;
  /** Debounced `setContainerScore`. */
  queueSetContainerScore(sessionId: string, draft: ContainerResultDraft): void;
  /** Run every queued edit now. Wire this to blur and to a route change. */
  queueFlush(): Promise<void>;
}

/** Everything the service needs. */
export interface SessionServiceDeps {
  coordinator: Coordinator;
  staticData: LoadedStaticData;
  preferences: PreferenceService;
  lookup: LookupService;
}

/** A session-level edit, expressed against the whole shard document. */
type ShardMutator = (doc: unknown) => unknown;

/** Read the shard envelope out of a coordinator document. */
function asShard(doc: unknown): ResultsShard {
  return (doc ?? { sessions: {} }) as ResultsShard;
}

/** Resolve one node by its execution path inside one workout. */
function resolveNode(workout: Workout, path: PathSegment[]): WorkoutNode | null {
  if (path.length === 0 || path[0].nodeId !== workout.root.id) return null;
  let current: WorkoutNode = workout.root;
  for (let depth = 1; depth < path.length; depth += 1) {
    if (current.type !== 'container') return null;
    const found: WorkoutNode | undefined = current.children.find(
      (node: WorkoutNode): boolean => node.id === path[depth].nodeId
    );
    if (found === undefined) return null;
    current = found;
  }
  return current;
}

/** The scored containers on one path, outermost first, excluding the leaf node. */
function scoredAncestors(
  workout: Workout,
  path: PathSegment[]
): Array<{ container: ContainerNode; path: PathSegment[] }> {
  const out: Array<{ container: ContainerNode; path: PathSegment[] }> = [];
  for (let depth = 1; depth < path.length; depth += 1) {
    // The container result is keyed without the iteration on its own segment.
    const ancestorPath = withoutIteration(path.slice(0, depth));
    const node = resolveNode(workout, ancestorPath);
    if (node === null || node.type !== 'container') continue;
    if (node.resultCapture === undefined) continue;
    out.push({ container: node, path: ancestorPath });
  }
  return out;
}
/**
 * Strip the iteration from the last segment of a path.
 *
 * A container result is keyed by the container's own node path, with no
 * iteration, while the children below it carry the iteration on that same
 * segment. `root/cindy|1` scores the whole container; `root/cindy:1/pushups`
 * is one round's child. This is the stored convention the Phase 04 validator
 * enforces, so the service builds keys the same way.
 */
function withoutIteration(path: PathSegment[]): PathSegment[] {
  const copy = path.map((segment: PathSegment): PathSegment => ({ ...segment }));
  const last = copy[copy.length - 1];
  if (last !== undefined) delete last.iteration;
  return copy;
}

/**
 * Every exercise result recorded strictly below one container occurrence.
 *
 * `containerPath` names the container with no iteration on its own segment.
 * A child below round 2 of that container repeats the container segment with
 * `iteration: 2`, so every ancestor above the container matches on node ID
 * **and** iteration, through the same `sameSegment` helper the Phase 04
 * validator uses. A match on node ID alone pulls a child of another outer
 * round into this container's derivation, which makes the score the service
 * derives disagree with the score the validator derives, and the write is
 * refused. REQUIREMENTS 10.8, 10.13.
 */
function childrenBelow(session: Session, containerPath: PathSegment[]): ExerciseResult[] {
  const depth = containerPath.length - 1;
  if (depth < 0) return [];
  const containerId = containerPath[depth]?.nodeId;
  if (containerId === undefined) return [];

  const out: ExerciseResult[] = [];
  for (const result of Object.values(session.exerciseResults)) {
    const path = result.executionPath;
    if (!Array.isArray(path) || path.length <= containerPath.length) continue;
    if (path[depth]?.nodeId !== containerId) continue;

    let matches = true;
    for (let index = 0; index < depth; index += 1) {
      if (!sameSegment(path[index], containerPath[index])) {
        matches = false;
        break;
      }
    }
    if (matches) out.push(result);
  }
  return out;
}

/**
 * The drafts whose container segment carries one iteration.
 *
 * The seed score passed to the expansion describes the *whole* container, so
 * the expansion emits every round from 1 to N. Only the new round may be
 * written: rounds already on file hold the user's recorded actuals, and
 * rewriting them with prescription values destroys that data. The expansion
 * module has no session, so it cannot know which rounds already exist. The
 * service owns that, and filters here.
 *
 * `depth` is the index of the container's own segment on the draft path, which
 * is where the expansion writes the round number. REQUIREMENTS 10.8, 11.1.
 */
function draftsAtIteration(
  drafts: DraftChild[],
  depth: number,
  iteration: number
): DraftChild[] {
  return drafts.filter((entry: DraftChild): boolean => {
    const segment = entry.draft.executionPath[depth];
    return segment !== undefined && (segment.iteration ?? 1) === iteration;
  });
}

/**
 * The score one added cycle stands for.
 *
 * `addAmrapRound` needs a score to expand from, and one more cycle is exactly
 * one more completed unit of whatever the container counts.
 */
function cycleScore(container: ContainerNode, cycles: number): Score {
  switch (container.resultCapture?.scoreType) {
    case 'intervals':
      return {
        type: 'intervals',
        completedIntervals: cycles * container.children.length,
        totalIntervals: cycles * container.children.length
      };
    case 'rounds_and_reps':
      return { type: 'rounds_and_reps', completedRounds: cycles, additionalReps: 0 };
    default:
      return { type: 'cycles', completedCycles: cycles };
  }
}

/**
 * Create the session service for one account.
 *
 * `lookup` answers which monthly shard holds a session, because a session ID
 * encodes no time. The map is seeded from the Phase 12 index, and sessions this
 * service starts are added to it as they are created.
 */
export function createSessionService(deps: SessionServiceDeps): SessionService {
  const { coordinator, staticData, preferences, lookup } = deps;

  /** Sessions this service knows the shard for, including ones it just created. */
  const shardBySession = new Map<string, string>();

  /**
   * The monthly shard that holds one session.
   *
   * A session this service created resolves from its own map. Anything else
   * resolves through the Phase 12 index, which carries `shardName` on every
   * session summary. An ID neither map knows is refused rather than guessed at,
   * because writing to the wrong shard would split one session across two files.
   * REQUIREMENT 17.6.
   */
  function shardFor(sessionId: string): string {
    const known = shardBySession.get(sessionId);
    if (known !== undefined) return known;
    const summary = lookup.index.sessionsById.get(sessionId);
    if (summary === undefined) {
      throw new AppError(
        'invalid_document',
        { reason: 'unknown_session', sessionId },
        'No shard is known for that session.'
      );
    }
    shardBySession.set(sessionId, summary.shardName);
    return summary.shardName;
  }

  /** Validate one candidate session before it reaches storage. */
  function assertValid(session: Session, shard: string): void {
    const report = validateSession(session, staticData, {
      shardYearMonthUtc: yearMonthUtc(session.startedAtUtc),
      sessionKey: session.id
    });
    if (report.issues.length === 0) return;

    const [first] = report.issues;
    throw new AppError(
      'semantic_reference',
      { reason: 'session_mutation_invalid', code: first.code, shard },
      'The session edit failed semantic validation.'
    );
  }

  /**
   * Build the shard mutator for one session-level edit.
   *
   * `apply` edits a clone of the stored session. The three terminal fields are
   * then copied back from the stored value, so an ordinary edit cannot move
   * them, and `updatedAtUtc` is stamped. REQUIREMENTS 11.19, 11.20, 11.21.
   *
   * `allowTerminal` is set only by `complete` and `abandon`, which own those
   * fields for that one write.
   */
  function buildMutator(
    sessionId: string,
    shard: string,
    apply: (session: Session) => void,
    allowTerminal: boolean
  ): ShardMutator {
    return (doc: unknown): unknown => {
      const shardDoc = asShard(doc);
      const stored = shardDoc.sessions?.[sessionId];
      if (stored === undefined) {
        throw new AppError(
          'invalid_document',
          { reason: 'session_not_found', sessionId, shard },
          'That session is not in its shard.'
        );
      }

      const next = clone(stored);
      apply(next);

      if (!allowTerminal) {
        next.status = stored.status;
        next.startedAtUtc = stored.startedAtUtc;
        if (stored.completedAtUtc === undefined) delete next.completedAtUtc;
        else next.completedAtUtc = stored.completedAtUtc;
      }
      next.updatedAtUtc = nowUtc();

      assertValid(next, shard);
      shardDoc.sessions[sessionId] = next;
      return shardDoc;
    };
  }

  /**
   * Run one edit against one shard, loading the shard first.
   *
   * Every mutation takes this path. A mutator that reads a shard the
   * coordinator has never loaded sees the family's empty document instead of
   * the stored one, so an edit that should find a session finds nothing and an
   * delete that should remove one removes nothing.
   */
  async function editShard(shard: string, mutate: ShardMutator): Promise<EditHandle> {
    await coordinator.ensureLoaded(shard);
    const handle = await coordinator.edit(shard, mutate);
    void handle.synced.catch(() => undefined);
    return handle;
  }

  /** Run one session-level edit now, and never leave the sync promise unhandled. */
  async function editNow(
    sessionId: string,
    apply: (session: Session) => void,
    allowTerminal = false
  ): Promise<EditHandle> {
    const shard = shardFor(sessionId);
    return editShard(shard, buildMutator(sessionId, shard, apply, allowTerminal));
  }

  /** Queue one session-level edit for the debounce window. */
  function queueEdit(
    sessionId: string,
    apply: (session: Session) => void,
    allowTerminal = false
  ): void {
    const shard = shardFor(sessionId);
    coordinator.queueEdit(shard, buildMutator(sessionId, shard, apply, allowTerminal));
  }

  /** The workout a session belongs to, from the current bundle. */
  function workoutFor(session: Session): Workout {
    const workout = staticData.workoutById.get(session.workoutId);
    if (workout === undefined) {
      throw new AppError(
        'invalid_document',
        { reason: 'unknown_workout', workoutId: session.workoutId },
        'That workout is not in the current bundle.'
      );
    }
    return workout;
  }

  /**
   * Rescore every scored container above one recorded child.
   *
   * Detail is authoritative once it exists, so the container score is rebuilt
   * from the children on every edit below it. A container whose detail cannot
   * reproduce its score type takes `nonstandard`. REQUIREMENTS 10.17, 10.18.
   */
  function rescoreAncestors(session: Session, workout: Workout, childPath: PathSegment[]): void {
    for (const ancestor of scoredAncestors(workout, childPath)) {
      if (ancestor.container.resultCapture?.childDetail === 'none') continue;
      const key = containerResultKey(ancestor.path);
      const children = childrenBelow(session, ancestor.path);

      if (children.length === 0) {
        // No detail left below the container. Nothing is deleted. The service
        // cannot tell a derived result from one the user typed by hand, and a
        // hand-typed aggregate belongs to the caller that typed it, so the
        // aggregate stays exactly as it stands. REQUIREMENT 10.13.
        continue;
      }

      const score = deriveScore(ancestor.container, children, staticData.exerciseById);
      const existing = session.containerResults[key];
      if (existing === undefined) {
        session.containerResults[key] = {
          workoutId: session.workoutId,
          executionPath: ancestor.path,
          status: 'completed',
          score
        };
        continue;
      }
      if (existing.status === 'skipped') {
        delete existing.score;
        continue;
      }
      existing.score = score;
    }
  }

  /**
   * The next iteration recorded under one container occurrence.
   *
   * `containerPath` names the container with no iteration on its own segment.
   * The children below it carry the iteration on that segment, so the highest
   * one present is the last round that ran. The selection runs through
   * `childrenBelow`, so an outer round reads only its own inner rounds, never
   * the highest inner round recorded under a sibling outer round.
   */
  function nextIteration(session: Session, containerPath: PathSegment[]): number {
    const depth = containerPath.length - 1;
    const containerId = containerPath[depth]?.nodeId;
    if (containerId === undefined) return 1;
    let max = 0;

    for (const result of childrenBelow(session, containerPath)) {
      const iteration = result.executionPath[depth]?.iteration ?? 1;
      if (iteration > max) max = iteration;
    }
    return max + 1;
  }

  /**
   * Stamp the session's workout onto each derived draft.
   *
   * The expansion module knows the tree, not the session, so the service adds
   * the identity a saved result must carry. The `inferred` marker rides on the
   * wrapper, which is what the caller reads to render the `Inferred` label, so
   * the wrapper is rebuilt rather than unwrapped. REQUIREMENTS 10.15, 11.3.
   */
  function stampWorkout(drafts: DraftChild[], workoutId: string): DraftChild[] {
    return drafts.map((entry: DraftChild): DraftChild => ({
      inferred: entry.inferred,
      draft: { ...entry.draft, workoutId }
    }));
  }

  /**
   * Move each draft value into the unit the user prefers for that exercise.
   *
   * The draft arrives in the unit the expansion derived. Showing it in the
   * preferred unit is what the pill would show, so the inferred row and the
   * saved row read the same way. A unit the exercise cannot hold keeps the
   * derived value instead of failing the expansion. REQUIREMENTS 12.4, 12.7.
   */
  function applyPreferredUnits(drafts: DraftChild[]): DraftChild[] {
    return drafts.map((entry: DraftChild): DraftChild => {
      const draft = entry.draft;
      if (draft.values === undefined) return entry;
      const converted: Record<string, { value: number; unit: string }> = {};
      for (const [dimension, quantity] of Object.entries(draft.values)) {
        if (quantity === undefined || quantity === null) continue;
        const preferred = preferences.getUnit(draft.exerciseId, dimension as Dimension);
        if (preferred === undefined || preferred === quantity.unit) {
          converted[dimension] = quantity;
          continue;
        }
        try {
          converted[dimension] = convert(quantity, preferred);
        } catch {
          converted[dimension] = quantity;
        }
      }
      return {
        inferred: entry.inferred,
        draft: { ...draft, values: converted as ExerciseResultDraft['values'] }
      };
    });
  }

  async function start(workoutId: string): Promise<Session> {
    const workout = staticData.workoutById.get(workoutId);
    if (workout === undefined) {
      throw new AppError(
        'invalid_document',
        { reason: 'unknown_workout', workoutId },
        'A session starts only from a workout in the current bundle.'
      );
    }

    const startedAtUtc = nowUtc();
    const shard = shardName(startedAtUtc);
    const session: Session = {
      id: createSessionId(),
      workoutId,
      status: 'in_progress',
      startedAtUtc,
      updatedAtUtc: startedAtUtc,
      exerciseResults: {},
      containerResults: {}
    };

    assertValid(session, shard);

    const handle = await coordinator.edit(shard, (doc: unknown): unknown => {
      const shardDoc = asShard(doc);
      shardDoc.sessions[session.id] = session;
      return shardDoc;
    });
    void handle.synced.catch(() => undefined);
    shardBySession.set(session.id, shard);

    logDiagnostic({
      severity: 'info',
      code: 'session_started',
      context: { sessionId: session.id, workoutId, shard }
    });

    return clone(session);
  }

  async function load(sessionId: string): Promise<Session> {
    const shard = shardFor(sessionId);
    const shardDoc = (await coordinator.ensureLoaded(shard)) as ResultsShard;
    const session = shardDoc.sessions?.[sessionId];
    if (session === undefined) {
      throw new AppError(
        'invalid_document',
        { reason: 'session_not_found', sessionId, shard },
        'That session is not in its shard.'
      );
    }
    return clone(session);
  }

  async function saveExerciseResult(
    sessionId: string,
    draft: ExerciseResultDraft
  ): Promise<void> {
    // Blank input is not a result. Nothing is written, and the session keeps
    // whatever it already held. REQUIREMENT 11.2.
    if (isBlankExerciseDraft(draft)) return;

    const session = await load(sessionId);
    const workout = workoutFor(session);
    const result = toExerciseResult(draft);
    const key = exerciseResultKey(result.executionPath, result.side ?? 'both', result.attempt ?? 1);

    await editNow(sessionId, (next: Session): void => {
      next.exerciseResults[key] = clone(result);
      rescoreAncestors(next, workout, result.executionPath);
    });
  }

  async function clearExerciseResult(sessionId: string, key: string): Promise<void> {
    const session = await load(sessionId);
    const existing = session.exerciseResults[key];
    if (existing === undefined) return;
    const workout = workoutFor(session);
    const childPath = existing.executionPath;

    await editNow(sessionId, (next: Session): void => {
      delete next.exerciseResults[key];
      rescoreAncestors(next, workout, childPath);
    });
  }

  async function addAttempt(sessionId: string, fromKey: string): Promise<string> {
    const session = await load(sessionId);
    const source = session.exerciseResults[fromKey];
    if (source === undefined) {
      throw new AppError(
        'invalid_document',
        { reason: 'unknown_result', sessionId, resultKey: fromKey },
        'There is no result to add an attempt to.'
      );
    }

    const attempt = (source.attempt ?? 1) + 1;
    const key = exerciseResultKey(source.executionPath, source.side ?? 'both', attempt);

    // A new attempt opens as an incomplete result. It carries the identity of
    // the attempt it follows and no values, because nothing has been recorded
    // for it yet. REQUIREMENTS 11.2, 11.4.
    const draft: ExerciseResultDraft = {
      workoutId: source.workoutId,
      exerciseId: source.exerciseId,
      executionPath: source.executionPath,
      side: source.side ?? 'both',
      attempt,
      status: 'incomplete',
      reasonCode: 'not_completed'
    };
    if (source.startingSide !== undefined) draft.startingSide = source.startingSide;

    await saveExerciseResult(sessionId, draft);
    return key;
  }

  async function addAmrapRound(
    sessionId: string,
    containerPath: PathSegment[]
  ): Promise<void> {
    const session = await load(sessionId);
    const workout = workoutFor(session);
    const container = resolveNode(workout, containerPath);

    if (container === null || container.type !== 'container') {
      throw new AppError(
        'invalid_document',
        { reason: 'unknown_container', sessionId },
        'That container path is not in the current workout.'
      );
    }
    if (container.resultCapture === undefined) {
      throw new AppError(
        'invalid_document',
        { reason: 'container_not_scored', containerId: container.id },
        'Only a scored container takes an added round.'
      );
    }
    if (container.resultCapture.childDetail === 'none') {
      throw new AppError(
        'invalid_document',
        { reason: 'child_detail_forbidden', containerId: container.id },
        'This container records its score with no child detail.'
      );
    }

    const iteration = nextIteration(session, containerPath);
    // The expansion writes the iteration onto each draft path itself, so the
    // container's own path goes in unmodified. The seed score describes the
    // whole container, so the expansion returns every round up to this one;
    // only the new round is written, and the rounds already on file keep their
    // recorded values.
    const depth = containerPath.length - 1;
    const drafts = draftsAtIteration(
      stampWorkout(
        expandAggregateToDraft(container, cycleScore(container, iteration), staticData, containerPath),
        session.workoutId
      ),
      depth,
      iteration
    );

    // One edit carries the whole cycle, so the round lands as one unit. Saving
    // each draft separately would leave a half-added round visible between them.
    await editNow(sessionId, (next: Session): void => {
      for (const entry of drafts) {
        const result = toExerciseResult(entry.draft);
        const key = exerciseResultKey(
          result.executionPath,
          result.side ?? 'both',
          result.attempt ?? 1
        );
        next.exerciseResults[key] = clone(result);
      }
      rescoreContainer(next, workout, containerPath);
    });
  }

  /**
   * Recompute one container's own score from the detail below it.
   *
   * An added round always moves the score, even when the round produced no
   * draft because the prescription carries no values, so this runs on the
   * container rather than through the child path. REQUIREMENT 10.17.
   */
  function rescoreContainer(
    session: Session,
    workout: Workout,
    containerPath: PathSegment[]
  ): void {
    const key = containerResultKey(containerPath);
    const children = childrenBelow(session, containerPath);
    const existing = session.containerResults[key];

    if (children.length === 0) {
      // Same rule as `rescoreAncestors`: an empty child set deletes nothing,
      // because the service cannot tell a derived aggregate from a hand-typed
      // one. REQUIREMENT 10.13.
      return;
    }

    const score = deriveScore(
      resolveNode(workout, containerPath) as ContainerNode,
      children,
      staticData.exerciseById
    );
    if (existing === undefined) {
      session.containerResults[key] = {
        workoutId: session.workoutId,
        executionPath: containerPath,
        status: 'completed',
        score
      };
      return;
    }
    if (existing.status === 'skipped') return;
    existing.score = score;
  }

  async function setContainerScore(
    sessionId: string,
    draft: ContainerResultDraft
  ): Promise<void> {
    if (isBlankContainerDraft(draft)) return;

    const session = await load(sessionId);
    const workout = workoutFor(session);
    const storedPath = withoutIteration(draft.executionPath);
    const container = resolveNode(workout, storedPath);

    if (container === null || container.type !== 'container') {
      throw new AppError(
        'invalid_document',
        { reason: 'unknown_container', sessionId },
        'That container path is not in the current workout.'
      );
    }
    if (container.resultCapture === undefined) {
      throw new AppError(
        'invalid_document',
        { reason: 'container_not_scored', containerId: container.id },
        'That container is not scored.'
      );
    }

    const key = containerResultKey(storedPath, draft.attempt ?? 1);
    const children = childrenBelow(session, storedPath);

    // Detail outranks the typed score. Once children are saved, the score is
    // what the detail derives, because the validator rejects any other value.
    // REQUIREMENT 10.17.
    const effective = clone(draft);
    effective.executionPath = storedPath;
    if (children.length > 0 && effective.status === 'completed') {
      effective.score = deriveScore(container, children, staticData.exerciseById);
    }
    const stored = toContainerResult(effective);

    await editNow(sessionId, (next: Session): void => {
      next.containerResults[key] = stored;
    });
  }

  async function expandAggregate(
    sessionId: string,
    containerKey: string
  ): Promise<DraftChild[]> {
    const session = await load(sessionId);
    const containerResult = session.containerResults[containerKey];
    if (containerResult === undefined || containerResult.score === undefined) return [];
    if (containerResult.score.type === 'nonstandard') return [];

    const workout = workoutFor(session);
    const storedPath = withoutIteration(containerResult.executionPath);
    const container = resolveNode(workout, storedPath);
    if (container === null || container.type !== 'container') return [];

    // A container that records its score with no child detail never offers an
    // expansion, because every draft it would produce is a result the validator
    // refuses. The screen shows the score alone. REQUIREMENTS 10.10, 10.13.
    if (container.resultCapture?.childDetail === 'none') return [];

    const drafts = stampWorkout(
      expandAggregateToDraft(container, containerResult.score, staticData, storedPath),
      session.workoutId
    );
    return applyPreferredUnits(drafts);
  }

  /**
   * Refuse a terminal status that would overwrite a different terminal status.
   *
   * A terminal `status` never changes once written, and `completedAtUtc` never
   * changes once written. Converting abandoned work into completed work, or the
   * reverse, misreports a workout the user walked away from, so the service
   * refuses the call instead of applying it. The screen confirms with the user
   * and, if the user wants the other outcome, deletes the session and records
   * it again. REQUIREMENTS 11.19, 11.20.
   *
   * Runs inside the mutator, so it reads the stored status at write time and a
   * concurrent edit cannot slip a different status past the check.
   */
  function assertTerminalTransition(stored: Session, target: SessionStatus, sessionId: string): void {
    if (stored.status === target) return;
    if (stored.status === 'completed' || stored.status === 'abandoned') {
      throw new AppError(
        'invalid_document',
        { reason: 'terminal_status_conflict', sessionId, status: stored.status, target },
        'That session already ended as ' + stored.status + '.'
      );
    }
  }

  /**
   * Move one in-progress session to a terminal status, once.
   *
   * `completedAtUtc` is written only when the session has none, so the first
   * terminal write fixes the timestamp and no later call moves it.
   */
  async function markTerminal(sessionId: string, target: SessionStatus): Promise<void> {
    const session = await load(sessionId);
    // Already in the target status: nothing to write, so nothing is written.
    // REQUIREMENT 11.2.
    if (session.status === target) return;
    if (session.status !== 'in_progress') {
      assertTerminalTransition(session, target, sessionId);
    }

    await editNow(
      sessionId,
      (next: Session): void => {
        assertTerminalTransition(next, target, sessionId);
        next.status = target;
        if (next.completedAtUtc === undefined) next.completedAtUtc = nowUtc();
      },
      true
    );
  }

  async function complete(sessionId: string): Promise<void> {
    await markTerminal(sessionId, 'completed');
  }

  async function abandon(sessionId: string, reasonCode: ReasonCode): Promise<void> {
    await markTerminal(sessionId, 'abandoned');
    // The session document has no reason field. The reason reaches the
    // diagnostic log, which is where a support read looks, and the recorded
    // results keep their own reason codes. REQUIREMENT 11.4.
    logDiagnostic({
      severity: 'info',
      code: 'session_abandoned',
      context: { sessionId, reasonCode }
    });
  }

  async function remove(sessionId: string): Promise<void> {
    const shard = shardFor(sessionId);
    // `remove` runs through the same loaded-shard path as every other
    // mutation. A delete issued against a shard that was never loaded would
    // fall back to the family's empty document, delete nothing, and report
    // success while the next merge brought the session back.
    const handle = await editShard(shard, (doc: unknown): unknown => {
      const shardDoc = asShard(doc);
      if (shardDoc.sessions?.[sessionId] === undefined) {
        throw new AppError(
          'invalid_document',
          { reason: 'session_not_found', sessionId, shard },
          'That session is not in its shard.'
        );
      }
      // One delete and nothing else. No tombstone field, no marker. A stale
      // device that synchronizes later can bring the session back, and the
      // user deletes it again. REQUIREMENT 11.14.
      delete shardDoc.sessions[sessionId];
      return shardDoc;
    });
    void handle.synced.catch(() => undefined);
    shardBySession.delete(sessionId);
  }

  async function reportMissingWork(sessionId: string): Promise<MissingWorkReport> {
    const session = await load(sessionId);
    const workout = workoutFor(session);
    const nodes: ResolvedNode[] = resolveTree(workout);
    const items: MissingWorkItem[] = [];

    // Index the recorded results by encoded path once, so the tree walk reads a
    // map instead of rescanning the session per node.
    const recorded = new Map<string, ExerciseResult[]>();
    for (const result of Object.values(session.exerciseResults)) {
      if (!Array.isArray(result.executionPath)) continue;
      const encoded = encodePath(result.executionPath);
      const bucket = recorded.get(encoded);
      if (bucket === undefined) {
        recorded.set(encoded, [result]);
        continue;
      }
      bucket.push(result);
    }

    for (const node of nodes) {
      if (node.node.type !== 'exercise') continue;
      // An exercise under a container that records its score with no child
      // detail never holds a separate result, so it is never missing work.
      // REQUIREMENTS 10.10, 10.13.
      if (isUnderNoChildDetail(workout, node.path)) continue;
      const nodeKey = `${workout.id}|${node.node.id}`;
      const bucket = recorded.get(encodePath(node.path));

      if (bucket === undefined || bucket.length === 0) {
        items.push({ nodeKey, compactPathLabel: node.compactPathLabel, reason: 'no_result' });
        continue;
      }
      for (const result of bucket) {
        if (result.status === 'completed') continue;
        items.push({
          nodeKey,
          compactPathLabel: node.compactPathLabel,
          reason: result.status === 'skipped' ? 'skipped' : 'incomplete'
        });
      }
    }

    return { items, hasMissingWork: items.length > 0 };
  }

  function queueSaveExerciseResult(sessionId: string, draft: ExerciseResultDraft): void {
    if (isBlankExerciseDraft(draft)) return;
    const session = peekSession(sessionId);
    if (session === null) return;
    const workout = workoutFor(session);
    const result = toExerciseResult(draft);
    const key = exerciseResultKey(result.executionPath, result.side ?? 'both', result.attempt ?? 1);

    queueEdit(sessionId, (next: Session): void => {
      next.exerciseResults[key] = clone(result);
      rescoreAncestors(next, workout, result.executionPath);
    });
  }

  function queueSetContainerScore(sessionId: string, draft: ContainerResultDraft): void {
    if (isBlankContainerDraft(draft)) return;
    const session = peekSession(sessionId);
    if (session === null) return;
    const workout = workoutFor(session);
    const storedPath = withoutIteration(draft.executionPath);
    const container = resolveNode(workout, storedPath);
    if (container === null || container.type !== 'container') return;

    const key = containerResultKey(storedPath, draft.attempt ?? 1);
    const children = childrenBelow(session, storedPath);
    const effective = clone(draft);
    effective.executionPath = storedPath;
    if (children.length > 0 && effective.status === 'completed') {
      effective.score = deriveScore(container, children, staticData.exerciseById);
    }
    const stored = toContainerResult(effective);

    queueEdit(sessionId, (next: Session): void => {
      next.containerResults[key] = stored;
    });
  }

  /**
   * The session from the coordinator's in-memory document, with no load.
   *
   * A queued edit must not await, because the whole point of the queue is that
   * a keystroke costs nothing. The document is already warm: the screen loaded
   * the session before it rendered the input. When it is not warm the queued
   * edit is dropped, because the input it would carry has no session to land
   * in. REQUIREMENT 4.1.
   */
  function peekSession(sessionId: string): Session | null {
    const shard = shardFor(sessionId);
    const shardDoc = coordinator.peek(shard) as ResultsShard | undefined;
    const session = shardDoc?.sessions?.[sessionId];
    return session === undefined ? null : session;
  }

  async function queueFlush(): Promise<void> {
    await coordinator.flush();
  }

  return {
    start,
    load,
    saveExerciseResult,
    clearExerciseResult,
    addAttempt,
    addAmrapRound,
    setContainerScore,
    expandAggregate,
    complete,
    abandon,
    remove,
    reportMissingWork,
    queueSaveExerciseResult,
    queueSetContainerScore,
    queueFlush
  };
}
