#!/usr/bin/env bun
/**
 * Validate a candidate REP JOT workout document.
 *
 * Runs the candidate through the same read path the app uses, then adds the
 * checks an author needs before shipping: curated-set membership, prescription
 * dimension support, iteration bounds, and a lint pass over common authoring
 * mistakes. Prints an outline of each workout so a human can confirm the nesting.
 *
 * Usage:
 *   bun validate-workout.ts <candidate.json> [options]
 *   bun validate-workout.ts -            read the candidate from stdin
 *
 * Options:
 *   --exercises <path>  Curated library. Default: <repo>/src/public/data/exercises.json
 *   --bundle <path>     Existing workouts, for ID-collision checks.
 *                       Default: <repo>/src/public/data/workouts.json
 *   --strict            Treat warnings as errors.
 *   --no-outline        Skip the printed outline.
 *   --json              Print the report as JSON instead of text.
 *   --help              Show usage.
 *
 * Exit codes:
 *   0  Clean, or warnings only without --strict.
 *   1  One or more errors, or warnings with --strict.
 *   2  Usage error, missing file, or unreadable input.
 */

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import { isAppError } from '../../../../src/domain/errors';
import type { Exercise, Workout, WorkoutNode } from '../../../../src/domain/types';
import { iterationCount, isRepeatedContainer } from '../../../../src/domain/execution-path';
import { processDocument } from '../../../../src/documents/document-pipeline';
import { validateStaticData, validateWorkoutSemantics } from '../../../../src/validation/semantic-validator';

type Severity = 'error' | 'warning';

interface Finding {
  severity: Severity;
  code: string;
  path: string;
  message: string;
  hint?: string;
}

const findings: Finding[] = [];

function error(code: string, path: string, message: string, hint?: string): void {
  findings.push({ severity: 'error', code, path, message, hint });
}

function warn(code: string, path: string, message: string, hint?: string): void {
  findings.push({ severity: 'warning', code, path, message, hint });
}

/** Walk up from this script until the repo root appears. */
function findRepoRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 12; i += 1) {
    if (
      existsSync(join(dir, 'schemas/workouts/v1.schema.json')) &&
      existsSync(join(dir, 'src/public/data/exercises.json'))
    ) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

interface Args {
  input: string;
  exercises: string;
  bundle: string;
  strict: boolean;
  outline: boolean;
  json: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): Args {
  const repo = findRepoRoot(dirname(fileURLToPath(import.meta.url)));
  const args: Args = {
    input: '',
    exercises: join(repo, 'src/public/data/exercises.json'),
    bundle: join(repo, 'src/public/data/workouts.json'),
    strict: false,
    outline: true,
    json: false,
    help: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--strict') args.strict = true;
    else if (arg === '--no-outline') args.outline = false;
    else if (arg === '--json') args.json = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--exercises' || arg === '--bundle') {
      const value = argv[i + 1];
      if (value === undefined) {
        throw new Error(`${arg} needs a path.`);
      }
      args[arg === '--exercises' ? 'exercises' : 'bundle'] = resolve(value);
      i += 1;
    } else if (arg === '-') {
      args.input = '-';
    } else if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    } else if (args.input === '') {
      args.input = resolve(arg);
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }
  return args;
}

const USAGE = `Usage: bun validate-workout.ts <candidate.json> [options]

  --exercises <path>  Curated library (default src/public/data/exercises.json)
  --bundle <path>     Existing workouts, for ID collision checks
  --strict            Treat warnings as errors
  --no-outline        Skip the printed outline
  --json              Print the report as JSON
  --help              Show this help
`;

// ---------------------------------------------------------------------------
// Candidate shape
// ---------------------------------------------------------------------------

/** True for a bare `workout` object rather than a full `repjot/workouts` document. */
function looksLikeSingleWorkout(value: unknown): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.id !== undefined && record.root !== undefined && record.workouts === undefined;
}

// ---------------------------------------------------------------------------
// Outline rendering
// ---------------------------------------------------------------------------

function fmtUnit(unit: string): string {
  if (unit === 'second') return 's';
  if (unit === 'minute') return 'min';
  return unit;
}

function fmtQuantity(value: unknown): string | null {
  if (value === null || typeof value !== 'object') return null;
  const q = value as { value?: unknown; unit?: unknown };
  if (typeof q.value !== 'number' || typeof q.unit !== 'string') return null;
  return `${String(q.value)} ${fmtUnit(q.unit)}`;
}

