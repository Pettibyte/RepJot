/**
 * P8-T01 — Generate the REP JOT exercise curation review artifact from approved local source
 * data plus explicit human curation. Generation-only: this command never writes canonical data.
 *
 * Usage:
 *   bun scripts/build-static-data.ts
 *       [--source <directory>]     default: ../free-exercise-db (local checkout, no network)
 *       [--curation <file>]        default: data/curation/exercises.curation.json
 *       [--staging <directory>]    default: .curation-staging (git-ignored)
 *
 * Behavior:
 - Reads local allowlisted source JSON only. Every source file and the curation document are
   ingested as exact bytes through `parseExactJson` (strict UTF-8, no duplicate members, no
   lossy values) before any structural or semantic validation. Missing checkout, malformed data,
   unknown source classifications, and duplicate internal source IDs fail closed with actionable
   diagnostics.
 - Requires an explicit curation entry for every source exercise (laterality, movement pattern,
   measurements, conditional load semantics) and curated equipment for null or unmapped source
   equipment. Source `body only` maps to no equipment.
 - On success, atomically replaces the one structured review artifact
   `<staging>/exercises.review.json`: candidate document, its exact canonical-byte SHA-256, and
   deterministic review metadata in a single file (same-directory temporary file plus rename).
   The same semantic inputs always produce byte-identical artifact bytes. A failed generation
   publishes nothing: the prior complete artifact (if any) stays unchanged because it is
   regenerable and explicitly selected for review, and canonical data is never touched by this
   command. Canonical publication is the separate `scripts/promote-static-data.ts` action.
 - One operator runs this development-time tool. One invocation per output path is supported;
   same-path multi-process concurrency is unsupported. Parallel work uses separate checkouts or
   output paths. The local workspace and operator are trusted against hostile concurrent
   filesystem mutation.
 */
import { lstat, mkdir, readFile, readdir, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";

import { parseCurationDocument } from "../src/curation/curation";
import { parseExactJson } from "../src/curation/exact-json";
import { parseSourceExercise } from "../src/curation/source";
import type { CurationDiagnostic, SourceExercise } from "../src/curation/source";
import { buildReviewArtifact, REVIEW_ARTIFACT_FILE_NAME } from "../src/curation/review-artifact";
import { transformExercises } from "../src/curation/transform";
import { OutputWriteError, writeAtomicFile } from "../src/curation/atomic-write";
import { createProductionValidator } from "../src/validation/schema-validator";
import { validateStaticDocuments } from "../src/validation/semantic";

export { REVIEW_ARTIFACT_FILE_NAME } from "../src/curation/review-artifact";

const REPO_ROOT = resolve(import.meta.dir, "..");

export const DEFAULT_SOURCE_PATH = "../free-exercise-db";
export const DEFAULT_CURATION_PATH = "data/curation/exercises.curation.json";
export const DEFAULT_STAGING_DIR = ".curation-staging";

interface Options {
  source: string;
  curation: string;
  staging: string;
}

function usageError(message: string): never {
  console.error("Usage error: " + message);
  console.error(
    [
      "Usage: bun scripts/build-static-data.ts",
      "  [--source <directory>]   default: " + DEFAULT_SOURCE_PATH,
      "  [--curation <file>]      default: " + DEFAULT_CURATION_PATH,
      "  [--staging <directory>]  default: " + DEFAULT_STAGING_DIR,
      "",
      "Generation only: writes the review artifact to staging and never writes canonical data.",
      "Canonical publication is a separate action: bun scripts/promote-static-data.ts"
    ].join("\n")
  );
  process.exit(2);
}

function parseArgs(args: readonly string[]): Options {
  const options: Options = {
    source: DEFAULT_SOURCE_PATH,
    curation: DEFAULT_CURATION_PATH,
    staging: resolve(DEFAULT_STAGING_DIR)
  };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const next = i + 1 < args.length ? args[i + 1] : undefined;
    if (next === undefined || next.length === 0) {
      usageError("flag " + arg + " needs a value");
    }
    switch (arg) {
      case "--source":
        options.source = resolve(next);
        i += 1;
        break;
      case "--curation":
        options.curation = resolve(next);
        i += 1;
        break;
      case "--staging":
        options.staging = resolve(next);
        i += 1;
        break;
      default:
        usageError("unknown argument " + arg);
    }
  }
  return options;
}

