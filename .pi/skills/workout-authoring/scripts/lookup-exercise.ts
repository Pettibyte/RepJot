#!/usr/bin/env bun
/**
 * Find exercises in the curated REP JOT library.
 *
 * Reads the bundled library at run time, so the result never goes stale. Prints
 * ranked candidates with the fields an author needs to pick one. Use it before
 * writing any workout JSON: an exercise that is not in this list cannot be used.
 *
 * Usage:
 *   bun lookup-exercise.ts "back squat"
 *   bun lookup-exercise.ts squat --equipment barbell
 *   bun lookup-exercise.ts --pattern hinge --muscle glutes
 *   bun lookup-exercise.ts --all
 *
 * Options:
 *   --exercises <path>  Library file. Default: <repo>/src/public/data/exercises.json
 *   --equipment <v>     Filter: barbell, dumbbell, kettlebell, band, cable, machine, ...
 *   --bodyweight        Filter: exercises with equipment null
 *   --muscle <v>        Filter: chest, lats, quadriceps, glutes, ...
 *   --pattern <v>       Filter: squat, hinge, horizontal_push, vertical_pull, ...
 *   --category <v>      Filter: strength, cardio, stretching, plyometrics, ...
 *   --limit <n>         Max candidates. Default 8.
 *   --all               List the whole library, one line each.
 *   --json              Machine-readable output.
 *   --help              Show usage.
 *
 * Exit codes:
 *   0  At least one candidate matched.
 *   1  Nothing matched. Read this as: the exercise is not in the curated set.
 *   2  Usage error.
 */

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { processDocument } from '../../../../src/documents/document-pipeline';
import type { Exercise } from '../../../../src/domain/types';

/** Everyday names for one curated exercise. Advisory only; fuzzy match still runs. */
const ALIASES: Record<string, string> = {
  'back squat': 'Barbell_Squat',
  'barbell back squat': 'Barbell_Squat',
  bs: 'Barbell_Squat',
  bench: 'Barbell_Bench_Press_-_Medium_Grip',
  'bench press': 'Barbell_Bench_Press_-_Medium_Grip',
  'flat bench': 'Barbell_Bench_Press_-_Medium_Grip',
  deadlift: 'Barbell_Deadlift',
  'conventional deadlift': 'Barbell_Deadlift',
  dl: 'Barbell_Deadlift',
  pullup: 'Pullups',
  pullups: 'Pullups',
  'pull-up': 'Pullups',
  'pull-ups': 'Pullups',
  'chin-up': 'Pullups',
  chinup: 'Pullups',
  pushup: 'Pushups',
  pushups: 'Pushups',
  'push-up': 'Pushups',
  'press-up': 'Pushups',
  'air squat': 'Bodyweight_Squat',
  'body weight squat': 'Bodyweight_Squat',
  'kettlebell swing': 'One-Arm_Kettlebell_Swings',
  'kettlebell swings': 'One-Arm_Kettlebell_Swings',
  kb: 'One-Arm_Kettlebell_Swings',
  halo: 'Kettlebell_Halo',
  'kb row': 'Alternating_Kettlebell_Row',
  'kettlebell row': 'Alternating_Kettlebell_Row',
  'push press': 'Double_Kettlebell_Push_Press',
  'weighted pullup': 'Weighted_Pull_Ups',
  'weighted pull-up': 'Weighted_Pull_Ups',
  'weighted chin': 'Weighted_Pull_Ups',
  'band assisted pullup': 'Band_Assisted_Pull-Up',
  'band assisted pull-up': 'Band_Assisted_Pull-Up',
  'band pull-up': 'Band_Assisted_Pull-Up',
  rower: 'Rowing_Stationary',
  rowing: 'Rowing_Stationary',
  erg: 'Rowing_Stationary',
  'jump rope': 'Rope_Jumping',
  skipping: 'Rope_Jumping',
  'knee tuck': 'Knee_Tuck_Jump',
  'worlds greatest stretch': 'Worlds_Greatest_Stretch',
  wgs: 'Worlds_Greatest_Stretch',
  'cat-cow': 'Cat_Stretch',
  'cat cow': 'Cat_Stretch',
  walkout: 'Inchworm',
  'round the world': 'Round_The_World_Shoulder_Stretch',
  'scap pull-up': 'Scapular_Pull-Up',
  scapular: 'Scapular_Pull-Up',
  'australian pull-up': 'Inverted_Row',
  'lateral band walk': 'Monster_Walk',
  'band walk': 'Monster_Walk'
};

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

