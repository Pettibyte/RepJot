// Correctness audit for checklist area 19.
//
// ARCHITECTURE section 17 defines `bun run test` as the release test command.
// That package script runs both the unit suite and the separate DOM suite.
// The release gate must not bypass it with a root-only `bun test` command.

import { expect, test } from 'bun:test';

test('the release gate runs the package test script that includes DOM tests', async () => {
  const source = await Bun.file(new URL('../scripts/release-check.ts', import.meta.url)).text();

  expect(source).toContain("argv: ['bun', 'run', 'test']");
  expect(source).not.toContain("argv: ['bun', 'test']");
});
