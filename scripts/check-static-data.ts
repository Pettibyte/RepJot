/**
 * Build-time gate for the static data files.
 *
 * Reads `src/public/data/exercises.json` and `src/public/data/workouts.json`,
 * pushes each through the document pipeline, then runs `validateStaticData` over
 * the pair. Prints one line per problem and exits nonzero when any problem
 * exists, so a stale or invalid static file fails the build instead of reaching
 * a browser.
 *
 * The gate runs the three identity checks and nothing else. REQUIREMENTS 6.19,
 * 6.20, 6.21, 6.22 pin it there. Prescription rules such as iteration bounds
 * are runtime concerns and stay out of this gate.
 *
 * Usage: bun run check:static
 */

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { isAppError } from '../src/domain/errors';
import type { ExercisesDoc, WorkoutsDoc } from '../src/domain/types';
import type { DocFamily } from '../src/validation/schema-validator';
import { validateStaticData } from '../src/validation/semantic-validator';
import { processDocument } from '../src/documents/document-pipeline';

const DATA_DIR = fileURLToPath(new URL('../src/public/data/', import.meta.url));

/** Bundled file names, named so no check depends on a list position. */
const EXERCISES_FILE = 'exercises.json';
const WORKOUTS_FILE = 'workouts.json';

/** One bundled file, with the family its envelope must carry. */
const BUNDLED_FILES: ReadonlyArray<{ file: string; family: DocFamily }> = [
  { file: EXERCISES_FILE, family: 'repjot/exercises' },
  { file: WORKOUTS_FILE, family: 'repjot/workouts' }
];

const problems: string[] = [];

/**
 * Outcome of one file check.
 *
 * The `ok` tag is what makes the skip rule in note 6 of PHASE-05.md hold by
 * type: a caller cannot read `document` out of a failed check, so the pair
 * check cannot run on a document that never validated. A plain `unknown | null`
 * collapses to `unknown` and narrows nothing.
 */
type FileCheck<T> = { ok: true; document: T } | { ok: false };

/**
 * Read one bundled file and run it through the pipeline.
 *
 * Returns the typed document, or the failure. The problem is recorded either
 * way, so one run reports every fault instead of stopping at the first one.
 */
function checkFile<T>(file: string, family: DocFamily): FileCheck<T> {
  const path = join(DATA_DIR, file);

  if (!existsSync(path)) {
    problems.push(`${file}: file is missing from ${DATA_DIR}`);
    return { ok: false };
  }

  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    problems.push(`${file}: cannot be read: ${(error as Error).message}`);
    return { ok: false };
  }

  try {
    // No semantic stage here. The pair check below needs both documents, so the
    // semantic pass runs once, over both files, instead of per file.
    return { ok: true, document: processDocument<T>(text, family).document };
  } catch (error) {
    if (isAppError(error)) {
      problems.push(`${file}: [${error.kind}] ${error.message}`);
      return { ok: false };
    }
    problems.push(`${file}: unexpected failure: ${(error as Error).message}`);
    return { ok: false };
  }
}

/**
 * Results keyed by file name.
 *
 * Keyed, not positional: reordering `BUNDLED_FILES` stays correct, because
 * every reader asks for a file by name instead of by index.
 */
const results = new Map<string, FileCheck<unknown>>(
  BUNDLED_FILES.map(({ file, family }) => [file, checkFile(file, family)])
);

/**
 * The checked document for one bundled file, or `undefined` when that file
 * failed. Keeps the pair check from reading a document that never validated.
 */
function checkedDocument<T>(file: string): T | undefined {
  const result = results.get(file);
  return result !== undefined && result.ok ? (result.document as T) : undefined;
}

// The pair check needs both documents. When one file already failed, its
// references cannot resolve, so the run stops with the faults it has instead of
// burying the real cause under a pile of unknown-exercise lines. The `undefined`
// test is that rule, not a comment about it.
const exercisesDoc = checkedDocument<ExercisesDoc>(EXERCISES_FILE);
const workoutsDoc = checkedDocument<WorkoutsDoc>(WORKOUTS_FILE);

if (exercisesDoc !== undefined && workoutsDoc !== undefined) {
  for (const issue of validateStaticData(exercisesDoc.exercises, workoutsDoc.workouts)) {
    problems.push(`${issue.path}: [${issue.code}] ${issue.message}`);
  }
}

if (problems.length > 0) {
  for (const problem of problems) {
    console.error(`check:static ${problem}`);
  }
  console.error(`\ncheck:static failed with ${String(problems.length)} problem(s).`);
  process.exit(1);
}

console.log('check:static exercises.json and workouts.json pass the identity checks.');