const USAGE = `Usage: bun lookup-exercise.ts [query] [options]

  --exercises <path>  Library file (default src/public/data/exercises.json)
  --equipment <v>     barbell | dumbbell | kettlebell | band | cable | machine | ...
  --bodyweight        Only exercises with no equipment
  --muscle <v>        chest | lats | quadriceps | glutes | ...
  --pattern <v>       squat | hinge | horizontal_push | vertical_pull | ...
  --category <v>      strength | cardio | stretching | plyometrics | ...
  --limit <n>         Max candidates (default 8)
  --all               List the whole library
  --json              Machine-readable output
  --help              Show this help

Exit 1 means nothing matched: the exercise is not in the curated set.
`;

interface Filters {
  equipment: string | null;
  bodyweight: boolean;
  muscle: string | null;
  pattern: string | null;
  category: string | null;
  limit: number;
  all: boolean;
  json: boolean;
  help: boolean;
}

interface ParsedArgs {
  query: string[];
  filters: Filters;
  exercisesPath: string;
}

function parseArgs(argv: string[]): ParsedArgs {
  const repo = findRepoRoot(dirname(fileURLToPath(import.meta.url)));
  const filters: Filters = {
    equipment: null,
    bodyweight: false,
    muscle: null,
    pattern: null,
    category: null,
    limit: 8,
    all: false,
    json: false,
    help: false
  };
  const query: string[] = [];
  let exercisesPath = join(repo, 'src/public/data/exercises.json');

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = (): string => {
      const value = argv[i + 1];
      if (value === undefined) throw new Error(`${arg} needs a value.`);
      i += 1;
      return value;
    };

    if (arg === '--help' || arg === '-h') filters.help = true;
    else if (arg === '--exercises') exercisesPath = next();
    else if (arg === '--equipment') filters.equipment = next().toLowerCase();
    else if (arg === '--bodyweight') filters.bodyweight = true;
    else if (arg === '--muscle') filters.muscle = next().toLowerCase();
    else if (arg === '--pattern') filters.pattern = next().toLowerCase();
    else if (arg === '--category') filters.category = next().toLowerCase();
    else if (arg === '--limit') filters.limit = Number.parseInt(next(), 10);
    else if (arg === '--all') filters.all = true;
    else if (arg === '--json') filters.json = true;
    else if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`);
    else query.push(arg);
  }

  if (!Number.isFinite(filters.limit) || filters.limit < 1) filters.limit = 8;
  return { query, filters, exercisesPath };
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function tokens(value: string): string[] {
  const words = normalize(value).split(' ').filter((w) => w !== '');
  return words;
}

function dimensionsOf(exercise: Exercise): string[] {
  return exercise.measurements.map((m) => m.dimension);
}

function scoreOne(exercise: Exercise, rawQuery: string): { score: number; why: string[] } {
  const q = normalize(rawQuery);
  if (q === '') return { score: 0, why: [] };

  const name = normalize(exercise.name);
  const id = normalize(exercise.id);
  const why: string[] = [];
  let score = 0;

  if (q === name || q === id) {
    return { score: 100, why: ['exact name'] };
  }
  if (name.startsWith(q)) {
    score = Math.max(score, 82);
    why.push('name starts with query');
  }
  if (name.includes(q)) {
    score = Math.max(score, 74);
    why.push('name contains query');
  }

  const qTokens = tokens(rawQuery);
  const nameTokens = tokens(exercise.name);
  const hitTokens = qTokens.filter((t) => nameTokens.includes(t));
  if (qTokens.length > 0 && hitTokens.length === qTokens.length) {
    score = Math.max(score, 66);
    why.push('all query words in name');
  } else if (hitTokens.length > 0) {
    const overlap = hitTokens.length / qTokens.length;
    const partial = overlap * 45;
    if (partial > score) {
      score = partial;
      why.push(`${String(hitTokens.length)}/${String(qTokens.length)} query words in name`);
    }
  }

  // Attribute text: equipment, muscles, pattern, category.
  const attrText = normalize(
    [
      exercise.equipment ?? 'bodyweight body only',
      exercise.primaryMuscles.join(' '),
      exercise.secondaryMuscles.join(' '),
      exercise.movementPattern.replace(/_/g, ' '),
      exercise.category.replace(/_/g, ' ')
    ].join(' ')
  );
  const attrHits = qTokens.filter((t) => attrText.includes(t));
  if (attrHits.length > 0 && score < 30) {
    score = (attrHits.length / qTokens.length) * 25;
    why.push('matched attributes, not the name');
  }

  for (const [alias, aliasId] of Object.entries(ALIASES)) {
    if (aliasId !== exercise.id) continue;
    const a = normalize(alias);
    if (a === q) {
      return { score: 95, why: [`alias "${alias}"`] };
    }
    if (a.length >= 4 && q.includes(a)) {
      score = Math.max(score, 88);
      why.push(`query carries alias "${alias}"`);
    } else if (q.length >= 3 && a.includes(q)) {
      score = Math.max(score, 58);
      why.push(`alias "${alias}" contains the query`);
    }
  }

  return { score, why };
}

function matchesFilters(exercise: Exercise, f: Filters): boolean {
  if (f.equipment !== null && (exercise.equipment ?? '') !== f.equipment) return false;
  if (f.bodyweight && exercise.equipment !== null) return false;
  if (f.muscle !== null) {
    const muscles = [...exercise.primaryMuscles, ...exercise.secondaryMuscles].map((m) => m.toLowerCase());
    if (!muscles.includes(f.muscle)) return false;
  }
  if (f.pattern !== null && exercise.movementPattern !== f.pattern) return false;
  if (f.category !== null && exercise.category !== f.category) return false;
  return true;
}

function line(exercise: Exercise): string {
  const equip = exercise.equipment ?? 'none (bodyweight)';
  return (
    `${exercise.id}\t${exercise.name}\t${equip}\t${exercise.movementPattern}\t` +
    `${exercise.primaryMuscles.join('+')}\t${exercise.laterality}\t${exercise.loadSemantics}\t` +
    `${dimensionsOf(exercise).join('/')}\t${exercise.category}\t${exercise.level}`
  );
}

function main(): number {
  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (problem) {
    process.stderr.write(`${(problem as Error).message}\n\n${USAGE}`);
    return 2;
  }
  const { query, filters, exercisesPath } = parsed;

  if (filters.help) {
    process.stdout.write(USAGE);
    return 0;
  }

  if (!existsSync(exercisesPath)) {
    process.stderr.write(`Curated library not found: ${exercisesPath}\n`);
    return 2;
  }

  const doc = processDocument<{ exercises: Exercise[] }>(readFileSync(exercisesPath, 'utf8'), 'repjot/exercises');
  const all = doc.document.exercises.filter((e) => matchesFilters(e, filters));

  const header = ['ID', 'NAME', 'EQUIPMENT', 'PATTERN', 'PRIMARY', 'LATERALITY', 'LOAD', 'DIMENSIONS', 'CATEGORY', 'LEVEL'];

  if (filters.all || query.join('').trim() === '') {
    if (filters.json) {
      process.stdout.write(`${JSON.stringify({ count: all.length, exercises: all }, null, 2)}\n`);
      return 0;
    }
    process.stdout.write(`CURATED LIBRARY (${String(all.length)} exercises)\n`);
    process.stdout.write(`${header.join('\t')}\n`);
    for (const e of all) process.stdout.write(`${line(e)}\n`);
    return 0;
  }

  const q = query.join(' ');
  const scored = all
    .map((e) => ({ exercise: e, ...scoreOne(e, q) }))
    .filter((r) => r.score >= 40)
    .sort((a, b) => b.score - a.score)
    .slice(0, filters.limit);

  if (scored.length === 0) {
    if (filters.json) {
      process.stdout.write(`${JSON.stringify({ query: q, ambiguous: false, candidates: [] }, null, 2)}\n`);
      return 1;
    }
    process.stdout.write(`NO MATCH for "${q}" in the curated library (${String(all.length)} exercises checked).\n`);
    process.stdout.write('The exercise is not available. Ask the user which curated exercise to use instead.\n');
    return 1;
  }

  const top = scored[0].score;
  const near = scored.filter((r) => r.score >= top - 10);
  // A score of 95 or above is an exact name or exact alias hit. That is decisive.
  const ambiguous = near.length > 1 && top < 95;

  if (filters.json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          query: q,
          ambiguous,
          candidates: scored.map((r) => ({
            score: Math.round(r.score),
            why: r.why,
            id: r.exercise.id,
            name: r.exercise.name,
            equipment: r.exercise.equipment,
            movementPattern: r.exercise.movementPattern,
            primaryMuscles: r.exercise.primaryMuscles,
            laterality: r.exercise.laterality,
            loadSemantics: r.exercise.loadSemantics,
            dimensions: dimensionsOf(r.exercise),
            category: r.exercise.category,
            level: r.exercise.level
          }))
        },
        null,
        2
      )}\n`
    );
    return 0;
  }

  process.stdout.write(`CANDIDATES for "${q}"\n`);
  process.stdout.write(`${header.join('\t')}\n`);
  for (const r of scored) {
    process.stdout.write(`${String(Math.round(r.score)).padStart(3)}  ${line(r.exercise)}\n`);
  }
  process.stdout.write('\n');
  if (ambiguous) {
    process.stdout.write(
      `AMBIGUOUS: ${String(near.length)} close matches. Ask the user which one before writing the JSON.\n`
    );
  } else {
    process.stdout.write('CLEAR: one leading match.\n');
  }
  return 0;
}

process.exitCode = main();
