/**
 * P9-T01 — Isolated static-data compatibility command. Compare the current static bundle with
 * the prior production bundle (or declare the explicit blank first-release mode), and separately
 * record the first-release baseline digest only after exact human approval.
 *
 * Usage:
 *   bun scripts/compare-production.ts --first-release
 *       Explicit blank first-release mode. No prior files, no network request, no digest is
 *       fabricated, and nothing is written. Always succeeds when invoked correctly.
 *
 *   bun scripts/compare-production.ts --fixture <directory>
 *       Fixture comparison. Reads <directory>/current/{exercises,workouts}.json and
 *       <directory>/prior/{exercises,workouts}.json from local disk only; performs no network
 *       access. A missing prior directory fails closed (use --first-release for the first release).
 *
 *   bun scripts/compare-production.ts [--current <dir>] [--prior <dir> | default: download]
 *       Production comparison. Current defaults to src/public/. Prior comes from a local
 *       directory or is downloaded from https://repjot.com/exercises.json and
 *       https://repjot.com/workouts.json (the last release). Any network failure blocks the
 *       release rather than skipping compatibility validation. The pinned baseline manifest at
 *       .compatibility/baseline.json must record the prior bundle digests; a mismatch or a
 *       missing manifest fails closed.
 *
 *   bun scripts/compare-production.ts --record-baseline --approval <file>
 *       [--current <dir>] [--baseline <file>]
 *       The separate approval-bound action that records first-release digests. Validates the
 *       current bundle, exact-parses and strictly validates the separate human approval, and
 *       requires both file digests to match exactly. Only then does it atomically write the
 *       baseline manifest (default .compatibility/baseline.json). Every failure leaves an
 *       existing baseline byte-identical; a different pre-existing baseline is never replaced.
 *
 * Behavior: bundle bytes are untrusted ingress and pass the exact JSON parser (strict UTF-8, no
 * BOM, RFC 8259, duplicate members rejected) before schema and semantic validation. Reports are
 * deterministic stdout diagnostics with stable codes; equivalent inputs produce identical output.
 * One operator runs this development-time tool; one invocation per output path is supported and
 * same-path multi-process concurrency is unsupported (no locks by design). The command never
 * writes production static data and performs no network access in fixture or first-release mode.
 */
import { mkdir, readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { writeAtomicFile } from "../src/curation/atomic-write";
import {
  COMPATIBILITY_INFORMATIONAL_MESSAGES,
  COMPATIBILITY_MESSAGES,
  buildBaselineBytes,
  compareStaticBundles,
  parseBaselineApproval,
  parseBaselineDocument,
  parseBundleBytes,
  sha256Hex,
  validateCanonicalCandidate
} from "../src/compatibility/compare-static-data";

const REPO_ROOT = resolve(import.meta.dir, "..");
const PRIOR_BASE_URL = "https://repjot.com/";
const DEFAULT_CURRENT_DIR = join(REPO_ROOT, "src", "public");
const DEFAULT_BASELINE_PATH = join(REPO_ROOT, ".compatibility", "baseline.json");

/** Injectable I/O so tests can run the whole command without disk or network. */
export interface CompatibilityIo {
  /** Read exact bytes; null when the path is absent. */
  readonly readBytes: (path: string) => Promise<Uint8Array | null>;
  /** Check path presence without reading file contents. */
  readonly pathExists: (path: string) => Promise<boolean>;
  /** Create the selected output parent before the atomic write. */
  readonly ensureDirectory: (path: string) => Promise<void>;
  /** Atomically replace one regular file (same-directory temp + rename). */
  readonly writeAtomic: (path: string, bytes: Uint8Array) => Promise<void>;
  /** Download one URL; null on any network or HTTP failure. Production mode only. */
  readonly fetchUrl: (url: string) => Promise<Uint8Array | null>;
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

/** Default node I/O. `fetch` is used only by the production download path. */
export function makeNodeIo(): CompatibilityIo {
  return {
    readBytes: async (path: string): Promise<Uint8Array | null> => {
      try {
        return new Uint8Array(await readFile(path));
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "ENOENT" || code === "ENOTDIR") return null;
        throw error;
      }
    },
    pathExists: async (path: string): Promise<boolean> => {
      try {
        await stat(path);
        return true;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "ENOENT" || code === "ENOTDIR") return false;
        throw error;
      }
    },
    ensureDirectory: async (path: string): Promise<void> => {
      await mkdir(path, { recursive: true });
    },
    writeAtomic: async (path: string, bytes: Uint8Array): Promise<void> => {
      await writeAtomicFile(path, bytes, "baseline-write-failed");
    },
    fetchUrl: async (url: string): Promise<Uint8Array | null> => {
      try {
        const response = await globalThis.fetch(url);
        if (!response.ok) return null;
        return new Uint8Array(await response.arrayBuffer());
      } catch (_error) {
        return null;
      }
    },
    out: (line: string): void => console.log(line),
    err: (line: string): void => console.error(line)
  };
}

