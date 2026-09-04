/**
 * Saved-correction immutability for one results shard (P5-T01).
 *
 * Authority: docs/contracts/user-data-contracts.md row RS-04 ("Release one permits no
 * persisted-timestamp edits; result, note, status, and conflict edits keep `startedAtUtc` and the
 * original UTC shard unchanged", owner `session`, `sem` supporting), its invariant-ownership entry
 * "Invariants 14-16: result uniqueness and session shape (Phase 5)" together with spec §8 invariant 16
 * ("Every session has `updatedAtUtc`"), docs/contracts/temporal-and-
 * omission-contracts.md rows TR-05 ("Status, `startedAtUtc`, and `endedAtUtc` are preserved; only
 * `updatedAtUtc` changes for ordinary corrections") and TR-08 ("Editing a historical session updates
 * only the original shard"), and docs/REQUIREMENTS.md 11.19, 11.20, 11.21.
 *
 * The narrow question this module answers is: does this candidate shard change a persisted timestamp,
 * a terminal status, or the shard's own UTC month relative to the base shard it was edited from, and does it
 * carry a later `updatedAtUtc` for each session it edits and the base `updatedAtUtc` for each session it leaves
 * otherwise unchanged? It is not a diff engine and not a merge: canonical
 * equality, semantic diffs, and conflict keys belong to
 * Phase 36, and merge precedence, ID reservation, retry, and convergence belong to Phases 37-42.
 *
 * Req 11.21 makes the later `updatedAtUtc` part of the saved correction itself (RS-04, invariant 16, and
 * TR-05, where it is the only field an ordinary correction may change). So each session the save corrects
 * must name an instant strictly later than the base session's. An unchanged time and an earlier time are
 * both rejected; the two are one rule because a save that does not move the last-correction time left no
 * record of itself. Instants are compared, not their text, so `2026-08-20T14:45:00.000Z` is the same instant as
 * `2026-08-20T14:45:00Z` and stays unchanged, while `2026-08-20T14:45:00.0001Z` is one instant later than
 * `2026-08-20T14:45:00.0000Z` however many digits either side writes. A time either side cannot read as a
 * `Z`-suffixed instant is reported on its own code and fails closed, because advancement cannot be proven from
 * it. Readable means readable by the persisted format alone: the canonical `YYYY-MM-DDTHH:mm:ss[.fff]Z` shape,
 * whose fraction carries any number of digits, *and* a date and a time of day the calendar has. So
 * `2026-02-30T00:00:00Z` and `2026-08-20T24:00:00Z` are unreadable, rather than instants that roll into March
 * and into the next day, and this pass never proves or denies advancement from a value the schema layer
 * rejects (spec §8 invariant 26, FF-12, and the asserted `date-time` format the registry registers).
 * Second `60` is the one place the read is narrower than the registry's grammar, and the rule is RFC 3339's
 * own: §5.7 writes time-second as `00-58, 00-59, 00-60 based on leap second calendar`, and Appendix D puts that
 * extra second at the end of a UTC day. So second `60` reads only as `23:59:60` on a date the leap-second
 * calendar carries, and `LEAP_SECOND_DATES` below is that calendar. `2016-12-31T23:59:60Z` is readable;
 * `2016-12-31T23:58:60Z` is not the end of its day and `2026-06-30T23:59:60Z` is a day end that carried no
 * extra second. Reading either one as a rolled-forward instant would let a save prove an advancement from a
 * time no UTC clock has.
 *
 * The leap second also has to sit in the order, and not only be accepted. It is the extra second of its day, so
 * `2016-12-31T23:59:59.999Z` is earlier than it and `2017-01-01T00:00:00Z` is later, and a fraction written on
 * the leap second orders inside that second however many digits it writes. The day count this module uses adds
 * one second per day and knows nothing about the extra one, so the leap second and the midnight that begins
 * where the leap second ends share one whole-second count, and `compareInstants` reads the leap second first
 * at that count.
 *
 * A session is asked to advance when the save carries a relevant correction for it: some persisted fact of
 * that session other than its own `updatedAtUtc` differs from the base. A save writes a whole shard, so a
 * session the save does not correct is copied through with the last-correction time it already has, and one
 * corrected session beside untouched ones is the ordinary shape of a legal multi-session save. The copy is
 * exact in both directions, because Req 11.21 moves a session's last-correction time *after* a correction of
 * that session and Req 11.20 permits no other change to a persisted timestamp: a session the save corrects has
 * to move its time forward, and a session the save does not correct has to keep the base instant exactly, so a
 * sibling whose time moved later or rolled back earlier is reported too. The two rules are one instant
 * comparison read two ways, never two comparisons, and they stay disjoint: a session carries the advancement
 * finding or the unchanged-sibling finding, never both, and an unreadable time on either side still carries
 * only the unreadable finding. The check is a same-value read of that one pair of sessions, not the canonical
 * equality and semantic diff of Phase 36: it
 * reads the document rather than its serialization, so a session whose members are written in another order is
 * still unchanged, while one changed value deep inside a result or a frozen plan is a correction that does have
 * to advance. It walks with a queue, like every other walk in this module, because the targeted devices have a
 * small stack.
 *
 * Sessions are matched by their persisted IDs, the only identity the contract persists (RS-02). A
 * session present in only one side is a creation or a deletion, both of which are separate operations
 * (deletion writes the permanent tombstone, RS-15), so neither is a correction and neither is reported.
 *
 * Pure: both `unknown` inputs are never mutated, and no clock, storage, or browser module is read.
 */

