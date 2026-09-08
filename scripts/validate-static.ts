/**
 * P10-T01 — Static-data validation command with explicit canonical and fixture modes.
 *
 * Usage:
 *   bun scripts/validate-static.ts
 *       Canonical mode. Validates the approved canonical static inputs under `src/public`
 *       (exercises.json, workouts.json, material-symbols.json, plus every trusted local SVG
 *       referenced by the exercises document). The canonical location is fixed to `src/public`:
 *       no option selects an alternate root, so structurally valid unapproved content can never
 *       be reported as a successful canonical validation. While no approved content has been
 *       published, this mode fails closed with the explicit `canonical-content-missing` content
 *       blocker: a nonzero result that is never reported as a successful canonical validation.
 *
 *   bun scripts/validate-static.ts --fixture <directory>
 *       Fixture mode. Validates one reviewed fixture set laid out as
 *       <directory>/{exercises,workouts,material-symbols}.json with SVG assets under
 *       <directory>/public.
 *
 *   bun scripts/validate-static.ts --fixtures-root <directory>
 *       Complete repository fixture set: validates every subdirectory of the selected root
 *       (default: tests/fixtures/static) in sorted order. A missing root or an empty set
 *       fails closed instead of silently passing with nothing selected.
 *
 * Behavior: document bytes are untrusted ingress and pass the exact JSON parser (strict UTF-8,
 * no BOM, RFC 8259, duplicate members rejected) before schema validation (Draft 2020-12, four
 * families), the static semantic cross-file pass, and the trusted local SVG gate (path safety,
 * sanitizer checks, existence). The command is read-only over every selected input: it creates,
 * replaces, and deletes nothing. Output is deterministic: stable codes, sorted fixture names,
 * no timestamps or randomness. Exits 0 only when every selected input passes; exits 1 on any
 * validation failure or the canonical content blocker; exits 2 on a usage error. One operator
 * runs this development-time tool; one invocation reads stable selected inputs (no multi-process
 * guarantee by design).
 */
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";

import { parseBundleBytes } from "../src/compatibility/compare-static-data";
import { createProductionValidator } from "../src/validation/schema-validator";
import { validateStaticDocuments } from "../src/validation/semantic";
import { validateTrustedLocalIcons } from "../src/validation/semantic/icon-validation";
import type { IconFileAccess } from "../src/validation/semantic/icon-validation";

const REPO_ROOT = resolve(import.meta.dir, "..");
export const DEFAULT_CANONICAL_ROOT = join(REPO_ROOT, "src", "public");
export const DEFAULT_FIXTURES_ROOT = join(REPO_ROOT, "tests", "fixtures", "static");
const CANONICAL_DOCUMENT_NAMES = ["exercises.json", "workouts.json", "material-symbols.json"] as const;

type LoadFailure = { readonly ok: false; readonly code: string; readonly subject: string; readonly message: string };
type LoadedSet = {
  readonly ok: true;
  readonly exercises: unknown;
  readonly workouts: unknown;
  readonly symbols: ReadonlySet<string>;
};
type DocumentRead = { readonly value: unknown } | LoadFailure;

async function readExactDocument(path: string, label: string): Promise<DocumentRead> {
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await readFile(path));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") {
      return { ok: false, code: "static-input-missing", subject: path, message: label + " is missing from the selected input set" };
    }
    throw error;
  }
  const parsed = parseBundleBytes(bytes);
  if (!parsed.ok) {
    return { ok: false, code: "static-json-invalid", subject: path, message: label + " is not exact JSON: " + parsed.detail };
  }
  return { value: parsed.value };
}

function symbolManifestFailure(path: string): LoadFailure {
  return { ok: false, code: "static-manifest-invalid", subject: path, message: "material-symbols.json must be an array of non-empty symbol names" };
}

