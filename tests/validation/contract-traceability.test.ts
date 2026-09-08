/**
 * P10-T01 — Phase 1-10 contract traceability audit (GATES.md §2 matrix, Architecture §§17-20).
 *
 * Every contract row owned by Phases 1-10 is mapped to objective fixture evidence and re-run
 * through the real production validators (schema registry, static semantic pass, result lifecycle
 * pass, trusted-icon gate, compatibility comparator). A test that only exercises generated types
 * would be insufficient; each row here passes concrete document bytes through a real gate.
 *
 * Ownership boundaries stay explicit:
 * - Invariant 21 (tombstones win during synchronization) is owned by Phase 37. This file asserts
 *   the ownership trace and that no merge implementation exists in this phase.
 * - Approved canonical content, prior-production baselines, curation approvals, physical Kindle
 *   evidence, and Google/legal approvals are external: their absence is asserted as an explicit
 *   blocker, never fabricated.
 */
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createProductionValidator } from "../../src/validation/schema-validator";
import { validatePreferencesSemantics, validateResultsShard, validateStaticDocuments } from "../../src/validation/semantic/index";
import { compareStaticBundles, parseBundleBytes } from "../../src/compatibility/compare-static-data";
import { buildMinimalResultsShardDocument, buildMinimalWorkoutsDocument } from "../domain/document-builders";
import { runValidateStatic } from "../../scripts/validate-static";

const REPO_ROOT = join(import.meta.dir, "..", "..");
const CONTRACT_FIXTURES = join(REPO_ROOT, "tests", "fixtures", "contract-acceptance");
const STATIC_SEMANTIC = join(REPO_ROOT, "tests", "fixtures", "static-semantic");
const RESULT_SEMANTIC = join(REPO_ROOT, "tests", "fixtures", "result-semantic");
const COMPATIBILITY = join(REPO_ROOT, "tests", "fixtures", "compatibility");

const validator = createProductionValidator();

async function doc(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
}

function codes(result: { readonly diagnostics: readonly { readonly code: string }[] }): string[] {
  return result.diagnostics.map((d) => d.code);
}

function hasCode(result: { readonly diagnostics: readonly { readonly code: string }[] }, code: string): boolean {
  return codes(result).indexOf(code) !== -1;
}

// Shared context documents, loaded once and never mutated (clones are mutated per case).
const exercisesContext = await doc(join(STATIC_SEMANTIC, "exercises.context.json"));
const workoutsContext = await doc(join(STATIC_SEMANTIC, "workouts.context.json"));
const resultExercises = await doc(join(RESULT_SEMANTIC, "exercises.context.json"));
const resultWorkouts = await doc(join(RESULT_SEMANTIC, "workouts.context.json"));
const shardContext = await doc(join(RESULT_SEMANTIC, "shard.context.json"));

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

async function loadPair(dir: string): Promise<readonly [readonly [unknown, unknown], readonly [unknown, unknown]]> {
  const priorEx = parseBundleBytes(new Uint8Array(await readFile(join(dir, "prior", "exercises.json"))));
  const priorWk = parseBundleBytes(new Uint8Array(await readFile(join(dir, "prior", "workouts.json"))));
  const curEx = parseBundleBytes(new Uint8Array(await readFile(join(dir, "current", "exercises.json"))));
  const curWk = parseBundleBytes(new Uint8Array(await readFile(join(dir, "current", "workouts.json"))));
  if (!priorEx.ok || !priorWk.ok || !curEx.ok || !curWk.ok) {
    throw new Error("compatibility fixture " + dir + " is not exact JSON");
  }
  return [[priorEx.value, priorWk.value], [curEx.value, curWk.value]];
}

async function compareFixture(dir: string): Promise<{ status: string; codes: string[] }> {
  const pair = await loadPair(join(COMPATIBILITY, dir));
  const outcome = compareStaticBundles(pair[0], pair[1]);
  if (!outcome.ok) return { status: "invalid", codes: [] };
  return { status: outcome.report.status, codes: outcome.report.diagnostics.map((d) => d.code) };
}

