// The Active Workout screen's decision logic, kept free of component state.
// Phase 17. REQUIREMENTS 11.2, 11.9, 15.1-15.8, 10.19-10.23.
//
// The screen holds draft state and calls these. Each function answers one
// question the screen cannot answer wrong, so each gets proved without a
// browser.

import type {
  ReasonCode,
  ResultStatus,
  ScoreType,
  SessionStatus,
  Side,
  StartingSide
} from '../../domain/enums';
import type { EffortOutcome, EffortTarget, Score } from '../../domain/types';
import type { MissingWorkItem } from '../../sessions/session-service';
import type { ExerciseResultDraft } from '../../sessions/drafts';
import {
  draftRowValues,
  fieldDisplay,
  type ActiveExerciseRow,
  type GroupModel
} from '../viewmodels/activeWorkoutModel';

/** What one row's draft is built from. */
export interface RowDraftInput {
  /** The session's workout id. */
  workoutId: string;
  /** The row being saved. */
  row: ActiveExerciseRow;
  /** Draft field text for this row, keyed by dimension. */
  overrides: Record<string, string>;
  /** Draft status. Falls back to the row's own status. */
  status?: ResultStatus;
  /** Draft reason code. Falls back to the row's own reason. */
  reasonCode?: ReasonCode;
  /**
   * Draft side. Falls back to the row's own side.
   *
   * The side decides the result key the screen clears when it moves a set,
   * so it is carried explicitly rather than read off the row at the call
   * site. REQUIREMENT 11.5.
   */
  side?: Side;
  /** Draft starting side. Falls back to the row's own starting side. */
  startingSide?: StartingSide;
  /**
   * Draft effort. Falls back to the effort already on the row.
   *
   * Pass `null` to clear a recorded effort. Pass `undefined` to leave the
   * row's own effort in place. REQUIREMENT 19.9.
   */
  effort?: EffortOutcome | null;
}

/**
 * Build the exercise draft one row writes.
 *
 * Values come from the field text in the unit each field shows, so the
 * number the user read is the number recorded. A blank field contributes
 * nothing, which is how a blank input creates no result. A non-completed
 * status carries a reason code, because the validator requires one.
 * REQUIREMENTS 11.2, 11.14.
 */
export function buildRowDraft(input: RowDraftInput): ExerciseResultDraft {
  const status = input.status ?? input.row.status;
  const draft: ExerciseResultDraft = {
    workoutId: input.workoutId,
    exerciseId: input.row.exerciseId,
    executionPath: input.row.path,
    side: input.side ?? input.row.side,
    attempt: input.row.attempt,
    status,
    values: draftRowValues(input.row.fields, input.overrides)
  };
  // A starting side belongs to an alternating set only. The validator
  // rejects the pair on any other side, so the guard drops the field rather
  // than saving a draft that cannot be written.
  if (draft.side === 'alternating') {
    const startingSide = input.startingSide ?? input.row.startingSide ?? 'left';
    draft.startingSide = startingSide;
  }
  if (input.effort === null) {
    delete draft.effort;
  } else if (input.effort !== undefined) {
    draft.effort = input.effort;
  } else if (input.row.effort !== undefined) {
    draft.effort = input.row.effort;
  }
  if (status !== 'completed') draft.reasonCode = input.reasonCode ?? 'not_completed';
  return draft;
}

/**
 * Build the score a container's own type asks for.
 *
 * An intervals score needs a total, which the model read from the EMOM
 * config. A typed count above that total is clamped to it, because a score
 * that claims more intervals than were programmed cannot validate.
 * REQUIREMENT 10.21.
 */
export function scoreFromText(
  scoreType: ScoreType,
  parsed: number,
  totalIntervals: number
): Score | null {
  const whole = Math.max(0, Math.trunc(parsed));
  if (scoreType === 'cycles') return { type: 'cycles', completedCycles: whole };
  if (scoreType === 'rounds_and_reps') {
    return { type: 'rounds_and_reps', completedRounds: whole, additionalReps: 0 };
  }
  if (scoreType === 'intervals') {
    const total = totalIntervals > 0 ? totalIntervals : whole;
    return {
      type: 'intervals',
      completedIntervals: Math.min(whole, total),
      totalIntervals: total
    };
  }
  return null;
}

/**
 * Build the rounds-and-reps score an extra-reps field writes.
 *
 * The round count comes from the score already on file, so typing extra
 * reps never resets completed rounds. REQUIREMENT 10.22.
 */
export function amrapPartialScore(
  existing: Score | undefined,
  additionalReps: number
): Score {
  const completedRounds =
    existing !== undefined && existing.type === 'rounds_and_reps' ? existing.completedRounds : 0;
  return {
    type: 'rounds_and_reps',
    completedRounds,
    additionalReps: Math.max(0, Math.trunc(additionalReps))
  };
}

/** What the finish bar may offer. */
export interface FinishPlan {
  /** True when the bar shows the missing-work prompt instead of its buttons. */
  showPrompt: boolean;
  /** True when the plain Finish button is live. */
  canFinish: boolean;
  /** The items the prompt lists. */
  items: MissingWorkItem[];
}

/**
 * Decide what the finish bar shows.
 *
 * The prompt appears only after the user presses Finish and gaps exist. A
 * bar that warned on every render would nag, and a bar that hid the gaps
 * would finish a workout the user believes is whole. REQUIREMENT 15.4.
 */