import { isTerminalStatus } from "./result-session";
import { finalizeDiagnostics, joinPointer } from "./types";
import { makeResultDiagnostic, type ResultSemanticDiagnostic, type ResultSemanticResult } from "./result-types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStructuredShard(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && Array.isArray(value["sessions"]) && Array.isArray(value["sessionTombstones"]);
}

/**
 * The canonical persisted UTC instant shape (spec §8 invariant 26, FF-12): four-digit year, two-digit month,
 * two-digit day, `T`, two-digit hour, minute and second, an optional fraction, then `Z`. A numeric offset and
 * a lowercase `z` sit outside the shape exactly as the results schema puts them outside its `utcTimestamp`
 * definition, which pairs the asserted `date-time` format with a `Z$` pattern.
 */
const UTC_INSTANT = /^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})(\.[0-9]+)?Z$/;

/** The day count of each month of a common year, in calendar order. */
const MONTH_LENGTHS: readonly number[] = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/**
 * The UTC dates whose day carries the leap second `23:59:60`, copied from the IERS table of inserted leap
 * seconds (IERS Bulletin C, published as `leap-seconds.list`): every insertion since 1 January 1972, when the
 * present scale began, through 31 December 2016, the last insertion so far. Each of the 27 insertions is
 * positive and each sits at the end of a 30 June or a 31 December, so the table holds no other day of a month.
 *
 * The list is closed on purpose, and it is what makes RFC 3339 §5.7 "based on leap second calendar" a fact this
 * pass can read: a date outside it has a day of 86400 seconds, so `2026-06-30T23:59:60Z` names no instant. That
 * is also how a table left behind fails. The next insertion, whenever the IERS announces one, reads as an
 * unreadable time until one line is added here, and an unreadable time is a save this pass cannot prove rather
 * than a comparison of two instants it invented. Two more facts keep the lookup a plain date comparison: the
 * persisted shape is `Z`-suffixed, so the day whose end the rule looks at is the UTC day and no offset moves it,
 * and a negative leap second would remove a second instead of naming one, which RFC 3339 writes no `60` for, so
 * the list has nothing else to hold.
 */
