#!/usr/bin/env bun
/**
 * Add one exercise from free-exercise-db to the REP JOT curated set.
 *
 * Writes one entry into `scripts/exercise-allowlist.json`, then runs the seed,
 * which regenerates `src/public/data/exercises.json`. The seed is the only
 * process allowed to write that file, so this script never touches it directly.
 *
 * Dry run by default. Nothing is written without `--apply`.
 *
 * Usage:
 *   bun add-exercise.ts One_Arm_Dumbbell_Preacher_Curl \
 *     --movement-pattern flexion --laterality unilateral --load-semantics per_implement \
 *     --measurements reps,weight --apply
 *
 * Options:
 *   --movement-pattern <p>  squat|hinge|horizontal_push|vertical_push|horizontal_pull|
 *                           vertical_pull|carry|locomotion|rotation|anti_rotation|
 *                           flexion|extension|other|none
 *   --laterality <l>        bilateral | unilateral
 *   --load-semantics <s>    total | per_implement | added | assisted
 *   --measurements <list>   Comma list: reps,weight,addedWeight,assistedWeight,
 *                           distance,duration,calories
 *   --units <dim>=<list>    Override the units for one dimension, for example
 *                           weight=kg or distance=m,km
 *   --equipment <v>         Replace the source equipment. Use "null" for no equipment.
 *   --entry '<json>'        Full allowlist entry. Overrides the flags above.
 *   --apply               Write the allowlist and run the seed.
 *   --no-seed             Update the allowlist only. Do not regenerate exercises.json.
 *   --json                Machine-readable dry-run report.
 *   --help                Show usage.
 *
 * Exit codes:
 *   0  Planned cleanly, or applied.
 *   1  Validation failed. Nothing was written.
 *   2  Usage error, unknown source ID, or a seed failure.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { buildExercises, loadValidators, runSeed } from '../../../../scripts/seed-exercises';

type Rec = Record<string, unknown>;

const str = (v: unknown): string => (typeof v === 'string' ? v : v === null ? 'null' : '');
const arr = (v: unknown): string[] =>
  Array.isArray(v) ? (v.filter((x) => typeof x === 'string') as string[]) : [];

/** Units written when the author names a dimension but not its units. */
const DEFAULT_UNITS: Record<string, string[]> = {
  reps: ['reps'],
  weight: ['kg', 'lb'],
  addedWeight: ['kg', 'lb'],
  assistedWeight: ['kg', 'lb'],
  distance: ['m', 'km', 'ft', 'mi'],
  duration: ['second', 'minute'],
  calories: ['kcal']
};

const MOVEMENT_PATTERNS = [
  'squat',
  'hinge',
  'horizontal_push',
  'vertical_push',
  'horizontal_pull',
  'vertical_pull',
  'carry',
  'locomotion',
  'rotation',
  'anti_rotation',
  'flexion',
  'extension',
  'other',
  'none'
];

const USAGE = `Usage: bun add-exercise.ts <sourceId> [options]

  --movement-pattern <p>  ${MOVEMENT_PATTERNS.join('|')}
  --laterality <l>        bilateral | unilateral
  --load-semantics <s>    total | per_implement | added | assisted
  --measurements <list>   reps,weight,addedWeight,assistedWeight,distance,duration,calories
  --units <dim>=<list>    Override units, for example weight=kg
  --equipment <v>         Replace source equipment. "null" for no equipment.
  --entry '<json>'        Full allowlist entry, replaces the flags
  --apply               Write the allowlist and run the seed
  --no-seed             Allowlist only, do not regenerate exercises.json
  --json                Machine-readable dry-run report
  --help                Show this help

Dry run by default. Nothing is written without --apply.
`;