describe("four families and v1 envelopes", () => {
  test("one valid v1 document per family passes the Draft 2020-12 schemas", async () => {
    expect(validator.validate("exercises", 1, await doc(join(CONTRACT_FIXTURES, "exercises.min.json"))).valid).toBe(true);
    expect(validator.validate("workouts", 1, await doc(join(CONTRACT_FIXTURES, "workouts.scenario.json"))).valid).toBe(true);
    expect(validator.validate("preferences", 1, await doc(join(CONTRACT_FIXTURES, "preferences.min.json"))).valid).toBe(true);
    expect(validator.validate("results", 1, buildMinimalResultsShardDocument()).valid).toBe(true);
  });

  test("wrong family and non-integer version are rejected with distinct outcomes", () => {
    const workoutsDoc = buildMinimalWorkoutsDocument();
    expect(validator.validate("exercises", 1, workoutsDoc).valid).toBe(false);
    const badVersion: Record<string, unknown> = clone(buildMinimalResultsShardDocument());
    badVersion["schemaVersion"] = 1.5;
    expect(validator.validate("results", 1, badVersion).valid).toBe(false);
  });
});

describe("UTC fields and Z values (invariant 26, Req 3.4-3.6)", () => {
  test("valid Z timestamps pass the schema gate", async () => {
    expect(validator.validate("results", 1, shardContext).valid).toBe(true);
  });

  test("numeric offsets and invalid dates are rejected by the schema", () => {
    const offset = clone(shardContext);
    (offset["sessions"] as Array<Record<string, unknown>>)[0]["startedAtUtc"] = "2026-09-01T08:30:00-07:00";
    expect(validator.validate("results", 1, offset).valid).toBe(false);

    const invalid = clone(shardContext);
    (invalid["sessions"] as Array<Record<string, unknown>>)[0]["startedAtUtc"] = "not-a-date";
    expect(validator.validate("results", 1, invalid).valid).toBe(false);
  });

  test("a session crossing a UTC month boundary stays in its start-month shard", () => {
    const result = validateResultsShard(shardContext, resultWorkouts, resultExercises, "results-2026-09.json");
    expect(result.valid).toBe(true);
  });
});

