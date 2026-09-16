/**
 * Release gate runner. `bun run release:check`
 *
 * Runs the automated release gates in order, then prints the manual gates that
 * still need a person. Phase 20 owns this file. See `docs/RELEASE.md`.
 *
 * The runner stops at the first failure and exits non-zero, so a caller can gate
 * a publish on this command alone. Each gate is one repo command. The runner
 * adds no logic of its own; it sequences, times, and reports.
 *
 * Manual gates never block this script. A human records them in `docs/RELEASE.md`
 * before the release tag goes up. The script prints them at the end so nobody
 * has to remember the list.
 */

interface Gate {
  /** Short name shown in the results table. */
  name: string;
  /** Command arguments passed to the shell. */
  argv: string[];
  /** What the gate proves. */
  proves: string;
}

const AUTOMATED_GATES: readonly Gate[] = [
  {
    name: 'install',
    argv: ['bun', 'ci'],
    proves: 'The lockfile installs with no drift.'
  },
  {
    name: 'type check',
    argv: ['bun', 'run', 'check'],
    proves: 'TypeScript and Svelte types are clean.'
  },
  {
    // `bun run test` is the package script that runs the unit suite and the
    // separate `tests/dom` suite. A bare `bun test` reaches only the root unit
    // suite, so the gate would report DOM coverage it never collected.
    // ARCHITECTURE section 17 names the package script.
    name: 'tests',
    argv: ['bun', 'run', 'test'],
    proves: 'Unit tests and DOM tests pass.'
  },
  {
    name: 'schemas',
    argv: ['bun', 'run', 'check:schemas'],
    proves: 'Schema files match their validators.'
  },
  {
    name: 'static data',
    argv: ['bun', 'run', 'check:static'],
    proves: 'Bundled exercise and workout files are valid.'
  },
  {
    name: 'styles',
    argv: ['bun', 'run', 'check:styles'],
    proves: 'No screen styles itself outside the token system.'
  },
  {
    name: 'seed',
    argv: ['bun', 'run', 'seed:check'],
    proves: 'The seed source matches the bundled data files.'
  },
  {
    name: 'build',
    argv: ['bun', 'run', 'build'],
    proves: 'The static bundle builds to dist/.'
  },
  {
    name: 'compat',
    argv: ['bun', 'run', 'check:compat'],
    proves: 'ES2019 load, budgets, secret scan, origin allowlist, CNAME, CSP policy, Drive scope.'
  }
];

/** Manual gates. These print at the end and never block this script. */
const MANUAL_GATES: readonly string[] = [
  'CSP loads clean in a conventional browser: no "Refused to" console line.',
  'Physical Kindle smoke checklist, all 13 rows, recorded in docs/RELEASE.md section 5.',
  'Production OAuth client ID for repjot.com used for the built bundle.',
  'Live site check: https://repjot.com loads, signs in, records a workout, syncs.',
  'Privacy mailbox support@pettibyte.com receives mail.',
  'Publish runbook followed and the release tag recorded in docs/RELEASE.md section 8.'
];

interface GateResult {
  gate: Gate;
  ok: boolean;
  seconds: number;
}

function runGate(gate: Gate): GateResult {
  const label = `bun run release:check > ${gate.argv.join(' ')}`;
  const started = Date.now();
  const proc = Bun.spawnSync(gate.argv, {
    cwd: new URL('..', import.meta.url).pathname,
    stdout: 'inherit',
    stderr: 'inherit'
  });
  const seconds = (Date.now() - started) / 1000;
  if (proc.error !== undefined) {
    console.error(`${label} could not start: ${proc.error.message}`);
  }
  return { gate, ok: proc.exitCode === 0, seconds };
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + ' '.repeat(width - value.length);
}

function table(results: GateResult[]): string {
  const rows = results.map((result) =>
    `  ${pad(result.gate.name, 14)} ${pad(result.ok ? 'PASS' : 'FAIL', 6)} ` +
    `${pad(`${result.seconds.toFixed(1)}s`, 8)} ${result.gate.proves}`
  );
  return rows.join('\n');
}

const results: GateResult[] = [];

for (const gate of AUTOMATED_GATES) {
  console.log(`\n=== ${gate.name} === ${gate.argv.join(' ')}`);
  const result = runGate(gate);
  results.push(result);
  if (!result.ok) {
    console.error(`\nRelease gate stopped at "${gate.name}".`);
    console.error(table(results));
    process.exit(1);
  }
}

console.log('\nAutomated gates');
console.log(table(results));

console.log('\nManual gates still open. Record each one in docs/RELEASE.md.');
for (const item of MANUAL_GATES) {
  console.log(`  [ ] ${item}`);
}

console.log('\nAll automated release gates passed.');