interface Options {
  sourceId: string | null;
  movementPattern: string | null;
  laterality: string | null;
  loadSemantics: string | null;
  measurements: string[] | null;
  units: Map<string, string[]>;
  equipment: string | null;
  equipmentSet: boolean;
  entryJson: string | null;
  apply: boolean;
  noSeed: boolean;
  json: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): Options {
  const o: Options = {
    sourceId: null,
    movementPattern: null,
    laterality: null,
    loadSemantics: null,
    measurements: null,
    units: new Map(),
    equipment: null,
    equipmentSet: false,
    entryJson: null,
    apply: false,
    noSeed: false,
    json: false,
    help: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = (): string => {
      const value = argv[i + 1];
      if (value === undefined || (value.startsWith('-') && !/^-[0-9]/.test(value))) {
        throw new Error(`${arg} needs a value.`);
      }
      i += 1;
      return value;
    };

    if (arg === '--help' || arg === '-h') o.help = true;
    else if (arg === '--movement-pattern') o.movementPattern = next();
    else if (arg === '--laterality') o.laterality = next();
    else if (arg === '--load-semantics') o.loadSemantics = next();
    else if (arg === '--measurements') o.measurements = next().split(',').map((s) => s.trim()).filter((s) => s !== '');
    else if (arg === '--units') {
      const spec = next();
      const eq = spec.indexOf('=');
      if (eq < 1) throw new Error('--units needs dimension=unit[,unit].');
      const dim = spec.slice(0, eq);
      const units = spec.slice(eq + 1).split(',').map((s) => s.trim()).filter((s) => s !== '');
      o.units.set(dim, units);
    } else if (arg === '--equipment') {
      const value = next();
      o.equipment = value === 'null' ? null : value;
      o.equipmentSet = true;
    } else if (arg === '--entry') o.entryJson = next();
    else if (arg === '--apply') o.apply = true;
    else if (arg === '--no-seed') o.noSeed = true;
    else if (arg === '--json') o.json = true;
    else if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`);
    else if (o.sourceId === null && o.entryJson === null) o.sourceId = arg;
    else throw new Error(`Unexpected argument: ${arg}`);
  }
  return o;
}

function findRepoRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 12; i += 1) {
    if (existsSync(join(dir, 'scripts/seed-config.json'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

/** Read the source array from the local cache. The seed fills this cache. */
function loadCachedSource(repo: string): { exercises: Rec[]; label: string } {
  const config = JSON.parse(readFileSync(join(repo, 'scripts/seed-config.json'), 'utf8')) as {
    source: { repo: string; commit: string; path: string };
  };
  const cache = join(
    repo,
    'scripts/.cache/free-exercise-db',
    `${config.source.repo.replace(/\//g, '+')}-${config.source.commit}.json`
  );
  if (!existsSync(cache)) {
    throw new Error(
      `Source cache is missing at scripts/.cache/free-exercise-db/. ` +
        `Run \`bun run seed\` with network access first, then re-run this script.`
    );
  }
  const parsed = JSON.parse(readFileSync(cache, 'utf8')) as unknown;
  if (!Array.isArray(parsed)) throw new Error('Cached source is not a JSON array.');
  return { exercises: parsed as Rec[], label: config.source.commit.slice(0, 12) };
}

function buildEntry(o: Options, source: Rec): Rec {
  if (o.entryJson !== null) {
    const parsed = JSON.parse(o.entryJson) as unknown;
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('--entry must be a JSON object.');
    }
    return parsed as Rec;
  }

  const entry: Rec = { id: str(source.id) };
  if (o.equipmentSet) entry.equipment = o.equipment;
  if (o.movementPattern !== null) entry.movementPattern = o.movementPattern;
  if (o.laterality !== null) entry.laterality = o.laterality;
  if (o.loadSemantics !== null) entry.loadSemantics = o.loadSemantics;

  const dims = o.measurements ?? ['reps'];
  entry.measurements = dims.map((dim) => {
    if (DEFAULT_UNITS[dim] === undefined) {
      throw new Error(
        `Unknown measurement dimension "${dim}". Use one of: ${Object.keys(DEFAULT_UNITS).join(', ')}.`
      );
    }
    return { dimension: dim, units: o.units.get(dim) ?? DEFAULT_UNITS[dim] };
  });

  return entry;
}

/** Run the seed core in memory and pull the one exercise this entry produces. */
function previewExercise(source: Rec[], allowlist: unknown[], sourceId: string): Rec | null {
  const result = buildExercises(source, allowlist, 'preview');
  if (result.errors.length > 0) {
    throw new Error(result.errors.join('\n  '));
  }
  const found = result.exercises.find((e) => str(e.id) === sourceId);
  return found ?? null;
}

function main(): Promise<number> {
  return run();
}

async function run(): Promise<number> {
  const o = parseArgs(process.argv.slice(2));

  if (o.help) {
    process.stdout.write(USAGE);
    return 0;
  }

  if (o.entryJson === null && o.sourceId === null) {
    process.stderr.write(`Missing <sourceId>.\n\n${USAGE}`);
    return 2;
  }

  const repo = findRepoRoot(dirname(fileURLToPath(import.meta.url)));
  const allowlistPath = join(repo, 'scripts/exercise-allowlist.json');

  let source: { exercises: Rec[]; label: string };
  try {
    source = loadCachedSource(repo);
  } catch (problem) {
    process.stderr.write(`${(problem as Error).message}\n`);
    return 2;
  }

  let allowlist: unknown[];
  try {
    const parsed = JSON.parse(readFileSync(allowlistPath, 'utf8')) as unknown;
    if (!Array.isArray(parsed)) throw new Error('Allowlist is not a JSON array.');
    allowlist = parsed;
  } catch (problem) {
    process.stderr.write(`Cannot read ${allowlistPath}: ${(problem as Error).message}\n`);
    return 2;
  }

  const allowlistIds = allowlist.map((e) =>
    typeof e === 'string' ? e : str((e as Rec).id)
  );

  // Resolve the source exercise. With --entry the ID comes from the entry.
  let entry: Rec;
  try {
    const provisional = buildEntry(o, { id: o.sourceId ?? '' });
    const sourceId = o.entryJson !== null ? str(provisional.id) : (o.sourceId as string);
    const sourceExercise = source.exercises.find((e) => str(e.id) === sourceId);
    if (sourceExercise === undefined) {
      const close = source.exercises
        .filter((e) => normalizeName(str(e.name)).includes(normalizeName(sourceId)))
        .slice(0, 5);
      process.stderr.write(`Source ID "${sourceId}" is not in free-exercise-db.\n`);
      if (close.length > 0) {
        process.stderr.write(`Close names:\n  ${close.map((e) => `${str(e.id)} (${str(e.name)})`).join('\n  ')}\n`);
      }
      process.stderr.write('Run lookup-source.ts to search the source by name.\n');
      return 2;
    }
    entry = o.entryJson !== null ? provisional : buildEntry(o, sourceExercise);
  } catch (problem) {
    process.stderr.write(`${(problem as Error).message}\n`);
    return 2;
  }

  const sourceId = str(entry.id);

  // Schema check, using the same compiled validators the seed uses.
  // The allowlist schema is an array of entries, so wrap the one entry.
  const validators = loadValidators();
  const entryErrors = runValidation(validators.allowlist, [entry], 'allowlist entry');
  if (entryErrors.length > 0) {
    process.stderr.write('The allowlist entry is invalid:\n');
    for (const line of entryErrors) process.stderr.write(`  - ${line}\n`);
    return 1;
  }

  if (allowlistIds.includes(sourceId)) {
    process.stdout.write(
      `"${sourceId}" is already in the curated allowlist. No change needed.\n`
    );
    return 0;
  }

  let preview: Rec | null;
  try {
    preview = previewExercise(source.exercises, [...allowlist, entry], sourceId);
  } catch (problem) {
    process.stderr.write(`The seed rejected the new entry:\n  ${(problem as Error).message}\n`);
    return 1;
  }

  if (preview === null) {
    process.stderr.write(`The seed produced no exercise for "${sourceId}".\n`);
    return 1;
  }

  const report = {
    dryRun: !o.apply,
    sourceId,
    sourceName: str(source.exercises.find((e) => str(e.id) === sourceId)?.name),
    sourceEquipment: source.exercises.find((e) => str(e.id) === sourceId)?.equipment ?? null,
    allowlistEntry: entry,
    generatedExercise: preview
  };

  if (o.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`Source: ${report.sourceName} (${source.label})\n`);
    process.stdout.write('Allowlist entry:\n');
    process.stdout.write(`${JSON.stringify(entry, null, 2)}\n\n`);
    process.stdout.write('Generated exercise:\n');
    process.stdout.write(
      `${JSON.stringify(
        {
          id: preview.id,
          name: preview.name,
          equipment: preview.equipment,
          category: preview.category,
          movementPattern: preview.movementPattern,
          laterality: preview.laterality,
          loadSemantics: preview.loadSemantics,
          measurements: preview.measurements,
          primaryMuscles: preview.primaryMuscles,
          secondaryMuscles: preview.secondaryMuscles
        },
        null,
        2
      )}\n`
    );
  }

  if (!o.apply) {
    process.stdout.write(
      '\nDRY RUN. Nothing was written. Re-run with --apply to add the exercise.\n'
    );
    return 0;
  }

  const next = [...allowlist, entry];
  writeFileSync(allowlistPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  process.stdout.write(`\nWrote ${allowlistPath.replace(`${repo}/`, '')} (${String(next.length)} entries).\n`);

  if (o.noSeed) {
    process.stdout.write('--no-seed set. Run `bun run seed` to regenerate the exercise file.\n');
    return 0;
  }

  try {
    await runSeed({ mode: 'seed', useCache: true, help: false });
  } catch (problem) {
    process.stderr.write(
      `The seed failed after the allowlist changed. Fix the problem, then run \`bun run seed\`.\n` +
        `  ${(problem as Error).message}\n`
    );
    return 2;
  }

  const after = JSON.parse(readFileSync(join(repo, 'src/public/data/exercises.json'), 'utf8')) as {
    exercises: Rec[];
  };
  if (!after.exercises.some((e) => str(e.id) === sourceId)) {
    process.stderr.write(`The regenerated file does not contain "${sourceId}".\n`);
    return 2;
  }

  process.stdout.write(
    `\nCurated set now holds ${String(after.exercises.length)} exercises, including "${sourceId}".\n` +
      'Next: bun run check:schemas && bun run check:static, then review the diff.\n'
  );
  return 0;
}

/** Ajv wrapper that returns readable messages instead of throwing. */
function runValidation(
  validate: { (data: unknown): boolean; errors?: unknown[] | null },
  value: unknown,
  label: string
): string[] {
  if (validate(value)) return [];
  const errors = (validate.errors ?? []) as { instancePath?: string; message?: string; keyword?: string }[];
  const noWrapper = errors.filter((e) => e.keyword !== 'oneOf');
  const list = noWrapper.length > 0 ? noWrapper : errors;
  return list.map((e) => `${label}${e.instancePath ?? ''} ${e.message ?? 'is invalid'}`);
}

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

process.exitCode = await main();