interface Options {
  mode: "first-release" | "fixture" | "production" | "record-baseline";
  fixtureDir: string;
  currentDir: string;
  priorDir: string;
  approvalPath: string;
  baselinePath: string;
}


function usageError(message: string): never {
  console.error("Usage error: " + message);
  console.error(
    [
      "Usage:",
      "  bun scripts/compare-production.ts --first-release",
      "  bun scripts/compare-production.ts --fixture <directory>",
      "  bun scripts/compare-production.ts [--current <dir>] [--prior <dir>]",
      "  bun scripts/compare-production.ts --record-baseline --approval <file> [--current <dir>] [--baseline <file>]"
    ].join("\n")
  );
  process.exit(2);
}

function parseArgs(args: readonly string[]): Options {
  const options: Options = {
    mode: "production",
    fixtureDir: "",
    currentDir: DEFAULT_CURRENT_DIR,
    priorDir: "",
    approvalPath: "",
    baselinePath: DEFAULT_BASELINE_PATH
  };
  let modeSelections = 0;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--first-release" || arg === "--record-baseline") {
      modeSelections += 1;
      if (modeSelections > 1) usageError("use exactly one of --first-release, --fixture <directory>, or --record-baseline");
      options.mode = arg === "--first-release" ? "first-release" : "record-baseline";
      continue;
    }
    const next = i + 1 < args.length ? args[i + 1] : undefined;
    if (next === undefined || next.length === 0) usageError("flag " + arg + " needs a value");
    switch (arg) {
      case "--fixture":
        modeSelections += 1;
        if (modeSelections > 1) usageError("use exactly one of --first-release, --fixture <directory>, or --record-baseline");
        options.mode = "fixture";
        options.fixtureDir = resolve(next);
        i += 1;
        break;
      case "--approval":
        options.approvalPath = resolve(next);
        i += 1;
        break;
      case "--current":
        options.currentDir = resolve(next);
        i += 1;
        break;
      case "--prior":
        options.priorDir = resolve(next);
        i += 1;
        break;
      case "--baseline":
        options.baselinePath = resolve(next);
        i += 1;
        break;
      default:
        usageError("unknown argument " + arg);
    }
  }
  if (options.mode === "first-release") {
    if (options.fixtureDir !== "" || options.priorDir !== "" || options.approvalPath !== "") {
      usageError("--first-release takes no other arguments; it requires no prior files and writes nothing");
    }
  }
  if (options.mode === "fixture" && options.fixtureDir === "") {
    usageError("one of --first-release, --fixture <directory>, or --record-baseline is required for non-production runs");
  }
  if (options.mode === "fixture" && options.approvalPath !== "") {
    usageError("--approval belongs to --record-baseline only");
  }
  if (options.mode === "record-baseline" && options.approvalPath === "") {
    usageError("--record-baseline requires --approval <file>; the baseline is never recorded without separate human approval");
  }
  return options;
}

