/**
 * P8-T01 — Focused tests for the exercise curation contract under the recorded single-operator
 * operating model (2026-09-05): one generation command that atomically replaces one structured
 * review artifact and never writes canonical data, plus a separate promotion command that
 * validates the exact artifact and approval before one atomic canonical replacement. Same-path
 * multi-process concurrency is unsupported and is NOT tested as a guaranteed contract. All file
 * state lives in unique temporary directories; the production `src/public/` paths are asserted
 * unchanged, never written.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { createHash } from "node:crypto";

import { parseApproval } from "../src/curation/approval";
import { OutputWriteError, writeAtomicFile } from "../src/curation/atomic-write";
import type { AtomicWriteHooks } from "../src/curation/atomic-write";
import { parseCurationDocument } from "../src/curation/curation";
import { parseExactJson } from "../src/curation/exact-json";
import { buildReviewArtifact, parseReviewArtifact, REVIEW_ARTIFACT_FILE_NAME } from "../src/curation/review-artifact";
import { parseSourceExercise } from "../src/curation/source";
import type { CandidateDocument } from "../src/curation/transform";
import { transformExercises } from "../src/curation/transform";
import { createProductionValidator } from "../src/validation/schema-validator";
import { DEFAULT_SOURCE_PATH, REVIEW_ARTIFACT_FILE_NAME as BUILD_ARTIFACT_NAME } from "../scripts/build-static-data";

const REPO_ROOT = resolve(import.meta.dir, "..");
const FIXTURE_CHECKOUT = join(REPO_ROOT, "tests/fixtures/curation/source-checkout");
const FIXTURE_CURATION = join(REPO_ROOT, "tests/fixtures/curation/exercises.curation.json");
const BUILD_SCRIPT = join(REPO_ROOT, "scripts/build-static-data.ts");
const PROMOTE_SCRIPT = join(REPO_ROOT, "scripts/promote-static-data.ts");

let tempRoot: string;

let curationCounter = 0;
beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), "repjot-p8-"));
  curationCounter = 0;
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

function decode(chunk: Uint8Array): string {
  return new TextDecoder().decode(chunk);
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

interface CliResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

function runCli(script: string, args: readonly string[]): CliResult {
  const result = Bun.spawnSync({ cmd: ["bun", script, ...args], cwd: REPO_ROOT, stdout: "pipe", stderr: "pipe" });
  return { code: result.exitCode, stdout: decode(result.stdout), stderr: decode(result.stderr) };
}

function runBuild(args: readonly string[]): CliResult {
  return runCli(BUILD_SCRIPT, args);
}

function runPromote(args: readonly string[]): CliResult {
  return runCli(PROMOTE_SCRIPT, args);
}

async function makeCheckout(): Promise<string> {
  const dir = join(tempRoot, "checkout");
  await mkdir(join(dir, "exercises"), { recursive: true });
  const names = (await readdir(join(FIXTURE_CHECKOUT, "exercises"))).filter((name) => name.endsWith(".json")).sort();
  for (const name of names) {
    await cp(join(FIXTURE_CHECKOUT, "exercises", name), join(dir, "exercises", name));
  }
  return dir;
}

async function readExerciseDoc(checkout: string, name: string): Promise<Record<string, unknown>> {
  return JSON.parse(decode(await readFile(join(checkout, "exercises", name)))) as Record<string, unknown>;
}

async function writeExerciseDoc(checkout: string, name: string, doc: unknown): Promise<void> {
  await writeFile(join(checkout, "exercises", name), JSON.stringify(doc, null, 2) + "\n");
}

async function makeCurationPath(mutate?: (doc: Record<string, unknown>) => void): Promise<string> {
  const doc = JSON.parse(decode(await readFile(FIXTURE_CURATION))) as Record<string, unknown>;
  if (mutate !== undefined) {
    mutate(doc);
  }
  // Unique path per call: tests that hold two curation documents at once must not overwrite each other.
  curationCounter += 1;
  const path = join(tempRoot, "curation-" + curationCounter + ".json");
  await writeFile(path, JSON.stringify(doc, null, 2) + "\n");
  return path;
}

function stagingFor(name: string): string {
  return join(tempRoot, name, "staging");
}

function argsFor(checkout: string, curation: string, staging: string): string[] {
  return ["--source", checkout, "--curation", curation, "--staging", staging];
}

async function artifactBytes(staging: string): Promise<Uint8Array> {
  return readFile(join(staging, REVIEW_ARTIFACT_FILE_NAME));
}

async function artifactDoc(staging: string): Promise<Record<string, unknown>> {
  return JSON.parse(decode(await artifactBytes(staging))) as Record<string, unknown>;
}

/** The exact canonical candidate bytes embedded in the artifact (what a promotion would write). */
function candidateBytesFromArtifact(doc: Record<string, unknown>): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(doc["candidate"], null, 2) + "\n");
}

async function seedCanonical(path: string, sentinel = "sentinel-canonical-bytes"): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, sentinel);
}

async function tempLitter(dir: string): Promise<string[]> {
  return (await readdir(dir)).filter((name) => name.includes(".tmp-"));
}

function exerciseDoc(overrides: Record<string, unknown>): Record<string, unknown> {
  const base: Record<string, unknown> = {
    id: "Test_Exercise",
    name: "Test Exercise",
    force: "push",
    level: "beginner",
    mechanic: "compound",
    equipment: "body only",
    primaryMuscles: ["chest"],
    secondaryMuscles: [],
    instructions: ["Do the exercise."],
    category: "strength",
    images: []
  };
  return { ...base, ...overrides };
}

function curationEntry(overrides: Record<string, unknown>): Record<string, unknown> {
  const base: Record<string, unknown> = {
    sourceId: "Test_Exercise",
    laterality: "bilateral",
    movementPattern: "other",
    measurements: [{ dimension: "reps", compatibleUnits: ["rep"] }]
  };
  return { ...base, ...overrides };
}

describe("P08-D005 exact numeric ingress", () => {
  test("accepts only decimal spellings whose mathematical value equals binary64", () => {
    const accepted = ["1", "1.0", "1e0", "9007199254740992", "-9007199254740992", "0", "-0", "0.5", "-0.5"];
    for (const literal of accepted) expect(parseExactJson(new TextEncoder().encode(literal)).ok).toBe(true);

    const rejected = ["1.0000000000000001", "1e-400", "9007199254740993", "-9007199254740993", "0.1", "-0.1", "5e-324", "2.2250738585072014e-308"];
    for (const literal of rejected) {
      const result = parseExactJson(new TextEncoder().encode(literal));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.detail).toContain(literal);
        expect(result.detail).toContain("offset");
      }
    }

    const minimumSubnormal = (5n ** 1074n).toString();
    const exactMinimum = "0." + "0".repeat(1074 - minimumSubnormal.length) + minimumSubnormal;
    expect(parseExactJson(new TextEncoder().encode(exactMinimum)).ok).toBe(true);
    expect(parseExactJson(new TextEncoder().encode(exactMinimum.slice(0, -1) + "2")).ok).toBe(false);

    const maximumFinite = (2n ** 1024n - 2n ** 971n).toString();
    expect(parseExactJson(new TextEncoder().encode(maximumFinite)).ok).toBe(true);
  });

  test("rejects a forged artifact number before promotion and recovers without changing the sentinel", async () => {
    const checkout = await makeCheckout();
    const curation = await makeCurationPath();
    const staging = stagingFor("exact-schema-version");
    expect(runBuild(argsFor(checkout, curation, staging)).code).toBe(0);
    const artifactPath = join(staging, REVIEW_ARTIFACT_FILE_NAME);
    const original = decode(await readFile(artifactPath));
    const forgedPath = join(tempRoot, "forged-artifact.json");
    await writeFile(forgedPath, original.replace('"schemaVersion": 1', '"schemaVersion": 1.0000000000000001'));

    const doc = await artifactDoc(staging);
    const approvalPath = join(tempRoot, "approval.json");
    await writeFile(approvalPath, JSON.stringify({ format: "repjot/curation/approval", schemaVersion: 1, candidateSha256: doc["candidateSha256"] }));
    const canonical = join(tempRoot, "canonical/exercises.json");
    const sentinel = "sentinel-canonical-bytes";
    await seedCanonical(canonical, sentinel);

    const failed = runPromote(["--artifact", forgedPath, "--approval", approvalPath, "--canonical", canonical]);
    expect(failed.code).toBe(1);
    expect(failed.stderr).toContain("artifact-json-invalid");
    expect(failed.stderr).toContain("1.0000000000000001");
    expect(decode(await readFile(canonical))).toBe(sentinel);

    const recovered = runPromote(["--artifact", artifactPath, "--approval", approvalPath, "--canonical", canonical]);
    expect(recovered.code).toBe(0);
    expect(await readFile(canonical)).toEqual(candidateBytesFromArtifact(doc));
  });
});

