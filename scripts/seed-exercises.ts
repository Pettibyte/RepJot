#!/usr/bin/env bun
/**
 * Seeds the REP JOT exercise directory from free-exercise-db.
 *
 * One allowlist drives the output. The script copies the agreed source fields,
 * drops everything else, and adds the curated fields that the source lacks.
 * It is the only process that writes `src/public/data/exercises.json`.
 *
 * Contracts:
 * - docs/REQUIREMENTS.md section 13.0 (seed rules)
 * - specs/exercise-seeding.md        (this process, end to end)
 * - schemas/exercises/v1.schema.json (output shape)
 * - schemas/seed-allowlist/v1.schema.json (allowlist shape)
 *
 * Commands:
 *   bun run seed        Generate the output file from the pinned source commit.
 *   bun run seed:check  Regenerate in memory and fail when the file on disk differs.
 *   bun run seed:bump   Move the pinned commit to the head of the source ref, then reseed.
 *
 * The script never hashes its output, never diffs a prior bundle, and never keeps
 * an exercise that the allowlist removes. Requirement 13.10.
 *
 * Equipment is normalized, not copied. Every equipment string, from the source or
 * from an override, is folded to lower case, singular, and whitespace-collapsed,
 * then matched against the closed vocabulary in $defs.equipmentValue. A value
 * outside that list fails the build.
 */

import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import type { AnyValidateFunction, ErrorObject, Schema } from "ajv/dist/core";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const REPO_ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const CONFIG_PATH = join(REPO_ROOT, "scripts/seed-config.json");
const EXERCISES_SCHEMA_PATH = join(REPO_ROOT, "schemas/exercises/v1.schema.json");
const ALLOWLIST_SCHEMA_PATH = join(REPO_ROOT, "schemas/seed-allowlist/v1.schema.json");
const CACHE_DIR = join(REPO_ROOT, "scripts/.cache/free-exercise-db");

/** The source value that means "no equipment". Requirement 13.13. */
const BODY_ONLY = "body only";

/** Curated defaults for a bare allowlist entry. Requirement 13.16. */
const DEFAULTS = {
  laterality: "bilateral",
  movementPattern: "none",
  loadSemantics: "total",
} as const;

const DEFAULT_MEASUREMENTS: MeasurementOverride[] = [
  { dimension: "reps", units: ["reps"] },
];

/** Fields copied verbatim from the source. Requirement 13.4. */
const COPIED_FIELDS = [
  "id",
  "name",
  "instructions",
  "category",
  "force",
  "mechanic",
  "level",
  "primaryMuscles",
  "secondaryMuscles",
] as const;

export interface SourceExercise {
  id: string;
  name?: unknown;
  instructions?: unknown;
  category?: unknown;
  force?: unknown;
  mechanic?: unknown;
  level?: unknown;
  primaryMuscles?: unknown;
  secondaryMuscles?: unknown;
  equipment?: unknown;
  [key: string]: unknown;
}

export interface MeasurementOverride {
  dimension: string;
  units: string[];
}

export interface AllowlistOverrideEntry {
  id: string;
  equipment?: string | null;
  laterality?: string;
  movementPattern?: string;
  loadSemantics?: string;
  measurements?: MeasurementOverride[];
  icon?: unknown;
}

export type AllowlistEntry = string | AllowlistOverrideEntry;

export interface SeedConfig {
  source: {
    repo: string;
    ref: string;
    commit: string;
    path: string;
  };
  allowlist: string;
  output: string;
}

export interface SeedResult {
  /** Validation problems. A non-empty list means the run produced nothing. */
  errors: string[];
  /** Deterministic JSON text for the output file. Null when errors exist. */
  json: string | null;
  exercises: Record<string, unknown>[];
}

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

interface Validators {
  allowlist: AnyValidateFunction;
  exercise: AnyValidateFunction;
  document: AnyValidateFunction;
  /** Closed equipment vocabulary, read from the exercise schema. */
  equipmentValues: string[];
}

let cachedValidators: Validators | null = null;

/**
 * Compiles the allowlist schema and the exercise schema into one Ajv instance.
 * The allowlist schema borrows its value sets from the exercise schema by $id,
 * so both files must live in the same instance.
 */