/** Read and exact-parse one static set (exercises, workouts, Material Symbol manifest). */
async function loadStaticSet(root: string): Promise<LoadedSet | LoadFailure> {
  const exercises = await readExactDocument(join(root, "exercises.json"), "the exercises document");
  if (!("value" in exercises)) return exercises;
  const workouts = await readExactDocument(join(root, "workouts.json"), "the workouts document");
  if (!("value" in workouts)) return workouts;
  const manifest = await readExactDocument(join(root, "material-symbols.json"), "the Material Symbol manifest");
  if (!("value" in manifest)) return manifest;
  const names: unknown = manifest.value;
  if (!Array.isArray(names) || names.some((name) => typeof name !== "string" || name.length === 0)) {
    return symbolManifestFailure(join(root, "material-symbols.json"));
  }
  return { ok: true, exercises: exercises.value, workouts: workouts.value, symbols: new Set<string>(names as string[]) };
}

function nodeIconFiles(staticRoot: string): IconFileAccess {
  return {
    rootRealPath: () => realpath(staticRoot),
    fileRealPath: async (candidatePath: string): Promise<string | null> => {
      try {
        const canonical = await realpath(candidatePath);
        const details = await lstat(canonical);
        return details.isFile() ? canonical : null;
      } catch (_error) {
        return null;
      }
    },
    readBytes: async (path: string) => new Uint8Array(await readFile(path))
  };
}

interface ValidateOutcome {
  readonly ok: boolean;
  readonly lines: readonly string[];
}

/** Run the full static gate over one loaded set: schema, semantic, trusted local SVG. */
async function validateLoadedSet(set: LoadedSet, iconRoot: string): Promise<ValidateOutcome> {
  const schema = createProductionValidator();
  const exerciseSchema = schema.validate("exercises", 1, set.exercises);
  if (!exerciseSchema.valid) {
    return { ok: false, lines: ["static-schema-invalid [exercises] the exercises document violates its Draft 2020-12 schema"] };
  }
  const workoutSchema = schema.validate("workouts", 1, set.workouts);
  if (!workoutSchema.valid) {
    return { ok: false, lines: ["static-schema-invalid [workouts] the workouts document violates its Draft 2020-12 schema"] };
  }

  const semantic = validateStaticDocuments(set.exercises, set.workouts);
  if (!semantic.valid) {
    return {
      ok: false,
      lines: semantic.diagnostics.map((item) => "static-semantic-invalid [" + item.code + "] " + item.path)
    };
  }

  let icons;
  try {
    icons = await validateTrustedLocalIcons(set.exercises, {
      staticRoot: iconRoot,
      materialSymbols: set.symbols,
      files: nodeIconFiles(iconRoot)
    });
  } catch (_error) {
    return { ok: false, lines: ["static-icon-root-missing [public] the static asset root is missing or unreadable"] };
  }
  if (!icons.valid) {
    return { ok: false, lines: icons.diagnostics.map((item) => "static-icon-invalid [" + item.code + "] " + item.path) };
  }
  return { ok: true, lines: [] };
}

interface Options {
  mode: "canonical" | "fixture" | "fixtures-root";
  fixtureDir: string;
  fixturesRoot: string;
}

function usageError(message: string): never {
  console.error("Usage error: " + message);
  console.error(
    [
      "Usage:",
      "  bun scripts/validate-static.ts",
      "  bun scripts/validate-static.ts --fixture <directory>",
      "  bun scripts/validate-static.ts [--fixtures-root <directory>]"
    ].join("\n")
  );
  process.exit(2);
}

function parseArgs(args: readonly string[]): Options {
  const options: Options = {
    mode: "canonical",
    fixtureDir: "",
    fixturesRoot: DEFAULT_FIXTURES_ROOT
  };
  let modeSelections = 0;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    switch (arg) {
      case "--fixture": {
        const next = i + 1 < args.length ? args[i + 1] : undefined;
        if (next === undefined || next.length === 0) usageError("flag --fixture needs a value");
        modeSelections += 1;
        if (modeSelections > 1) usageError("use exactly one of --fixture <directory> or --fixtures-root <directory>");
        options.mode = "fixture";
        options.fixtureDir = resolve(next);
        i += 1;
        break;
      }
      case "--fixtures-root": {
        const next = i + 1 < args.length ? args[i + 1] : undefined;
        if (next === undefined || next.length === 0) usageError("flag --fixtures-root needs a value");
        modeSelections += 1;
        if (modeSelections > 1) usageError("use exactly one of --fixture <directory> or --fixtures-root <directory>");
        options.mode = "fixtures-root";
        options.fixturesRoot = resolve(next);
        i += 1;
        break;
      }
      default:
        usageError("unknown argument " + arg);
    }
  }
  return options;
}