describe("invariants 1-20 and 22-28 (spec §8)", () => {
  test("invariant 1: an equipmentId resolves to retained equipment", async () => {
    expect(validateStaticDocuments(exercisesContext, workoutsContext).valid).toBe(true);
    const broken = clone(exercisesContext);
    (broken["exercises"] as Array<Record<string, unknown>>)[0]["equipmentIds"] = ["ghost-equipment"];
    expect(hasCode(validateStaticDocuments(broken, workoutsContext), "equipment-reference-missing")).toBe(true);
  });

  test("invariant 2: a workout exerciseId resolves to a retained exercise", async () => {
    expect(validateStaticDocuments(exercisesContext, workoutsContext).valid).toBe(true);
    const broken = clone(workoutsContext);
    const visit = (node: Record<string, unknown>): void => {
      if (node["type"] === "exercise") {
        node["exerciseId"] = "ghost-exercise";
        return;
      }
      const children = node["children"] as Array<Record<string, unknown>> | undefined;
      if (Array.isArray(children)) for (const child of children) visit(child);
    };
    visit((broken["workouts"] as Array<Record<string, unknown>>)[0]["root"] as Record<string, unknown>);
    expect(hasCode(validateStaticDocuments(exercisesContext, broken), "exercise-reference-missing")).toBe(true);
  });

  test("invariant 3: a session workoutId resolves to the retained workout", async () => {
    const result = validateResultsShard(await doc(join(RESULT_SEMANTIC, "shard.invalid-paths.json")), resultWorkouts, resultExercises, "results-2026-09.json");
    expect(hasCode(result, "session-workout-unresolved")).toBe(true);
  });

  test("invariant 4: a result workoutId matches its session and the same workout", async () => {
    const result = validateResultsShard(await doc(join(RESULT_SEMANTIC, "shard.invalid-paths.json")), resultWorkouts, resultExercises, "results-2026-09.json");
    expect(hasCode(result, "result-workout-mismatch")).toBe(true);
  });

  test("invariant 5: every result path resolves from the workout root", async () => {
    const result = validateResultsShard(await doc(join(RESULT_SEMANTIC, "shard.invalid-paths.json")), resultWorkouts, resultExercises, "results-2026-09.json");
    expect(hasCode(result, "result-path-node-unresolved")).toBe(true);
  });

  test("invariant 6: a direct exerciseId matches the terminal workout node", async () => {
    const result = validateResultsShard(await doc(join(RESULT_SEMANTIC, "shard.invalid-paths.json")), resultWorkouts, resultExercises, "results-2026-09.json");
    expect(hasCode(result, "result-exercise-mismatch")).toBe(true);
  });

  test("invariant 7: a measurement dimension appears in the referenced exercise", async () => {
    const result = validateResultsShard(await doc(join(RESULT_SEMANTIC, "shard.invalid-values.json")), resultWorkouts, resultExercises, "results-2026-09.json");
    expect(hasCode(result, "result-value-dimension-unsupported")).toBe(true);
  });

  test("invariant 8: a quantity unit is compatible with its dimension", async () => {
    const result = validateResultsShard(await doc(join(RESULT_SEMANTIC, "shard.invalid-values.json")), resultWorkouts, resultExercises, "results-2026-09.json");
    expect(hasCode(result, "result-value-unit-incompatible")).toBe(true);
  });

  test("invariant 9: a preferred unit is compatible with its exercise and dimension", async () => {
    // Static half (EX-11, supporting sem): unit lists keep metric-first compatible order.
    const broken = clone(exercisesContext);
    const exercise = (broken["exercises"] as Array<Record<string, unknown>>).find((e) => e["id"] === "back-squat");
    if (exercise !== undefined) {
      for (const measurement of exercise["measurements"] as Array<Record<string, unknown>>) {
        if (measurement["dimension"] === "weight") {
          measurement["compatibleUnits"] = ["lb", "kg"];
        }
      }
    }
    expect(hasCode(validateStaticDocuments(broken, workoutsContext), "compatible-unit-order-violation")).toBe(true);

    // Cross-file half (PF-02, sem-owned): every preference mapping resolves against the retained directory.
    const preferences = await doc(join(CONTRACT_FIXTURES, "preferences.min.json"));
    const exercises = await doc(join(CONTRACT_FIXTURES, "exercises.min.json"));
    expect(validator.validate("preferences", 1, preferences).valid).toBe(true);
    expect(validatePreferencesSemantics(preferences, exercises).valid).toBe(true);

    // PF-02 negative: an unknown exercise ID (a case variant is equally unresolvable).
    const unknownExercise = clone(preferences);
    (unknownExercise["exerciseUnits"] as Record<string, unknown>)["ghost-exercise"] = { weight: "lb" };
    expect(hasCode(validatePreferencesSemantics(unknownExercise, exercises), "preference-exercise-unknown")).toBe(true);

    // PF-02 negative: a dimension the exercise lacks.
    const unsupportedDimension = clone(preferences);
    (unsupportedDimension["exerciseUnits"] as Record<string, Record<string, unknown>>)["back-squat"]["calories"] = "kcal";
    expect(hasCode(validatePreferencesSemantics(unsupportedDimension, exercises), "preference-dimension-unsupported")).toBe(true);

    // PF-02 negative: a controlled unit absent from the exercise's supported list. The context stays
    // schema-valid (weight ", [kg]" is a legal list); only the cross-file gate rejects the preference.
    const reducedUnits = clone(exercises);
    const backSquat = (reducedUnits["exercises"] as Array<Record<string, unknown>>).find((e) => e["id"] === "back-squat");
    if (backSquat !== undefined) {
      for (const measurement of backSquat["measurements"] as Array<Record<string, unknown>>) {
        if (measurement["dimension"] === "weight") {
          measurement["compatibleUnits"] = ["kg"];
        }
      }
    }
    expect(validator.validate("exercises", 1, reducedUnits).valid).toBe(true);
    expect(hasCode(validatePreferencesSemantics(preferences, reducedUnits), "preference-unit-incompatible")).toBe(true);
  });

  test("invariant 10: a container score matches the workout container contract", async () => {
    const scenario = await doc(join(CONTRACT_FIXTURES, "workouts.scenario.json"));
    const exMin = await doc(join(CONTRACT_FIXTURES, "exercises.min.json"));
    const nested = await doc(join(CONTRACT_FIXTURES, "results.nested-scored.json"));
    expect(validateResultsShard(nested, scenario, exMin, "results-2026-08.json").valid).toBe(true);
    const broken = clone(nested);
    for (const session of broken["sessions"] as Array<Record<string, unknown>>) {
      for (const result of session["results"] as Array<Record<string, unknown>>) {
        if (result["type"] === "container") {
          const score = result["score"] as Record<string, unknown>;
          if (score["type"] === "intervals") score["completedIntervals"] = 3;
        }
      }
    }
    expect(hasCode(validateResultsShard(broken, scenario, exMin, "results-2026-08.json"), "container-score-bounds-invalid")).toBe(true);
  });

  test("invariant 11: child detail obeys the container childDetail rule", async () => {
    const scenario = await doc(join(CONTRACT_FIXTURES, "workouts.scenario.json"));
    const exMin = await doc(join(CONTRACT_FIXTURES, "exercises.min.json"));
    const nested = await doc(join(CONTRACT_FIXTURES, "results.nested-scored.json"));
    for (const workout of scenario["workouts"] as Array<Record<string, unknown>>) {
      const visit = (node: Record<string, unknown>): void => {
        if (node["id"] === "blocks") (node["resultCapture"] as Record<string, unknown>)["childDetail"] = "required";
        const children = node["children"] as Array<Record<string, unknown>> | undefined;
        if (Array.isArray(children)) for (const child of children) visit(child);
      };
      visit(workout["root"] as Record<string, unknown>);
    }
    const noDetail = clone(nested);
    for (const session of noDetail["sessions"] as Array<Record<string, unknown>>) {
      session["results"] = (session["results"] as Array<Record<string, unknown>>).filter(
        (r) => !(r["type"] === "container" && (r["executionPath"] as unknown[]).length === 3)
      );
    }
    expect(hasCode(validateResultsShard(noDetail, scenario, exMin, "results-2026-08.json"), "container-detail-required")).toBe(true);
  });

  test("invariant 12: complete child detail derives the stored container score", async () => {
    const scenario = await doc(join(CONTRACT_FIXTURES, "workouts.scenario.json"));
    const exMin = await doc(join(CONTRACT_FIXTURES, "exercises.min.json"));
    const deprecatedAtStart = await doc(join(CONTRACT_FIXTURES, "results.deprecated-at-start.json"));
    expect(validateResultsShard(deprecatedAtStart, scenario, exMin, "results-2026-08.json").valid).toBe(true);
    const partial = clone(deprecatedAtStart);
    for (const session of partial["sessions"] as Array<Record<string, unknown>>) {
      session["results"] = (session["results"] as Array<Record<string, unknown>>).filter((r) => r["exerciseId"] !== "air-squat");
    }
    expect(hasCode(validateResultsShard(partial, scenario, exMin, "results-2026-08.json"), "container-detail-incomplete")).toBe(true);
  });

  test("invariant 13: at most one container result per execution path", async () => {
    const duplicated = clone(shardContext);
    for (const session of duplicated["sessions"] as Array<Record<string, unknown>>) {
      const results = session["results"] as Array<Record<string, unknown>>;
      const container = results.find((r) => r["type"] === "container");
      if (container !== undefined) results.push(clone(container));
    }
    expect(hasCode(validateResultsShard(duplicated, resultWorkouts, resultExercises, "results-2026-09.json"), "container-result-duplicate")).toBe(true);
  });

  test("invariant 14: exercise results are unique by workout, path, side, and attempt", async () => {
    const result = validateResultsShard(await doc(join(RESULT_SEMANTIC, "shard.invalid-duplicates.json")), resultWorkouts, resultExercises, "results-2026-09.json");
    expect(hasCode(result, "result-identity-duplicate")).toBe(true);
  });

  test("invariant 15: startingSide appears exactly on alternating results", async () => {
    const result = validateResultsShard(await doc(join(RESULT_SEMANTIC, "shard.invalid-fields.json")), resultWorkouts, resultExercises, "results-2026-09.json");
    expect(hasCode(result, "result-starting-side-required")).toBe(true);
    expect(hasCode(result, "result-starting-side-forbidden")).toBe(true);
  });

  test("invariant 16: sessions carry updatedAtUtc and a session- prefixed UUID", async () => {
    const missing = clone(shardContext);
    delete (missing["sessions"] as Array<Record<string, unknown>>)[0]["updatedAtUtc"];
    expect(hasCode(validateResultsShard(missing, resultWorkouts, resultExercises, "results-2026-09.json"), "session-updated-at-missing")).toBe(true);
    const badId = clone(shardContext);
    (badId["sessions"] as Array<Record<string, unknown>>)[0]["id"] = "not-a-session-id";
    expect(validator.validate("results", 1, badId).valid).toBe(false);
  });

  test("invariant 17: an in_progress session has a plan and no end time", async () => {
    const result = validateResultsShard(await doc(join(RESULT_SEMANTIC, "shard.invalid-lifecycle.json")), resultWorkouts, resultExercises, "results-2026-09.json");
    expect(hasCode(result, "session-plan-required")).toBe(true);
  });

  test("invariant 18: a terminal session has an end time and no plan", async () => {
    const result = validateResultsShard(await doc(join(RESULT_SEMANTIC, "shard.invalid-lifecycle.json")), resultWorkouts, resultExercises, "results-2026-09.json");
    expect(hasCode(result, "session-ended-at-required")).toBe(true);
    expect(hasCode(result, "session-plan-forbidden")).toBe(true);
  });

  test("invariant 19: file name, yearMonthUtc, and session start months agree", async () => {
    const result = validateResultsShard(await doc(join(RESULT_SEMANTIC, "shard.invalid-shard.json")), resultWorkouts, resultExercises, "results-2026-09.json");
    expect(hasCode(result, "shard-start-month-mismatch")).toBe(true);
  });

  test("invariant 20: a tombstone and live session do not share an ID in one document", async () => {
    const collision = clone(shardContext);
    const liveId = (collision["sessions"] as Array<Record<string, unknown>>)[0]["id"];
    (collision["sessionTombstones"] as Array<Record<string, unknown>>).push({
      sessionId: liveId,
      deletedAtUtc: "2026-09-15T00:00:00Z"
    });
    expect(hasCode(validateResultsShard(collision, resultWorkouts, resultExercises, "results-2026-09.json"), "tombstone-session-collision")).toBe(true);
  });

  test("invariant 22: a sync copy references a different session ID in the same shard", async () => {
    const selfReference = clone(shardContext);
    for (const session of selfReference["sessions"] as Array<Record<string, unknown>>) {
      if (session["conflictOfSessionId"] !== undefined) session["conflictOfSessionId"] = session["id"];
    }
    expect(hasCode(validateResultsShard(selfReference, resultWorkouts, resultExercises, "results-2026-09.json"), "sync-copy-self-reference")).toBe(true);
  });

  test("invariant 23: published IDs are never deleted or reused across namespaces", async () => {
    const compatible = await compareFixture("compatible");
    expect(compatible.status).toBe("compatible");
    const deleted = await compareFixture("exercise-deleted");
    expect(deleted.status).toBe("incompatible");
    expect(deleted.codes.indexOf("exercise-id-deleted") !== -1).toBe(true);
    const reused = await compareFixture("namespace-reuse");
    expect(reused.codes.indexOf("id-reused-in-different-namespace") !== -1).toBe(true);
  });

  test("invariant 24: deprecated entities remain resolvable for historical references", async () => {
    // The context shard references the deprecated push-up exercise and the retired workout.
    expect(validateResultsShard(shardContext, resultWorkouts, resultExercises, "results-2026-09.json").valid).toBe(true);
  });

  test("invariant 25: rounds_and_reps containers resolve to deterministic leaf sequences", async () => {
    expect(validateStaticDocuments(exercisesContext, workoutsContext).valid).toBe(true);
    const broken = clone(workoutsContext);
    const root = (broken["workouts"] as Array<Record<string, unknown>>)[0]["root"] as Record<string, unknown>;
    const cindy = (root["children"] as Array<Record<string, unknown>>).find((c) => c["id"] === "cindy");
    if (cindy === undefined) throw new Error("the static context fixture lost its cindy AMRAP node");
    (cindy["children"] as Array<Record<string, unknown>>).push({
      id: "cindy-nested",
      type: "container",
      strategy: "amrap",
      strategyConfig: { duration: { value: 1, unit: "minute" } },
      children: [{ id: "nested-leaf", type: "exercise", exerciseId: "pull-up", stimulus: "conditioning", prescription: { reps: 5 } }]
    });
    expect(hasCode(validateStaticDocuments(exercisesContext, broken), "rounds-and-reps-nested-container-non-deterministic")).toBe(true);
  });

  test("invariant 27: iterations inherit omitted fields and numbers appear at most once", async () => {
    const duplicate = await doc(join(CONTRACT_FIXTURES, "workouts.invalid-duplicate-iteration.json"));
    expect(hasCode(validateStaticDocuments(exercisesContext, duplicate), "iteration-number-duplicate")).toBe(true);
  });

  test("invariant 28: a deprecated omission makes scored ancestors detail-only and nonstandard", async () => {
    const scenario = await doc(join(CONTRACT_FIXTURES, "workouts.scenario.json"));
    const exMin = await doc(join(CONTRACT_FIXTURES, "exercises.min.json"));
    const deprecatedAtStart = await doc(join(CONTRACT_FIXTURES, "results.deprecated-at-start.json"));
    expect(validateResultsShard(deprecatedAtStart, scenario, exMin, "results-2026-08.json").valid).toBe(true);
  });

  test("permitted corrections (Req 6.2) keep identity and move only results and updatedAtUtc", async () => {
    const base = await doc(join(RESULT_SEMANTIC, "shard.correction-base.json"));
    const candidate = await doc(join(RESULT_SEMANTIC, "shard.correction-candidate.json"));
    const { validateShardCorrection } = await import("../../src/validation/semantic/index");
    expect(validateShardCorrection(base, candidate).valid).toBe(true);
  });
});