export function finishPlan(missing: MissingWorkItem[], promptRequested: boolean): FinishPlan {
  const hasMissing = missing.length > 0;
  return {
    showPrompt: promptRequested && hasMissing,
    canFinish: !promptRequested || !hasMissing,
    items: missing
  };
}

/**
 * Whether a terminal action may run.
 *
 * A finished or abandoned session keeps its results editable, so the tree
 * stays live, but the finish and abandon buttons must not fire a second time.
 * REQUIREMENTS 11.16, 15.7.
 */
export function terminalActionsAllowed(sessionStatus: SessionStatus): boolean {
  return sessionStatus === 'in_progress';
}

/** Whether one group's controls render at all. */
export function groupShowsControls(group: GroupModel): boolean {
  return group.scored;
}

/**
 * Whether the AMRAP extra-reps field renders.
 *
 * The two AMRAP controls are complementary, not exclusive. `+` records a
 * whole round; the field records the reps that did not fill one. A user
 * runs both in one session, so saved child detail must not hide the field:
 * the first `+` tap writes child results, and hiding the field there would
 * break the normal flow. `amrapPartialScore` keeps the round count already
 * on file, so the two controls cannot overwrite each other.
 * REQUIREMENTS 19.7, 19.8.
 */
export function amrapShowsPartial(group: GroupModel): boolean {
  return group.scored && group.scoreType === 'rounds_and_reps';
}

/** One choice the effort control lists. */
export interface EffortChoice {
  /** The select value. Opaque to the component, decoded by `effortFromChoice`. */
  value: string;
  /** What the user reads. */
  label: string;
}

/**
 * The choices the effort control offers for one programmed target.
 *
 * The list is built from the target, so a `to failure` set asks whether the
 * user reached failure and an `RIR 2` set asks for a reserve count. The
 * blank choice clears the recorded effort, because a set the user did not
 * push to the programmed target is a fact worth dropping rather than
 * misreporting. REQUIREMENT 19.9.
 */
export function effortChoices(target: EffortTarget | undefined): EffortChoice[] {
  if (target === undefined) return [];
  if (target.type === 'failure') {
    return [
      { value: '', label: 'Not recorded' },
      { value: 'failure:achieved', label: 'Reached failure' },
      { value: 'failure:missed', label: 'Stopped short of failure' }
    ];
  }
  if (target.type === 'rir') {
    const choices: EffortChoice[] = [{ value: '', label: 'Not recorded' }];
    for (let value = 0; value <= RIR_CHOICES; value += 1) {
      choices.push({ value: `rir:${value}`, label: `RIR ${value}` });
    }
    return choices;
  }
  const choices: EffortChoice[] = [{ value: '', label: 'Not recorded' }];
  for (let value = 1; value <= RPE_MAX; value += 1) {
    choices.push({ value: `rpe:${value}`, label: `RPE ${value}` });
  }
  return choices;
}

/** Reserve choices offered on an RIR row. `0` reads as failure. */
const RIR_CHOICES = 10;

/** RPE runs 1 to 10. The schema rejects anything outside that range. */
const RPE_MAX = 10;

/**
 * Decode one effort choice into a recorded outcome.
 *
 * The blank choice returns `null`, which clears the effort. A value the
 * target does not match returns `null` too, so a stale select value cannot
 * write an outcome the prescription never asked for. REQUIREMENT 19.9.
 */
export function effortFromChoice(
  target: EffortTarget | undefined,
  choice: string
): EffortOutcome | null {
  if (target === undefined || choice === '') return null;
  const separator = choice.indexOf(':');
  if (separator < 0) return null;
  const kind = choice.slice(0, separator);
  const rest = choice.slice(separator + 1);

  if (target.type === 'failure' && kind === 'failure') {
    if (rest === 'achieved') return { type: 'failure', achieved: true };
    if (rest === 'missed') return { type: 'failure', achieved: false };
    return null;
  }
  if (target.type === 'rir' && kind === 'rir') {
    const value = Number(rest);
    if (!Number.isInteger(value) || value < 0 || value > RIR_CHOICES) return null;
    return { type: 'rir', value };
  }
  if (target.type === 'rpe' && kind === 'rpe') {
    const value = Number(rest);
    if (!Number.isInteger(value) || value < 1 || value > RPE_MAX) return null;
    return { type: 'rpe', value };
  }
  return null;
}

/**
 * The select value that shows one recorded outcome.
 *
 * A missing outcome reads as the blank choice, so the control opens on
 * `Not recorded` rather than on the first listed value.
 */
export function choiceForEffort(outcome: EffortOutcome | undefined): string {
  if (outcome === undefined) return '';
  if (outcome.type === 'failure') {
    return outcome.achieved ? 'failure:achieved' : 'failure:missed';
  }
  return `${outcome.type}:${outcome.value}`;
}

/**
 * Whether the row may open one more attempt.
 *
 * An attempt is opened from a recorded result, because `addAttempt` copies
 * the identity of the attempt it follows. A row with nothing recorded has
 * nothing to follow, so the control waits for a first result.
 * REQUIREMENT 19.9.
 */
export function canAddAttempt(row: ActiveExerciseRow): boolean {
  return row.recordable && !row.unresolved && row.hasSavedResult && row.resultKey !== null;
}