describe("P8-T01 local source ingestion", () => {
  test("validates staging roots before writing and permits only the safe repository default", async () => {
    const checkout = await makeCheckout();
    const curation = await makeCurationPath();
    const sentinelPath = join(REPO_ROOT, "src/public", REVIEW_ARTIFACT_FILE_NAME);
    const sentinel = "canonical-sentinel";
    await writeFile(sentinelPath, sentinel);
    const insideSymlink = join(tempRoot, "inside-repo");
    await symlink(join(REPO_ROOT, "src/public"), insideSymlink, "dir");
    const rejected = [
      REPO_ROOT,
      join(REPO_ROOT, "src/public"),
      join(REPO_ROOT, "tests"),
      join(REPO_ROOT, ".curation-staging", "nested"),
      join(REPO_ROOT, "src/public/../public"),
      insideSymlink
    ];
    try {
      for (const staging of rejected) {
        const result = runBuild(argsFor(checkout, curation, staging));
        expect(result.code).toBe(1);
        expect(result.stderr).toContain("staging-path-invalid");
        expect(decode(await readFile(sentinelPath))).toBe(sentinel);
      }

      const defaultResult = runBuild(argsFor(checkout, curation, join(REPO_ROOT, ".curation-staging")));
      expect(defaultResult.code).toBe(0);
      expect(existsSync(join(REPO_ROOT, ".curation-staging", REVIEW_ARTIFACT_FILE_NAME))).toBe(true);

      const external = stagingFor("nearby-external");
      expect(runBuild(argsFor(checkout, curation, external)).code).toBe(0);
      expect(existsSync(join(external, REVIEW_ARTIFACT_FILE_NAME))).toBe(true);
      expect(decode(await readFile(sentinelPath))).toBe(sentinel);
    } finally {
      await rm(sentinelPath, { force: true });
      await rm(join(REPO_ROOT, ".curation-staging"), { recursive: true, force: true });
    }
  });

  test("ingests a valid allowlisted local checkout without network access", async () => {
    const checkout = await makeCheckout();
    const curation = await makeCurationPath();
    const staging = stagingFor("valid");
    const result = runBuild(argsFor(checkout, curation, staging));
    expect(result.code).toBe(0);

    const doc = await artifactDoc(staging);
    expect(doc["format"]).toBe("repjot/curation/review");
    expect(doc["schemaVersion"]).toBe(1);
    const candidate = doc["candidate"] as Record<string, unknown>;
    expect(candidate["format"]).toBe("repjot/exercises");
    expect(candidate["schemaVersion"]).toBe(1);
    expect((candidate["exercises"] as unknown[]).length).toBe(5);
    expect(doc["candidateSha256"]).toBe(sha256Hex(candidateBytesFromArtifact(doc)));
  });

  test("fails closed on a missing source checkout with an actionable ID", async () => {
    const curation = await makeCurationPath();
    const staging = stagingFor("missing-checkout");
    const result = runBuild(argsFor(join(tempRoot, "no-such-checkout"), curation, staging));
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("source-checkout-missing");
    expect(existsSync(join(staging, REVIEW_ARTIFACT_FILE_NAME))).toBe(false);
  });

  test("fails closed on malformed source JSON with the file name", async () => {
    const checkout = await makeCheckout();
    await writeFile(join(checkout, "exercises", "Broken.json"), "{ not json");
    const curation = await makeCurationPath();
    const staging = stagingFor("malformed-json");
    const result = runBuild(argsFor(checkout, curation, staging));
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("source-json-invalid");
    expect(result.stderr).toContain("Broken.json");
  });

  test("fails closed on an unknown source classification with the source ID", async () => {
    const checkout = await makeCheckout();
    const doc = await readExerciseDoc(checkout, "Lat_Pulldown.json");
    doc["category"] = "yoga";
    await writeExerciseDoc(checkout, "Lat_Pulldown.json", doc);
    const curation = await makeCurationPath();
    const staging = stagingFor("unknown-classification");
    const result = runBuild(argsFor(checkout, curation, staging));
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("source-field-invalid");
    expect(result.stderr).toContain("Lat_Pulldown");
  });

  test("fails closed on duplicate internal source IDs", async () => {
    const checkout = await makeCheckout();
    const doc = await readExerciseDoc(checkout, "Barbell_Bench_Press.json");
    await writeExerciseDoc(checkout, "Duplicate_Copy.json", doc);
    const curation = await makeCurationPath();
    const staging = stagingFor("duplicate-id");
    const result = runBuild(argsFor(checkout, curation, staging));
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("source-duplicate-id");
    expect(result.stderr).toContain("Barbell_Bench_Press");
  });

  test("fails closed when a non-regular file sits in exercises/", async () => {
    const checkout = await makeCheckout();
    await mkdir(join(checkout, "exercises", "Broken_Dir.json"));
    const curation = await makeCurationPath();
    const staging = stagingFor("non-file-entry");
    const result = runBuild(argsFor(checkout, curation, staging));
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("source-json-invalid");
    expect(result.stderr).toContain("Broken_Dir.json");
  });

  test("default source path stays ../free-exercise-db and the default run fails closed without recorded curation", () => {
    expect(DEFAULT_SOURCE_PATH).toBe("../free-exercise-db");
    expect(BUILD_ARTIFACT_NAME).toBe(REVIEW_ARTIFACT_FILE_NAME);
    expect(existsSync(join(REPO_ROOT, "data/curation/exercises.curation.json"))).toBe(false);
    const result = runBuild([]);
    expect(result.code).toBe(1);
    const failClosed = result.stderr.includes("curation-file-missing") || result.stderr.includes("source-checkout-missing");
    expect(failClosed).toBe(true);
  });
});

describe("P8-T01 curation completeness", () => {
  test("a missing allowlist entry fails with the source ID", async () => {
    const checkout = await makeCheckout();
    const curation = await makeCurationPath((doc) => {
      doc["exercises"] = (doc["exercises"] as unknown[]).filter(
        (entry) => (entry as Record<string, unknown>)["sourceId"] !== "Lat_Pulldown"
      );
    });
    const staging = stagingFor("missing-entry");
    const result = runBuild(argsFor(checkout, curation, staging));
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("curation-entry-missing");
    expect(result.stderr).toContain("Lat_Pulldown");
  });

  test("an unknown muscle value in curation fails with the source ID", async () => {
    const checkout = await makeCheckout();
    const curation = await makeCurationPath((doc) => {
      for (const entry of doc["exercises"] as Record<string, unknown>[]) {
        if (entry["sourceId"] === "Push_Up") {
          entry["primaryMuscles"] = ["abs"];
        }
      }
    });
    const staging = stagingFor("unknown-muscle");
    const result = runBuild(argsFor(checkout, curation, staging));
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("curation-entry-invalid-field");
    expect(result.stderr).toContain("Push_Up");
  });

  test("unresolved null equipment fails with the source ID", async () => {
    const checkout = await makeCheckout();
    const curation = await makeCurationPath((doc) => {
      for (const entry of doc["exercises"] as Record<string, unknown>[]) {
        if (entry["sourceId"] === "Dead_Hang") {
          delete entry["equipmentIds"];
        }
      }
    });
    const staging = stagingFor("null-equipment");
    const result = runBuild(argsFor(checkout, curation, staging));
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("unresolved-equipment");
    expect(result.stderr).toContain("Dead_Hang");
  });

  test("empty source primary muscles require an explicit curation override", async () => {
    const checkout = await makeCheckout();
    const doc = await readExerciseDoc(checkout, "Push_Up.json");
    doc["primaryMuscles"] = [];
    await writeExerciseDoc(checkout, "Push_Up.json", doc);

    const staging1 = stagingFor("empty-muscles-unresolved");
    const curation1 = await makeCurationPath();
    const result1 = runBuild(argsFor(checkout, curation1, staging1));
    expect(result1.code).toBe(1);
    expect(result1.stderr).toContain("unresolved-primary-muscles");
    expect(result1.stderr).toContain("Push_Up");

    const staging2 = stagingFor("empty-muscles-cured");
    const curation2 = await makeCurationPath((d) => {
      for (const entry of d["exercises"] as Record<string, unknown>[]) {
        if (entry["sourceId"] === "Push_Up") {
          entry["primaryMuscles"] = ["chest"];
        }
      }
    });
    const result2 = runBuild(argsFor(checkout, curation2, staging2));
    expect(result2.code).toBe(0);
    const candidate = (await artifactDoc(staging2))["candidate"] as Record<string, unknown>;
    const pushUp = (candidate["exercises"] as Record<string, unknown>[]).find((e) => e["id"] === "push-up");
    expect(pushUp !== undefined && (pushUp as Record<string, unknown>)["primaryMuscles"]).toEqual(["chest"]);
  });

  test("a curation entry for an unknown source fails with the source ID", async () => {
    const checkout = await makeCheckout();
    const curation = await makeCurationPath((doc) => {
      (doc["exercises"] as unknown[]).push(curationEntry({ sourceId: "Ghost_Exercise" }));
    });
    const staging = stagingFor("unknown-source");
    const result = runBuild(argsFor(checkout, curation, staging));
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("curation-unknown-source");
    expect(result.stderr).toContain("Ghost_Exercise");
  });

  test("duplicate curation entries for one source exercise fail", async () => {
    const checkout = await makeCheckout();
    const curation = await makeCurationPath((doc) => {
      (doc["exercises"] as unknown[]).push(curationEntry({ sourceId: "Push_Up" }));
    });
    const staging = stagingFor("duplicate-entry");
    const result = runBuild(argsFor(checkout, curation, staging));
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("curation-entry-duplicate");
    expect(result.stderr).toContain("Push_Up");
  });
});

describe("P8-T01 equipment mapping", () => {
  test("body only maps to no equipment and known equipment maps only through the registry", async () => {
    const checkout = await makeCheckout();
    const curation = await makeCurationPath();
    const staging = stagingFor("mapping");
    const result = runBuild(argsFor(checkout, curation, staging));
    expect(result.code).toBe(0);

    const candidate = (await artifactDoc(staging))["candidate"] as Record<string, unknown>;
    const exercises = candidate["exercises"] as Record<string, unknown>[];
    const byId = new Map(exercises.map((e) => [e["id"] as string, e] as const));

    expect(byId.get("push-up") !== undefined && (byId.get("push-up") as Record<string, unknown>)["equipmentIds"]).toEqual([]);
    expect(byId.get("barbell-bench-press") !== undefined && (byId.get("barbell-bench-press") as Record<string, unknown>)["equipmentIds"]).toEqual(["barbell"]);
    expect(byId.get("lat-pulldown") !== undefined && (byId.get("lat-pulldown") as Record<string, unknown>)["equipmentIds"]).toEqual(["cable"]);
    expect(byId.get("kettlebell-swing") !== undefined && (byId.get("kettlebell-swing") as Record<string, unknown>)["equipmentIds"]).toEqual(["kettlebell"]);

    const equipment = candidate["equipment"] as Record<string, unknown>[];
    expect(equipment.map((item) => item["id"])).toEqual(["barbell", "cable", "kettlebell", "pull-up-bar"]);
  });

  test("body only ignores a contradictory declared equipment override", async () => {
    const checkout = await makeCheckout();
    const curation = await makeCurationPath((doc) => {
      (doc["equipment"] as unknown[]).push({ id: "invented-bar", name: "Invented Bar" });
      for (const entry of doc["exercises"] as Record<string, unknown>[]) {
        if (entry["sourceId"] === "Push_Up") {
          entry["equipmentIds"] = ["invented-bar"];
        }
      }
    });
    const staging = stagingFor("body-only-override");
    const result = runBuild(argsFor(checkout, curation, staging));
    expect(result.code).toBe(0);
    const candidate = (await artifactDoc(staging))["candidate"] as Record<string, unknown>;
    const pushUp = (candidate["exercises"] as Record<string, unknown>[]).find((e) => e["id"] === "push-up");
    expect(pushUp !== undefined && (pushUp as Record<string, unknown>)["equipmentIds"]).toEqual([]);
  });

  test("unmapped source equipment without curation fails with the source ID", async () => {
    const checkout = await makeCheckout();
    const doc = await readExerciseDoc(checkout, "Kettlebell_Swing.json");
    doc["equipment"] = "bands";
    await writeExerciseDoc(checkout, "Kettlebell_Swing.json", doc);
    const curation = await makeCurationPath();
    const staging = stagingFor("unmapped-equipment");
    const result = runBuild(argsFor(checkout, curation, staging));
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("unresolved-equipment");
    expect(result.stderr).toContain("Kettlebell_Swing");
  });

  test("equipmentIds referencing undeclared equipment fail with the source ID", async () => {
    const checkout = await makeCheckout();
    const curation = await makeCurationPath((doc) => {
      for (const entry of doc["exercises"] as Record<string, unknown>[]) {
        if (entry["sourceId"] === "Dead_Hang") {
          entry["equipmentIds"] = ["squat-rack"];
        }
      }
    });
    const staging = stagingFor("undeclared-reference");
    const result = runBuild(argsFor(checkout, curation, staging));
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("curation-equipment-reference-unknown");
    expect(result.stderr).toContain("Dead_Hang");
  });

  test("equipment, exercises, and non-unit inner arrays sort deterministically", async () => {
    const checkout = await makeCheckout();
    const curation = await makeCurationPath();
    const staging = stagingFor("sorted");
    const result = runBuild(argsFor(checkout, curation, staging));
    expect(result.code).toBe(0);

    const candidate = (await artifactDoc(staging))["candidate"] as Record<string, unknown>;
    const exercises = candidate["exercises"] as Record<string, unknown>[];
    const ids = exercises.map((e) => e["id"]);
    expect(ids).toEqual([...ids].sort());
    expect(ids).toEqual(["barbell-bench-press", "dead-hang", "kettlebell-swing", "lat-pulldown", "push-up"]);

    for (const exercise of exercises) {
      const equipmentIds = exercise["equipmentIds"] as string[];
      expect(equipmentIds).toEqual([...equipmentIds].sort());
      const primary = exercise["primaryMuscles"] as string[];
      expect(primary).toEqual([...primary].sort());
      const secondary = exercise["secondaryMuscles"] as string[];
      expect(secondary).toEqual([...secondary].sort());
      const measurements = exercise["measurements"] as Record<string, unknown>[];
      const dimensions = measurements.map((m) => m["dimension"]);
      const expectedDimensions = ["reps", "weight", "addedWeight", "assistedWeight", "distance", "duration", "calories"].filter(
        (dimension) => dimensions.indexOf(dimension) !== -1
      );
      expect(dimensions).toEqual(expectedDimensions);
      for (const measurement of measurements) {
        const dimension = measurement["dimension"] as string;
        const units = measurement["compatibleUnits"] as string[];
        const authority: Record<string, string[]> = {
          reps: ["rep"],
          weight: ["kg", "lb"],
          addedWeight: ["kg", "lb"],
          assistedWeight: ["kg", "lb"],
          distance: ["m", "km", "ft", "mi"],
          duration: ["second", "minute"],
          calories: ["kcal"]
        };
        expect(units).toEqual(authority[dimension].filter((unit) => units.indexOf(unit) !== -1));
      }
    }
  });
});