export function loadValidators(): Validators {
  if (cachedValidators) return cachedValidators;

  const exercisesSchema = readJson(EXERCISES_SCHEMA_PATH, "exercise schema") as Schema;
  const equipmentValues = readEquipmentVocabulary(exercisesSchema);

  // discriminator: true lets the allowlist pick a measurement branch by its
  // "dimension" tag, so one bad dimension gives one clear message.
  const ajv = new Ajv2020({ strict: true, allErrors: true, discriminator: true });
  // ajv-formats v3 registers formats as real validators, so a bad date-time
  // fails the check instead of passing as an annotation.
  addFormats(ajv);
  ajv.addSchema(exercisesSchema);
  ajv.addSchema(readJson(ALLOWLIST_SCHEMA_PATH, "allowlist schema") as Schema);

  cachedValidators = {
    allowlist: ajv.getSchema("https://repjot.com/schemas/seed-allowlist/v1.schema.json")!,
    exercise: ajv.getSchema("https://repjot.com/schemas/exercises/v1.schema.json#/$defs/exercise")!,
    document: ajv.getSchema("https://repjot.com/schemas/exercises/v1.schema.json")!,
    equipmentValues,
  };
  return cachedValidators;
}

/**
 * Reads the closed equipment vocabulary from the exercise schema.
 * The schema owns the list, so the seed and the validator can never drift apart.
 * The list must already be lower case and singular, because the seed folds input
 * into it and a plural entry would make the fold lossy.
 */
function readEquipmentVocabulary(schema: Schema): string[] {
  const shape = schema as { $defs?: { equipmentValue?: { enum?: unknown } } };
  const values = shape.$defs?.equipmentValue?.enum;
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error(
      'equipment vocabulary is missing. Add $defs.equipmentValue.enum to schemas/exercises/v1.schema.json.',
    );
  }
  for (const value of values) {
    if (typeof value !== "string") {
      throw new Error(`equipment vocabulary entry ${JSON.stringify(value)} is not a string`);
    }
    if (canonicalCase(value) !== value) {
      throw new Error(`equipment vocabulary entry "${value}" is not lower case`);
    }
    if (singularize(value) !== value) {
      throw new Error(`equipment vocabulary entry "${value}" is not singular`);
    }
    if (value === BODY_ONLY) {
      throw new Error(`equipment vocabulary must not list "${BODY_ONLY}". The seed maps it to null.`);
    }
  }
  return values as string[];
}