const LEAP_SECOND_DATES: readonly string[] = [
  "1972-06-30",
  "1972-12-31",
  "1973-12-31",
  "1974-12-31",
  "1975-12-31",
  "1976-12-31",
  "1977-12-31",
  "1978-12-31",
  "1979-12-31",
  "1981-06-30",
  "1982-06-30",
  "1983-06-30",
  "1985-06-30",
  "1987-12-31",
  "1989-12-31",
  "1990-12-31",
  "1992-06-30",
  "1993-06-30",
  "1994-06-30",
  "1995-12-31",
  "1997-06-30",
  "1998-12-31",
  "2005-12-31",
  "2008-12-31",
  "2012-06-30",
  "2015-06-30",
  "2016-12-31"
];

/** The table above as a lookup. Each entry is the `YYYY-MM-DD` text a persisted timestamp carries for it. */
const LEAP_SECOND_DATE_SET: ReadonlySet<string> = new Set(LEAP_SECOND_DATES);

const SECONDS_PER_DAY = 86400;
const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_MINUTE = 60;

/** A century year is a leap year only when it divides by 400, so 2000 is and 1900 is not. */
function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

/** The last day one month of one year has, which is the calendar fact a grammar alone cannot state. */
function daysInMonth(year: number, month: number): number {
  if (month === 2 && isLeapYear(year)) {
    return 29;
  }
  return MONTH_LENGTHS[month - 1];
}

/**
 * The days from the 1970-01-01 epoch to one proleptic Gregorian calendar date. The instant of a persisted
 * time is counted from its own validated components rather than handed to a date parser, because a parser
 * rolls a date the calendar does not have into a neighbouring month or day and so turns an unreadable time
 * into a usable instant.
 */
function daysFromEpoch(year: number, month: number, day: number): number {
  // March starts the shifted year, which moves the one leap day of a leap year to its end.
  const shiftedYear = month <= 2 ? year - 1 : year;
  const era = Math.floor(shiftedYear / 400);
  const yearOfEra = shiftedYear - era * 400;
  const monthOfEra = month <= 2 ? month + 9 : month - 3; // March is 0, February is 11.
  const dayOfEra =
    yearOfEra * 365 +
    Math.floor(yearOfEra / 4) -
    Math.floor(yearOfEra / 100) +
    Math.floor((153 * monthOfEra + 2) / 5) +
    (day - 1);
  return era * 146097 + dayOfEra - 719468;
}

/**
 * One persisted instant the advancement rule compares. The whole seconds and the fraction are kept apart
 * because the fraction has no fixed length: RFC 3339 writes it as `"."` followed by any number of digits, and
 * scaling it into the seconds would cap the comparison at whichever unit the scale picks. `compareInstants`
 * below is the only reader of these three fields.
 */
interface Instant {
  /**
   * The whole seconds from the 1970-01-01 epoch, counted from the validated components. One date carries two
   * values on the same count, which is the fact `compareInstants` settles: the leap second of `LEAP_SECOND_DATES`
   * and the midnight of the day after it.
   */
  readonly epochSeconds: number;
  /** Whether the value is the leap second itself, which is the earlier of the two values on its count. */
  readonly isLeapSecond: boolean;
  /** The digits after the decimal point exactly as written, and `""` when the text carries no fraction. */
  readonly fraction: string;
}

/**
 * The instant a persisted last-correction time denotes, or null when it cannot be read: a missing field, a
 * non-string, an empty string, a numeric offset, a lowercase `z`, a value outside the canonical shape, and a
 * date or time of day the calendar does not have all read as null, so the caller never infers advancement
 * from an unreadable time. The fraction keeps every digit RFC 3339 allows, so a difference narrower than any
 * unit orders correctly against its neighbour. Second `60` is read only where RFC 3339 and the leap-second
 * calendar put it: as `23:59:60` on one of the dates `LEAP_SECOND_DATES` carries, which denotes the extra second
 * one second after `23:59:59` and ending where the next midnight begins. Second `60` in any other minute, and
 * second `60` on any other date, names no instant, so it reads as null rather than as a second this pass can
 * compare.
 */
