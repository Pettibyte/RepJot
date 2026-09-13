// Bounded in-memory diagnostic ring with a JSON download.
// REQUIREMENTS 12.11, 12.12. ARCHITECTURE ADR-016, section 11.
//
// The ring holds at most `MAX_DIAGNOSTIC_EVENTS` events and drops the oldest.
// Nothing here persists, uploads, salts, or aliases a diagnostic. The log never
// reaches Drive. REQUIREMENTS 12.12.
//
// A context key that names a credential is refused before it enters the ring, so a
// careless caller cannot put a token in the log a person can download.

import { AppError } from '../domain/errors';
import { nowUtc } from '../domain/time';

/** Hard cap on retained events. The oldest event is dropped first. REQUIREMENTS 12.12. */
export const MAX_DIAGNOSTIC_EVENTS = 200;

/** Code for the event the context guard writes. */
const GUARD_CODE = 'diagnostic_context_guard';

/** A context key that matches this names a credential, so it is refused. */
const BANNED_CONTEXT_KEY = /token|authorization|header|secret/i;

/**
 * String value shapes that carry a credential.
 *
 * A key filter alone misses a token carried under a neutral key such as `value`.
 * These patterns name the credential shapes REP JOT actually handles: a Google
 * access token, an `Authorization` style scheme prefix, a Google API key, and a
 * Google refresh token. REQUIREMENTS 12.12.
 *
 * There is deliberately no generic long-base64 rule. Drive file IDs and ETags are
 * long, legitimate, and needed for diagnosis, so a broad rule would destroy real
 * diagnostic data.
 */
const CREDENTIAL_VALUE_PATTERNS: readonly RegExp[] = [
  /ya29\./,
  /\b(bearer|basic)\s+[A-Za-z0-9._-]/i,
  /AIza[0-9A-Za-z_-]{20,}/,
  /^\d{6,}-[0-9a-zA-Z_]{20,}/,
  /^\s*Bearer%20/i
];

/** Placeholder that replaces a credential-shaped value. The key stays. */
const REDACTED = '[redacted]';

/** One short structured support event. */
export interface DiagnosticEvent {
  /** When the event was recorded, RFC 3339 UTC. */
  recordedAtUtc: string;
  /** How serious the event is. */
  severity: 'info' | 'warn' | 'error';
  /** Stable code, for example `'sync_upload_retry'`. */
  code: string;
  /** Safe scalar context only. Never a token, a header, a body, or a note. */
  context?: Record<string, string | number>;
}

/** An event as a caller supplies it, before the timestamp is added. */
export type DiagnosticInput = Omit<DiagnosticEvent, 'recordedAtUtc'>;

/** The ring. Oldest at index 0, newest at the end. Never persisted. */
const ring: DiagnosticEvent[] = [];

/** Append one event and trim the oldest beyond the cap. */
function append(event: DiagnosticEvent): void {
  ring.push(event);
  if (ring.length > MAX_DIAGNOSTIC_EVENTS) ring.splice(0, ring.length - MAX_DIAGNOSTIC_EVENTS);
}

/** Split a context object into the safe part and the guard counters. */
function sanitizeContext(context: Record<string, string | number>): {
  safe: Record<string, string | number>;
  refusedKeys: number;
  redactedValues: number;
} {
  const safe: Record<string, string | number> = {};
  let refusedKeys = 0;
  let redactedValues = 0;
  for (const key of Object.keys(context)) {
    if (BANNED_CONTEXT_KEY.test(key)) {
      refusedKeys += 1;
      continue;
    }
    const value = context[key];
    if (typeof value === 'string' && CREDENTIAL_VALUE_PATTERNS.some((pattern) => pattern.test(value))) {
      safe[key] = REDACTED;
      redactedValues += 1;
      continue;
    }
    safe[key] = value;
  }
  return { safe, refusedKeys, redactedValues };
}

/**
 * Record one diagnostic event.
 *
 * A context key that matches `/token|authorization|header|secret/i` is dropped,
 * and a value that matches a credential shape is replaced with `'[redacted]'`.
 * The event is still recorded with its safe keys and its redacted values, and a
 * `warn` guard event follows it. No refused name and no credential value ever
 * enters the ring. REQUIREMENTS 12.12.
 *
 * Guard events coalesce. When the newest ring entry is already the guard event
 * for the same source code, that entry takes the new counters and moves behind
 * the event being recorded, instead of a second guard event being appended. One
 * chatty code therefore costs one ring slot, so violations cannot halve the
 * retained window of the events a support case needs. REQUIREMENTS 12.12.
 */
export function logDiagnostic(event: DiagnosticInput): void {
  const { safe, refusedKeys, redactedValues } = sanitizeContext(event.context ?? {});
  const source: DiagnosticEvent = {
    recordedAtUtc: nowUtc(),
    severity: event.severity,
    code: event.code,
    context: safe
  };
  const violated = refusedKeys > 0 || redactedValues > 0;
  const newest = ring[ring.length - 1];
  const guard = violated && newest !== undefined && newest.code === GUARD_CODE
    ? newest
    : undefined;

  if (guard !== undefined && guard.context !== undefined && guard.context.sourceCode === event.code) {
    guard.context.refusedKeys = numberOr(guard.context.refusedKeys) + refusedKeys;
    guard.context.redactedValues = numberOr(guard.context.redactedValues) + redactedValues;
    guard.recordedAtUtc = nowUtc();
    // Keep the guard behind the event it describes, so the ring still reads
    // source event then guard event.
    ring.pop();
    append(source);
    append(guard);
    return;
  }

  append(source);
  if (violated) {
    append({
      recordedAtUtc: nowUtc(),
      severity: 'warn',
      code: GUARD_CODE,
      context: { sourceCode: event.code, refusedKeys, redactedValues }
    });
  }
}

/** Read a guard counter, treating a missing or non-numeric value as zero. */
function numberOr(value: string | number | undefined): number {
  return typeof value === 'number' ? value : 0;
}

/**
 * Snapshot of the ring, oldest first.
 *
 * The returned array, each event in it, and each `event.context` in those events
 * are copies. A caller may write to them without touching the ring. Context
 * values are `string | number`, so a two-level copy reaches every value.
 */
export function diagnosticSnapshot(): DiagnosticEvent[] {
  return ring.map((event) => ({
    recordedAtUtc: event.recordedAtUtc,
    severity: event.severity,
    code: event.code,
    context: event.context === undefined ? undefined : { ...event.context }
  }));
}

/** The ring as indented JSON, oldest first. */
export function diagnosticJson(): string {
  return JSON.stringify(diagnosticSnapshot(), null, 2);
}

/**
 * Offer the log as a JSON file download. Settings calls this.
 * REQUIREMENTS 12.11.
 *
 * Rejects with `AppError('storage')` and `reason: 'no_dom'` on a host with no
 * document or no object URL support. The log is never uploaded.
 */
export function downloadDiagnosticLog(): void {
  if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') {
    throw new AppError('storage', { reason: 'no_dom' }, 'This host cannot download the diagnostic log.');
  }
  const stamp = nowUtc().replace(/[:]/g, '');
  const url = URL.createObjectURL(new Blob([diagnosticJson()], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `repjot-diagnostics-${stamp}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Drop every retained event.
 *
 * Test support only. Production code never calls this: the ring clears itself by
 * dropping the oldest event, and a user clears it by closing the tab.
 */
export function resetDiagnosticLog(): void {
  ring.length = 0;
}