/** Trims, collapses inner whitespace runs, and forces lower case. */
function canonicalCase(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Naive English singular form.
 *
 * The vocabulary decides what is valid, so a wrong guess here fails the build
 * with the guess shown in the message. It never writes bad data on its own.
 */
function singularize(value: string): string {
  if (value.length > 3 && value.endsWith("ies")) return `${value.slice(0, -3)}y`;
  if (/(?:ss|us|is|xs)$/.test(value)) return value;
  if (/(?:ch|sh|x|z|s)es$/.test(value)) return value.slice(0, -2);
  if (value.endsWith("s")) return value.slice(0, -1);
  return value;
}

/**
 * Validates one value and returns readable, labelled messages.
 * Kept separate from the cached pair because callers validate many shapes.
 */
function check(
  ajvSchema: AnyValidateFunction,
  value: unknown,
  label: string,
): string[] {
  if (ajvSchema(value)) return [];
  const errors = ajvSchema.errors ?? [];
  // A oneOf wrapper repeats what its branches already reported. Keep it only
  // when nothing more specific came back.
  const noWrapper = errors.filter((error) => error.keyword !== "oneOf");
  const list = pruneShadowedAncestors(noWrapper.length > 0 ? noWrapper : errors);
  return list.map(
    (error) => `${label}${pathSuffix(error.instancePath)} ${error.message ?? "is invalid"}`,
  );
}

/**
 * Drops a broad error when a deeper error under the same path also fired.
 * A union branch that fails while a nested field also fails adds no information.
 */
function pruneShadowedAncestors(errors: ErrorObject[]): ErrorObject[] {
  const deeper = errors
    .map((error) => error.instancePath)
    .filter((path) => path !== "");
  return errors.filter((error) => {
    if (error.instancePath === "") return true;
    return !deeper.some(
      (path) => path !== error.instancePath && path.startsWith(`${error.instancePath}/`),
    );
  });
}

/** Turns a JSON pointer into a readable suffix: /1/units/0 -> [1].units[0] */
function pathSuffix(instancePath: string): string {
  let out = "";
  for (const raw of instancePath.split("/").filter((segment) => segment !== "")) {
    const segment = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    out += /^[0-9]+$/.test(segment) ? `[${segment}]` : `.${segment}`;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Pure seed core
// ---------------------------------------------------------------------------

/**
 * Builds the exercise directory document from a source array and an allowlist.
 * Collects every problem before returning so one run reports all of them.
 */
export function buildExercises(
  sourceExercises: unknown,
  allowlist: unknown,
  sourceLabel = "source",
): SeedResult {
  const errors: string[] = [];
  const validators = loadValidators();

  const allowlistErrors = check(validators.allowlist, allowlist, "allowlist");
  if (allowlistErrors.length > 0) {
    return {
      errors: allowlistErrors,
      json: null,
      exercises: [],
    };
  }

  if (!Array.isArray(sourceExercises)) {
    return {
      errors: [`${sourceLabel}: expected a JSON array of exercises`],
      json: null,
      exercises: [],
    };
  }

  const byId = new Map<string, SourceExercise>();
  for (const item of sourceExercises as SourceExercise[]) {
    if (!item || typeof item.id !== "string" || item.id.length === 0) {
      errors.push(`${sourceLabel}: an entry has no usable "id" field`);
      continue;
    }
    if (byId.has(item.id)) {
      errors.push(`${sourceLabel}: duplicate exercise id "${item.id}"`);
      continue;
    }
    byId.set(item.id, item);
  }

  const entries = allowlist as AllowlistEntry[];
  const seen = new Set<string>();
  const exercises: Record<string, unknown>[] = [];

  entries.forEach((entry, index) => {
    const id = typeof entry === "string" ? entry : entry.id;
    const where = `allowlist[${index}] "${id}"`;

    if (seen.has(id)) {
      errors.push(`${where}: listed more than once`);
      return;
    }
    seen.add(id);

    const source = byId.get(id);
    if (!source) {
      errors.push(`${where}: not found in ${sourceLabel}. Remove the entry or bump the source.`);
      return;
    }

    const normalized = normalizeExercise(entry, source, where, validators.equipmentValues);
    if (normalized.errors.length > 0) {
      errors.push(...normalized.errors);
      return;
    }

    const exerciseErrors = check(validators.exercise, normalized.exercise, "generated exercise");
    if (exerciseErrors.length > 0) {
      errors.push(...exerciseErrors.map((message) => `${where}: ${message}`));
      return;
    }

    exercises.push(normalized.exercise);
  });

  if (errors.length > 0) return { errors, json: null, exercises: [] };

  const document = {
    format: "repjot/exercises",
    schemaVersion: 1,
    exercises,
  };
  const documentErrors = check(validators.document, document, "generated document");
  if (documentErrors.length > 0) {
    return {
      errors: documentErrors,
      json: null,
      exercises,
    };
  }

  return { errors: [], json: renderJson(document), exercises };
}

/**
 * Copies the allowed source fields and applies curated values.
 * Key order is fixed so the output text is stable across runs.
 */
function normalizeExercise(
  entry: AllowlistEntry,
  source: SourceExercise,
  where: string,
  equipmentValues: string[],
): { exercise: Record<string, unknown>; errors: string[] } {
  const errors: string[] = [];
  const override: AllowlistOverrideEntry = typeof entry === "string" ? { id: source.id } : entry;

  const copied: Record<string, unknown> = {};
  for (const field of COPIED_FIELDS) {
    copied[field] = clone((source as Record<string, unknown>)[field]);
  }

  const equipment = resolveEquipment(override, source, equipmentValues);
  if (equipment.problem) {
    errors.push(`${where}: ${equipment.problem}`);
  }

  const measurements = override.measurements
    ? override.measurements.map(toCompatibleUnits)
    : clone(DEFAULT_MEASUREMENTS).map(toCompatibleUnits);
  const loadSemantics = override.loadSemantics ?? DEFAULTS.loadSemantics;

  // uniqueItems in the schema rejects identical objects only. Two weight entries
  // with different units pass it, so the seed enforces one entry per dimension.
  const dimensionNames = measurements.map((m) => m.dimension as string);
  const repeated = [...new Set(dimensionNames.filter(
    (name, index) => dimensionNames.indexOf(name) !== index,
  ))];
  if (repeated.length > 0) {
    errors.push(
      `${where}: measurement dimension ${repeated.map((name) => `"${name}"`).join(" and ")} ` +
        `appears more than once. Merge the entries into one dimension with one unit list.`,
    );
  }

  // The exercise schema ties a dimension to a load semantic one way. The seed
  // ties it the other way, so "added" without an addedWeight dimension fails
  // here instead of producing an exercise the app cannot record against.
  const dimensions = new Set(dimensionNames);
  if (loadSemantics === "added" && !dimensions.has("addedWeight")) {
    errors.push(`${where}: loadSemantics "added" requires an "addedWeight" measurement`);
  }
  if (loadSemantics === "assisted" && !dimensions.has("assistedWeight")) {
    errors.push(`${where}: loadSemantics "assisted" requires an "assistedWeight" measurement`);
  }

  const exercise: Record<string, unknown> = {
    id: copied.id,
    name: copied.name,
    instructions: copied.instructions,
  };
  if (override.icon !== undefined) exercise.icon = clone(override.icon);
  exercise.equipment = equipment.value;
  exercise.force = copied.force;
  exercise.mechanic = copied.mechanic;
  exercise.category = copied.category;
  exercise.level = copied.level;
  exercise.movementPattern = override.movementPattern ?? DEFAULTS.movementPattern;
  exercise.primaryMuscles = copied.primaryMuscles;
  exercise.secondaryMuscles = copied.secondaryMuscles;
  exercise.laterality = override.laterality ?? DEFAULTS.laterality;
  exercise.measurements = measurements;
  exercise.loadSemantics = loadSemantics;

  return { exercise, errors };
}

/**
 * Equipment is a copied default, not a verbatim field. Requirement 13.16.
 * Every value passes through the normalizer, from the source and from an
 * override alike. A missing or empty source value needs an explicit override.
 * Requirement 13.13.
 */
function resolveEquipment(
  override: AllowlistOverrideEntry,
  source: SourceExercise,
  vocabulary: string[],
): { value: string | null; problem?: string } {
  if ("equipment" in override) {
    if (override.equipment === null || override.equipment === undefined) return { value: null };
    return foldEquipment(override.equipment, vocabulary, "equipment override", "use null for no equipment");
  }

  const raw = source.equipment;
  if (raw === undefined || raw === null) {
    return { value: null, problem: 'source equipment is null; add an "equipment" override' };
  }
  if (typeof raw !== "string") {
    return { value: null, problem: `source equipment must be a string or null, got ${typeof raw}` };
  }
  return foldEquipment(raw, vocabulary, "source equipment", 'add an "equipment" override');
}

/**
 * Folds one raw equipment string into the closed vocabulary.
 * Lower case, singular, whitespace collapsed, then matched against the schema list.
 * Every equipment value reaches this function, so every rejection carries the
 * same diagnostic. Requirement 13.21.
 */
function foldEquipment(
  raw: string,
  vocabulary: string[],
  label: string,
  hint: string,
): { value: string | null; problem?: string } {
  if (raw.trim() === "") {
    return { value: null, problem: `${label} is empty; ${hint}` };
  }

  const folded = singularize(canonicalCase(raw));
  if (folded === BODY_ONLY) return { value: null };
  if (vocabulary.includes(folded)) return { value: folded };

  return {
    value: null,
    problem:
      `${label} "${raw}" normalizes to "${folded}", which is not in the equipment vocabulary. ` +
      `Add "${folded}" to $defs.equipmentValue in schemas/exercises/v1.schema.json. ` +
      `Known values: ${vocabulary.join(", ")}.`,
  };
}

function toCompatibleUnits(measurement: MeasurementOverride): Record<string, unknown> {
  return { dimension: measurement.dimension, compatibleUnits: [...measurement.units] };
}

function renderJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function clone<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

// ---------------------------------------------------------------------------
// Source access
// ---------------------------------------------------------------------------

function readJson(path: string, label: string): unknown {
  if (!existsSync(path)) throw new Error(`${label} not found at ${path}`);
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`${label} at ${path} is not valid JSON: ${(error as Error).message}`);
  }
}

function loadConfig(): SeedConfig {
  const config = readJson(CONFIG_PATH, "seed config") as SeedConfig;
  if (!config?.source?.repo || !config.source.commit || !config.source.path) {
    throw new Error(`seed config at ${CONFIG_PATH} needs source.repo, source.commit, and source.path`);
  }
  if (!/^[0-9a-f]{40}$/.test(config.source.commit)) {
    throw new Error(
      `seed config source.commit must be a full 40-character commit SHA, got "${config.source.commit}"`,
    );
  }
  return config;
}

function cachePath(repo: string, commit: string): string {
  return join(CACHE_DIR, `${repo.replace(/\//g, "+")}-${commit}.json`);
}

/**
 * Returns the source exercise array for one pinned commit.
 * A local cache keeps repeat runs and offline runs working.
 */
export async function loadSource(
  config: SeedConfig,
  options: { localFile?: string; useCache?: boolean } = {},
): Promise<{ exercises: unknown; label: string }> {
  if (options.localFile) {
    return { exercises: readJson(options.localFile, `source file ${options.localFile}`), label: options.localFile };
  }

  const cached = cachePath(config.source.repo, config.source.commit);
  if (options.useCache !== false && existsSync(cached)) {
    return { exercises: readJson(cached, "cached source"), label: `cache ${config.source.commit.slice(0, 12)}` };
  }

  const url = `https://raw.githubusercontent.com/${config.source.repo}/${config.source.commit}/${config.source.path}`;
  let response: Response;
  try {
    response = await fetch(url);
  } catch (error) {
    throw new Error(`cannot fetch ${url}: ${(error as Error).message}`);
  }
  if (!response.ok) {
    throw new Error(`cannot fetch ${url}: HTTP ${response.status} ${response.statusText}`);
  }

  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`fetched source from ${url} is not valid JSON: ${(error as Error).message}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`fetched source from ${url} is not a JSON array`);
  }

  mkdirSync(dirname(cached), { recursive: true });
  writeFileSync(cached, text);
  return { exercises: parsed, label: `${config.source.repo}@${config.source.commit.slice(0, 12)}` };
}

/** Resolves the head commit of the configured ref through the GitHub API. */
export async function resolveHeadCommit(config: SeedConfig, ref: string): Promise<string> {
  const url = `https://api.github.com/repos/${config.source.repo}/commits/${encodeURIComponent(ref)}`;
  let response: Response;
  try {
    response = await fetch(url, { headers: { accept: "application/vnd.github+json" } });
  } catch (error) {
    throw new Error(`cannot resolve ${ref} for ${config.source.repo}: ${(error as Error).message}`);
  }
  if (!response.ok) {
    throw new Error(`cannot resolve ${ref} for ${config.source.repo}: HTTP ${response.status} ${response.statusText}`);
  }
  const body = (await response.json()) as { sha?: unknown };
  if (typeof body.sha !== "string" || !/^[0-9a-f]{40}$/.test(body.sha)) {
    throw new Error(`GitHub did not return a commit SHA for ${ref}`);
  }
  return body.sha;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export interface CliOptions {
  mode: "seed" | "check" | "bump";
  sourceFile?: string;
  commit?: string;
  ref?: string;
  allowlistFile?: string;
  outFile?: string;
  useCache: boolean;
  help: boolean;
}

const USAGE = `
REP JOT exercise seed

  bun run seed        Generate ${"src/public/data/exercises.json"} from the pinned source commit.
  bun run seed:check  Regenerate in memory and fail when the file on disk differs.
  bun run seed:bump   Move the pinned commit to the head of the source ref, then reseed.

Options
  --source <path>     Read the source array from a local file instead of fetching it.
  --commit <sha>      Use one commit for this run instead of the pinned commit.
  --ref <name>        With bump: the upstream ref to follow. Default: config source.ref.
  --allowlist <path>  Use another allowlist file.
  --out <path>        Write to another output file.
  --no-cache          Ignore the local source cache and do not write one.
  -h, --help          Show this text.
`.trimStart();

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { mode: "seed", useCache: true, help: false };
  const take = (index: number, flag: string): string => {
    const value = argv[index + 1];
    if (!value || value.startsWith("-")) throw new Error(`${flag} needs a value`);
    return value;
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "check" || arg === "--check") options.mode = "check";
    else if (arg === "bump" || arg === "--bump") options.mode = "bump";
    else if (arg === "--source") options.sourceFile = take(index++, arg);
    else if (arg === "--commit") options.commit = take(index++, arg);
    else if (arg === "--ref") options.ref = take(index++, arg);
    else if (arg === "--allowlist") options.allowlistFile = take(index++, arg);
    else if (arg === "--out") options.outFile = take(index++, arg);
    else if (arg === "--no-cache") options.useCache = false;
    else if (arg === "-h" || arg === "--help") options.help = true;
    else throw new Error(`unknown argument "${arg}"`);
  }
  return options;
}