function readInstant(value: unknown): Instant | null {
  if (typeof value !== "string") {
    return null;
  }
  const parts = UTC_INSTANT.exec(value);
  if (parts === null) {
    return null;
  }
  const year = Number(parts[1]);
  const month = Number(parts[2]);
  const day = Number(parts[3]);
  const hour = Number(parts[4]);
  const minute = Number(parts[5]);
  const second = Number(parts[6]);
  if (month < 1 || month > 12) {
    return null; // month `00` and month `13` name no month
  }
  if (day < 1 || day > daysInMonth(year, month)) {
    return null; // `2026-02-30`, `2026-02-29` in a common year, and `2026-04-31` name no day
  }
  if (hour > 23 || minute > 59 || second > 60) {
    return null; // `24:00` and `23:60` name no time of day
  }
  let isLeapSecond = false;
  if (second === 60) {
    // RFC 3339 §5.7 caps second at `59` outside the leap second, its Appendix D puts that extra second at the
    // end of a UTC day, and §5.7 admits it only where the leap-second calendar carries one. So `12:00:60` and
    // `23:58:60` name no instant, and neither does `23:59:60` on a date the table leaves out: that day, such as
    // `2026-06-30`, has 86400 seconds and no sixtieth second in its last minute.
    if (hour !== 23 || minute !== 59) {
      return null;
    }
    // The three captures are the date text exactly as written, and it is the text the table is keyed by.
    if (LEAP_SECOND_DATE_SET.has(parts[1] + "-" + parts[2] + "-" + parts[3]) === false) {
      return null;
    }
    isLeapSecond = true;
  }
  return {
    // The day count adds one second per day, so this is also the count the midnight after a leap second gets.
    epochSeconds:
      daysFromEpoch(year, month, day) * SECONDS_PER_DAY +
      hour * SECONDS_PER_HOUR +
      minute * SECONDS_PER_MINUTE +
      second,
    isLeapSecond,
    // `parts[7]` carries the leading point, which is not a digit and is not a fact of the fraction.
    fraction: parts[7] === undefined ? "" : parts[7].slice(1)
  };
}

/**
 * Compare two fractions of a second: negative, zero, positive. Each missing digit of the shorter side is a zero, so
 * `"5"`, `"50"`, and `"5000"` are the same fraction and `"0001"` follows `"0000"`. Digits compare in their
 * character order, which is their numeric order, and no digit is dropped however long either side writes.
 */
function compareFractions(left: string, right: string): number {
  const digits = left.length > right.length ? left.length : right.length;
  for (let i = 0; i < digits; i += 1) {
    // A digit past the end of a fraction is a zero, the digit `0` being code point 48.
    const leftDigit = i < left.length ? left.charCodeAt(i) : 48;
    const rightDigit = i < right.length ? right.charCodeAt(i) : 48;
    if (leftDigit !== rightDigit) {
      return leftDigit < rightDigit ? -1 : 1;
    }
  }
  return 0;
}

/**
 * Compare two readable instants: negative, zero, or positive when the first is earlier than, the same as, or
 * later than the second.
 * Two texts that denote the same instant compare equal however each writes the fraction, so an unchanged
 * last-correction time stays unchanged whether or not the save rewrote its text. The whole-second count is read
 * first and the leap second inside it second, which puts `23:59:60` and every fraction written on it strictly
 * before the midnight of the next day.
 */
function compareInstants(left: Instant, right: Instant): number {
  if (left.epochSeconds !== right.epochSeconds) {
    return left.epochSeconds < right.epochSeconds ? -1 : 1;
  }
  // Two values share this count only at a leap second: the leap second of one of the 27 days and the midnight
  // that begins where that second ends. The leap second fills the count first and ends at its next whole second,
  // so the leap second is the earlier value and any fraction it carries stays inside it, below the midnight.
  if (left.isLeapSecond !== right.isLeapSecond) {
    return left.isLeapSecond ? -1 : 1;
  }
  return compareFractions(left.fraction, right.fraction);
}

/** One pair of JSON values the correction comparison still has to read. */
interface ValuePair {
  readonly left: unknown;
  readonly right: unknown;
}