/** Presence check without reading bytes; other I/O errors fail closed by rethrowing. */
async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return false;
    throw error;
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    const details = await lstat(path);
    return details.isDirectory();
  } catch (_error) {
    return false;
  }
}

/** Canonical mode: the fixed approved location only; absent or incomplete content is an explicit blocker. */
async function runCanonical(): Promise<number> {
  const root = DEFAULT_CANONICAL_ROOT;
  if (!(await isDirectory(root))) {
    console.error("canonical-content-missing [" + root + "] the canonical static root is missing; approved content has not been published, so canonical validation is blocked");
    return 1;
  }
  const missing: string[] = [];
  for (const name of CANONICAL_DOCUMENT_NAMES) {
    if (!(await pathExists(join(root, name)))) missing.push(name);
  }
  if (missing.length > 0) {
    console.error(
      "canonical-content-missing [" + root + "] approved canonical static inputs are absent: " +
        missing.join(", ") + "; publish them through the curation approval flow before running canonical validation"
    );
    return 1;
  }

  const set = await loadStaticSet(root);
  if (!set.ok) {
    console.error(set.code + " [" + set.subject + "] " + set.message);
    return 1;
  }
  const outcome = await validateLoadedSet(set, root);
  if (!outcome.ok) {
    for (const line of outcome.lines) console.error(line);
    return 1;
  }
  console.log("canonical static validation passed: " + root);
  return 0;
}

/** Fixture mode: one reviewed fixture set with SVG assets under <fixture>/public. */
async function runFixture(options: Options): Promise<number> {
  const root = options.fixtureDir;
  if (!(await isDirectory(root))) {
    console.error("static-input-missing [" + root + "] the selected fixture directory is missing");
    return 1;
  }
  const set = await loadStaticSet(root);
  if (!set.ok) {
    console.error(set.code + " [" + set.subject + "] " + set.message);
    return 1;
  }
  const outcome = await validateLoadedSet(set, join(root, "public"));
  if (!outcome.ok) {
    for (const line of outcome.lines) console.error(line);
    return 1;
  }
  console.log("static fixture validation passed: " + root);
  return 0;
}

/** Complete repository fixture set: every subdirectory of the selected root, sorted. */
async function runFixturesRoot(options: Options): Promise<number> {
  const root = options.fixturesRoot;
  if (!(await isDirectory(root))) {
    console.error("static-input-missing [" + root + "] the selected fixtures root is missing");
    return 1;
  }
  let names: string[];
  try {
    names = (await readdir(root, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch (_error) {
    console.error("static-input-missing [" + root + "] the selected fixtures root is unreadable");
    return 1;
  }
  if (names.length === 0) {
    console.error("fixtures-set-empty [" + root + "] no fixture sets are selected; the repository fixture set must not validate to a silent pass");
    return 1;
  }
  let failed = false;
  for (const name of names) {
    const dir = join(root, name);
    if (!(await isDirectory(dir))) continue;
    const set = await loadStaticSet(dir);
    if (!set.ok) {
      console.error(name + ": " + set.code + " [" + set.subject + "] " + set.message);
      failed = true;
      continue;
    }
    const outcome = await validateLoadedSet(set, join(dir, "public"));
    if (!outcome.ok) {
      for (const line of outcome.lines) console.error(name + ": " + line);
      failed = true;
      continue;
    }
    console.log(name + ": ok");
  }
  if (failed) {
    console.error("validate:static FAILED (" + root + ")");
    return 1;
  }
  console.log("validate:static ok (" + names.length + " fixture set" + (names.length === 1 ? "" : "s") + " under " + root + ")");
  return 0;
}

/** Run one complete command invocation; returns the process exit code. Exported for tests. */
export async function runValidateStatic(args: readonly string[]): Promise<number> {
  const options = parseArgs(args);
  switch (options.mode) {
    case "fixture":
      return runFixture(options);
    case "fixtures-root":
      return runFixturesRoot(options);
    default:
      return runCanonical();
  }
}

// Runs only when executed directly (`bun scripts/validate-static.ts`), not when imported by tests.
if (import.meta.main) {
  process.exitCode = await runValidateStatic(process.argv.slice(2));
}