/**
 * Raised when the run found validation problems. The CLI prints every problem and
 * exits non-zero. Throwing keeps the exit call out of the testable path.
 */
export class SeedProblems extends Error {
  readonly problems: string[];

  constructor(problems: string[]) {
    super(`${problems.length} problem(s)`);
    this.name = "SeedProblems";
    this.problems = problems;
  }
}

/**
 * Resolves the commit this run must use and validates it.
 * Runs before any write, in every mode, so a bad --commit can never be persisted.
 */
export function resolveTargetCommit(
  config: SeedConfig,
  options: { mode: CliOptions["mode"]; commit?: string; ref?: string },
): Promise<string> | string {
  if (options.commit !== undefined && !/^[0-9a-f]{40}$/.test(options.commit)) {
    throw new Error(`--commit must be a full 40-character commit SHA, got "${options.commit}"`);
  }
  if (options.mode !== "bump" || options.commit !== undefined) {
    return options.commit ?? config.source.commit;
  }
  return resolveHeadCommit(config, options.ref ?? config.source.ref ?? "main");
}

/**
 * Runs one seed command.
 *
 * Nothing is written until every check passes. A bump resolves its commit, fetches
 * the source, and validates the whole generated document before it touches
 * scripts/seed-config.json, so a broken bump leaves the repository untouched.
 * Requirement 13.17.
 *
 * Throws SeedProblems for validation failures and a plain Error for I/O faults.
 */