/** The member names a record is compared on: a member either side leaves `undefined` names no fact. */
function factKeys(record: Record<string, unknown>): string[] {
  const keys: string[] = [];
  for (const key of Object.keys(record)) {
    if (record[key] !== undefined) {
      keys.push(key);
    }
  }
  return keys;
}

/**
 * Whether two JSON values say the same thing. Member order is not a fact of a document, so two records with
 * the same members are equal however they are written, and each value is compared by its own kind. The walk
 * is iterative because a compared session carries a frozen plan that nests as deep as a workout tree and the
 * targeted devices have a small stack.
 */
function sameJsonValue(left: unknown, right: unknown): boolean {
  const queue: ValuePair[] = [{ left, right }];
  for (let i = 0; i < queue.length; i += 1) {
    const pair: ValuePair | undefined = queue[i];
    if (pair === undefined) {
      continue;
    }
    if (pair.left === pair.right) {
      continue; // equal primitive, equal null, or one shared value
    }
    if (Array.isArray(pair.left) && Array.isArray(pair.right)) {
      if (pair.left.length !== pair.right.length) {
        return false;
      }
      for (let c = 0; c < pair.left.length; c += 1) {
        queue.push({ left: pair.left[c], right: pair.right[c] });
      }
      continue;
    }
    if (isRecord(pair.left) && isRecord(pair.right)) {
      const keys = factKeys(pair.left);
      if (keys.length !== factKeys(pair.right).length) {
        return false;
      }
      for (const key of keys) {
        const other = pair.right[key];
        if (other === undefined) {
          return false; // the other side drops a fact this side has
        }
        queue.push({ left: pair.left[key], right: other });
      }
      continue;
    }
    return false; // two different JSON kinds, or two primitives that differ
  }
  return true;
}

/**
 * The session as the correction comparison reads it: every persisted field except its own last-correction
 * time, which is the field the advancement rule below is about.
 */
function sessionFacts(session: Record<string, unknown>): Record<string, unknown> {
  const facts: Record<string, unknown> = {};
  for (const key of Object.keys(session)) {
    if (key !== "updatedAtUtc") {
      facts[key] = session[key];
    }
  }
  return facts;
}

/**
 * Whether this save corrects the session: some persisted fact of it other than `updatedAtUtc` differs from
 * the base session. A session with no such difference carries the last-correction time the base already has,
 * and Req 11.21 asks that time to move only after a saved correction: an unchanged session has to keep the base
 * instant, and a moved or rolled-back sibling time is the caller's finding, not this function's.
 */
function hasRelevantCorrection(
  baseSession: Record<string, unknown>,
  candidateSession: Record<string, unknown>
): boolean {
  return sameJsonValue(sessionFacts(baseSession), sessionFacts(candidateSession)) === false;
}

/** Index readable session IDs to their session and position; the first entry wins. */
function indexSessions(shard: Record<string, unknown>): Map<string, { session: Record<string, unknown>; index: number }> {
  const index = new Map<string, { session: Record<string, unknown>; index: number }>();
  const raw = shard["sessions"];
  const sessions: readonly unknown[] = Array.isArray(raw) ? raw : [];
  for (let i = 0; i < sessions.length; i += 1) {
    const session = sessions[i];
    if (!isRecord(session) || typeof session["id"] !== "string" || session["id"].length === 0) {
      continue; // without a persisted ID no identity rule can be proven
    }
    if (!index.has(session["id"])) {
      index.set(session["id"], { session, index: i });
    }
  }
  return index;
}

/**
 * Compare a candidate shard against the base shard a correction started from and report only the
 * fields release one forbids a correction to change.
 */
