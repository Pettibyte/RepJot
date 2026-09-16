// Regression: the shipped CSP must allow the same-origin data fetch.
//
// The app loads its exercise and workout bundles from its own origin.
// `src/documents/static-loader.ts` fetches `./data/exercises.json` and
// `./data/workouts.json`. A browser applies an explicit `connect-src` in
// place of `default-src` for that directive, not in addition to it. A
// `connect-src` that names only the Google origins therefore blocks the
// same-origin fetch, and the app cannot start.
//
// Production reported:
//   Content-Security-Policy: The page's settings blocked the loading of a
//   resource (connect-src) at https://repjot.com/data/exercises.json
//   because it violates the following directive: "connect-src
//   https://www.googleapis.com https://oauth2.googleapis.com"

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

/** Parse one CSP directive's source list out of a policy string. */
function sourcesOf(policy: string, directive: string): string[] {
  for (const part of policy.split(';')) {
    const tokens = part.trim().split(/\s+/).filter((t) => t.length > 0);
    if (tokens[0]?.toLowerCase() === directive) return tokens.slice(1);
  }
  return [];
}

/** Read the CSP meta tag out of a built index.html. */
function policyFromHtml(html: string): string {
  const tag = /<meta\b[^>]*http-equiv=(['"])Content-Security-Policy\1[^>]*>/i.exec(html);
  expect(tag).not.toBeNull();
  const content = /\bcontent=(['"])([\s\S]*?)\1/i.exec(tag![0]);
  expect(content).not.toBeNull();
  return content![2];
}

/**
 * The rule a browser applies: an explicit directive replaces the fallback.
 * A same-origin fetch is allowed only when the explicit list says so.
 */
function allowsSameOriginConnect(policy: string): boolean {
  const connect = sourcesOf(policy, 'connect-src');
  if (connect.length === 0) {
    // No explicit connect-src, so default-src governs.
    return sourcesOf(policy, 'default-src').includes("'self'");
  }
  return connect.includes("'self'");
}

describe('shipped CSP allows the same-origin data fetch', () => {
  const html = readFileSync('dist/index.html', 'utf8');
  const policy = policyFromHtml(html);

  test('connect-src names the Google origins the app calls', () => {
    const connect = sourcesOf(policy, 'connect-src');
    expect(connect).toContain('https://www.googleapis.com');
    expect(connect).toContain('https://oauth2.googleapis.com');
  });

  test('connect-src includes self, so ./data/exercises.json can load', () => {
    expect(sourcesOf(policy, 'connect-src')).toContain("'self'");
  });

  test('the same-origin connect is permitted under browser fallback rules', () => {
    expect(allowsSameOriginConnect(policy)).toBe(true);
  });

  test('the data files the loader fetches ship in the bundle', () => {
    expect(readFileSync('dist/data/exercises.json', 'utf8')).toContain('repjot/exercises');
    expect(readFileSync('dist/data/workouts.json', 'utf8')).toContain('repjot/workouts');
  });
});

describe('the fallback rule itself is modelled correctly', () => {
  test('an explicit connect-src without self blocks, even with default-src self', () => {
    const broken =
      "default-src 'self'; connect-src https://www.googleapis.com";
    expect(allowsSameOriginConnect(broken)).toBe(false);
  });

  test('an explicit connect-src with self allows', () => {
    const fixed = "default-src 'self'; connect-src 'self' https://www.googleapis.com";
    expect(allowsSameOriginConnect(fixed)).toBe(true);
  });

  test('no explicit connect-src falls back to default-src self', () => {
    const fallback = "default-src 'self'";
    expect(allowsSameOriginConnect(fallback)).toBe(true);
  });
});
