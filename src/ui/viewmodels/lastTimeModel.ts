// The Last Time badge model and the read behind it.
// Phase 17. REQUIREMENTS 19.3-19.5.
//
// One badge answers "what did I do last time" beside an exercise. Two
// screens draw it: Active Workout, where the badge also carries the fill
// control, and Workout Overview, where the badge only reports. Both read
// through this module so the two never drift on what "last time" means.
//
// The read lives here rather than in either screen for one reason: the rule
// about which session counts. The badge shows the latest completed set from
// an **earlier** session. The session under edit is skipped by id, not by
// status, because REQUIREMENT 11.16 opens a completed or abandoned session
// in the same editor. A `getLastTime` call alone skips only `in_progress`
// sessions, so editing a finished session would show the very set being
// edited. REQUIREMENTS 19.4, 11.16.

import { formatRoute } from '../../routing/routes';
import type { LookupService } from '../../indexes/lookup-service';
import type { ResultValues } from '../../domain/types';
import { DIMENSION_ORDER, type Dimension } from '../../units/conversion';
import { formatMinuteValue, formatStep, unitLabel } from '../../units/format';

/** The Last Time badge content. REQUIREMENTS 19.3-19.5. */
export interface LastTimeModel {
  /** `'none'` renders `No history`. */
  kind: 'value' | 'none';
  /** Recorded values with units, for example `8 reps · 185 lb`. */
  text: string;
  /** Local date of that session. Absent when there is no history. */
  dateLabel?: string;
  /** Exercise History address. Absent when the exercise is unknown. */
  href?: string;
  /**
   * The recorded values behind `text`, in the units they were stored in.
   *
   * The **Fill with last time** control writes these into a row's fields.
   * `text` cannot fill an input: it folds the unit into one display string,
   * while a field needs the number and the unit apart, and needs the unit
   * the field shows rather than the unit first recorded.
   * REQUIREMENTS 19.4, 19.11.
   *
   * A screen that only reports — Workout Overview — ignores this field. It
   * carries no input to write into, so it draws the badge with no fill
   * control and the values stay unread.
   */
  fill?: ResultValues;
}

/**
 * How many stored occurrences the Last Time scan reads.
 *
 * The scan skips the session under edit, so the badge may have to walk past
 * the newest entry to reach an earlier session. The window is wide enough
 * to cover a run of edits on one session and small enough to stay a
 * bounded read on every row.
 */
const LAST_TIME_SCAN_SIZE = 25;

/** Display step for a repetition count. Reps are whole numbers. */
const REPS_STEP = 1;

/** Display step for every measured quantity. REQUIREMENTS 12.5. */
const MEASURED_STEP = 0.1;

/** The step one dimension displays at. Reps are whole; the rest read to 0.1. */
function stepFor(dimension: Dimension): number {
  return dimension === 'reps' ? REPS_STEP : MEASURED_STEP;
}

/**
 * The Last Time badge for one exercise.
 *
 * `excludeSessionId` names a session the badge must not read. Active Workout
 * passes the session under edit. A screen with no session in hand — Workout
 * Overview — passes nothing, and the badge reads the newest completed set in
 * the index.
 *
 * REQUIREMENTS 19.4, 11.16.
 */
export function buildLastTime(
  exerciseId: string,
  lookup: LookupService,
  excludeSessionId = ''
): LastTimeModel {
  const href = formatRoute({ name: 'exercise-history', exerciseId });
  const page = lookup.getExerciseHistory(exerciseId, { offset: 0, limit: LAST_TIME_SCAN_SIZE });

  for (const occurrence of page.items) {
    if (occurrence.status !== 'completed') continue;
    if (occurrence.sessionId === excludeSessionId) continue;

    const parts: string[] = [];
    for (const dimension of DIMENSION_ORDER) {
      const quantity = occurrence.values?.[dimension];
      if (quantity === undefined) continue;
      // A read-only line drops the trailing `.0`. `formatEditable` keeps one
      // decimal because an editable field must show the digit the user types
      // into; a badge is not a field. `225 lb`, not `225.0 lb`.
      const step = stepFor(dimension);
      const shown =
        quantity.unit === 'minute'
          ? formatMinuteValue(quantity.value)
          : formatStep(quantity.value, step);
      parts.push(`${shown} ${unitLabel(quantity.unit)}`);
    }
    if (parts.length === 0) break;

    return {
      kind: 'value',
      text: parts.join(' · '),
      // The same values the badge just read, kept whole so a fill tap does
      // not have to parse its own display string back apart.
      fill: { ...(occurrence.values ?? {}) },
      dateLabel: occurrence.completedAtUtc.slice(0, 10),
      href
    };
  }

  return { kind: 'none', text: 'No history', href };
}