export function validateShardCorrection(baseDocument: unknown, candidateDocument: unknown): ResultSemanticResult {
  const diagnostics: ResultSemanticDiagnostic[] = [];

  if (!isStructuredShard(baseDocument) || !isStructuredShard(candidateDocument)) {
    diagnostics.push(makeResultDiagnostic("results-document-unstructured", ""));
  } else {
    const baseMonth = baseDocument["yearMonthUtc"];
    const candidateMonth = candidateDocument["yearMonthUtc"];
    // TR-08: a correction writes to the original shard only, so the shard identity never moves.
    if (typeof baseMonth === "string" && candidateMonth !== baseMonth) {
      diagnostics.push(makeResultDiagnostic("shard-year-month-immutable", "/yearMonthUtc"));
    }

    const candidate = indexSessions(candidateDocument);
    const base = indexSessions(baseDocument);

    base.forEach((entry, id) => {
      const other = candidate.get(id);
      if (other === undefined) {
        return; // creation or deletion, not a correction
      }
      const pointer = joinPointer("/sessions", other.index);

      // Req 11.20 and RS-04: `startedAtUtc` is never edited, in any session state.
      const baseStart = entry.session["startedAtUtc"];
      if (typeof baseStart === "string" && other.session["startedAtUtc"] !== baseStart) {
        diagnostics.push(makeResultDiagnostic("session-start-immutable", joinPointer(pointer, "startedAtUtc")));
      }

      // TR-05 and Req 11.19: an existing `endedAtUtc` is preserved once the session became terminal.
      const baseEnd = entry.session["endedAtUtc"];
      if (typeof baseEnd === "string" && other.session["endedAtUtc"] !== baseEnd) {
        diagnostics.push(makeResultDiagnostic("session-ended-at-immutable", joinPointer(pointer, "endedAtUtc")));
      }

      // Req 11.19: editing preserves the status of a terminal session. A base `in_progress` session may
      // still be completed or abandoned by this save, which is a transition and not a correction. The
      // transition still advances `updatedAtUtc` below (TR-04).
      if (isTerminalStatus(entry.session) && other.session["status"] !== entry.session["status"]) {
        diagnostics.push(makeResultDiagnostic("session-status-immutable", joinPointer(pointer, "status")));
      }

      // Req 11.21 and TR-05: the saved correction advances `updatedAtUtc` and advances it forward only, and a
      // session the save does not correct keeps its base time exactly. The comparison never cascades: the rules
      // above report what the save changed, this one reports that the save left no later last-correction time
      // behind a correction or changed a last-correction time with no correction behind it.
      //
      // Only a session the save corrects is asked to advance. A shard save writes every session it holds, so
      // the sessions it does not correct are copied through with the time the base already has, and one
      // corrected session beside untouched ones is a legal save, not a missing advancement. The untouched
      // sibling is copied through *exactly*: Req 11.21 licenses a later time only for a session this save
      // corrects, so a sibling that moved forward or rolled back has changed a persisted timestamp Req 11.20
      // leaves alone. Only a readable instant on both sides is comparable, so the unreadable-time rule keeps
      // applying to every shared session and reports alone, because a session that carries no readable
      // last-correction time is a session neither side can prove anything about.
      const baseUpdated = readInstant(entry.session["updatedAtUtc"]);
      const candidateUpdated = readInstant(other.session["updatedAtUtc"]);
      const updatedAtPointer = joinPointer(pointer, "updatedAtUtc");
      if (baseUpdated === null || candidateUpdated === null) {
        diagnostics.push(makeResultDiagnostic("session-updated-at-unreadable", updatedAtPointer));
      } else {
        // One instant comparison per session, read two ways by whether this save corrects the session.
        const order = compareInstants(candidateUpdated, baseUpdated);
        if (hasRelevantCorrection(entry.session, other.session)) {
          if (order <= 0) {
            diagnostics.push(makeResultDiagnostic("session-updated-at-not-advanced", updatedAtPointer));
          }
        } else if (order !== 0) {
          // Same instant written another way is the same instant, so a save that re-serializes an untouched
          // session keeps that session untouched and stays clean here.
          diagnostics.push(makeResultDiagnostic("session-updated-at-changed-without-correction", updatedAtPointer));
        }
      }
    });
  }

  const finalized = finalizeDiagnostics(diagnostics);
  return { valid: finalized.length === 0, diagnostics: finalized };
}