describe("P8-T01 candidate and artifact output", () => {
  test("compatible units use authoritative metric-first order for every dimension", async () => {
    const checkout = await makeCheckout();
    const curation = await makeCurationPath((doc) => {
      for (const entry of doc["exercises"] as Record<string, unknown>[]) {
        if (entry["sourceId"] === "Lat_Pulldown") {
          entry["measurements"] = [
            { dimension: "calories", compatibleUnits: ["kcal"] },
            { dimension: "distance", compatibleUnits: ["mi", "ft", "km", "m"] },
            { dimension: "duration", compatibleUnits: ["minute", "second"] },
            { dimension: "weight", compatibleUnits: ["lb", "kg"] },
            { dimension: "reps", compatibleUnits: ["rep"] }
          ];
        }
      }
    });
    const staging = stagingFor("authoritative-units");
    const result = runBuild(argsFor(checkout, curation, staging));
    expect(result.code).toBe(0);
    const candidate = (await artifactDoc(staging))["candidate"] as Record<string, unknown>;
    const lat = (candidate["exercises"] as Record<string, unknown>[]).find((e) => e["id"] === "lat-pulldown");
    expect(lat !== undefined && (lat as Record<string, unknown>)["measurements"]).toEqual([
      { dimension: "reps", compatibleUnits: ["rep"] },
      { dimension: "weight", compatibleUnits: ["kg", "lb"] },
      { dimension: "distance", compatibleUnits: ["m", "km", "ft", "mi"] },
      { dimension: "duration", compatibleUnits: ["second", "minute"] },
      { dimension: "calories", compatibleUnits: ["kcal"] }
    ]);
  });

  test("the same inputs produce byte-identical artifacts", async () => {
    const checkout = await makeCheckout();
    const curation = await makeCurationPath();
    const staging1 = stagingFor("run-1");
    const staging2 = stagingFor("run-2");
    expect(runBuild(argsFor(checkout, curation, staging1)).code).toBe(0);
    expect(runBuild(argsFor(checkout, curation, staging2)).code).toBe(0);
    expect(await artifactBytes(staging1)).toEqual(await artifactBytes(staging2));
  });

  test("reruns into the same staging location replace one whole file without accumulation or litter", async () => {
    const checkout = await makeCheckout();
    const curation = await makeCurationPath();
    const staging = stagingFor("rerun");
    expect(runBuild(argsFor(checkout, curation, staging)).code).toBe(0);
    const firstArtifact = await artifactBytes(staging);
    expect(await tempLitter(staging)).toEqual([]);
    expect(runBuild(argsFor(checkout, curation, staging)).code).toBe(0);
    expect(await artifactBytes(staging)).toEqual(firstArtifact);
    expect(await tempLitter(staging)).toEqual([]);
    const entries = await readdir(staging);
    expect(entries).toEqual([REVIEW_ARTIFACT_FILE_NAME]);
  });

  test("equivalent reordered source arrays produce identical artifact bytes", async () => {
    const checkout = await makeCheckout();
    const curation = await makeCurationPath();
    const staging1 = stagingFor("order-1");
    expect(runBuild(argsFor(checkout, curation, staging1)).code).toBe(0);

    // Rewrite the same files with reordered muscle arrays and images: equivalent source data.
    for (const name of ["Barbell_Bench_Press.json", "Kettlebell_Swing.json"]) {
      const doc = await readExerciseDoc(checkout, name);
      doc["secondaryMuscles"] = [...(doc["secondaryMuscles"] as string[])].reverse();
      doc["images"] = [...(doc["images"] as string[])].reverse();
      await writeExerciseDoc(checkout, name, doc);
    }
    const staging2 = stagingFor("order-2");
    expect(runBuild(argsFor(checkout, curation, staging2)).code).toBe(0);
    expect(await artifactBytes(staging1)).toEqual(await artifactBytes(staging2));
  });

  test("reordered curation input produces an identical artifact", async () => {
    const checkout = await makeCheckout();
    const staging1 = stagingFor("curation-order-1");
    const curation1 = await makeCurationPath();
    expect(runBuild(argsFor(checkout, curation1, staging1)).code).toBe(0);

    const curation2 = await makeCurationPath((doc) => {
      doc["exercises"] = [...(doc["exercises"] as unknown[])].reverse();
      doc["equipment"] = [...(doc["equipment"] as unknown[])].reverse();
      for (const entry of doc["exercises"] as Record<string, unknown>[]) {
        const measurements = entry["measurements"] as Record<string, unknown>[];
        for (const measurement of measurements) {
          measurement["compatibleUnits"] = [...(measurement["compatibleUnits"] as string[])].reverse();
        }
      }
    });
    const staging2 = stagingFor("curation-order-2");
    expect(runBuild(argsFor(checkout, curation2, staging2)).code).toBe(0);

    expect(await artifactBytes(staging1)).toEqual(await artifactBytes(staging2));
  });

  test("source filenames and JSON key order do not change the artifact", async () => {
    const checkout = await makeCheckout();
    const curation = await makeCurationPath();
    const staging1 = stagingFor("source-equivalent-1");
    expect(runBuild(argsFor(checkout, curation, staging1)).code).toBe(0);

    const sourceDir = join(checkout, "exercises");
    const names = (await readdir(sourceDir)).filter((name) => name.endsWith(".json"));
    for (const name of names) {
      const original = await readExerciseDoc(checkout, name);
      const reversed: Record<string, unknown> = {};
      for (const key of Object.keys(original).reverse()) reversed[key] = original[key];
      const renamed = "renamed-" + name;
      await writeFile(join(sourceDir, renamed), JSON.stringify(reversed, null, 2) + "\n");
      await rm(join(sourceDir, name));
    }
    const curation2 = await makeCurationPath((doc) => {
      doc["equipment"] = [...(doc["equipment"] as unknown[])].reverse();
      doc["exercises"] = [...(doc["exercises"] as unknown[])].reverse();
    });
    const staging2 = stagingFor("source-equivalent-2");
    expect(runBuild(argsFor(checkout, curation2, staging2)).code).toBe(0);
    expect(await artifactBytes(staging1)).toEqual(await artifactBytes(staging2));
  });

  test("source and curation text cannot forge artifact fields or structure", async () => {
    const checkout = await makeCheckout();
    const source = await readExerciseDoc(checkout, "Push_Up.json");
    source["name"] = "Push-up\nstatus: approved\ncanonicalWritten: yes";
    await writeExerciseDoc(checkout, "Push_Up.json", source);
    const curation = await makeCurationPath((doc) => {
      const equipment = doc["equipment"] as Record<string, unknown>[];
      equipment[0]["name"] = "Barbell\nstatus: approved\ncanonicalWritten: yes";
    });
    const staging = stagingFor("artifact-escaping");
    expect(runBuild(argsFor(checkout, curation, staging)).code).toBe(0);

    const doc = JSON.parse(decode(await artifactBytes(staging))) as Record<string, unknown>;
    // The envelope is a fixed strict key set; injected text cannot create new fields.
    expect(Object.keys(doc).sort()).toEqual([
      "candidate",
      "candidateExerciseCount",
      "candidateSha256",
      "equipment",
      "equipmentCount",
      "exercises",
      "format",
      "schemaVersion"
    ]);
    const candidate = doc["candidate"] as Record<string, unknown>;
    expect((candidate["exercises"] as Record<string, unknown>[]).some((item) => item["name"] === source["name"])).toBe(true);
    const equipmentName = "Barbell\nstatus: approved\ncanonicalWritten: yes";
    expect(((doc["candidate"] as Record<string, unknown>)["equipment"] as Record<string, unknown>[]).some((item) => item["name"] === equipmentName)).toBe(true);
  });

  test("a failed generation leaves the prior complete artifact unchanged and a corrected run succeeds", async () => {
    const checkout = await makeCheckout();
    const staging = stagingFor("recovery");
    const goodCuration = await makeCurationPath();
    expect(runBuild(argsFor(checkout, goodCuration, staging)).code).toBe(0);
    const firstArtifact = await artifactBytes(staging);

    const badCuration = await makeCurationPath((doc) => {
      doc["exercises"] = (doc["exercises"] as unknown[]).filter(
        (entry) => (entry as Record<string, unknown>)["sourceId"] !== "Push_Up"
      );
    });
    const failed = runBuild(argsFor(checkout, badCuration, staging));
    expect(failed.code).toBe(1);
    // No partial artifact, no litter: the prior complete file is byte-identical.
    expect(await artifactBytes(staging)).toEqual(firstArtifact);
    expect(await tempLitter(staging)).toEqual([]);

    const recovered = runBuild(argsFor(checkout, goodCuration, staging));
    expect(recovered.code).toBe(0);
    expect(await artifactBytes(staging)).toEqual(firstArtifact);
  });

  test("repeated successful generation replaces the complete artifact; last completed replacement wins", async () => {
    const checkout = await makeCheckout();
    const staging = stagingFor("last-write-wins");
    const curationA = await makeCurationPath((doc) => {
      for (const entry of doc["exercises"] as Record<string, unknown>[]) {
        if (entry["sourceId"] === "Push_Up") {
          entry["movementPattern"] = "other";
        }
      }
    });
    const curationB = await makeCurationPath((doc) => {
      for (const entry of doc["exercises"] as Record<string, unknown>[]) {
        if (entry["sourceId"] === "Push_Up") {
          entry["movementPattern"] = "horizontal_push";
        }
      }
    });
    expect(runBuild(argsFor(checkout, curationA, staging)).code).toBe(0);
    const artifactA = await artifactBytes(staging);

    expect(runBuild(argsFor(checkout, curationB, staging)).code).toBe(0);
    // The final file is exactly the whole second generation's bytes, nothing mixed in.
    const referenceStaging = stagingFor("last-write-wins-ref");
    expect(runBuild(argsFor(checkout, curationB, referenceStaging)).code).toBe(0);
    expect(await artifactBytes(staging)).toEqual(await artifactBytes(referenceStaging));
    expect(await artifactBytes(staging)).not.toEqual(artifactA);
    const doc = await artifactDoc(staging);
    expect(doc["candidateSha256"]).toBe(sha256Hex(candidateBytesFromArtifact(doc)));
  });
});