async function readBundle(io: CompatibilityIo, dir: string): Promise<{ ok: true; exercises: Uint8Array; workouts: Uint8Array } | { ok: false; code: string; subject: string; message: string }> {
  const exercises = await io.readBytes(join(dir, "exercises.json"));
  if (exercises === null) return { ok: false, code: "bundle-file-missing", subject: dir + "/exercises.json", message: "the bundle file is missing" };
  const workouts = await io.readBytes(join(dir, "workouts.json"));
  if (workouts === null) return { ok: false, code: "bundle-file-missing", subject: dir + "/workouts.json", message: "the bundle file is missing" };
  return { ok: true, exercises, workouts };
}

function fail(io: CompatibilityIo, code: string, subject: string, message: string): number {
  io.err(code + " [" + subject + "] " + message);
  return 1;
}

/** Exact-parse one side; returns a failure line when any file is not valid strict JSON. */
function parseSide(bytesPair: readonly [Uint8Array, Uint8Array], label: string): { ok: true; value: readonly [unknown, unknown] } | { ok: false; code: string; subject: string; message: string } {
  const names = ["exercises.json", "workouts.json"];
  const values: unknown[] = [];
  for (let i = 0; i < 2; i += 1) {
    const parsed = parseBundleBytes(bytesPair[i]);
    if (!parsed.ok) {
      return { ok: false, code: "bundle-json-invalid", subject: label + "/" + names[i], message: parsed.detail };
    }
    values.push(parsed.value);
  }
  return { ok: true, value: [values[0], values[1]] };
}

async function runFirstRelease(io: CompatibilityIo, baselinePath: string): Promise<number> {
  // Blank mode is valid only before a baseline exists. Check presence without reading the
  // manifest contents so an absent baseline keeps the no-bundle-read/no-network/no-write path.
  let baselineExists: boolean;
  try {
    baselineExists = await io.pathExists(baselinePath);
  } catch (_error) {
    return fail(io, "first-release-baseline-check-failed", baselinePath, "the configured baseline state could not be checked");
  }
  if (baselineExists) {
    return fail(io, "first-release-baseline-exists", baselinePath, "blank first-release mode requires no existing baseline; use future comparison instead");
  }
  io.out("REP JOT static-data compatibility report");
  io.out("mode: first-release");
  io.out("result: first-release-accepted");
  io.out("diagnostics: none");
  io.out("no prior production bundle exists; no network request was made and no baseline digest was recorded");
  return 0;
}

async function runFixture(io: CompatibilityIo, fixtureDir: string): Promise<number> {
  const currentDir = join(fixtureDir, "current");
  const priorDir = join(fixtureDir, "prior");
  const prior = await io.readBytes(join(priorDir, "exercises.json"));
  if (prior === null) {
    return fail(io, "prior-bundle-missing", fixtureDir + "/prior", "the prior bundle is absent; the first release uses --first-release instead of a prior comparison");
  }
  const current = await readBundle(io, currentDir);
  if (!current.ok) return fail(io, current.code, current.subject, current.message);
  const priorWorkouts = await io.readBytes(join(priorDir, "workouts.json"));
  if (priorWorkouts === null) {
    return fail(io, "prior-bundle-missing", fixtureDir + "/prior/workouts.json", "the prior bundle file is missing");
  }
  const currentParsed = parseSide([current.exercises, current.workouts], "current");
  if (!currentParsed.ok) return fail(io, currentParsed.code, currentParsed.subject, currentParsed.message);
  const priorParsed = parseSide([prior, priorWorkouts], "prior");
  if (!priorParsed.ok) return fail(io, priorParsed.code, priorParsed.subject, priorParsed.message);
  return printComparison(io, "fixture", compareStaticBundles(priorParsed.value, currentParsed.value));
}