export async function runSeed(options: CliOptions): Promise<void> {
  const config = loadConfig();
  const allowlistPath = options.allowlistFile
    ? resolveFromRoot(options.allowlistFile)
    : resolveFromRoot(config.allowlist);
  const outPath = options.outFile ? resolveFromRoot(options.outFile) : resolveFromRoot(config.output);

  const targetCommit = await resolveTargetCommit(config, options);

  const allowlist = readJson(allowlistPath, "allowlist");
  const { exercises: sourceExercises, label } = await loadSource(
    { ...config, source: { ...config.source, commit: targetCommit } },
    { localFile: options.sourceFile, useCache: options.useCache },
  );

  const result = buildExercises(sourceExercises, allowlist, label);
  if (result.errors.length > 0) throw new SeedProblems(result.errors);

  const json = result.json!;

  if (options.mode === "check") {
    if (!existsSync(outPath)) {
      throw new Error(`${relative(outPath)} is missing. Run: bun run seed`);
    }
    if (readFileSync(outPath, "utf8") !== json) {
      throw new Error(`${relative(outPath)} is out of date. Run: bun run seed`);
    }
    console.log(`seed: ${relative(outPath)} matches the pinned source (${label}).`);
    return;
  }

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, json);
  console.log(
    `seed: wrote ${relative(outPath)} with ${result.exercises.length} exercise(s) from ${label}.`,
  );

  // The pin is written last, after the artifact it describes. A crash between the
  // two leaves the config claiming less than it should, and seed:check catches it.
  if (options.mode === "bump" && targetCommit !== config.source.commit) {
    writeConfigCommit(targetCommit);
    console.log(
      `seed: pinned commit ${config.source.commit} -> ${targetCommit} ` +
        `(${options.ref ?? config.source.ref ?? "main"}).`,
    );
  } else if (options.mode === "bump") {
    console.log(`seed: source already pinned to ${targetCommit}.`);
  }

  // Naming the equipment this run emitted keeps the vocabulary visible in the diff.
  // It is the line to read after a bump, when the source may carry a new value.
  const used = [
    ...new Set(
      result.exercises
        .map((item) => (item.equipment as string | null) ?? "none")
        .sort(),
    ),
  ];
  console.log(`seed: equipment used: ${used.join(", ")}.`);
}

function resolveFromRoot(path: string): string {
  return path.startsWith("/") ? path : join(REPO_ROOT, path);
}

function relative(path: string): string {
  return path.startsWith(`${REPO_ROOT}/`) ? path.slice(REPO_ROOT.length + 1) : path;
}

/** Rewrites only the pinned commit so the rest of the config keeps its formatting. */
function writeConfigCommit(commit: string): void {
  const text = readFileSync(CONFIG_PATH, "utf8");
  const updated = text.replace(/("commit"\s*:\s*")[0-9a-f]{40}(")/, `$1${commit}$2`);
  if (updated === text) {
    throw new Error(`could not find the pinned commit field in ${CONFIG_PATH}`);
  }
  writeFileSync(CONFIG_PATH, updated);
}

export async function runCli(argv: string[]): Promise<void> {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(USAGE);
    return;
  }
  await runSeed(options);
}

if (import.meta.main) {
  runCli(process.argv.slice(2)).catch((error: Error) => {
    if (error instanceof SeedProblems) {
      console.error(`seed: ${error.problems.length} problem(s)`);
      for (const problem of error.problems) console.error(`  - ${problem}`);
    } else {
      console.error(`seed: ${error.message}`);
    }
    process.exit(1);
  });
}