function fmtReps(reps: unknown): string | null {
  if (typeof reps === 'number') return `${String(reps)} reps`;
  if (reps === null || typeof reps !== 'object') return null;
  const r = reps as Record<string, unknown>;
  if (typeof r.min === 'number' && typeof r.max === 'number') return `${String(r.min)}-${String(r.max)} reps`;
  if (typeof r.target === 'number') return `~${String(r.target)} reps`;
  return null;
}

function fmtEffort(effort: unknown): string | null {
  if (effort === null || typeof effort !== 'object') return null;
  const e = effort as Record<string, unknown>;
  if (e.type === 'failure') return 'to failure';
  if (e.type === 'rir' && typeof e.target === 'number') return `RIR ${String(e.target)}`;
  if (e.type === 'rpe' && typeof e.target === 'number') return `RPE ${String(e.target)}`;
  return null;
}

function fmtPrescription(prescription: Record<string, unknown>): string {
  const parts: string[] = [];

  const reps = fmtReps(prescription.reps);
  if (reps !== null) parts.push(reps);

  for (const key of ['weight', 'addedWeight', 'assistedWeight', 'distance', 'duration', 'calories'] as const) {
    const text = fmtQuantity(prescription[key]);
    if (text !== null) parts.push(`${key} ${text}`);
  }

  const effort = fmtEffort(prescription.effort);
  if (effort !== null) parts.push(effort);

  const load = prescription.loadStrategy;
  if (load !== null && typeof load === 'object' && typeof (load as { type?: unknown }).type === 'string') {
    parts.push(`load: ${(load as { type: string }).type}`);
  }

  const iterations = prescription.iterations;
  if (Array.isArray(iterations) && iterations.length > 0) {
    const rendered = iterations.map((raw) => {
      const it = (raw ?? {}) as Record<string, unknown>;
      const bits: string[] = [];
      const itReps = fmtReps(it.reps);
      if (itReps !== null) bits.push(itReps);
      for (const key of ['weight', 'addedWeight', 'assistedWeight', 'distance', 'duration', 'calories'] as const) {
        const text = fmtQuantity(it[key]);
        if (text !== null) bits.push(`${key} ${text}`);
      }
      const itEffort = fmtEffort(it.effort);
      if (itEffort !== null) bits.push(itEffort);
      return `#${String(it.iteration)} ${bits.join(', ')}`.trim();
    });
    parts.push(`per set: ${rendered.join(' | ')}`);
  }

  return parts.join(', ');
}

function containerLabel(node: Extract<WorkoutNode, { type: 'container' }>): string {
  const cfg = node.strategyConfig as Record<string, unknown>;
  switch (node.strategy) {
    case 'rounds':
      return `${String(cfg.rounds)} rounds`;
    case 'amrap':
      return `AMRAP ${fmtQuantity(cfg.duration) ?? '?'}`;
    case 'emom':
      return `EMOM ${String(cfg.cycles)} x ${fmtQuantity(cfg.interval) ?? '?'}`;
    case 'complex':
      return `${String(cfg.cycles)} cycles (complex)`;
    default:
      return 'sequence';
  }
}

function outlineWorkout(workout: Workout, exercises: Map<string, Exercise>): string[] {
  const lines: string[] = [`WORKOUT "${workout.name}"  id=${workout.id}`];
  if (workout.notes !== undefined && workout.notes !== '') lines.push(`  notes: ${workout.notes}`);

  const walk = (node: WorkoutNode, depth: number): void => {
    const pad = '  '.repeat(depth + 1);
    if (node.type === 'exercise') {
      const ex = exercises.get(node.exerciseId);
      const name = ex?.name ?? `?? ${node.exerciseId}`;
      const setKind = node.setType === undefined ? '' : ` [${node.setType}]`;
      const detail = fmtPrescription(node.prescription as unknown as Record<string, unknown>);
      lines.push(`${pad}- ${name} (${node.stimulus})${setKind}${detail === '' ? '' : `: ${detail}`}`);
      return;
    }
    const label = node.name === undefined ? containerLabel(node) : `${node.name} — ${containerLabel(node)}`;
    lines.push(`${pad}(${label})`);
    for (const child of node.children) walk(child, depth + 1);
  };

  walk(workout.root, 0);
  return lines;
}

// ---------------------------------------------------------------------------
// Lint pass
// ---------------------------------------------------------------------------