async function runProduction(io: CompatibilityIo, options: Options): Promise<number> {
  const current = await readBundle(io, options.currentDir);
  if (!current.ok) return fail(io, current.code, current.subject, current.message);

  let priorExercises: Uint8Array | null;
  let priorWorkouts: Uint8Array | null;
  if (options.priorDir !== "") {
    const localPrior = await readBundle(io, options.priorDir);
    if (!localPrior.ok) return fail(io, "prior-bundle-missing", localPrior.subject, localPrior.message);
    priorExercises = localPrior.exercises;
    priorWorkouts = localPrior.workouts;
  } else {
    priorExercises = await io.fetchUrl(PRIOR_BASE_URL + "exercises.json");
    if (priorExercises === null) return fail(io, "prior-download-failed", PRIOR_BASE_URL + "exercises.json", "the prior bundle download failed; the release is blocked rather than skipping compatibility validation");
    priorWorkouts = await io.fetchUrl(PRIOR_BASE_URL + "workouts.json");
    if (priorWorkouts === null) return fail(io, "prior-download-failed", PRIOR_BASE_URL + "workouts.json", "the prior bundle download failed; the release is blocked rather than skipping compatibility validation");
  }

  const baselineBytes = await io.readBytes(options.baselinePath);
  if (baselineBytes === null) {
    return fail(io, "baseline-missing", options.baselinePath, "the pinned release manifest is missing; record it with the approval-bound --record-baseline action first");
  }
  const baselineParsed = parseBundleBytes(baselineBytes);
  if (!baselineParsed.ok) return fail(io, "baseline-not-valid", options.baselinePath, baselineParsed.detail);
  const baselineDocument = parseBaselineDocument(baselineParsed.value);
  if (!baselineDocument.ok) return fail(io, "baseline-not-valid", options.baselinePath, baselineDocument.detail);
  if (sha256Hex(priorExercises) !== baselineDocument.document.exercisesSha256 || sha256Hex(priorWorkouts) !== baselineDocument.document.workoutsSha256) {
    return fail(io, "prior-bundle-digest-mismatch", options.baselinePath, "the prior bundle digests do not match the pinned release manifest");
  }

  const currentParsed = parseSide([current.exercises, current.workouts], "current");
  if (!currentParsed.ok) return fail(io, currentParsed.code, currentParsed.subject, currentParsed.message);
  const priorParsed = parseSide([priorExercises, priorWorkouts], "prior");
  if (!priorParsed.ok) return fail(io, priorParsed.code, priorParsed.subject, priorParsed.message);
  return printComparison(io, options.priorDir === "" ? "production" : "production-local", compareStaticBundles(priorParsed.value, currentParsed.value));
}