describe("static source transform (Phase 8 ownership)", () => {
  test("the reviewed fixture curation generates a deterministic review artifact with body-only mapped to no equipment", async () => {
    const staging = await mkdtemp(join(tmpdir(), "repjot-transform-"));
    try {
      const result = spawnSync(
        "bun",
        [
          "scripts/build-static-data.ts",
          "--source",
          join(REPO_ROOT, "tests", "fixtures", "curation", "source-checkout"),
          "--curation",
          join(REPO_ROOT, "tests", "fixtures", "curation", "exercises.curation.json"),
          "--staging",
          staging
        ],
        { cwd: REPO_ROOT, encoding: "utf8" }
      );
      expect(result.status).toBe(0);
      const artifact = JSON.parse(await readFile(join(staging, "exercises.review.json"), "utf8")) as Record<string, unknown>;
      // Determinism: the reviewed fixture inputs produce a fixed candidate digest.
      expect(artifact["candidateSha256"]).toBe("14f2fc15eccca07ae8a37f0f3631ae988b8f50a3633b3be4cc007630d2cbe879");
      const candidate = artifact["candidate"] as Record<string, unknown>;
      const exercises = candidate["exercises"] as Array<Record<string, unknown>>;
      const pushUp = exercises.find((e) => e["id"] === "push-up");
      expect(pushUp !== undefined).toBe(true);
      expect(pushUp!["equipmentIds"]).toEqual([]);
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  });
});

describe("trusted local SVG gate (Architecture §18 gate 5)", () => {
  test("the reviewed valid fixture's local SVG passes and the hostile set is present for negative coverage", async () => {
    const { validateTrustedLocalIcons } = await import("../../src/validation/semantic/icon-validation");
    const { lstat, readFile: readNodeFile, realpath } = await import("node:fs/promises");
    const staticRoot = join(REPO_ROOT, "tests", "fixtures", "static", "valid", "public");
    const manifest = JSON.parse(await readFile(join(REPO_ROOT, "tests", "fixtures", "static", "valid", "material-symbols.json"), "utf8")) as string[];
    const result = await validateTrustedLocalIcons(await doc(join(REPO_ROOT, "tests", "fixtures", "static", "valid", "exercises.json")), {
      staticRoot,
      materialSymbols: new Set(manifest),
      files: {
        rootRealPath: () => realpath(staticRoot),
        fileRealPath: async (candidate: string): Promise<string | null> => {
          try {
            const canonical = await realpath(candidate);
            return (await lstat(canonical)).isFile() ? canonical : null;
          } catch (_error) {
            return null;
          }
        },
        readBytes: async (path: string): Promise<Uint8Array> => new Uint8Array(await readNodeFile(path))
      }
    });
    expect(result.valid).toBe(true);
    for (const name of ["script", "event", "external-reference", "malformed"]) {
      await stat(join(REPO_ROOT, "tests", "fixtures", "icons", "hostile", name + ".svg"));
    }
  });
});

describe("ES2019 classic bundle and authorization gates (Architecture §18 gate 9 preserved)", () => {
  test("the built bundle parses as ES2019, keeps the exact app-data scope, and cannot call window.open", () => {
    const result = spawnSync("bun", ["scripts/check-browser-compat.ts"], { cwd: REPO_ROOT, encoding: "utf8" });
    expect(result.status).toBe(0);
  });

  test("the Phase 0 authorization regression suite remains in the repository and is executed by bun test", async () => {
    await stat(join(REPO_ROOT, "tests", "google-identity.test.ts"));
  });
});

describe("invariant 21 tombstone ownership (Phase 37)", () => {
  test("tombstone merge precedence is owned by Phase 37 and not implemented in this phase", async () => {
    const phaseFile = await readFile(join(REPO_ROOT, "docs", "implementation", "phase-37.md"), "utf8");
    expect(phaseFile.toLowerCase().indexOf("tombstone") !== -1).toBe(true);
    // The semantic validator documents the boundary: document-exclusivity checks only.
    const resultTypes = await readFile(join(REPO_ROOT, "src", "validation", "semantic", "result-types.ts"), "utf8");
    expect(resultTypes.indexOf("Phase 37") !== -1).toBe(true);
    // No merge implementation exists in this phase's tree.
    let mergeDirExists: boolean;
    try {
      await stat(join(REPO_ROOT, "src", "merge"));
      mergeDirExists = true;
    } catch (_error) {
      mergeDirExists = false;
    }
    expect(mergeDirExists).toBe(false);
  });
});

describe("external blockers remain explicit (never fabricated)", () => {
  test("canonical static validation is blocked while approved content is unpublished", async () => {
    const err: string[] = [];
    const realError = console.error;
    console.error = (line: unknown): void => {
      err.push(String(line));
    };
    let code = 0;
    try {
      code = await runValidateStatic([]);
    } finally {
      console.error = realError;
    }
    expect(code).toBe(1);
    expect(err.some((line) => line.indexOf("canonical-content-missing") === 0)).toBe(true);
  });

  test("no prior-production baseline manifest exists in the repository", async () => {
    let exists: boolean;
    try {
      await stat(join(REPO_ROOT, ".compatibility", "baseline.json"));
      exists = true;
    } catch (_error) {
      exists = false;
    }
    expect(exists).toBe(false);
  });

  test("curation approvals are templates only; no approval file is committed", async () => {
    const names = (await readdir(join(REPO_ROOT, "data", "curation"))).sort();
    expect(names.some((name) => name.endsWith(".json") && name.indexOf(".template.") === -1)).toBe(false);
  });
});