const STIMULUS_BY_CATEGORY: Record<string, string> = {
  stretching: 'mobility',
  cardio: 'conditioning'
};


function lintWorkout(workout: Workout, exercises: Map<string, Exercise>): void {
  const base = `workout "${workout.id}"`;

  if (workout.notes === undefined || workout.notes.trim() === '') {
    warn('missing_notes', base, 'The workout has no notes.', 'Add one line about the intent.');
  }

  const seenIds = new Set<string>();

  const walk = (node: WorkoutNode, path: string, repeated: boolean): void => {
    if (seenIds.has(node.id)) {
      // `validateStaticData` reports this too. Kept here so the lint pass stands
      // alone when it runs without the static pair.
      error('duplicate_node_id', path, `Node id "${node.id}" appears more than once in this workout.`);
    }
    seenIds.add(node.id);

    if (node.type === 'exercise') {
      const ex = exercises.get(node.exerciseId);
      if (ex === undefined) return; // Already an error from validateStaticData.

      const p = node.prescription as unknown as Record<string, unknown>;

      const expected = STIMULUS_BY_CATEGORY[ex.category];
      if (expected !== undefined && node.stimulus !== expected) {
        warn(
          'stimulus_category_mismatch',
          `${path}`,
          `"${ex.name}" is category "${ex.category}" but the node uses stimulus "${node.stimulus}".`,
          `Expected stimulus "${expected}".`
        );
      }

      if (p.iterations !== undefined && p.reps === undefined && p.duration === undefined) {
        warn(
          'iterations_without_base',
          `${path}.prescription`,
          'The prescription carries per-iteration overrides but no base value.',
          'Sets not listed fall back to nothing. Add a base reps or duration.'
        );
      }
      return;
    }

    if (node.children.length === 0) {
      error('empty_container', path, `Container "${node.id}" has no children.`);
    }

    if (node.name === undefined && node !== workout.root) {
      warn('container_unnamed', path, `Container "${node.id}" has no name.`, 'Name it after the block, e.g. "Bench Block".');
    }

    if ((node.strategy === 'amrap' || node.strategy === 'emom') && node.resultCapture === undefined) {
      warn(
        'timed_without_capture',
        path,
        `A "${node.strategy}" block has no resultCapture, so its score is not recorded.`,
        'Add resultCapture with scoreType "rounds_and_reps" or "intervals".'
      );
    }

    if (node.benchmark !== undefined && node.strategy !== 'amrap') {
      warn(
        'benchmark_not_amrap',
        path,
        'A benchmark block is present on a non-AMRAP container.',
        'Benchmarks are usually timed AMRAPs.'
      );
    }

    const isRepeated = isRepeatedContainer(node);
    if (isRepeated && iterationCount(node) < 1) {
      error('zero_iterations', path, `Container "${node.id}" repeats fewer than one time.`);
    }

    for (const child of node.children) walk(child, `${path}/${child.id}`, isRepeated || repeated);
  };

  walk(workout.root, `${base}.root`, false);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): number {
  let args: Args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (problem) {
    process.stderr.write(`${(problem as Error).message}\n\n${USAGE}`);
    return 2;
  }

  if (args.help || args.input === '') {
    process.stdout.write(USAGE);
    return args.help ? 0 : 2;
  }

  let text: string;
  if (args.input === '-') {
    text = readFileSync(0, 'utf8');
  } else {
    if (!existsSync(args.input)) {
      process.stderr.write(`Candidate not found: ${args.input}\n`);
      return 2;
    }
    text = readFileSync(args.input, 'utf8');
  }

  let exercisesRaw: Exercise[];
  try {
    exercisesRaw = processDocument<{ exercises: Exercise[] }>(
      readFileSync(args.exercises, 'utf8'),
      'repjot/exercises'
    ).document.exercises;
  } catch (problem) {
    const message = isAppError(problem) ? `[${problem.kind}] ${problem.message}` : (problem as Error).message;
    process.stderr.write(`Curated library is not readable: ${args.exercises}\n${message}\n`);
    return 2;
  }

  const exercises = new Map(exercisesRaw.map((e) => [e.id, e]));

  // Detect a bare workout object and wrap it, so an author can paste one workout.
  let candidateText = text;
  let wrapped = false;
  try {
    const parsed = JSON.parse(text) as unknown;
    if (looksLikeSingleWorkout(parsed)) {
      candidateText = JSON.stringify({
        format: 'repjot/workouts',
        schemaVersion: 1,
        workouts: [parsed]
      });
      wrapped = true;
    }
  } catch {
    // Let the pipeline report the parse failure with its own message.
  }

  let workouts: Workout[];
  try {
    const result = processDocument<{ workouts: Workout[] }>(candidateText, 'repjot/workouts');
    workouts = result.document.workouts;
  } catch (problem) {
    if (isAppError(problem)) {
      const issues = problem.detail.issues;
      error('schema', 'document', `[${problem.kind}] ${problem.message}`, issues === undefined ? undefined : String(issues));
    } else {
      error('schema', 'document', (problem as Error).message);
    }
    report(args, [], exercises, wrapped);
    return 1;
  }

  if (workouts.length === 0) {
    warn('no_workouts', 'document', 'The document holds zero workouts.');
  }

  for (const issue of validateStaticData(exercisesRaw, workouts)) {
    const hint = issue.code === 'unknown_exercise' ? 'Pick an exercise from the curated library.' : undefined;
    error(issue.code, issue.path, issue.message, hint);
  }
  for (const issue of validateWorkoutSemantics(workouts, exercisesRaw)) {
    error(issue.code, issue.path, issue.message);
  }

  // Collision check against the shipped bundle. Skipped when the candidate is
  // the bundle itself, which is how the check runs in CI.
  if (existsSync(args.bundle) && resolve(args.bundle) !== resolve(args.input)) {
    try {
      const bundled = processDocument<{ workouts: Workout[] }>(readFileSync(args.bundle, 'utf8'), 'repjot/workouts')
        .document.workouts;
      const bundledIds = new Set(bundled.map((w) => w.id));
      for (const workout of workouts) {
        if (bundledIds.has(workout.id)) {
          warn(
            'workout_id_collides',
            `workout "${workout.id}"`,
            'This id already exists in the shipped bundle.',
            'Renaming avoids a shadowed or replaced workout on install.'
          );
        }
      }
    } catch {
      warn('bundle_unreadable', 'document', `Skipped the collision check: ${args.bundle} did not parse.`);
    }
  }

  for (const workout of workouts) lintWorkout(workout, exercises);

  report(args, workouts, exercises, wrapped);

  const errors = findings.filter((f) => f.severity === 'error').length;
  const warnings = findings.filter((f) => f.severity === 'warning').length;
  if (errors > 0) return 1;
  if (args.strict && warnings > 0) return 1;
  return 0;
}

