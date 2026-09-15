// The route table, the hash parser, and the hash formatter.
// ARCHITECTURE ADR-001 and section 9 "Routes". REQUIREMENTS 16.1 and 16.2.
//
// Why a hash router. Static hosting at GitHub Pages runs no server code, so a
// path route such as `/sessions/abc` returns 404 on reload. A hash route needs
// no rewrite rule, so a reload or a bookmark restores the same screen.
//
// This module is pure. It reads no browser object and imports no routing
// library. `parseHash` never throws: an address it cannot match returns the
// `not-found` route with the attempted text preserved, so the shell can show
// what the user typed instead of failing.

/** The three tab-root route names. REQUIREMENTS 16.1. */
export type TabRootName = 'home' | 'history' | 'settings';

/** Every route the shell recognizes. */
export type Route =
  | { name: 'home' }
  | { name: 'workout-overview'; workoutId: string }
  | { name: 'session-active'; sessionId: string }
  | { name: 'session-summary'; sessionId: string }
  | { name: 'history' }
  | { name: 'exercise-history'; exerciseId: string }
  | { name: 'settings' }
  | { name: 'raw-json'; source: string }
  | { name: 'not-found'; attempted: string };

/**
 * The route names that render the tab header.
 *
 * The shell reads this list to pick the header variant. Every route outside it
 * renders the compact back header. REQUIREMENTS 16.1 and 16.2.
 */
export const TAB_ROOTS: ReadonlyArray<TabRootName> = ['home', 'history', 'settings'];

import { isIntegerLikeKey } from '../domain/ids';

/**
 * The characters an ID segment may hold.
 *
 * The rule matches the ID contract in `domain/ids.ts`: no `/`, no `|`, no `:`.
 * A route param that fails this check is not an ID this app can look up, so the
 * parser returns not-found instead of passing junk to a screen.
 */
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Upper bound on one ID segment. A longer segment is junk, not an ID. */
const MAX_ID_LENGTH = 128;

/** Decode one percent-encoded segment. `null` when the encoding is malformed. */
function decodeSegment(raw: string): string | null {
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

/**
 * Validate one ID segment and return the decoded value.
 *
 * The decode runs first because a percent-encoded `/` would otherwise split the
 * path later. A segment that is empty, over-long, or holds a character outside
 * the ID rule returns `null`.
 */
function readId(raw: string): string | null {
  const decoded = decodeSegment(raw);
  if (decoded === null) return null;
  if (decoded.length === 0 || decoded.length > MAX_ID_LENGTH) return null;
  if (!SAFE_ID_PATTERN.test(decoded)) return null;
  // An all-digit key is rejected for the same reason the storage layer rejects
  // it: JavaScript iterates integer keys ahead of string keys, which breaks the
  // ordering every index depends on. Requirement 3.17 and Requirement 3.18.
  if (isIntegerLikeKey(decoded)) return null;
  return decoded;
}

/** Drop the leading `#` from a hash. */
function withoutLeadingHash(hash: string): string {
  return hash.startsWith('#') ? hash.slice(1) : hash;
}

/**
 * The attempted address in the form the shell shows.
 *
 * The value keeps the leading `#` so `formatRoute(parseHash(x))` returns the
 * same string the user typed. A bare or empty hash normalizes to `#/`.
 */
function normalizeAttempted(hash: string): string {
  const trimmed = hash.trim();
  if (trimmed.length === 0) return '#/';
  return trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
}

/** Split a hash into its non-empty path segments. */
function segments(hash: string): string[] {
  return withoutLeadingHash(hash)
    .split('/')
    .filter((segment: string): boolean => segment.length > 0);
}

/**
 * Parse a location hash into a typed `Route`.
 *
 * A hash with no path is the home route. Each other shape maps to one route and
 * validates its ID segment. Anything else, including a malformed ID or a wrong
 * segment count, returns `not-found` with the attempted text.
 */
export function parseHash(hash: string): Route {
  const attempted = normalizeAttempted(hash);
  const parts = segments(hash);
  const notFound: Route = { name: 'not-found', attempted };

  if (parts.length === 0) return { name: 'home' };

  const [first, second, third] = parts;

  if (parts.length === 2 && first === 'workouts') {
    const workoutId = readId(second);
    return workoutId === null ? notFound : { name: 'workout-overview', workoutId };
  }

  if (parts.length === 3 && first === 'sessions') {
    const sessionId = readId(second);
    if (sessionId === null) return notFound;
    if (third === 'active') return { name: 'session-active', sessionId };
    if (third === 'summary') return { name: 'session-summary', sessionId };
    return notFound;
  }

  if (parts.length === 1 && first === 'history') return { name: 'history' };

  if (parts.length === 3 && first === 'exercises') {
    const exerciseId = readId(second);
    if (exerciseId === null || third !== 'history') return notFound;
    return { name: 'exercise-history', exerciseId };
  }

  if (parts.length === 1 && first === 'settings') return { name: 'settings' };

  if (parts.length === 2 && first === 'raw') {
    const source = readId(second);
    return source === null ? notFound : { name: 'raw-json', source };
  }

  return notFound;
}

/**
 * Format a route as a location hash.
 *
 * The inverse of `parseHash` for every route except `not-found`, which carries
 * the address the user typed and formats back to that same address.
 */
export function formatRoute(route: Route): string {
  switch (route.name) {
    case 'home':
      return '#/';
    case 'workout-overview':
      return `#/workouts/${encodeURIComponent(route.workoutId)}`;
    case 'session-active':
      return `#/sessions/${encodeURIComponent(route.sessionId)}/active`;
    case 'session-summary':
      return `#/sessions/${encodeURIComponent(route.sessionId)}/summary`;
    case 'history':
      return '#/history';
    case 'exercise-history':
      return `#/exercises/${encodeURIComponent(route.exerciseId)}/history`;
    case 'settings':
      return '#/settings';
    case 'raw-json':
      return `#/raw/${encodeURIComponent(route.source)}`;
    case 'not-found':
      return normalizeAttempted(route.attempted);
  }
}

/** True when the route renders the tab header. REQUIREMENTS 16.1. */
export function isTabRoot(route: Route): boolean {
  return TAB_ROOTS.indexOf(route.name as TabRootName) >= 0;
}

/**
 * The route the back control returns to.
 *
 * Each detail route names its own parent. The raw viewer returns home because
 * it opens from an error card, and the card's own screen stays reachable from
 * the tab bar.
 */
export function parentRoute(route: Route): Route {
  switch (route.name) {
    case 'workout-overview':
    case 'session-active':
    case 'session-summary':
    case 'raw-json':
      return { name: 'home' };
    case 'exercise-history':
      return { name: 'history' };
    default:
      return { name: 'home' };
  }
}