async function runRecordBaseline(io: CompatibilityIo, options: Options): Promise<number> {
  const current = await readBundle(io, options.currentDir);
  if (!current.ok) return fail(io, current.code, current.subject, current.message);
  const parsed = parseSide([current.exercises, current.workouts], "current");
  if (!parsed.ok) return fail(io, parsed.code, parsed.subject, parsed.message);
  const validation = validateCanonicalCandidate(parsed.value[0], parsed.value[1]);
  if (!validation.ok) {
    if (validation.kind === "compatibility") {
      for (const diagnostic of validation.report.diagnostics) {
        const message = COMPATIBILITY_MESSAGES[diagnostic.code];
        io.err(diagnostic.code + " [" + diagnostic.subject + "] " + message);
      }
      return 1;
    }
    return fail(io, validation.kind === "schema" ? "bundle-schema-invalid" : "bundle-semantic-invalid", "current", validation.detail);
  }

  const approvalBytes = await io.readBytes(options.approvalPath);
  if (approvalBytes === null) {
    return fail(io, "approval-file-missing", options.approvalPath, "the separate human approval is missing; record human approval bound to the bundle digests first");
  }
  const approvalParsed = parseBundleBytes(approvalBytes);
  if (!approvalParsed.ok) return fail(io, "approval-json-invalid", options.approvalPath, approvalParsed.detail);
  const approval = parseBaselineApproval(approvalParsed.value);
  if (!approval.ok) return fail(io, "approval-malformed", options.approvalPath, approval.detail);

  const exercisesSha256 = sha256Hex(current.exercises);
  const workoutsSha256 = sha256Hex(current.workouts);
  if (approval.approval.exercisesSha256 !== exercisesSha256 || approval.approval.workoutsSha256 !== workoutsSha256) {
    return fail(io, "approval-mismatch", options.approvalPath, "the approval digests do not match the current bundle; re-review and record a new approval");
  }

  const baselineBytes = buildBaselineBytes(exercisesSha256, workoutsSha256);
  const existing = await io.readBytes(options.baselinePath);
  if (existing !== null && !bytesEqual(existing, baselineBytes)) {
    return fail(io, "baseline-already-recorded", options.baselinePath, "a different baseline manifest already exists; it is never replaced");
  }

  try {
    await io.ensureDirectory(dirname(options.baselinePath));
    await io.writeAtomic(options.baselinePath, baselineBytes);
  } catch (error) {
    const code = error instanceof Error && typeof (error as { code?: unknown }).code === "string" ? (error as { code: string }).code : "baseline-write-failed";
    return fail(io, code, options.baselinePath, "the baseline manifest could not be written");
  }

  io.out("REP JOT static-data compatibility report");
  io.out("mode: record-baseline");
  io.out("result: baseline-recorded");
  io.out("diagnostics: none");
  io.out("baseline manifest: " + options.baselinePath);
  io.out("exercisesSha256: " + exercisesSha256);
  io.out("workoutsSha256: " + workoutsSha256);
  return 0;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function printComparison(io: CompatibilityIo, mode: string, outcome: ReturnType<typeof compareStaticBundles>): number {
  if (!outcome.ok) {
    const code = outcome.kind === "schema" ? "bundle-schema-invalid" : "bundle-semantic-invalid";
    return fail(io, code, outcome.side, outcome.detail);
  }
  const report = outcome.report;
  const lines: (readonly [string, string])[] = [];
  for (const diagnostic of report.diagnostics) {
    lines.push([diagnostic.code, diagnostic.subject]);
  }
  io.out("REP JOT static-data compatibility report");
  io.out("mode: " + mode);
  io.out("result: " + report.status);
  if (lines.length === 0) {
    io.out("diagnostics: none");
  } else {
    io.out("diagnostics:");
    for (const [code, subject] of lines) {
      const message = COMPATIBILITY_MESSAGES[code as keyof typeof COMPATIBILITY_MESSAGES];
      io.out("  " + code + " [" + subject + "] " + (message === undefined ? "" : message).trim());
    }
  }
  if (report.deprecationImpact.length === 0) {
    io.out("deprecation impact: none");
  } else {
    io.out("deprecation impact (newly deprecated exercises):");
    for (const [exerciseId, entries] of report.deprecationImpact) {
      for (const entry of entries) {
        const containers = entry.containerIds.length === 0 ? "none" : entry.containerIds.join(",");
        io.out("  exercise:" + exerciseId + " affects workout:" + entry.workoutId + " containers: " + containers);
      }
    }
  }
  if (report.informational.length === 0) {
    io.out("informational: none");
  } else {
    io.out("informational:");
    for (const item of report.informational) {
      const message = COMPATIBILITY_INFORMATIONAL_MESSAGES[item.code];
      io.out("  " + item.code + " [" + item.subject + "] " + message);
    }
  }
  return report.status === "compatible" ? 0 : 1;
}

/** Run one complete command invocation; returns the process exit code. Exported for tests. */
export async function runCompareProduction(args: readonly string[], io: CompatibilityIo = makeNodeIo()): Promise<number> {
  const options = parseArgs(args);
  switch (options.mode) {
    case "first-release":
      return runFirstRelease(io, options.baselinePath);
    case "fixture":
      return runFixture(io, options.fixtureDir);
    case "record-baseline":
      return runRecordBaseline(io, options);
    default:
      return runProduction(io, options);
  }
}

// Runs only when executed directly (`bun scripts/compare-production.ts`), not when imported by tests.
if (import.meta.main) {
  process.exitCode = await runCompareProduction(process.argv.slice(2));
}