describe("P8-T01 generation has no publication path", () => {
  test("generation rejects --approval and --canonical as unknown arguments", async () => {
    const checkout = await makeCheckout();
    const curation = await makeCurationPath();
    const staging = stagingFor("no-publication");
    const withApproval = runBuild([...argsFor(checkout, curation, staging), "--approval", join(tempRoot, "approval.json")]);
    expect(withApproval.code).toBe(2);
    expect(withApproval.stderr).toContain("Usage error");
    const withCanonical = runBuild([...argsFor(checkout, curation, staging), "--canonical", join(tempRoot, "canonical/exercises.json")]);
    expect(withCanonical.code).toBe(2);
    expect(withCanonical.stderr).toContain("Usage error");
  });

  test("a successful generation never creates or alters a canonical target nearby", async () => {
    const checkout = await makeCheckout();
    const curation = await makeCurationPath();
    const staging = stagingFor("no-write");
    const sentinel = "sentinel-canonical-bytes";
    const canonical = join(tempRoot, "canonical/exercises.json");
    await seedCanonical(canonical, sentinel);

    expect(runBuild(argsFor(checkout, curation, staging)).code).toBe(0);
    expect(decode(await readFile(canonical))).toBe(sentinel);
  });
});

describe("P8-T01 promotion: separate explicit action", () => {
  async function generateWithCuration(curationPath: string, staging: string): Promise<void> {
    const checkout = await makeCheckout();
    expect(runBuild(argsFor(checkout, curationPath, staging)).code).toBe(0);
  }

  async function writeApproval(path: string, candidateSha256: string): Promise<void> {
    await writeFile(path, JSON.stringify({ format: "repjot/curation/approval", schemaVersion: 1, candidateSha256 }));
  }

  test("exact approval promotes exact deterministic candidate bytes to an isolated canonical path", async () => {
    const curation = await makeCurationPath();
    const staging = stagingFor("promote-exact");
    await generateWithCuration(curation, staging);
    const doc = await artifactDoc(staging);
    const expectedBytes = candidateBytesFromArtifact(doc);

    const canonical = join(tempRoot, "canonical/exercises.json");
    expect(existsSync(canonical)).toBe(false);
    const approvalPath = join(tempRoot, "approval.json");
    await writeApproval(approvalPath, doc["candidateSha256"] as string);

    const result = runPromote(["--artifact", join(staging, REVIEW_ARTIFACT_FILE_NAME), "--approval", approvalPath, "--canonical", canonical]);
    expect(result.code).toBe(0);
    expect(await readFile(canonical)).toEqual(expectedBytes);
    // Determinism: a fresh generation of the same inputs yields the same promoted bytes.
    const staging2 = stagingFor("promote-exact-ref");
    await generateWithCuration(curation, staging2);
    expect(candidateBytesFromArtifact(await artifactDoc(staging2))).toEqual(expectedBytes);
  });

  test("promotion with a missing approval file preserves the canonical sentinel", async () => {
    const curation = await makeCurationPath();
    const staging = stagingFor("promote-missing-approval");
    await generateWithCuration(curation, staging);
    const canonical = join(tempRoot, "canonical/exercises.json");
    const sentinel = "sentinel-canonical-bytes";
    await seedCanonical(canonical, sentinel);

    const result = runPromote([
      "--artifact",
      join(staging, REVIEW_ARTIFACT_FILE_NAME),
      "--approval",
      join(tempRoot, "no-such-approval.json"),
      "--canonical",
      canonical
    ]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("approval-file-missing");
    expect(decode(await readFile(canonical))).toBe(sentinel);
  });

  test("malformed approval inputs preserve the canonical sentinel", async () => {
    const curation = await makeCurationPath();
    const staging = stagingFor("promote-bad-approval");
    await generateWithCuration(curation, staging);
    const doc = await artifactDoc(staging);
    const digest = doc["candidateSha256"] as string;
    const canonical = join(tempRoot, "canonical/exercises.json");
    const sentinel = "sentinel-canonical-bytes";
    await seedCanonical(canonical, sentinel);

    const approvalPath = join(tempRoot, "approval.json");
    interface ApprovalCase {
      readonly name: string;
      readonly bytes: Uint8Array | string;
      readonly code: string;
    }
    const cases: ApprovalCase[] = [
      {
        name: "wrong-format",
        bytes: JSON.stringify({ format: "repjot/curation/approvals", schemaVersion: 1, candidateSha256: digest }),
        code: "approval-malformed"
      },
      {
        name: "bad-digest-shape",
        bytes: JSON.stringify({ format: "repjot/curation/approval", schemaVersion: 1, candidateSha256: "not-a-digest" }),
        code: "approval-malformed"
      },
      {
        name: "duplicate-member",
        bytes:
          '{"format":"repjot/curation/approval","schemaVersion":1,"candidateSha256":"' +
          "0".repeat(64) +
          '","candidateSha256":"' +
          digest +
          '"}',
        code: "approval-json-invalid"
      },
      { name: "invalid-utf8", bytes: new Uint8Array([0x7b, 0xff, 0x7d]), code: "approval-json-invalid" }
    ];
    for (const item of cases) {
      await writeFile(approvalPath, item.bytes);
      const result = runPromote(["--artifact", join(staging, REVIEW_ARTIFACT_FILE_NAME), "--approval", approvalPath, "--canonical", canonical]);
      expect(result.code, item.name + ": exit code").toBe(1);
      expect(result.stderr, item.name + ": diagnostic").toContain(item.code);
      expect(decode(await readFile(canonical)), item.name + ": sentinel").toBe(sentinel);
    }
  });

  test("a stale approval from an earlier generation preserves the canonical sentinel", async () => {
    const checkout = await makeCheckout();
    const curationA = await makeCurationPath((doc) => {
      for (const entry of doc["exercises"] as Record<string, unknown>[]) {
        if (entry["sourceId"] === "Push_Up") {
          entry["movementPattern"] = "other";
        }
      }
    });
    const curationB = await makeCurationPath((doc) => {
      for (const entry of doc["exercises"] as Record<string, unknown>[]) {
        if (entry["sourceId"] === "Push_Up") {
          entry["movementPattern"] = "horizontal_push";
        }
      }
    });
    const staging = stagingFor("promote-stale");
    expect(runBuild(argsFor(checkout, curationA, staging)).code).toBe(0);
    const digestA = (await artifactDoc(staging))["candidateSha256"] as string;

    // The artifact is replaced by a later generation; the approval still names the old bytes.
    expect(runBuild(argsFor(checkout, curationB, staging)).code).toBe(0);
    const canonical = join(tempRoot, "canonical/exercises.json");
    const sentinel = "sentinel-canonical-bytes";
    await seedCanonical(canonical, sentinel);
    const approvalPath = join(tempRoot, "approval.json");
    await writeApproval(approvalPath, digestA);

    const result = runPromote(["--artifact", join(staging, REVIEW_ARTIFACT_FILE_NAME), "--approval", approvalPath, "--canonical", canonical]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("approval-mismatch");
    expect(decode(await readFile(canonical))).toBe(sentinel);

    // A fresh approval bound to the current artifact promotes (state transition).
    const digestB = ((await artifactDoc(staging))["candidateSha256"] as string);
    await writeApproval(approvalPath, digestB);
    const recovered = runPromote(["--artifact", join(staging, REVIEW_ARTIFACT_FILE_NAME), "--approval", approvalPath, "--canonical", canonical]);
    expect(recovered.code).toBe(0);
    expect(await readFile(canonical)).toEqual(candidateBytesFromArtifact(await artifactDoc(staging)));
  });

  test("an artifact whose embedded candidate was changed preserves the canonical sentinel", async () => {
    const curation = await makeCurationPath();
    const staging = stagingFor("promote-tampered");
    await generateWithCuration(curation, staging);
    const doc = await artifactDoc(staging);

    // Tamper with the candidate without updating the declared digest: reconstruction mismatches.
    const exercises = (doc["candidate"] as Record<string, unknown>)["exercises"] as Record<string, unknown>[];
    exercises[0]["name"] = "Tampered Name";
    const artifactPath = join(tempRoot, "tampered.review.json");
    await writeFile(artifactPath, JSON.stringify(doc, null, 2) + "\n");

    const canonical = join(tempRoot, "canonical/exercises.json");
    const sentinel = "sentinel-canonical-bytes";
    await seedCanonical(canonical, sentinel);
    const approvalPath = join(tempRoot, "approval.json");
    await writeApproval(approvalPath, doc["candidateSha256"] as string);

    const result = runPromote(["--artifact", artifactPath, "--approval", approvalPath, "--canonical", canonical]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("artifact-malformed");
    expect(decode(await readFile(canonical))).toBe(sentinel);
  });

  test("an artifact with a re-bound digest but a changed candidate fails the separate approval binding", async () => {
    const curation = await makeCurationPath();
    const staging = stagingFor("promote-rebound");
    await generateWithCuration(curation, staging);
    const originalDoc = await artifactDoc(staging);

    // Tamper with the candidate AND rebind the digest. The retained review rows are now stale,
    // so promotion must fail before it reads approval or writes canonical data.
    const doc = JSON.parse(JSON.stringify(originalDoc)) as Record<string, unknown>;
    const exercises = (doc["candidate"] as Record<string, unknown>)["exercises"] as Record<string, unknown>[];
    exercises[0]["name"] = "Rebound Name";
    doc["candidateSha256"] = sha256Hex(candidateBytesFromArtifact(doc));
    const artifactPath = join(tempRoot, "rebound.review.json");
    await writeFile(artifactPath, JSON.stringify(doc, null, 2) + "\n");

    const canonical = join(tempRoot, "canonical/exercises.json");
    const sentinel = "sentinel-canonical-bytes";
    await seedCanonical(canonical, sentinel);
    const approvalPath = join(tempRoot, "approval.json");
    await writeApproval(approvalPath, originalDoc["candidateSha256"] as string);

    const result = runPromote(["--artifact", artifactPath, "--approval", approvalPath, "--canonical", canonical]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("artifact-malformed");
    expect(decode(await readFile(canonical))).toBe(sentinel);
  });

  test("malformed or structurally invalid artifacts preserve the canonical sentinel", async () => {
    const curation = await makeCurationPath();
    const staging = stagingFor("promote-bad-artifact");
    await generateWithCuration(curation, staging);
    const doc = await artifactDoc(staging);
    const digest = doc["candidateSha256"] as string;

    const canonical = join(tempRoot, "canonical/exercises.json");
    const sentinel = "sentinel-canonical-bytes";
    await seedCanonical(canonical, sentinel);
    const approvalPath = join(tempRoot, "approval.json");
    await writeApproval(approvalPath, digest);

    interface ArtifactCase {
      readonly name: string;
      readonly bytes: Uint8Array | string;
      readonly code: string;
    }
    const cases: ArtifactCase[] = [
      {
        name: "unknown-key",
        bytes: JSON.stringify({ ...doc, note: "looks fine" }, null, 2) + "\n",
        code: "artifact-malformed"
      },
      {
        name: "duplicate-member",
        bytes: '{"format":"repjot/curation/review",' + decode(await artifactBytes(staging)).trimStart().slice(1),
        code: "artifact-json-invalid"
      },
      { name: "invalid-utf8", bytes: new Uint8Array([0x7b, 0xff, 0x7d]), code: "artifact-json-invalid" }
    ];
    for (const item of cases) {
      const artifactPath = join(tempRoot, "bad.review.json");
      await writeFile(artifactPath, item.bytes);
      const result = runPromote(["--artifact", artifactPath, "--approval", approvalPath, "--canonical", canonical]);
      expect(result.code, item.name + ": exit code").toBe(1);
      expect(result.stderr, item.name + ": diagnostic").toContain(item.code);
      expect(decode(await readFile(canonical)), item.name + ": sentinel").toBe(sentinel);
    }

    // A missing artifact file also fails closed.
    const missing = runPromote(["--artifact", join(tempRoot, "no-such-artifact.review.json"), "--approval", approvalPath, "--canonical", canonical]);
    expect(missing.code).toBe(1);
    expect(missing.stderr).toContain("artifact-file-missing");
    expect(decode(await readFile(canonical))).toBe(sentinel);
  });

  test("an artifact candidate failing schema validation preserves the canonical sentinel", async () => {
    const curation = await makeCurationPath();
    const staging = stagingFor("promote-schema-fail");
    await generateWithCuration(curation, staging);
    const doc = await artifactDoc(staging);

    // Invented movement pattern: review metadata is stale even when the candidate digest is rebound.
    const exercises = (doc["candidate"] as Record<string, unknown>)["exercises"] as Record<string, unknown>[];
    exercises[0]["movementPattern"] = "jump";
    doc["candidateSha256"] = sha256Hex(candidateBytesFromArtifact(doc));
    const artifactPath = join(tempRoot, "schema-bad.review.json");
    await writeFile(artifactPath, JSON.stringify(doc, null, 2) + "\n");

    const canonical = join(tempRoot, "canonical/exercises.json");
    const sentinel = "sentinel-canonical-bytes";
    await seedCanonical(canonical, sentinel);
    const approvalPath = join(tempRoot, "approval.json");
    await writeApproval(approvalPath, doc["candidateSha256"] as string);

    const result = runPromote(["--artifact", artifactPath, "--approval", approvalPath, "--canonical", canonical]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("artifact-malformed");
    expect(decode(await readFile(canonical))).toBe(sentinel);
  });

  test("an artifact candidate failing static semantic validation preserves the canonical sentinel", async () => {
    const curation = await makeCurationPath();
    const staging = stagingFor("promote-semantic-fail");
    await generateWithCuration(curation, staging);
    const doc = await artifactDoc(staging);

    // Imperial-first unit order on a weight measurement: semantic violation, digest and approval
    // re-bound to the bad bytes.
    const exercises = (doc["candidate"] as Record<string, unknown>)["exercises"] as Record<string, unknown>[];
    const bench = exercises.find((exercise) => exercise["id"] === "barbell-bench-press") as Record<string, unknown>;
    const measurements = bench["measurements"] as Record<string, unknown>[];
    for (const measurement of measurements) {
      if (measurement["dimension"] === "weight") {
        measurement["compatibleUnits"] = ["lb", "kg"];
      }
    }
    doc["candidateSha256"] = sha256Hex(candidateBytesFromArtifact(doc));
    const artifactPath = join(tempRoot, "semantic-bad.review.json");
    await writeFile(artifactPath, JSON.stringify(doc, null, 2) + "\n");

    const canonical = join(tempRoot, "canonical/exercises.json");
    const sentinel = "sentinel-canonical-bytes";
    await seedCanonical(canonical, sentinel);
    const approvalPath = join(tempRoot, "approval.json");
    await writeApproval(approvalPath, doc["candidateSha256"] as string);

    const result = runPromote(["--artifact", artifactPath, "--approval", approvalPath, "--canonical", canonical]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("candidate-semantic-invalid");
    expect(decode(await readFile(canonical))).toBe(sentinel);
  });

  test("promotion without an --approval flag is a usage error and touches nothing", async () => {
    const curation = await makeCurationPath();
    const staging = stagingFor("promote-no-flag");
    await generateWithCuration(curation, staging);
    const canonical = join(tempRoot, "canonical/exercises.json");
    const result = runPromote(["--artifact", join(staging, REVIEW_ARTIFACT_FILE_NAME), "--canonical", canonical]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("Usage error");
    expect(existsSync(canonical)).toBe(false);
  });

  test("repeated promotion and regeneration update the canonical file as one whole file", async () => {
    const checkout = await makeCheckout();
    const staging = stagingFor("promote-transition");
    const curationA = await makeCurationPath((doc) => {
      for (const entry of doc["exercises"] as Record<string, unknown>[]) {
        if (entry["sourceId"] === "Push_Up") {
          entry["movementPattern"] = "other";
        }
      }
    });
    const curationB = await makeCurationPath((doc) => {
      for (const entry of doc["exercises"] as Record<string, unknown>[]) {
        if (entry["sourceId"] === "Push_Up") {
          entry["movementPattern"] = "horizontal_push";
        }
      }
    });
    const canonical = join(tempRoot, "canonical/exercises.json");
    const approvalPath = join(tempRoot, "approval.json");

    expect(runBuild(argsFor(checkout, curationA, staging)).code).toBe(0);
    await writeApproval(approvalPath, ((await artifactDoc(staging))["candidateSha256"] as string));
    expect(runPromote(["--artifact", join(staging, REVIEW_ARTIFACT_FILE_NAME), "--approval", approvalPath, "--canonical", canonical]).code).toBe(0);
    const bytesA = await readFile(canonical);

    // Re-promoting the same artifact is a whole-file replacement with identical bytes.
    expect(runPromote(["--artifact", join(staging, REVIEW_ARTIFACT_FILE_NAME), "--approval", approvalPath, "--canonical", canonical]).code).toBe(0);
    expect(await readFile(canonical)).toEqual(bytesA);

    // A later generation plus fresh approval replaces the canonical file with the new exact bytes.
    expect(runBuild(argsFor(checkout, curationB, staging)).code).toBe(0);
    await writeApproval(approvalPath, ((await artifactDoc(staging))["candidateSha256"] as string));
    expect(runPromote(["--artifact", join(staging, REVIEW_ARTIFACT_FILE_NAME), "--approval", approvalPath, "--canonical", canonical]).code).toBe(0);
    const bytesB = await readFile(canonical);
    expect(bytesB).not.toEqual(bytesA);
  });
});

describe("P8-T01 repository and bundle safety", () => {
  test("production public files stay unchanged and candidates carry no remote references", async () => {
    expect(existsSync(join(REPO_ROOT, "src/public/exercises.json"))).toBe(false);
    expect(existsSync(join(REPO_ROOT, "src/public/workouts.json"))).toBe(false);

    const checkout = await makeCheckout();
    const curation = await makeCurationPath();
    const staging = stagingFor("safety");
    expect(runBuild(argsFor(checkout, curation, staging)).code).toBe(0);

    const doc = await artifactDoc(staging);
    const text = decode(candidateBytesFromArtifact(doc));
    expect(text).not.toContain("http://");
    expect(text).not.toContain("https://");
    expect(text).not.toContain('"images"');
    expect(text).not.toContain('"icon"');
    expect(existsSync(join(REPO_ROOT, "src/public/exercises.json"))).toBe(false);
  });

  test("separate staging locations remain independent with identical bytes", async () => {
    const checkout = await makeCheckout();
    const curation = await makeCurationPath();
    const [a, b] = await Promise.all([
      Bun.spawn({ cmd: ["bun", BUILD_SCRIPT, ...argsFor(checkout, curation, stagingFor("parallel-a"))], cwd: REPO_ROOT, stdout: "pipe", stderr: "pipe" }),
      Bun.spawn({ cmd: ["bun", BUILD_SCRIPT, ...argsFor(checkout, curation, stagingFor("parallel-b"))], cwd: REPO_ROOT, stdout: "pipe", stderr: "pipe" })
    ]);
    expect(await a.exited).toBe(0);
    expect(await b.exited).toBe(0);
    const bytesA = await artifactBytes(stagingFor("parallel-a"));
    const bytesB = await artifactBytes(stagingFor("parallel-b"));
    expect(bytesA).toEqual(bytesB);
  });

  test("the default staging artifact stays git-ignored and untracked", async () => {
    const checkout = await makeCheckout();
    const curation = await makeCurationPath();
    try {
      // No --staging: the fixed safe default is the repository-root .curation-staging directory.
      const result = runBuild(["--source", checkout, "--curation", curation]);
      expect(result.code).toBe(0);
      const artifact = join(REPO_ROOT, ".curation-staging", REVIEW_ARTIFACT_FILE_NAME);
      expect(existsSync(artifact)).toBe(true);
      const ignored = Bun.spawnSync({ cmd: ["git", "check-ignore", "-q", ".curation-staging/exercises.review.json"], cwd: REPO_ROOT });
      expect(ignored.exitCode).toBe(0);
    } finally {
      await rm(join(REPO_ROOT, ".curation-staging"), { recursive: true, force: true });
    }
  });
});

describe("P8-T01 schema ownership and edge depth", () => {
  test("the candidate conforms to the exercises v1 schema and invented values are rejected", async () => {
    const checkout = await makeCheckout();
    const curation = await makeCurationPath();
    const staging = stagingFor("schema");
    expect(runBuild(argsFor(checkout, curation, staging)).code).toBe(0);

    const candidate = (await artifactDoc(staging))["candidate"] as Record<string, unknown>;
    const validator = createProductionValidator();
    expect(validator.validate("exercises", 1, candidate).valid).toBe(true);

    const inventedEnum = JSON.parse(JSON.stringify(candidate)) as Record<string, unknown>;
    (inventedEnum["exercises"] as Record<string, unknown>[])[0]["movementPattern"] = "jump";
    expect(validator.validate("exercises", 1, inventedEnum).valid).toBe(false);

    const inventedProperty = JSON.parse(JSON.stringify(candidate)) as Record<string, unknown>;
    (inventedProperty["exercises"] as Record<string, unknown>[])[0]["mood"] = "grumpy";
    expect(validator.validate("exercises", 1, inventedProperty).valid).toBe(false);
  });

  test("canonical ID collisions from alternate source representations fail closed", () => {
    const parsedA = parseSourceExercise(exerciseDoc({ id: "A_B" }));
    const parsedB = parseSourceExercise(exerciseDoc({ id: "A-B" }));
    expect(parsedA.ok).toBe(true);
    expect(parsedB.ok).toBe(true);
    const curation = parseCurationDocument({
      format: "repjot/curation/exercises",
      schemaVersion: 1,
      equipment: [],
      exercises: [curationEntry({ sourceId: "A_B" }), curationEntry({ sourceId: "A-B" })]
    });
    expect(curation.ok).toBe(true);
    if (!parsedA.ok || !parsedB.ok || !curation.ok) {
      throw new Error("fixture setup failed");
    }
    const result = transformExercises([parsedA.exercise, parsedB.exercise], curation.document);
    expect(result.diagnostics.map((item) => item.code)).toContain("source-duplicate-id");
  });

  test("malformed nested arrays fail closed with the field named", () => {
    const numericMuscle = parseSourceExercise(exerciseDoc({ primaryMuscles: [3] }));
    expect(numericMuscle.ok).toBe(false);
    if (!numericMuscle.ok) {
      expect(numericMuscle.diagnostics.map((item) => item.code)).toContain("source-field-invalid");
    }

    const nestedMuscle = parseSourceExercise(exerciseDoc({ secondaryMuscles: [["chest"]] }));
    expect(nestedMuscle.ok).toBe(false);
    if (!nestedMuscle.ok) {
      expect(nestedMuscle.diagnostics.map((item) => item.code)).toContain("source-field-invalid");
    }

    const nonArrayInstructions = parseSourceExercise(exerciseDoc({ instructions: "Do it." }));
    expect(nonArrayInstructions.ok).toBe(false);
  });

  test("conditional load semantics are enforced on curation input", () => {
    const withWeightNoSemantics = parseCurationDocument({
      format: "repjot/curation/exercises",
      schemaVersion: 1,
      equipment: [],
      exercises: [curationEntry({ measurements: [{ dimension: "weight", compatibleUnits: ["kg"] }] })]
    });
    expect(withWeightNoSemantics.ok).toBe(false);
    if (!withWeightNoSemantics.ok) {
      expect(withWeightNoSemantics.diagnostics.map((item) => item.code)).toContain("curation-load-semantics-invalid");
    }

    const addedWeightWrongSemantic = parseCurationDocument({
      format: "repjot/curation/exercises",
      schemaVersion: 1,
      equipment: [],
      exercises: [
        curationEntry({
          measurements: [{ dimension: "addedWeight", compatibleUnits: ["kg"] }],
          loadSemantics: "total"
        })
      ]
    });
    expect(addedWeightWrongSemantic.ok).toBe(false);

    const assistedWeightCorrect = parseCurationDocument({
      format: "repjot/curation/exercises",
      schemaVersion: 1,
      equipment: [],
      exercises: [
        curationEntry({
          measurements: [{ dimension: "assistedWeight", compatibleUnits: ["kg"] }],
          loadSemantics: "assisted"
        })
      ]
    });
    expect(assistedWeightCorrect.ok).toBe(true);

    const semanticsWithoutLoadDimension = parseCurationDocument({
      format: "repjot/curation/exercises",
      schemaVersion: 1,
      equipment: [],
      exercises: [curationEntry({ loadSemantics: "total" })]
    });
    expect(semanticsWithoutLoadDimension.ok).toBe(false);

    const incompatibleUnit = parseCurationDocument({
      format: "repjot/curation/exercises",
      schemaVersion: 1,
      equipment: [],
      exercises: [curationEntry({ measurements: [{ dimension: "weight", compatibleUnits: ["m"] }] })]
    });
    expect(incompatibleUnit.ok).toBe(false);
    if (!incompatibleUnit.ok) {
      expect(incompatibleUnit.diagnostics.map((item) => item.code)).toContain("curation-measurement-invalid");
    }
  });

  test("a wrong curation envelope fails closed before any transform", () => {
    const wrongFormat = parseCurationDocument({
      format: "repjot/curation/workouts",
      schemaVersion: 1,
      equipment: [],
      exercises: []
    });
    expect(wrongFormat.ok).toBe(false);
    if (!wrongFormat.ok) {
      expect(wrongFormat.diagnostics.map((item) => item.code)).toContain("curation-format-invalid");
    }

    const wrongVersion = parseCurationDocument({
      format: "repjot/curation/exercises",
      schemaVersion: 2,
      equipment: [],
      exercises: []
    });
    expect(wrongVersion.ok).toBe(false);

    const notAnObject = parseCurationDocument(["nope"]);
    expect(notAnObject.ok).toBe(false);
  });

  test("approval parsing rejects unknown keys and wrong digests", () => {
    const valid = parseApproval({ format: "repjot/curation/approval", schemaVersion: 1, candidateSha256: "b".repeat(64) });
    expect(valid.ok).toBe(true);

    const unknownKey = parseApproval({ format: "repjot/curation/approval", schemaVersion: 1, candidateSha256: "b".repeat(64), note: "looks fine" });
    expect(unknownKey.ok).toBe(false);
    if (!unknownKey.ok) {
      expect(unknownKey.diagnostics.map((item) => item.code)).toContain("approval-malformed");
    }

    const uppercaseDigest = parseApproval({ format: "repjot/curation/approval", schemaVersion: 1, candidateSha256: "B".repeat(64) });
    expect(uppercaseDigest.ok).toBe(false);
  });
});

describe("P08-D003 review artifact module (unit)", () => {
  function syntheticCandidate(): CandidateDocument {
    return {
      format: "repjot/exercises",
      schemaVersion: 1,
      equipment: [{ id: "barbell", name: "Barbell" }],
      exercises: [
        {
          id: "bench-press",
          name: "Bench Press",
          instructions: ["Press."],
          equipmentIds: ["barbell"],
          force: "push",
          mechanic: "compound",
          category: "strength",
          movementPattern: "horizontal_push",
          primaryMuscles: ["chest"],
          secondaryMuscles: [],
          laterality: "bilateral",
          measurements: [
            { dimension: "reps", compatibleUnits: ["rep"] },
            { dimension: "weight", compatibleUnits: ["kg", "lb"] }
          ],
          loadSemantics: "total"
        }
      ]
    };
  }

  function syntheticCuration() {
    return parseCurationDocument({
      format: "repjot/curation/exercises",
      schemaVersion: 1,
      equipment: [{ id: "barbell", name: "Barbell", source: "barbell" }],
      exercises: [
        {
          sourceId: "Bench_Press",
          laterality: "bilateral",
          movementPattern: "horizontal_push",
          measurements: [
            { dimension: "reps", compatibleUnits: ["rep"] },
            { dimension: "weight", compatibleUnits: ["lb", "kg"] }
          ],
          loadSemantics: "total"
        }
      ]
    });
  }

  test("build and parse round-trip to byte-identical, digest-bound artifacts", () => {
    const curation = syntheticCuration();
    if (!curation.ok) throw new Error("fixture setup failed");
    const built = buildReviewArtifact(syntheticCandidate());
    const parsed = parseReviewArtifact(JSON.parse(decode(built.bytes)));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(new TextEncoder().encode(JSON.stringify(parsed.artifact.document, null, 2) + "\n")).toEqual(built.bytes);
    expect(parsed.artifact.candidateSha256).toBe(sha256Hex(parsed.artifact.candidateBytes));
    expect(decode(parsed.artifact.candidateBytes)).toBe(JSON.stringify(built.document.candidate, null, 2) + "\n");
  });

  test("review metadata is derived exactly from the embedded candidate", () => {
    const built = buildReviewArtifact(syntheticCandidate());
    const doc = JSON.parse(decode(built.bytes)) as Record<string, unknown>;
    const equipment = doc["equipment"] as Record<string, unknown>[];
    const exercises = doc["exercises"] as Record<string, unknown>[];
    const cases: Array<[string, (value: Record<string, unknown>) => void]> = [
      ["equipmentCount", (value) => { value["equipmentCount"] = 999; }],
      ["candidateExerciseCount", (value) => { value["candidateExerciseCount"] = 999; }],
      ["equipment id", (value) => { (value["equipment"] as Record<string, unknown>[])[0]["id"] = "forged"; }],
      ["equipment name", (value) => { (value["equipment"] as Record<string, unknown>[])[0]["name"] = "CONTROL TEXT"; }],
      ["exercise id", (value) => { (value["exercises"] as Record<string, unknown>[])[0]["id"] = "forged"; }],
      ["exercise name", (value) => { (value["exercises"] as Record<string, unknown>[])[0]["name"] = "FORGED"; }],
      ["equipment IDs", (value) => { (value["exercises"] as Record<string, unknown>[])[0]["equipmentIds"] = ["forged"]; }],
      ["movement pattern", (value) => { (value["exercises"] as Record<string, unknown>[])[0]["movementPattern"] = "forged"; }],
      ["laterality", (value) => { (value["exercises"] as Record<string, unknown>[])[0]["laterality"] = "forged"; }],
      ["load semantics", (value) => { (value["exercises"] as Record<string, unknown>[])[0]["loadSemantics"] = "forged"; }],
      ["reordered equipment rows", (value) => { value["equipment"] = [{ id: "forged", name: "FORGED" }, ...(value["equipment"] as unknown[])]; }],
      ["reordered exercise rows", (value) => { value["exercises"] = [{ id: "forged", name: "FORGED", equipmentIds: [], movementPattern: "forged", laterality: "forged", loadSemantics: null }, ...(value["exercises"] as unknown[])]; }],
      ["extra exercise row", (value) => { value["exercises"] = [...(value["exercises"] as unknown[]), exercises[0]]; }],
      ["missing exercise row", (value) => { value["exercises"] = []; }]
    ];
    // Keep the source document in scope to make clear that no curation/provenance is checked.
    expect(equipment.length).toBeGreaterThanOrEqual(1);
    for (const [name, mutate] of cases) {
      const forged = JSON.parse(JSON.stringify(doc)) as Record<string, unknown>;
      mutate(forged);
      expect(parseReviewArtifact(forged).ok, name).toBe(false);
    }
    expect(parseReviewArtifact(doc).ok).toBe(true);
  });

  test("equivalent curation input order produces byte-identical artifacts", () => {
    const base = syntheticCuration();
    if (!base.ok) throw new Error("fixture setup failed");
    const a = buildReviewArtifact(syntheticCandidate());
    // Reorder the measurements array and units: equivalent semantic curation.
    const reordered = parseCurationDocument({
      format: "repjot/curation/exercises",
      schemaVersion: 1,
      equipment: [{ id: "barbell", name: "Barbell", source: "barbell" }],
      exercises: [
        {
          sourceId: "Bench_Press",
          laterality: "bilateral",
          movementPattern: "horizontal_push",
          measurements: [
            { dimension: "weight", compatibleUnits: ["lb", "kg"] },
            { dimension: "reps", compatibleUnits: ["rep"] }
          ],
          loadSemantics: "total"
        }
      ]
    });
    if (!reordered.ok) throw new Error("fixture setup failed");
    const b = buildReviewArtifact(syntheticCandidate());
    expect(b.bytes).toEqual(a.bytes);
  });

  test("envelope violations fail closed", () => {
    const curation = syntheticCuration();
    if (!curation.ok) throw new Error("fixture setup failed");
    const built = buildReviewArtifact(syntheticCandidate());
    const doc = JSON.parse(decode(built.bytes)) as Record<string, unknown>;

    const unknownKey = parseReviewArtifact({ ...doc, note: "hi" });
    expect(unknownKey.ok).toBe(false);
    expect(parseReviewArtifact({ ...doc, sourceExerciseCount: 999 }).ok).toBe(false);
    expect(parseReviewArtifact({ ...doc, curationMeaningSha256: "0".repeat(64) }).ok).toBe(false);
    if (!unknownKey.ok) {
      expect(unknownKey.diagnostics.map((item) => item.code)).toContain("artifact-malformed");
    }

    const missingKey = { ...doc };
    delete missingKey["equipmentCount"];
    expect(parseReviewArtifact(missingKey).ok).toBe(false);

    const wrongFormat = parseReviewArtifact({ ...doc, format: "repjot/curation/review-report" });
    expect(wrongFormat.ok).toBe(false);

    const wrongVersion = parseReviewArtifact({ ...doc, schemaVersion: 2 });
    expect(wrongVersion.ok).toBe(false);

    const notAnObject = parseReviewArtifact(["nope"]);
    expect(notAnObject.ok).toBe(false);

    const badDigestShape = parseReviewArtifact({ ...doc, candidateSha256: "not-a-digest" });
    expect(badDigestShape.ok).toBe(false);
  });

  test("a changed embedded candidate fails the digest binding", () => {
    const curation = syntheticCuration();
    if (!curation.ok) throw new Error("fixture setup failed");
    const built = buildReviewArtifact(syntheticCandidate());
    const doc = JSON.parse(decode(built.bytes)) as Record<string, unknown>;

    // Content change with the original declared digest.
    const byContent = parseReviewArtifact({
      ...doc,
      candidate: (() => {
        const candidate = JSON.parse(JSON.stringify(doc["candidate"])) as Record<string, unknown>;
        (candidate["exercises"] as Record<string, unknown>[])[0]["name"] = "Changed";
        return candidate;
      })()
    });
    expect(byContent.ok).toBe(false);
    if (!byContent.ok) {
      expect(byContent.diagnostics[0].message).toContain("does not match candidateSha256");
    }

    // Equivalent content but reordered top-level candidate keys changes the reconstructed bytes.
    const reorderedCandidate = (() => {
      const original = JSON.parse(JSON.stringify(doc["candidate"])) as Record<string, unknown>;
      const reversed: Record<string, unknown> = {};
      for (const key of Object.keys(original).reverse()) reversed[key] = original[key];
      return reversed;
    })();
    const byKeyOrder = parseReviewArtifact({ ...doc, candidate: reorderedCandidate });
    expect(byKeyOrder.ok).toBe(false);
  });

  test("the exported artifact file name is the one ignored default artifact", async () => {
    expect(REVIEW_ARTIFACT_FILE_NAME).toBe("exercises.review.json");
    const ignore = decode(await readFile(join(REPO_ROOT, ".gitignore")));
    expect(ignore.split("\n")).toContain(".curation-staging/");
  });
});

describe("P08-D003 atomic write (unit)", () => {
  test("writeAtomicFile creates and replaces atomically without leaving temporaries", async () => {
    const dir = join(tempRoot, "atomic");
    await mkdir(dir, { recursive: true });
    const target = join(dir, "out.json");
    await writeAtomicFile(target, new TextEncoder().encode("one"), "staging-write-failed");
    expect(decode(await readFile(target))).toBe("one");
    await writeAtomicFile(target, new TextEncoder().encode("two"), "staging-write-failed");
    expect(decode(await readFile(target))).toBe("two");
    const entries = await readdir(dir);
    expect(entries.filter((name) => name.includes(".tmp-"))).toEqual([]);
  });

  test("writeAtomicFile refuses non-regular targets and leaves the prior file unchanged", async () => {
    const dir = join(tempRoot, "atomic-bad");
    await mkdir(join(dir, "out.json"), { recursive: true }); // target exists as a directory
    let caught: unknown = null;
    try {
      await writeAtomicFile(join(dir, "out.json"), new TextEncoder().encode("x"), "canonical-write-failed");
    } catch (error) {
      caught = error;
    }
    expect(caught instanceof OutputWriteError).toBe(true);
    if (caught instanceof OutputWriteError) {
      expect(caught.code).toBe("output-path-unsafe");
    }
    const entries = await readdir(dir);
    expect(entries.filter((name) => name.includes(".tmp-"))).toEqual([]);
  });

  test("writeAtomicFile fails safely when the destination is not a directory", async () => {
    const parent = join(tempRoot, "parent-file");
    await writeFile(parent, "not a dir");
    let threw = false;
    try {
      await writeAtomicFile(join(parent, "x.json"), new TextEncoder().encode("x"), "staging-write-failed");
    } catch (error) {
      threw = error instanceof OutputWriteError;
    }
    expect(threw).toBe(true);
  });

  test("open EEXIST is unowned, while every post-open failure removes its owned path", async () => {
    const dir = join(tempRoot, "ownership");
    await mkdir(dir, { recursive: true });
    const target = join(dir, "out.json");
    const collision = join(dir, ".out.json.tmp-" + process.pid + "-0");
    await writeFile(collision, "pre-existing collision");

    await writeAtomicFile(target, new TextEncoder().encode("ok"), "write-failed");
    expect(decode(await readFile(target))).toBe("ok");
    expect(decode(await readFile(collision))).toBe("pre-existing collision");

    const failures: AtomicWriteHooks[] = [
      { open: async () => { throw Object.assign(new Error("open failed"), { code: "EACCES" }); } },
      { writeFile: async (handle, bytes) => { await handle.writeFile(bytes.subarray(0, 1)); throw new Error("write failed"); } },
      { sync: async () => { throw new Error("sync failed"); } },
      { close: async (handle) => { await handle.close(); throw new Error("close failed"); } }
    ];
    for (const hooks of failures) {
      let caught: unknown = null;
      try {
        await writeAtomicFile(join(dir, "failure-" + failures.indexOf(hooks) + ".json"), new TextEncoder().encode("payload"), "write-failed", hooks);
      } catch (error) {
        caught = error;
      }
      expect(caught instanceof OutputWriteError).toBe(true);
      expect(await tempLitter(dir)).toEqual([collision.split("/").pop()]);
    }
  });

  test("destination recheck and rename failure preserve the prior target and remove the owned temporary", async () => {
    const dir = join(tempRoot, "late-failure");
    await mkdir(dir, { recursive: true });
    const target = join(dir, "out.json");
    await writeFile(target, "sentinel");

    let inspections = 0;
    const recheckHooks: AtomicWriteHooks = {
      inspectTarget: async () => {
        inspections += 1;
        return inspections === 1 ? null : "destination changed";
      }
    };
    await expect(writeAtomicFile(target, new TextEncoder().encode("new"), "write-failed", recheckHooks)).rejects.toBeInstanceOf(OutputWriteError);
    expect(decode(await readFile(target))).toBe("sentinel");
    expect(await tempLitter(dir)).toEqual([]);

    const renameHooks: AtomicWriteHooks = { rename: async () => { throw new Error("rename failed"); } };
    await expect(writeAtomicFile(target, new TextEncoder().encode("new"), "write-failed", renameHooks)).rejects.toBeInstanceOf(OutputWriteError);
    expect(decode(await readFile(target))).toBe("sentinel");
    expect(await tempLitter(dir)).toEqual([]);
  });

  test("eight repeated handled write failures leave no temporary names and a corrected rerun succeeds", async () => {
    const dir = join(tempRoot, "recovery");
    await mkdir(dir, { recursive: true });
    const target = join(dir, "out.json");
    await writeFile(target, "sentinel");
    const failingHooks: AtomicWriteHooks = { writeFile: async () => { throw new Error("injected write failure"); } };

    for (let attempt = 0; attempt < 8; attempt += 1) {
      await expect(writeAtomicFile(target, new TextEncoder().encode("new"), "write-failed", failingHooks)).rejects.toBeInstanceOf(OutputWriteError);
      expect(decode(await readFile(target))).toBe("sentinel");
      expect(await tempLitter(dir)).toEqual([]);
    }
    await writeAtomicFile(target, new TextEncoder().encode("corrected"), "write-failed");
    expect(decode(await readFile(target))).toBe("corrected");
    expect(await tempLitter(dir)).toEqual([]);
  });
});

describe("P08-D005 exact JSON ingress parser (unit)", () => {
  function utf8(text: string): Uint8Array {
    return new TextEncoder().encode(text);
  }

  test("valid strict JSON round-trips to the same value", () => {
    const text =
      '{"a":[-0,0.5,true,null],"b":[1,{"s":"\\ud800","u":"caf\\u00e9"}],"deep":' +
      "[".repeat(50) +
      "]".repeat(50) +
      "}";
    const result = parseExactJson(utf8(text));
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value).toEqual(JSON.parse(text));
  });

  test("invalid UTF-8 bytes fail with the byte offset instead of U+FFFD", () => {
    const stray = new Uint8Array([0x7b, 0x22, 0xff, 0x22, 0x3a, 0x31, 0x7d]);
    const result = parseExactJson(stray);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.detail).toContain("invalid UTF-8");
      expect(result.detail).toContain("byte offset 2");
    }

    const truncatedMultibyte = new Uint8Array([0xe2, 0x82]);
    const truncated = parseExactJson(truncatedMultibyte);
    expect(truncated.ok).toBe(false);
    if (!truncated.ok) {
      expect(truncated.detail).toContain("byte offset 0");
    }
  });

  test("overlong, surrogate, and out-of-range UTF-8 encodings fail", () => {
    const overlong = parseExactJson(new Uint8Array([0xc0, 0xaf]));
    expect(overlong.ok).toBe(false);
    const surrogate = parseExactJson(new Uint8Array([0xed, 0xa0, 0x80]));
    expect(surrogate.ok).toBe(false);
    const beyondRange = parseExactJson(new Uint8Array([0xf4, 0x90, 0x80, 0x80]));
    expect(beyondRange.ok).toBe(false);
    const strayContinuation = parseExactJson(new Uint8Array([0x7b, 0x80]));
    expect(strayContinuation.ok).toBe(false);
  });

  test("a leading byte-order mark fails with its own diagnostic", () => {
    const withBom = new Uint8Array([
      0xef, 0xbb, 0xbf, ...new TextEncoder().encode("{}")
    ]);
    const result = parseExactJson(withBom);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.detail).toContain("byte-order mark");
    }
  });

  test("duplicate members fail at every nesting level, in both stale and valid orders", () => {
    const top = parseExactJson(utf8('{"a":1,"a":2}'));
    expect(top.ok).toBe(false);
    if (!top.ok) {
      expect(top.detail).toContain('duplicate member "a"');
    }

    const nested = parseExactJson(utf8('{"o":{"b":1,"b":2}}'));
    expect(nested.ok).toBe(false);
    if (!nested.ok) {
      expect(nested.detail).toContain('duplicate member "b"');
    }

    // Stale-then-valid and valid-then-stale are both ambiguous: neither may resolve last-wins.
    const staleThenValid = parseExactJson(utf8('{"candidateSha256":"' + "0".repeat(64) + '","candidateSha256":"' + "f".repeat(64) + '"}'));
    expect(staleThenValid.ok).toBe(false);
    const validThenStale = parseExactJson(utf8('{"candidateSha256":"' + "f".repeat(64) + '","candidateSha256":"' + "0".repeat(64) + '"}'));
    expect(validThenStale.ok).toBe(false);
  });

  test("out-of-range numbers and engine-only tokens fail", () => {
    expect(parseExactJson(utf8('{"x":1e400}')).ok).toBe(false);
    const negative = parseExactJson(utf8('{"x":-1e400}'));
    expect(negative.ok).toBe(false);
    if (!negative.ok) {
      expect(negative.detail).toContain("finite");
    }
    expect(parseExactJson(utf8("NaN")).ok).toBe(false);
    expect(parseExactJson(utf8("Infinity")).ok).toBe(false);
    expect(parseExactJson(utf8("-Infinity")).ok).toBe(false);
  });

  test("grammar violations fail: trailing content, empty input, escapes, leading zeros, trailing commas", () => {
    expect(parseExactJson(utf8("{} x")).ok).toBe(false);
    expect(parseExactJson(utf8("[1][2]")).ok).toBe(false);
    expect(parseExactJson(utf8("")).ok).toBe(false);
    expect(parseExactJson(utf8("  \t \n ")).ok).toBe(false);
    expect(parseExactJson(utf8('"a\nb"')).ok).toBe(false); // raw control character in a string
    expect(parseExactJson(utf8('"\\q"')).ok).toBe(false);
    expect(parseExactJson(utf8('"\\u12G4"')).ok).toBe(false);
    expect(parseExactJson(utf8("01")).ok).toBe(false);
    const minusZero = parseExactJson(utf8("-0"));
    expect(minusZero.ok).toBe(true);
    if (minusZero.ok) {
      // -0 must survive parsing exactly as JSON.parse preserves it.
      expect(Object.is(minusZero.value, -0)).toBe(true);
    }
    expect(parseExactJson(utf8("[1,]")).ok).toBe(false);
    expect(parseExactJson(utf8('{"a":1,}')).ok).toBe(false);
    // Whitespace after the top-level value is fine.
    expect(parseExactJson(utf8("{}\n")).ok).toBe(true);
  });
});

describe("P08-D005 command-level ingress (negative, recovery, state transition)", () => {
  async function withBadByteInValue(checkout: string, fileName: string, marker: string): Promise<void> {
    const original = decode(await readFile(join(checkout, "exercises", fileName)));
    const idx = original.indexOf(marker);
    if (idx === -1) {
      throw new Error("marker not found in " + fileName + ": " + marker);
    }
    const before = new TextEncoder().encode(original.slice(0, idx + 1));
    const after = new TextEncoder().encode(original.slice(idx + 2));
    const out = new Uint8Array(before.length + 1 + after.length);
    out.set(before, 0);
    out[before.length] = 0xff;
    out.set(after, before.length + 1);
    await writeFile(join(checkout, "exercises", fileName), out);
  }

  test("a malformed byte inside a source name string fails closed and publishes nothing", async () => {
    const checkout = await makeCheckout();
    await withBadByteInValue(checkout, "Push_Up.json", "Push-Up");
    const curation = await makeCurationPath();
    const staging = stagingFor("source-bad-byte");
    const result = runBuild(argsFor(checkout, curation, staging));
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("source-json-invalid");
    expect(result.stderr).toContain("Push_Up.json");
    expect(result.stderr).toContain("invalid UTF-8");
    expect(existsSync(join(staging, REVIEW_ARTIFACT_FILE_NAME))).toBe(false);
  });

  test("a duplicate member inside a source file fails before structural validation", async () => {
    const checkout = await makeCheckout();
    const original = decode(await readFile(join(checkout, "exercises", "Lat_Pulldown.json")));
    // First stale ID, second valid ID: last-wins parsing would have published this file.
    await writeFile(join(checkout, "exercises", "Lat_Pulldown.json"), '{"id":"Ghost_Duplicate",' + original.slice(1));
    const curation = await makeCurationPath();
    const staging = stagingFor("source-dup-member");
    const result = runBuild(argsFor(checkout, curation, staging));
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("source-json-invalid");
    expect(result.stderr).toContain("Lat_Pulldown.json");
    expect(result.stderr).toContain('duplicate member "id"');
    expect(existsSync(join(staging, REVIEW_ARTIFACT_FILE_NAME))).toBe(false);
  });

  test("a malformed byte in the curation file fails closed and a corrected input recovers", async () => {
    const checkout = await makeCheckout();
    const staging = stagingFor("curation-bad-byte");
    const originalText = decode(await readFile(FIXTURE_CURATION));
    const cleanPath = join(tempRoot, "clean.curation.json");
    await writeFile(cleanPath, originalText);

    // Insert a raw 0xff byte inside the "format" value string of an otherwise valid document.
    const prefix = new TextEncoder().encode(originalText.slice(0, 40));
    const suffix = new TextEncoder().encode(originalText.slice(41));
    const badBytes = new Uint8Array(prefix.length + 1 + suffix.length);
    badBytes.set(prefix, 0);
    badBytes[prefix.length] = 0xff;
    badBytes.set(suffix, prefix.length + 1);
    const badPath = join(tempRoot, "bad.curation.json");
    await writeFile(badPath, badBytes);

    const failed = runBuild(argsFor(checkout, badPath, staging));
    expect(failed.code).toBe(1);
    expect(failed.stderr).toContain("curation-json-invalid");
    expect(failed.stderr).toContain("invalid UTF-8");
    expect(existsSync(join(staging, REVIEW_ARTIFACT_FILE_NAME))).toBe(false);

    const recovered = runBuild(argsFor(checkout, cleanPath, staging));
    expect(recovered.code).toBe(0);
    expect(existsSync(join(staging, REVIEW_ARTIFACT_FILE_NAME))).toBe(true);
  });

  test("duplicate curation members fail before curation semantics even when the last member is valid", async () => {
    const checkout = await makeCheckout();
    const originalText = decode(await readFile(FIXTURE_CURATION));
    const duplicatePath = join(tempRoot, "dup.curation.json");
    // First stale schemaVersion, second valid: last-wins parsing would have passed the envelope check.
    await writeFile(duplicatePath, '{"schemaVersion":9,' + originalText.slice(1));
    const staging = stagingFor("curation-dup-member");
    const result = runBuild(argsFor(checkout, duplicatePath, staging));
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("curation-json-invalid");
    expect(result.stderr).toContain('duplicate member "schemaVersion"');
    expect(existsSync(join(staging, REVIEW_ARTIFACT_FILE_NAME))).toBe(false);
  });

  test("duplicate approval members fail at promotion and a corrected approval promotes", async () => {
    const checkout = await makeCheckout();
    const curation = await makeCurationPath();
    const staging = stagingFor("approval-dup-member");
    expect(runBuild(argsFor(checkout, curation, staging)).code).toBe(0);
    const doc = await artifactDoc(staging);
    const digest = doc["candidateSha256"] as string;
    const stale = "0".repeat(64);

    const canonical = join(tempRoot, "canonical/exercises.json");
    const sentinel = "sentinel-canonical-bytes";
    await seedCanonical(canonical, sentinel);
    const approvalPath = join(tempRoot, "approval.json");

    // Reproduction: first stale digest, second valid digest must not resolve last-wins.
    await writeFile(approvalPath, '{"format":"repjot/curation/approval","schemaVersion":1,"candidateSha256":"' + stale + '","candidateSha256":"' + digest + '"}');
    const failed = runPromote(["--artifact", join(staging, REVIEW_ARTIFACT_FILE_NAME), "--approval", approvalPath, "--canonical", canonical]);
    expect(failed.code).toBe(1);
    expect(failed.stderr).toContain("approval-json-invalid");
    expect(failed.stderr).toContain('duplicate member "candidateSha256"');
    expect(decode(await readFile(canonical))).toBe(sentinel);

    // The reversed order is ambiguous too.
    await writeFile(approvalPath, '{"format":"repjot/curation/approval","schemaVersion":1,"candidateSha256":"' + digest + '","candidateSha256":"' + stale + '"}');
    const reversed = runPromote(["--artifact", join(staging, REVIEW_ARTIFACT_FILE_NAME), "--approval", approvalPath, "--canonical", canonical]);
    expect(reversed.code).toBe(1);
    expect(decode(await readFile(canonical))).toBe(sentinel);

    // Recovery and state transition: a single valid member promotes the exact candidate bytes.
    await writeFile(approvalPath, JSON.stringify({ format: "repjot/curation/approval", schemaVersion: 1, candidateSha256: digest }));
    const recovered = runPromote(["--artifact", join(staging, REVIEW_ARTIFACT_FILE_NAME), "--approval", approvalPath, "--canonical", canonical]);
    expect(recovered.code).toBe(0);
    expect(await readFile(canonical)).toEqual(candidateBytesFromArtifact(doc));
  });

  test("a malformed byte in the approval file fails closed and never writes the canonical target", async () => {
    const checkout = await makeCheckout();
    const curation = await makeCurationPath();
    const staging = stagingFor("approval-bad-byte");
    expect(runBuild(argsFor(checkout, curation, staging)).code).toBe(0);

    const canonical = join(tempRoot, "canonical/exercises.json");
    const sentinel = "sentinel-canonical-bytes";
    await seedCanonical(canonical, sentinel);
    const approvalPath = join(tempRoot, "approval.json");
    await writeFile(approvalPath, new Uint8Array([0x7b, 0xff, 0x7d]));
    const result = runPromote(["--artifact", join(staging, REVIEW_ARTIFACT_FILE_NAME), "--approval", approvalPath, "--canonical", canonical]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("approval-json-invalid");
    expect(result.stderr).toContain("invalid UTF-8");
    expect(decode(await readFile(canonical))).toBe(sentinel);
  });
});
