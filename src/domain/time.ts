// UTC-only persistence: formatting, parsing, and shard naming.
// Requirement 3.5 and Requirement 3.6 (persist UTC only), Requirement 3.3 and
// Requirement 3.4 (monthly shards), ARCHITECTURE C-10 and C-11.

import { AppError } from './errors';

/** File name prefix for one monthly results shard. Requirement 3.3. */
const SHARD_PREFIX = 'results-';

/** File extension for one monthly results shard. */
const SHARD_SUFFIX = '.json';

/**
 * RFC 3339 date-time in UTC. The trailing `Z` is required, so a stored value can
 * never carry a local offset. ARCHITECTURE C-10.
 */
const UTC_DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

/**
 * Format a `Date` as an RFC 3339 UTC string with whole-second precision.
 * The value ends in `Z` and carries no millisecond part. Requirement 3.5.
 */
export function toUtcIso(input: Date): string {
  if (!(input instanceof Date) || Number.isNaN(input.getTime())) {
    throw new AppError('invalid_document', { field: 'date' }, 'The date value is not valid.');
  }
  return `${input.toISOString().slice(0, 19)}Z`;
}

/**
 * Format the current instant as an RFC 3339 UTC string with whole-second precision.
 * Requirement 3.5.
 */
export function nowUtc(): string {
  return toUtcIso(new Date());
}

/**
 * Parse a persisted UTC timestamp.
 *
 * Rejects a value that does not end in `Z`, so a stored offset never enters the
 * app. ARCHITECTURE C-10.
 *
 * `Date` normalizes an impossible calendar value instead of rejecting it, so
 * `2026-02-30` becomes `2026-03-02`. The round trip below compares the parsed
 * instant with the text it came from, so a value the calendar does not hold throws
 * rather than silently moving to another day or month. REQUIREMENTS 3.5.
 */
export function parseUtc(value: string): Date {
  if (typeof value !== 'string' || !value.endsWith('Z')) {
    throw new AppError(
      'invalid_document',
      { reason: 'timestamp is not UTC' },
      'A persisted timestamp must end in "Z".'
    );
  }
  if (!UTC_DATE_TIME_PATTERN.test(value)) {
    throw new AppError(
      'invalid_document',
      { reason: 'timestamp is not RFC 3339' },
      'A persisted timestamp must be an RFC 3339 UTC date-time.'
    );
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new AppError('invalid_document', { reason: 'timestamp is unparseable' });
  }

  // Compare at whole-second precision. The stored fraction, when present, only
  // adds detail the round trip keeps, so drop it from the left side first.
  const withoutFraction = value.replace(/\.\d+Z$/, 'Z');
  const roundTrip = `${parsed.toISOString().slice(0, 19)}Z`;
  if (roundTrip !== withoutFraction) {
    throw new AppError(
      'invalid_document',
      { reason: 'timestamp is not a real calendar date-time' },
      'A persisted timestamp must name a date the calendar holds.'
    );
  }

  return parsed;
}

/**
 * Read the UTC month of a timestamp, formatted `'2026-09'`.
 * The month comes from the UTC value, never from a local calendar. ARCHITECTURE C-11.
 */
export function yearMonthUtc(startedAtUtc: string): string {
  return parseUtc(startedAtUtc).toISOString().slice(0, 7);
}

/**
 * Build the monthly results shard file name for a session start.
 * Example: `'2026-09-01T06:30:00Z'` gives `'results-2026-09.json'`.
 * Requirement 3.3 and ARCHITECTURE C-11.
 */
export function shardName(startedAtUtc: string): string {
  return `${SHARD_PREFIX}${yearMonthUtc(startedAtUtc)}${SHARD_SUFFIX}`;
}

/**
 * Report whether two UTC timestamps fall in the same UTC month.
 * Requirement 3.4 keeps one session inside one shard.
 */
export function isSameUtcMonth(a: string, b: string): boolean {
  return yearMonthUtc(a) === yearMonthUtc(b);
}