function printDiagnostics(diagnostics: readonly CurationDiagnostic[]): void {
  for (const item of diagnostics) {
    const target = item.sourceId === null ? "" : " [" + item.sourceId + "]";
    console.error(item.code + target + " " + item.message);
  }
}

interface SourceLoadResult {
  readonly exercises: SourceExercise[];
  readonly diagnostics: CurationDiagnostic[];
}

async function effectivePath(path: string): Promise<string> {
  let current = path;
  const suffix: string[] = [];
  while (true) {
    try {
      const resolvedCurrent = await realpath(current);
      return suffix.reduceRight((parent, name) => join(parent, name), resolvedCurrent);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = resolve(current, "..");
      if (parent === current) return current;
      suffix.push(relative(parent, current));
      current = parent;
    }
  }
}

async function validateStagingPath(staging: string): Promise<void> {
  if (!isAbsolute(staging)) throw new Error("staging path must be absolute");
  const repoRoot = await realpath(REPO_ROOT);
  const effective = await effectivePath(staging);
  const fromRepo = relative(repoRoot, effective);
  const withinRepo = fromRepo === "" || (!fromRepo.startsWith(".." + "/") && !isAbsolute(fromRepo));
  if (withinRepo && effective !== join(repoRoot, DEFAULT_STAGING_DIR)) {
    throw new OutputWriteError("staging-path-invalid", 'staging directory must be the repository root .curation-staging directory or an external directory');
  }
}

async function loadSourceCheckout(sourceDir: string): Promise<SourceLoadResult> {
  const diagnostics: CurationDiagnostic[] = [];
  let details;
  try {
    details = await stat(join(sourceDir, "exercises"));
  } catch (_error) {
    return {
      exercises: [],
      diagnostics: [
        {
          code: "source-checkout-missing",
          sourceId: null,
          message:
            'the source checkout "' +
            sourceDir +
            '" is missing its exercises/ directory; check out yuhonas/free-exercise-db locally or pass --source <directory>'
        }
      ]
    };
  }
  if (!details.isDirectory()) {
    return {
      exercises: [],
      diagnostics: [{ code: "source-checkout-missing", sourceId: null, message: 'path "' + join(sourceDir, "exercises") + '" is not a directory' }]
    };
  }

  const names = (await readdir(join(sourceDir, "exercises"))).filter((name) => name.endsWith(".json")).sort();
  const exercises: SourceExercise[] = [];
  const filesById = new Map<string, string>();
  for (const name of names) {
    const fileDetails = await lstat(join(sourceDir, "exercises", name));
    if (!fileDetails.isFile()) {
      diagnostics.push({
        code: "source-json-invalid",
        sourceId: null,
        message: 'source entry "' + name + '" is not a regular file; remove it from the checkout or correct the path'
      });
      continue;
    }
    let raw: unknown;
    try {
      const bytes = new Uint8Array(await readFile(join(sourceDir, "exercises", name)));
      const exact = parseExactJson(bytes);
      if (!exact.ok) {
        diagnostics.push({
          code: "source-json-invalid",
          sourceId: null,
          message: 'source file "' + name + '" is not valid strict JSON: ' + exact.detail + "; correct the file and rerun"
        });
        continue;
      }
      raw = exact.value;
    } catch (_error) {
      diagnostics.push({
        code: "source-json-invalid",
        sourceId: null,
        message: 'source file "' + name + '" could not be read as bytes; check the file and rerun'
      });
      continue;
    }
    const parsed = parseSourceExercise(raw);
    if (!parsed.ok) {
      for (const item of parsed.diagnostics) {
        diagnostics.push({ code: item.code, sourceId: item.sourceId, message: 'source file "' + name + '": ' + item.message });
      }
      continue;
    }
    const existingFile = filesById.get(parsed.exercise.id);
    if (existingFile !== undefined) {
      diagnostics.push({
        code: "source-duplicate-id",
        sourceId: parsed.exercise.id,
        message: 'source ID "' + parsed.exercise.id + '" appears in both "' + existingFile + '" and "' + name + '"'
      });
      continue;
    }
    filesById.set(parsed.exercise.id, name);
    exercises.push(parsed.exercise);
  }
  return { exercises, diagnostics };
}

