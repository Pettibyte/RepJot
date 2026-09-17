#!/usr/bin/env bun
/**
 * Search the pinned free-exercise-db source for an exercise.
 *
 * Use this when `lookup-exercise.ts` reports NO MATCH against the curated set.
 * The curated set is a small slice of the pinned source, which holds hundreds of
 * exercises. This script finds the source ID you would add to
 * `scripts/exercise-allowlist.json`.
 *
 * The source is read from the local cache first, so the script works offline.
 * The cache lives at `scripts/.cache/free-exercise-db/`. It fills on the first
 * `bun run seed` that has network access.
 *
 * Usage:
 *   bun lookup-source.ts "dumbbell preacher curl"
 *   bun lookup-source.ts "rear delt" --equipment dumbbell
 *   bun lookup-source.ts --category stretching --muscle hamstrings
 *   bun lookup-source.ts "wall sit" --entry
 *
 * Options:
 *   --equipment <v>   Source equipment, for example dumbbell, kettlebells, barbell.
 *   --muscle <v>      Primary or secondary muscle.
 *   --category <v>    strength, stretching, cardio, plyometrics, ...
 *   --mechanic <v>    compound | isolation
 *   --level <v>       beginner | intermediate | expert
 *   --limit <n>       Max candidates. Default 10.
 *   --entry           Print an editable allowlist entry for the top match.
 *   --json            Machine-readable output.
 *   --source <path>   Read the source array from a file instead of the cache.
 *   --no-fetch        Never go to the network. Cache only.
 *   --help            Show usage.
 *
 * Exit codes:
 *   0  At least one candidate matched.
 *   1  Nothing matched. The movement is not in the source either.
 *   2  Usage error, or the source is neither cached nor reachable.
 */

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

type Rec = Record<string, unknown>;

function findRepoRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 12; i += 1) {
    if (
      existsSync(join(dir, 'scripts/seed-config.json')) &&
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

const USAGE = `Usage: bun lookup-source.ts [query] [options]

  --equipment <v>   Source equipment (dumbbell, kettlebells, barbell, body only, ...)
  --muscle <v>      Primary or secondary muscle
  --category <v>    strength | stretching | cardio | plyometrics | ...
  --mechanic <v>    compound | isolation
  --level <v>       beginner | intermediate | expert
  --limit <n>       Max candidates (default 10)
  --entry           Print an editable allowlist entry for the top match
  --json            Machine-readable output
  --source <path>   Read the source array from a file instead of the cache
  --no-fetch        Cache only. Never hit the network.
  --help            Show this help

Exit 1 means the movement is not in the source either.
`;

interface Filters {
  equipment: string | null;
  muscle: string | null;
  category: string | null;
  mechanic: string | null;
  level: string | null;
  limit: number;
  entry: boolean;
  json: boolean;
  sourceFile: string | null;
  noFetch: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): { query: string[]; filters: Filters } {
  const filters: Filters = {
    equipment: null,
    muscle: null,
    category: null,
    mechanic: null,
    level: null,
    limit: 10,
    entry: false,
    json: false,
    sourceFile: null,
    noFetch: false,
    help: false
  };
  const query: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = (): string => {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('-')) throw new Error(`${arg} needs a value.`);
      i += 1;
      return value;
    };

    if (arg === '--help' || arg === '-h') filters.help = true;
    else if (arg === '--equipment') filters.equipment = next().toLowerCase();
    else if (arg === '--muscle') filters.muscle = next().toLowerCase();
    else if (arg === '--category') filters.category = next().toLowerCase();
    else if (arg === '--mechanic') filters.mechanic = next().toLowerCase();
    else if (arg === '--level') filters.level = next().toLowerCase();
    else if (arg === '--limit') filters.limit = Number.parseInt(next(), 10);
    else if (arg === '--entry') filters.entry = true;
    else if (arg === '--json') filters.json = true;
    else if (arg === '--source') filters.sourceFile = next();
    else if (arg === '--no-fetch') filters.noFetch = true;
    else if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`);
    else query.push(arg);
  }

  if (!Number.isFinite(filters.limit) || filters.limit < 1) filters.limit = 10;
  return { query, filters };
}

const str = (v: unknown): string => (typeof v === 'string' ? v : v === null ? 'null' : '');
const arr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') as string[] : []);

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function tokens(value: string): string[] {
  return normalize(value).split(' ').filter((w) => w !== '');
}

/**
 * Load the pinned source array.
 *
 * Order: explicit --source file, then the local cache, then the network. The
 * cache path mirrors the seed script, so a warm checkout needs no download.
 */
async function loadSourceArray(
  repo: string,
  filters: Filters
): Promise<{ exercises: Rec[]; label: string }> {
  if (filters.sourceFile !== null) {
    const path = filters.sourceFile.startsWith('/')
      ? filters.sourceFile
      : join(repo, filters.sourceFile);
    if (!existsSync(path)) throw new Error(`Source file not found: ${path}`);
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    if (!Array.isArray(parsed)) throw new Error('Source file is not a JSON array.');
    return { exercises: parsed as Rec[], label: `file ${filters.sourceFile}` };
  }

  const config = JSON.parse(readFileSync(join(repo, 'scripts/seed-config.json'), 'utf8')) as {
    source: { repo: string; ref: string; commit: string; path: string };
  };
  const { repo: srcRepo, commit } = config.source;
  const cache = join(repo, 'scripts/.cache/free-exercise-db', `${srcRepo.replace(/\//g, '+')}-${commit}.json`);

  if (existsSync(cache)) {
    const parsed = JSON.parse(readFileSync(cache, 'utf8')) as unknown;
    if (!Array.isArray(parsed)) throw new Error('Cached source is not a JSON array.');
    return { exercises: parsed as Rec[], label: `cache ${commit.slice(0, 12)}` };
  }

  if (filters.noFetch) {
    throw new Error(
      `Source is not cached at ${cache} and --no-fetch was given. Run \`bun run seed\` with network access first.`
    );
  }

  const url = `https://raw.githubusercontent.com/${srcRepo}/${commit}/${config.source.path}`;
  process.stderr.write(`Source not cached. Fetching ${url}\n`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Fetch failed: HTTP ${response.status} ${response.statusText}`);
  const text = await response.text();
  const parsed = JSON.parse(text) as unknown;
  if (!Array.isArray(parsed)) throw new Error('Fetched source is not a JSON array.');
  return { exercises: parsed as Rec[], label: `fetched ${commit.slice(0, 12)}` };
}

function matchesFilters(exercise: Rec, f: Filters): boolean {
  if (f.equipment !== null && str(exercise.equipment).toLowerCase() !== f.equipment) return false;
  if (f.muscle !== null) {
    const muscles = [...arr(exercise.primaryMuscles), ...arr(exercise.secondaryMuscles)].map((m) =>
      m.toLowerCase()
    );
    if (!muscles.includes(f.muscle)) return false;
  }
  if (f.category !== null && str(exercise.category).toLowerCase() !== f.category) return false;
  if (f.mechanic !== null && str(exercise.mechanic).toLowerCase() !== f.mechanic) return false;
  if (f.level !== null && str(exercise.level).toLowerCase() !== f.level) return false;
  return true;
}

function scoreOne(exercise: Rec, rawQuery: string): { score: number; why: string[] } {
  const q = normalize(rawQuery);
  if (q === '') return { score: 0, why: [] };

  const name = normalize(str(exercise.name));
  const id = normalize(str(exercise.id));
  const why: string[] = [];
  let score = 0;

  if (q === name || q === id) return { score: 100, why: ['exact name'] };
  if (name === q.replace(/ /g, '_')) return { score: 100, why: ['exact id'] };
  if (name.startsWith(q)) {
    score = Math.max(score, 82);
    why.push('name starts with query');
  }
  if (name.includes(q)) {
    score = Math.max(score, 76);
    why.push('name contains query');
  }

  const qTokens = tokens(rawQuery);
  const nameTokens = tokens(str(exercise.name));
  const hits = qTokens.filter((t) => nameTokens.includes(t));
  if (qTokens.length > 0 && hits.length === qTokens.length) {
    score = Math.max(score, 68);
    why.push('all query words in name');
  } else if (hits.length > 0) {
    const partial = (hits.length / qTokens.length) * 45;
    if (partial > score) {
      score = partial;
      why.push(`${String(hits.length)}/${String(qTokens.length)} query words in name`);
    }
  }

  const attrText = normalize(
    [
      str(exercise.equipment),
      arr(exercise.primaryMuscles).join(' '),
      arr(exercise.secondaryMuscles).join(' '),
      str(exercise.category)
    ].join(' ')
  );
  const attrHits = qTokens.filter((t) => attrText.includes(t));
  if (attrHits.length > 0 && score < 30) {
    score = (attrHits.length / qTokens.length) * 25;
    why.push('matched attributes, not the name');
  }

  return { score, why };
}

/** The curated IDs, so the table shows what already exists. */
function curatedIds(repo: string): Set<string> {
  try {
    const doc = JSON.parse(readFileSync(join(repo, 'src/public/data/exercises.json'), 'utf8')) as {
      exercises?: { id: string }[];
    };
    return new Set((doc.exercises ?? []).map((e) => e.id));
  } catch {
    return new Set();
  }
}

function entrySkeleton(exercise: Rec): Rec {
  return {
    id: str(exercise.id),
    // Pick one value from schemas/exercises/v1.schema.json#/$defs/exercise/properties/movementPattern/enum.
    movementPattern: 'REPLACE_ME',
    // bilateral | unilateral. Unilateral when one side works at a time.
    laterality: 'REPLACE_ME',
    // total | per_implement | added | assisted. per_implement for one dumbbell or KB.
    loadSemantics: 'REPLACE_ME',
    // List only the dimensions the app should record.
    measurements: [
      { dimension: 'reps', units: ['reps'] },
      { dimension: 'weight', units: ['kg', 'lb'] }
    ]
  };
}

function main(): Promise<number> {
  return run();
}

async function run(): Promise<number> {
  let parsed: { query: string[]; filters: Filters };
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (problem) {
    process.stderr.write(`${(problem as Error).message}\n\n${USAGE}`);
    return 2;
  }
  const { query, filters } = parsed;

  if (filters.help) {
    process.stdout.write(USAGE);
    return 0;
  }

  const repo = findRepoRoot(dirname(fileURLToPath(import.meta.url)));

  let source: { exercises: Rec[]; label: string };
  try {
    source = await loadSourceArray(repo, filters);
  } catch (problem) {
    process.stderr.write(`${(problem as Error).message}\n`);
    return 2;
  }

  const curated = curatedIds(repo);
  const filtered = source.exercises.filter((e) => matchesFilters(e, filters));
  const q = query.join(' ');

  const scored = (
    q.trim() === ''
      ? filtered.map((e) => ({ exercise: e, score: 50, why: ['filter only'] }))
      : filtered.map((e) => ({ exercise: e, ...scoreOne(e, q) }))
  )
    .filter((r) => r.score >= 40)
    .sort((a, b) => b.score - a.score)
    .slice(0, filters.limit);

  if (scored.length === 0) {
    if (filters.json) {
      process.stdout.write(`${JSON.stringify({ source: source.label, query: q, candidates: [] }, null, 2)}\n`);
      return 1;
    }
    process.stdout.write(
      `NO MATCH for "${q}" in the source (${String(source.exercises.length)} exercises checked).\n`
    );
    process.stdout.write('The movement is not in free-exercise-db either. Ask the user for a different movement.\n');
    return 1;
  }

  const top = scored[0].score;
  const near = scored.filter((r) => r.score >= top - 10);
  const ambiguous = near.length > 1 && top < 95;

  if (filters.json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          source: source.label,
          query: q,
          ambiguous,
          candidates: scored.map((r) => ({
            score: Math.round(r.score),
            why: r.why,
            id: str(r.exercise.id),
            name: str(r.exercise.name),
            equipment: r.exercise.equipment ?? null,
            category: str(r.exercise.category),
            mechanic: str(r.exercise.mechanic),
            force: str(r.exercise.force),
            level: str(r.exercise.level),
            primaryMuscles: arr(r.exercise.primaryMuscles),
            secondaryMuscles: arr(r.exercise.secondaryMuscles),
            alreadyCurated: curated.has(str(r.exercise.id))
          }))
        },
        null,
        2
      )}\n`
    );
    return 0;
  }

  process.stdout.write(`SOURCE CANDIDATES for "${q}"  (${source.label})\n`);
  process.stdout.write(
    'SCORE  SOURCE_ID\tNAME\tEQUIPMENT\tCATEGORY\tMECHANIC\tPRIMARY\tCURATED\n'
  );
  for (const r of scored) {
    const id = str(r.exercise.id);
    process.stdout.write(
      `${String(Math.round(r.score)).padStart(5)}  ${id}\t${str(r.exercise.name)}\t` +
        `${str(r.exercise.equipment)}\t${str(r.exercise.category)}\t${str(r.exercise.mechanic)}\t` +
        `${arr(r.exercise.primaryMuscles).join('+')}\t${curated.has(id) ? 'YES' : 'no'}\n`
    );
  }
  process.stdout.write('\n');

  if (ambiguous) {
    process.stdout.write(
      `AMBIGUOUS: ${String(near.length)} close matches. Ask the user which source exercise to add.\n`
    );
  } else {
    process.stdout.write('CLEAR: one leading match.\n');
  }

  if (filters.entry) {
    const topId = str(scored[0].exercise.id);
    process.stdout.write('\nAllowlist entry skeleton for the top match. Fill every REPLACE_ME.\n');
    process.stdout.write(`${JSON.stringify(entrySkeleton(scored[0].exercise), null, 2)}\n`);
    process.stdout.write(
      `\nThen: bun .pi/skills/workout-authoring/scripts/add-exercise.ts ${topId} [overrides] --apply\n`
    );
  }

  return 0;
}

process.exitCode = await main();