function report(args: Args, workouts: Workout[], exercises: Map<string, Exercise>, wrapped: boolean): void {
  const errors = findings.filter((f) => f.severity === 'error');
  const warnings = findings.filter((f) => f.severity === 'warning');

  if (args.json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          ok: errors.length === 0 && !(args.strict && warnings.length > 0),
          wrappedSingleWorkout: wrapped,
          errors,
          warnings,
          outline: workouts.flatMap((w) => outlineWorkout(w, exercises))
        },
        null,
        2
      )}\n`
    );
    return;
  }

  if (args.outline && workouts.length > 0) {
    process.stdout.write('=== OUTLINE ===\n');
    for (const workout of workouts) {
      for (const line of outlineWorkout(workout, exercises)) process.stdout.write(`${line}\n`);
      process.stdout.write('\n');
    }
  }

  if (wrapped) {
    process.stdout.write('Note: the input was one workout object. It was wrapped in a repjot/workouts envelope for validation.\n\n');
  }

  if (errors.length === 0 && warnings.length === 0) {
    process.stdout.write('PASS: no errors, no warnings.\n');
    return;
  }

  if (errors.length > 0) {
    process.stdout.write(`ERRORS (${String(errors.length)})\n`);
    for (const f of errors) {
      process.stdout.write(`  [${f.code}] ${f.path}: ${f.message}\n`);
      if (f.hint !== undefined) process.stdout.write(`      → ${f.hint}\n`);
    }
    process.stdout.write('\n');
  }

  if (warnings.length > 0) {
    process.stdout.write(`WARNINGS (${String(warnings.length)})\n`);
    for (const f of warnings) {
      process.stdout.write(`  [${f.code}] ${f.path}: ${f.message}\n`);
      if (f.hint !== undefined) process.stdout.write(`      → ${f.hint}\n`);
    }
    process.stdout.write('\n');
  }

  process.stdout.write(errors.length === 0 ? 'PASS with warnings.\n' : 'FAIL.\n');
}

process.exitCode = main();