/**
 * The read-compute-publish pipeline. All validation runs before the single artifact write, so a
 * failed generation publishes nothing and leaves any prior complete artifact unchanged.
 */
async function runPipeline(options: Options): Promise<number> {
  await validateStagingPath(options.staging);
  const sourceLoad = await loadSourceCheckout(options.source);
  if (sourceLoad.diagnostics.length > 0) {
    printDiagnostics(sourceLoad.diagnostics);
    return 1;
  }

  let curationBytes: Uint8Array;
  try {
    curationBytes = new Uint8Array(await readFile(options.curation));
  } catch (error) {
    const isMissing = (error as NodeJS.ErrnoException).code === "ENOENT";
    printDiagnostics([
      {
        code: isMissing ? "curation-file-missing" : "curation-json-invalid",
        sourceId: null,
        message: isMissing
          ? 'the curation file "' + options.curation + '" is missing; copy data/curation/exercises.curation.template.json and record explicit human curation'
          : 'the curation file "' + options.curation + '" could not be read as bytes; check the file and rerun'
      }
    ]);
    return 1;
  }
  const exactCuration = parseExactJson(curationBytes);
  if (!exactCuration.ok) {
    printDiagnostics([
      {
        code: "curation-json-invalid",
        sourceId: null,
        message: 'the curation file "' + options.curation + '" is not valid strict JSON: ' + exactCuration.detail + "; correct the file and rerun"
      }
    ]);
    return 1;
  }
  const parsedCuration = parseCurationDocument(exactCuration.value);
  if (!parsedCuration.ok) {
    printDiagnostics(parsedCuration.diagnostics);
    return 1;
  }

  const result = transformExercises(sourceLoad.exercises, parsedCuration.document);
  if (result.diagnostics.length > 0) {
    printDiagnostics(result.diagnostics);
    return 1;
  }

  const schemaCheck = createProductionValidator().validate("exercises", 1, result.document);
  if (!schemaCheck.valid) {
    for (const item of schemaCheck.errors) {
      printDiagnostics([{ code: "candidate-schema-invalid", sourceId: null, message: item.instancePath + ": " + item.message }]);
    }
    return 1;
  }

  // The candidate is a static exercises document. Run the accepted static semantic owner with an
  // empty workouts document so generation cannot accept schema-valid semantic defects.
  const semanticCheck = validateStaticDocuments(result.document, {
    format: "repjot/workouts",
    schemaVersion: 1,
    workouts: []
  });
  if (!semanticCheck.valid) {
    for (const item of semanticCheck.diagnostics) {
      printDiagnostics([{ code: "candidate-semantic-invalid", sourceId: null, message: item.path + ": " + item.message }]);
    }
    return 1;
  }

  const artifact = buildReviewArtifact(result.document);
  await mkdir(options.staging, { recursive: true });
  await writeAtomicFile(join(options.staging, REVIEW_ARTIFACT_FILE_NAME), artifact.bytes, "staging-write-failed");

  console.log("Review artifact written to " + join(options.staging, REVIEW_ARTIFACT_FILE_NAME));
  console.log("candidateSha256: " + artifact.document.candidateSha256);
  console.log(
    "Generation only: canonical data was not written. Review the artifact, record approval bound to candidateSha256, then run bun scripts/promote-static-data.ts --approval <file>."
  );
  return 0;
}

async function main(): Promise<number> {
  const options = parseArgs(process.argv.slice(2));
  try {
    return await runPipeline(options);
  } catch (error) {
    if (error instanceof OutputWriteError) {
      printDiagnostics([{ code: error.code, sourceId: null, message: error.message }]);
    } else {
      printDiagnostics([{ code: "staging-write-failed", sourceId: null, message: "unexpected filesystem error during artifact publication: " + String(error) }]);
    }
    return 1;
  }
}

// Runs only when executed directly (`bun scripts/build-static-data.ts`), not when imported by tests.
if (import.meta.main) {
  process.exitCode = await main();
}
