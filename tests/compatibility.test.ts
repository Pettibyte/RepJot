/**
 * P9-T01 — Static-data compatibility boundary tests.
 *
 * Covers every public acceptance category from docs/implementation/phase-09-acceptance.md:
 * blank first release, compatible/reordered future releases, forbidden identity changes with
 * stable codes, additions and newly deprecated impact reporting, the separate approval-bound
 * baseline recording action, and deterministic no-network behavior. Fixture bytes under
 * tests/fixtures/compatibility are untrusted input; each test reads them as exact bytes.
 */
import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  COMPATIBILITY_MESSAGES,
  buildBaselineBytes,
  compareStaticBundles,
  extractBundleIdentity,
  parseBaselineApproval,
  parseBaselineDocument,
  sha256Hex
} from "../src/compatibility/compare-static-data";
import { makeNodeIo, runCompareProduction } from "../scripts/compare-production";

const FIXTURE_ROOT = join(import.meta.dir, "fixtures", "compatibility");
const REPO_ROOT = join(import.meta.dir, "..");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function readFixtureValue(fixture: string, side: string, name: string): Promise<unknown> {
  const bytes = new Uint8Array(await readFile(join(FIXTURE_ROOT, fixture, side, name)));
  // The exact parser is the ingress boundary; reuse it so tests exercise the same path.
  const { parseBundleBytes } = await import("../src/compatibility/compare-static-data");
  const parsed = parseBundleBytes(bytes);
  if (!parsed.ok) throw new Error("fixture " + fixture + "/" + side + "/" + name + " is not exact JSON: " + parsed.detail);
  return parsed.value;
}

async function loadPair(fixture: string): Promise<{ prior: readonly [unknown, unknown]; current: readonly [unknown, unknown] }> {
  const priorEx = await readFixtureValue(fixture, "prior", "exercises.json");
  const priorWk = await readFixtureValue(fixture, "prior", "workouts.json");
  const curEx = await readFixtureValue(fixture, "current", "exercises.json");
  const curWk = await readFixtureValue(fixture, "current", "workouts.json");
  return { prior: [priorEx, priorWk], current: [curEx, curWk] };
}

function codes(report: { diagnostics: readonly { code: string }[] }): string[] {
  return report.diagnostics.map((d) => d.code);
}

/** In-memory I/O for the whole command; records every fetch attempt and write. */
function memIo(files: Map<string, Uint8Array>, fetched?: Record<string, Uint8Array>) {
  const outLines: string[] = [];
  const errLines: string[] = [];
  const fetchCalls: string[] = [];
  const reads: string[] = [];
  const writes: (readonly [string, Uint8Array])[] = [];
  return {
    io: {
      readBytes: async (path: string): Promise<Uint8Array | null> => {
        reads.push(path);
        const found = files.get(path);
        return found === undefined ? null : found;
      },
      pathExists: async (path: string): Promise<boolean> => files.has(path),
      ensureDirectory: async (_path: string): Promise<void> => undefined,
      writeAtomic: async (path: string, bytes: Uint8Array): Promise<void> => {
        writes.push([path, bytes]);
        files.set(path, bytes);
      },
      fetchUrl: async (url: string): Promise<Uint8Array | null> => {
        fetchCalls.push(url);
        return fetched !== undefined && url in fetched ? fetched[url] : null;
      },
      out: (line: string): void => {
        outLines.push(line);
      },
      err: (line: string): void => {
        errLines.push(line);
      }
    },
    out: () => outLines,
    err: () => errLines,
    fetchCalls: () => fetchCalls,
    reads: () => reads,
    writes: () => writes
  };
}

async function fixtureIo(fixture: string) {
  const files = new Map<string, Uint8Array>();
  for (const side of ["current", "prior"]) {
    for (const name of ["exercises.json", "workouts.json"]) {
      const path = join(FIXTURE_ROOT, fixture, side, name);
      try {
        files.set(path, new Uint8Array(await readFile(path)));
      } catch (_error) {
        // Absent file: the command must fail closed for it.
      }
    }
  }
  return memIo(files);
}

function baseBundle(): { exercises: unknown; workouts: unknown } {
  const ex = JSON.parse(
    JSON.stringify({
      format: "repjot/exercises",
      schemaVersion: 1,
      equipment: [{ id: "barbell", name: "Barbell" }],
      exercises: [
        {
          id: "plank",
          name: "Plank",
          instructions: [],
          equipmentIds: [],
          force: "static",
          mechanic: "isolation",
          category: "cardio",
          movementPattern: "anti_rotation",
          primaryMuscles: ["abdominals"],
          secondaryMuscles: [],
          laterality: "bilateral",
          measurements: [{ dimension: "duration", compatibleUnits: ["second", "minute"] }]
        }
      ]
    })
  );
  const wk = JSON.parse(
    JSON.stringify({
      format: "repjot/workouts",
      schemaVersion: 1,
      workouts: [
        {
          id: "core-day",
          name: "Core Day",
          root: {
            id: "root",
            type: "container",
            strategy: "sequence",
            strategyConfig: {},
            children: [{ id: "core-plank", type: "exercise", exerciseId: "plank", stimulus: "conditioning", prescription: { duration: { value: 30, unit: "second" } } }]
          }
        }
      ]
    })
  );
  return { exercises: ex, workouts: wk };
}

function blankBundle(): { exercises: unknown; workouts: unknown } {
  return {
    exercises: { format: "repjot/exercises", schemaVersion: 1, equipment: [], exercises: [] },
    workouts: { format: "repjot/workouts", schemaVersion: 1, workouts: [] }
  };
}

function deepFreeze(value: unknown): void {
  if (typeof value !== "object" || value === null) return;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
}

// ---------------------------------------------------------------------------
// Blank first release
// ---------------------------------------------------------------------------

describe("blank first release", () => {
  test("--first-release succeeds with no prior files, no network, and no writes", async () => {
    const probe = memIo(new Map());
    await expect(
      runCompareProduction(["--first-release"], probe.io)
    ).resolves.toBe(0);
    expect(probe.out()[1]).toBe("mode: first-release");
    expect(probe.out()[2]).toBe("result: first-release-accepted");
    expect(probe.fetchCalls().length).toBe(0);
    expect(probe.writes().length).toBe(0);
  });

  test("--first-release output is deterministic across runs", async () => {
    const a = memIo(new Map());
    const b = memIo(new Map());
    expect(await runCompareProduction(["--first-release"], a.io)).toBe(0);
    expect(await runCompareProduction(["--first-release"], b.io)).toBe(0);
    expect(a.out()).toEqual(b.out());
  });

  test("--first-release rejects an existing explicit baseline without reading or writing it", async () => {
    const baselinePath = "/tmp/repjot-existing-baseline.json";
    const files = new Map([[baselinePath, new TextEncoder().encode("PRIVATE-BASELINE")]]);
    const probe = memIo(files);
    expect(await runCompareProduction(["--first-release", "--baseline", baselinePath], probe.io)).toBe(1);
    expect(probe.err().join("\\n")).toContain("first-release-baseline-exists");
    expect(probe.writes()).toHaveLength(0);
    expect(probe.fetchCalls()).toHaveLength(0);
    expect(Buffer.from(files.get(baselinePath) as Uint8Array).toString()).toBe("PRIVATE-BASELINE");
  });

  test("--first-release with an absent explicit baseline remains blank and performs no file-content reads", async () => {
    const baselinePath = "/tmp/repjot-absent-baseline.json";
    const probe = memIo(new Map());
    expect(await runCompareProduction(["--first-release", "--baseline", baselinePath], probe.io)).toBe(0);
    expect(probe.out()[2]).toBe("result: first-release-accepted");
    expect(probe.writes()).toHaveLength(0);
    expect(probe.fetchCalls()).toHaveLength(0);
  });

  test("the blank fixture has no prior directory and comparison fails closed for it", async () => {
    const probe = await fixtureIo("blank");
    const code = await runCompareProduction(["--fixture", join(FIXTURE_ROOT, "blank")], probe.io);
    expect(code).toBe(1);
    expect(probe.err().join("\n")).toContain("prior-bundle-missing");
    expect(probe.fetchCalls().length).toBe(0);
  });

  test("--first-release rejects conflicting arguments", async () => {
    // Usage errors exit the process; verify through a real subprocess, not an in-process call.
    const proc = Bun.spawn(["bun", "scripts/compare-production.ts", "--first-release", "--fixture", "x"], {
      cwd: REPO_ROOT,
      stdout: "pipe",
      stderr: "pipe"
    });
    expect(await proc.exited).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Compatible future releases (unchanged, reordered, permitted text corrections)
// ---------------------------------------------------------------------------

describe("compatible future release", () => {
  test("the compatible fixture passes with no failure diagnostics", async () => {
    const pair = await loadPair("compatible");
    const outcome = compareStaticBundles(pair.prior, pair.current);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.report.status).toBe("compatible");
    expect(outcome.report.diagnostics).toEqual([]);
  });

  test("newly deprecated exercise reports affected workouts and scored or timed containers", async () => {
    const pair = await loadPair("compatible");
    const outcome = compareStaticBundles(pair.prior, pair.current);
    if (!outcome.ok) throw new Error("expected compatible outcome");
    expect(outcome.report.deprecationImpact).toEqual([
      [
        "plank",
        [
          { workoutId: "core-day", containerIds: [] },
          { workoutId: "strength-day", containerIds: ["engine-room"] }
        ]
      ]
    ]);
  });

  test("reordered equivalent inputs produce an identical report", async () => {
    const pair = await loadPair("compatible");
    const reference = compareStaticBundles(pair.prior, pair.current);
    if (!reference.ok) throw new Error("expected compatible outcome");

    // Reorder only arrays whose order is not contractually significant: top-level entity
    // arrays, node children, and instruction lists. compatibleUnits keeps metric-first order.
    const reorderable = new Set(["equipment", "exercises", "workouts", "children", "instructions"]);
    const reorderDeep = (doc: unknown): unknown => {
      const value = JSON.parse(JSON.stringify(doc));
      const walk = (node: unknown, key: string): void => {
        if (Array.isArray(node)) {
          if (reorderable.has(key)) node.reverse();
          for (let i = 0; i < node.length; i += 1) walk(node[i], key);
          return;
        }
        if (typeof node === "object" && node !== null) {
          for (const childKey of Object.keys(node as Record<string, unknown>)) {
            walk((node as Record<string, unknown>)[childKey], childKey);
          }
        }
      };
      walk(value, "");
      return value;
    };
    const shuffledPrior: readonly [unknown, unknown] = [reorderDeep(pair.prior[0]), reorderDeep(pair.prior[1])];
    const shuffledCurrent: readonly [unknown, unknown] = [reorderDeep(pair.current[0]), reorderDeep(pair.current[1])];
    const second = compareStaticBundles(shuffledPrior, shuffledCurrent);
    if (!second.ok) throw new Error("expected compatible outcome after reorder");
    expect(second.report.status).toBe(reference.report.status);
    expect(second.report.diagnostics).toEqual(reference.report.diagnostics);
    expect(second.report.deprecationImpact).toEqual(reference.report.deprecationImpact);
    expect(second.report.informational).toEqual(reference.report.informational);
  });

  test("re-adding a deprecated exercise is informational, never a failure", async () => {
    const priorEx = JSON.parse(JSON.stringify(baseBundle().exercises)) as Record<string, unknown>;
    (priorEx["exercises"] as Record<string, unknown>[])[0]["deprecated"] = true;
    const outcome = compareStaticBundles(
      [priorEx, baseBundle().workouts],
      [baseBundle().exercises, baseBundle().workouts]
    );
    if (!outcome.ok) throw new Error("expected compatible outcome");
    expect(outcome.report.status).toBe("compatible");
    expect(outcome.report.informational).toEqual([{ code: "exercise-reenabled", subject: "exercise:plank" }]);
  });

  test("the command prints a deterministic report for the compatible fixture", async () => {
    const run = async (): Promise<{ code: number; out: string[] }> => {
      const p = await fixtureIo("compatible");
      const code = await runCompareProduction(["--fixture", join(FIXTURE_ROOT, "compatible")], p.io);
      return { code, out: p.out() };
    };
    const a = await run();
    const b = await run();
    expect(a.code).toBe(0);
    expect(a.out.join("\n")).toContain("result: compatible");
    expect(a.out.join("\n")).toContain("exercise:plank affects workout:strength-day containers: engine-room");
    expect(a.out.join("\n")).toContain("exercise:plank affects workout:core-day containers: none");
    expect(a.out).toEqual(b.out);
  });

  test("comparing a bundle with itself is compatible", async () => {
    const ex = baseBundle().exercises;
    const wk = baseBundle().workouts;
    const outcome = compareStaticBundles([ex, wk], [ex, wk]);
    if (!outcome.ok) throw new Error("expected ok");
    expect(outcome.report.status).toBe("compatible");
  });

  test("frozen inputs are never mutated", async () => {
    const ex = baseBundle().exercises;
    const wk = baseBundle().workouts;
    deepFreeze(ex);
    deepFreeze(wk);
    const outcome = compareStaticBundles([ex, wk], [ex, wk]);
    expect(outcome.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Forbidden identity changes (one fixture pair per stable code)
// ---------------------------------------------------------------------------

const FORBIDDEN: readonly (readonly [string, string[], string])[] = [
  ["equipment-deleted", ["equipment-id-deleted"], "equipment:dumbbell"],
  ["exercise-deleted", ["exercise-id-deleted"], "exercise:wall-sit"],
  ["workout-deleted", ["workout-id-deleted", "node-id-deleted"], "workout:core-day"],
  ["node-deleted", ["node-id-deleted"], "workout:strength-day/node:plank-hold"],
  ["node-moved", ["node-parent-changed"], "workout:strength-day/node:squat-set"],
  ["node-moved-between-workouts", ["node-id-deleted", "node-id-reused"], "workout:core-day/node:core-plank"],
  ["namespace-reuse", ["exercise-id-deleted", "id-reused-in-different-namespace"], "wall-sit (exercise -> workout)"],
  ["node-type-changed", ["node-type-changed"], "workout:core-day/node:core-plank"],
  ["node-reference-changed", ["node-exercise-reference-changed"], "workout:strength-day/node:squat-set"],
  ["strategy-changed", ["node-strategy-changed"], "workout:core-day/node:root"],
  ["score-contract-changed", ["node-result-capture-changed"], "workout:strength-day/node:engine-room"],
  ["dimension-removed", ["exercise-dimension-removed"], "exercise:back-squat dimension:distance"],
  ["unit-removed", ["exercise-unit-removed"], "exercise:back-squat dimension:weight unit:lb"],
  ["deprecated-in-new-node", ["deprecated-exercise-in-new-node"], "workout:core-day/node:plank-extra"],
  ["already-deprecated-in-new-workout", ["deprecated-exercise-in-new-node"], "workout:late-bloomer/node:late-plank"]
];

describe("forbidden identity changes fail with stable codes", () => {
  for (const [fixture, expectedCodes, expectedSubject] of FORBIDDEN) {
    test(fixture + " fails closed naming the affected identity", async () => {
      const pair = await loadPair(fixture);
      const outcome = compareStaticBundles(pair.prior, pair.current);
      if (!outcome.ok) throw new Error("expected a comparison outcome, got: " + outcome.detail);
      expect(outcome.report.status).toBe("incompatible");
      for (const code of expectedCodes) {
        expect(codes(outcome.report)).toContain(code);
      }
      const subjects = outcome.report.diagnostics.map((d) => d.subject);
      expect(subjects.join("\n")).toContain(expectedSubject);
    });

    test(fixture + " command exits 1 and prints the stable code", async () => {
      const probe = await fixtureIo(fixture);
      const code = await runCompareProduction(["--fixture", join(FIXTURE_ROOT, fixture)], probe.io);
      expect(code).toBe(1);
      const reportText = probe.out().join("\n") + "\n" + probe.err().join("\n");
      for (const expectedCode of expectedCodes) {
        expect(reportText).toContain(expectedCode);
      }
    });
  }

  test("already-deprecated-in-new-workout reports no new deprecation impact", async () => {
    const pair = await loadPair("already-deprecated-in-new-workout");
    const outcome = compareStaticBundles(pair.prior, pair.current);
    if (!outcome.ok) throw new Error("expected a comparison outcome");
    expect(outcome.report.deprecationImpact).toEqual([]);
  });

  test("newly deprecated exercise keeps existing references resolvable while reporting impact", async () => {
    const pair = await loadPair("deprecated-in-new-node");
    const outcome = compareStaticBundles(pair.prior, pair.current);
    if (!outcome.ok) throw new Error("expected a comparison outcome");
    // Existing plank references (plank-hold, core-plank) stay; only the new node fails.
    expect(codes(outcome.report)).toEqual(["deprecated-exercise-in-new-node"]);
    expect(outcome.report.deprecationImpact).toHaveLength(1);
  });

  test("diagnostic codes all have fixed operator messages", () => {
    const seen = new Set<string>();
    for (const [fixture, expectedCodes] of FORBIDDEN) {
      for (const code of expectedCodes) seen.add(code);
    }
    for (const code of seen) {
      expect(COMPATIBILITY_MESSAGES[code as keyof typeof COMPATIBILITY_MESSAGES]).toBeTypeOf("string");
    }
  });
});

// ---------------------------------------------------------------------------
// Malformed input fails closed and preserves inputs
// ---------------------------------------------------------------------------

describe("malformed input", () => {
  test("truncated JSON bytes fail with bundle-json-invalid", async () => {
    const probe = await fixtureIo("malformed-json");
    const code = await runCompareProduction(["--fixture", join(FIXTURE_ROOT, "malformed-json")], probe.io);
    expect(code).toBe(1);
    expect(probe.err().join("\n")).toContain("bundle-json-invalid");
  });

  test("duplicate node IDs fail semantic validation before comparison", async () => {
    const pair = await loadPair("node-ids-repeated");
    const outcome = compareStaticBundles(pair.prior, pair.current);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.side).toBe("current");
    expect(outcome.kind).toBe("semantic");
  });

  test("duplicate JSON members are rejected by the exact parser", async () => {
    const bytes = new TextEncoder().encode('{"format": "repjot/exercises", "format": "repjot/workouts"}');
    const { parseBundleBytes } = await import("../src/compatibility/compare-static-data");
    const parsed = parseBundleBytes(bytes);
    expect(parsed.ok).toBe(false);
  });

  test("a schema-invalid bundle fails closed", async () => {
    const broken = JSON.parse(JSON.stringify(baseBundle().exercises)) as Record<string, unknown>;
    delete broken["schemaVersion"];
    const outcome = compareStaticBundles([baseBundle().exercises, baseBundle().workouts], [broken, baseBundle().workouts]);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.side).toBe("current");
    expect(outcome.kind).toBe("schema");
  });
});

// ---------------------------------------------------------------------------
// Additions are accepted
// ---------------------------------------------------------------------------

describe("additions", () => {
  test("new equipment, exercises, workouts, and nodes never produce diagnostics", async () => {
    const pair = await loadPair("compatible");
    const outcome = compareStaticBundles(pair.prior, pair.current);
    if (!outcome.ok) throw new Error("expected ok");
    expect(outcome.report.diagnostics).toEqual([]);
  });

  test("a node ID may be reused across workouts while the prior occurrence survives", async () => {
    // Prior: workout A owns node "shared". Current adds workout B owning node "shared" too;
    // both occurrences remain published, so this is a permitted addition.
    const prior = baseBundle();
    const currentEx = JSON.parse(JSON.stringify(prior.exercises));
    const currentWk = JSON.parse(JSON.stringify(prior.workouts)) as { workouts: unknown[] };
    currentWk.workouts.push({
      id: "second-day",
      name: "Second Day",
      root: {
        id: "root",
        type: "container",
        strategy: "sequence",
        strategyConfig: {},
        children: [
          {
            id: "core-plank",
            type: "exercise",
            exerciseId: "plank",
            stimulus: "conditioning",
            prescription: { duration: { value: 30, unit: "second" } }
          }
        ]
      }
    });
    const outcome = compareStaticBundles([prior.exercises, prior.workouts], [currentEx, currentWk]);
    if (!outcome.ok) throw new Error("expected ok");
    expect(outcome.report.status).toBe("compatible");
  });

  test("the complete namespace index rejects every prior-to-current collision direction", () => {
    const cases = [
      ["barbell", "node", "equipment -> node"],
      ["plank", "node", "exercise -> node"],
      ["core-day", "node", "workout -> node"],
      ["root", "equipment", "node -> equipment"],
      ["root", "exercise", "node -> exercise"],
      ["root", "workout", "node -> workout"]
    ] as const;
    for (const [id, target, direction] of cases) {
      const prior = baseBundle();
      const currentEx = JSON.parse(JSON.stringify(prior.exercises)) as Record<string, unknown>;
      const currentWk = JSON.parse(JSON.stringify(prior.workouts)) as { workouts: Record<string, unknown>[] };
      if (target === "node") {
        const root = currentWk.workouts[0].root as Record<string, unknown>;
        (root.children as Record<string, unknown>[]).push({ id, type: "exercise", exerciseId: "plank", stimulus: "conditioning", prescription: { duration: { value: 1, unit: "second" } } });
      } else if (target === "equipment") {
        (currentEx.equipment as Record<string, unknown>[]).push({ id, name: "Collision" });
      } else if (target === "exercise") {
        (currentEx.exercises as Record<string, unknown>[]).push({ ...(currentEx.exercises as Record<string, unknown>[])[0], id, name: "Collision" });
      } else {
        currentWk.workouts.push({ id, name: "Collision", root: { id: "new-root", type: "container", strategy: "sequence", strategyConfig: {}, children: [] } });
      }
      const outcome = compareStaticBundles([prior.exercises, prior.workouts], [currentEx, currentWk]);
      if (!outcome.ok) throw new Error("expected valid comparison for " + direction);
      expect(outcome.report.diagnostics.map((diagnostic) => diagnostic.subject)).toContain(id + " (" + direction + ")");
    }
  });

  test("current-only collisions reject all six pairs, including unchanged self-comparison, and recover after correction", () => {
    const prior = baseBundle();
    const currentEx = JSON.parse(JSON.stringify(prior.exercises)) as Record<string, unknown>;
    const currentWk = JSON.parse(JSON.stringify(prior.workouts)) as { workouts: Record<string, unknown>[] };
    (currentEx.equipment as Record<string, unknown>[]).push({ id: "fresh-collision", name: "Fresh" });
    (currentEx.exercises as Record<string, unknown>[]).push({ ...(currentEx.exercises as Record<string, unknown>[])[0], id: "fresh-collision", name: "Fresh" });
    currentWk.workouts.push({ id: "fresh-collision", name: "Fresh", root: { id: "fresh-collision", type: "container", strategy: "sequence", strategyConfig: {}, children: [] } });
    const rejected = compareStaticBundles([prior.exercises, prior.workouts], [currentEx, currentWk]);
    if (!rejected.ok) throw new Error("expected valid comparison");
    expect(rejected.report.diagnostics.filter((diagnostic) => diagnostic.subject.startsWith("fresh-collision (")).length).toBe(6);
    const self = compareStaticBundles([currentEx, currentWk], [currentEx, currentWk]);
    if (!self.ok) throw new Error("expected valid self-comparison");
    expect(self.report.diagnostics.filter((diagnostic) => diagnostic.subject.startsWith("fresh-collision (")).length).toBe(6);
    const correctedEx = JSON.parse(JSON.stringify(prior.exercises));
    const correctedWk = JSON.parse(JSON.stringify(prior.workouts));
    const recovered = compareStaticBundles([prior.exercises, prior.workouts], [correctedEx, correctedWk]);
    if (!recovered.ok) throw new Error("expected valid corrected comparison");
    expect(recovered.report.diagnostics).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Baseline document and approval (pure parsing)
// ---------------------------------------------------------------------------

describe("baseline document and approval", () => {
  const DIGEST_A = "a".repeat(64);
  const DIGEST_B = "b".repeat(64);

  test("buildBaselineBytes is deterministic and round-trips through the strict parser", () => {
    const a = buildBaselineBytes(DIGEST_A, DIGEST_B);
    const b = buildBaselineBytes(DIGEST_A, DIGEST_B);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    const parsed = parseBaselineDocument(JSON.parse(new TextDecoder().decode(a)));
    expect(parsed.ok).toBe(true);
  });

  test("unknown approval keys fail closed", () => {
    const bad = parseBaselineApproval({ format: "repjot/compatibility/baseline-approval", schemaVersion: 1, exercisesSha256: DIGEST_A, workoutsSha256: DIGEST_B, extra: true });
    expect(bad.ok).toBe(false);
  });

  test("wrong approval envelope fails closed", () => {
    const bad = parseBaselineApproval({ format: "repjot/curation/approval", schemaVersion: 1, exercisesSha256: DIGEST_A, workoutsSha256: DIGEST_B });
    expect(bad.ok).toBe(false);
  });

  test("baseline manifest with a non-blank priorRelease fails closed", () => {
    const bad = parseBaselineDocument({ format: "repjot/compatibility/baseline", schemaVersion: 1, priorRelease: "inferred", exercisesSha256: DIGEST_A, workoutsSha256: DIGEST_B });
    expect(bad.ok).toBe(false);
  });

  test("identity extraction preserves measurements and node facts", async () => {
    const pair = await loadPair("compatible");
    const identity = extractBundleIdentity(pair.prior[0], pair.prior[1]);
    expect(identity.equipmentIds.has("barbell")).toBe(true);
    expect(identity.exercises.get("back-squat")!.measurements.get("weight")).toEqual(["kg", "lb"]);
    const strengthDay = identity.workouts.get("strength-day");
    expect(strengthDay).toBeDefined();
    expect(strengthDay!.nodes.get("engine-room")!.scoreContract).toBe("scored/intervals/optional");
    expect(strengthDay!.nodes.get("engine-room")!.timed).toBe(true);
    expect(strengthDay!.nodes.get("plank-hold")!.parentId).toBe("engine-room");
  });
});

// ---------------------------------------------------------------------------
// Record-baseline: the separate approval-bound action
// ---------------------------------------------------------------------------

describe("record-baseline (separate approval-bound action)", () => {
  const CURRENT_DIR = "/tmp/repjot-p9-current";
  const BASELINE_PATH = "/tmp/repjot-p9-baseline.json";
  const APPROVAL_PATH = "/tmp/repjot-p9-approval.json";

  async function currentFiles(): Promise<Map<string, Uint8Array>> {
    const ex = new TextEncoder().encode(JSON.stringify(baseBundle().exercises, null, 2) + "\n");
    const wk = new TextEncoder().encode(JSON.stringify(baseBundle().workouts, null, 2) + "\n");
    return new Map([
      [join(CURRENT_DIR, "exercises.json"), ex],
      [join(CURRENT_DIR, "workouts.json"), wk]
    ]);
  }

  function approvalBytes(exDigest: string, wkDigest: string): Uint8Array {
    return new TextEncoder().encode(
      JSON.stringify({ format: "repjot/compatibility/baseline-approval", schemaVersion: 1, exercisesSha256: exDigest, workoutsSha256: wkDigest }, null, 2) + "\n"
    );
  }

  async function digests(files: Map<string, Uint8Array>): Promise<[string, string]> {
    return [sha256Hex(files.get(join(CURRENT_DIR, "exercises.json")) as Uint8Array), sha256Hex(files.get(join(CURRENT_DIR, "workouts.json")) as Uint8Array)];
  }

  function candidateWithNamespaces(namespaces: readonly string[]): { exercises: any; workouts: any } {
    const bundle = JSON.parse(JSON.stringify(baseBundle())) as { exercises: any; workouts: any };
    const id = "fresh-collision";
    if (namespaces.indexOf("equipment") !== -1) bundle.exercises.equipment.push({ id, name: "Fresh" });
    if (namespaces.indexOf("exercise") !== -1) bundle.exercises.exercises.push({ ...bundle.exercises.exercises[0], id, name: "Fresh" });
    if (namespaces.indexOf("workout") !== -1) bundle.workouts.workouts.push({ id, name: "Fresh", root: { id: "fresh-root", type: "container", strategy: "sequence", strategyConfig: {}, children: [] } });
    if (namespaces.indexOf("node") !== -1) bundle.workouts.workouts[0].root.children.push({ id, type: "exercise", exerciseId: "plank", stimulus: "conditioning", prescription: { duration: { value: 1, unit: "second" } } });
    return bundle;
  }

  function installCandidate(files: Map<string, Uint8Array>, bundle: { exercises: unknown; workouts: unknown }): [string, string] {
    const exercises = new TextEncoder().encode(JSON.stringify(bundle.exercises, null, 2) + "\n");
    const workouts = new TextEncoder().encode(JSON.stringify(bundle.workouts, null, 2) + "\n");
    files.set(join(CURRENT_DIR, "exercises.json"), exercises);
    files.set(join(CURRENT_DIR, "workouts.json"), workouts);
    return [sha256Hex(exercises), sha256Hex(workouts)];
  }

  test("all six current-only namespace collisions reject before approval and write", async () => {
    const pairs = [["equipment", "exercise"], ["equipment", "workout"], ["equipment", "node"], ["exercise", "workout"], ["exercise", "node"], ["workout", "node"]] as const;
    for (const pair of pairs) {
      const files = await currentFiles();
      const [exercisesSha256, workoutsSha256] = installCandidate(files, candidateWithNamespaces(pair));
      files.set(APPROVAL_PATH, approvalBytes(exercisesSha256, workoutsSha256));
      const probe = memIo(files);
      expect(await runCompareProduction(["--record-baseline", "--approval", APPROVAL_PATH, "--current", CURRENT_DIR, "--baseline", BASELINE_PATH], probe.io)).toBe(1);
      expect(probe.err().join("\n")).toContain("id-reused-in-different-namespace");
      expect(files.has(BASELINE_PATH)).toBe(false);
    }
  });

  test("all-four collision is deterministic and preserves an existing baseline", async () => {
    const files = await currentFiles();
    const [exercisesSha256, workoutsSha256] = installCandidate(files, candidateWithNamespaces(["equipment", "exercise", "workout", "node"]));
    files.set(APPROVAL_PATH, approvalBytes(exercisesSha256, workoutsSha256));
    const sentinel = new TextEncoder().encode("PRIVATE-SENTINEL-BASELINE");
    files.set(BASELINE_PATH, sentinel);
    const probe = memIo(files);
    expect(await runCompareProduction(["--record-baseline", "--approval", APPROVAL_PATH, "--current", CURRENT_DIR, "--baseline", BASELINE_PATH], probe.io)).toBe(1);
    expect(probe.err().filter((line) => line.indexOf("id-reused-in-different-namespace") !== -1)).toHaveLength(6);
    expect(Buffer.from(files.get(BASELINE_PATH) as Uint8Array).equals(sentinel)).toBe(true);
  });

  test("repeated node IDs across separate workouts remain recordable", async () => {
    const bundle = baseBundle() as any;
    bundle.workouts.workouts.push({ id: "second-day", name: "Second Day", root: { id: "root", type: "container", strategy: "sequence", strategyConfig: {}, children: [{ id: "core-plank", type: "exercise", exerciseId: "plank", stimulus: "conditioning", prescription: { duration: { value: 1, unit: "second" } } }] } });
    const files = await currentFiles();
    const [exercisesSha256, workoutsSha256] = installCandidate(files, bundle);
    files.set(APPROVAL_PATH, approvalBytes(exercisesSha256, workoutsSha256));
    const probe = memIo(files);
    expect(await runCompareProduction(["--record-baseline", "--approval", APPROVAL_PATH, "--current", CURRENT_DIR, "--baseline", BASELINE_PATH], probe.io)).toBe(0);
  });

  test("first-baseline rejects deprecated references before approval access or target creation", async () => {
    const files = await currentFiles();
    const currentEx = new Uint8Array(await readFile(join(FIXTURE_ROOT, "compatible", "current", "exercises.json")));
    const currentWk = new Uint8Array(await readFile(join(FIXTURE_ROOT, "compatible", "current", "workouts.json")));
    files.set(join(CURRENT_DIR, "exercises.json"), currentEx);
    files.set(join(CURRENT_DIR, "workouts.json"), currentWk);
    files.set(APPROVAL_PATH, approvalBytes(sha256Hex(currentEx), sha256Hex(currentWk)));
    const probe = memIo(files);

    expect(await runCompareProduction(["--record-baseline", "--approval", APPROVAL_PATH, "--current", CURRENT_DIR, "--baseline", BASELINE_PATH], probe.io)).toBe(1);
    const errors = probe.err().join("\\n");
    expect(errors.match(/deprecated-exercise-in-new-node/g)).toHaveLength(2);
    expect(probe.reads()).not.toContain(APPROVAL_PATH);
    expect(probe.writes()).toHaveLength(0);
    expect(files.has(BASELINE_PATH)).toBe(false);
  });

  test("recording a corrected candidate recovers and closes from blank to current", async () => {
    const files = await currentFiles();
    let [exercisesSha256, workoutsSha256] = installCandidate(files, candidateWithNamespaces(["equipment", "node"]));
    files.set(APPROVAL_PATH, approvalBytes(exercisesSha256, workoutsSha256));
    const rejected = memIo(files);
    expect(await runCompareProduction(["--record-baseline", "--approval", APPROVAL_PATH, "--current", CURRENT_DIR, "--baseline", BASELINE_PATH], rejected.io)).toBe(1);
    expect(files.has(BASELINE_PATH)).toBe(false);

    [exercisesSha256, workoutsSha256] = installCandidate(files, candidateWithNamespaces([]));
    files.set(APPROVAL_PATH, approvalBytes(exercisesSha256, workoutsSha256));
    const recovered = memIo(files);
    expect(await runCompareProduction(["--record-baseline", "--approval", APPROVAL_PATH, "--current", CURRENT_DIR, "--baseline", BASELINE_PATH], recovered.io)).toBe(0);
    const exercises = JSON.parse(new TextDecoder().decode(files.get(join(CURRENT_DIR, "exercises.json")) as Uint8Array));
    const workouts = JSON.parse(new TextDecoder().decode(files.get(join(CURRENT_DIR, "workouts.json")) as Uint8Array));
    const self = compareStaticBundles([exercises, workouts], [exercises, workouts]);
    expect(self.ok).toBe(true);
    if (self.ok) expect(self.report.status).toBe("compatible");
    const blank = blankBundle();
    const firstRelease = compareStaticBundles([blank.exercises, blank.workouts], [exercises, workouts]);
    expect(firstRelease.ok).toBe(true);
    if (firstRelease.ok) expect(firstRelease.report.status).toBe("compatible");

    // The recorded digest must also close through the command's future-comparison path.
    files.set(join("/tmp/repjot-p9-prior", "exercises.json"), files.get(join(CURRENT_DIR, "exercises.json")) as Uint8Array);
    files.set(join("/tmp/repjot-p9-prior", "workouts.json"), files.get(join(CURRENT_DIR, "workouts.json")) as Uint8Array);
    const future = memIo(files);
    expect(await runCompareProduction(["--current", CURRENT_DIR, "--prior", "/tmp/repjot-p9-prior", "--baseline", BASELINE_PATH], future.io)).toBe(0);
    expect(future.out().join("\n")).toContain("result: compatible");
  });

  test("missing approval fails and writes nothing", async () => {
    const files = await currentFiles();
    const probe = memIo(files);
    const code = await runCompareProduction(["--record-baseline", "--approval", APPROVAL_PATH, "--current", CURRENT_DIR, "--baseline", BASELINE_PATH], probe.io);
    expect(code).toBe(1);
    expect(probe.err().join("\n")).toContain("approval-file-missing");
    expect(files.has(BASELINE_PATH)).toBe(false);
  });

  test("malformed approval JSON fails and writes nothing", async () => {
    const files = await currentFiles();
    files.set(APPROVAL_PATH, new TextEncoder().encode("{ not json"));
    const probe = memIo(files);
    const code = await runCompareProduction(["--record-baseline", "--approval", APPROVAL_PATH, "--current", CURRENT_DIR, "--baseline", BASELINE_PATH], probe.io);
    expect(code).toBe(1);
    expect(probe.err().join("\n")).toContain("approval-json-invalid");
    expect(files.has(BASELINE_PATH)).toBe(false);
  });

  test("stale approval digest fails and preserves an existing baseline byte-identical", async () => {
    const files = await currentFiles();
    const [exDigest] = await digests(files);
    const sentinel = new TextEncoder().encode("PRIVATE-SENTINEL-BASELINE");
    files.set(BASELINE_PATH, sentinel);
    files.set(APPROVAL_PATH, approvalBytes("f".repeat(64), exDigest));
    const probe = memIo(files);
    const code = await runCompareProduction(["--record-baseline", "--approval", APPROVAL_PATH, "--current", CURRENT_DIR, "--baseline", BASELINE_PATH], probe.io);
    expect(code).toBe(1);
    expect(probe.err().join("\n")).toContain("approval-mismatch");
    expect(Buffer.from(files.get(BASELINE_PATH) as Uint8Array).equals(sentinel)).toBe(true);
  });

  test("exact approval records the baseline; re-running is idempotent", async () => {
    const files = await currentFiles();
    const [exDigest, wkDigest] = await digests(files);
    files.set(APPROVAL_PATH, approvalBytes(exDigest, wkDigest));
    const probe = memIo(files);
    expect(await runCompareProduction(["--record-baseline", "--approval", APPROVAL_PATH, "--current", CURRENT_DIR, "--baseline", BASELINE_PATH], probe.io)).toBe(0);
    expect(probe.out().join("\n")).toContain("result: baseline-recorded");
    const recorded = files.get(BASELINE_PATH) as Uint8Array;
    expect(Buffer.from(recorded).equals(buildBaselineBytes(exDigest, wkDigest))).toBe(true);

    // Second run against the same bundle and approval succeeds without changing bytes.
    const second = memIo(files);
    expect(await runCompareProduction(["--record-baseline", "--approval", APPROVAL_PATH, "--current", CURRENT_DIR, "--baseline", BASELINE_PATH], second.io)).toBe(0);
    expect(Buffer.from(files.get(BASELINE_PATH) as Uint8Array).equals(recorded)).toBe(true);
  });

  test("a different pre-existing baseline is never replaced (recovery: exact new approval for the existing bytes fails, correction succeeds elsewhere)", async () => {
    const files = await currentFiles();
    const sentinel = buildBaselineBytes("c".repeat(64), "d".repeat(64));
    files.set(BASELINE_PATH, sentinel);
    const [exDigest, wkDigest] = await digests(files);
    files.set(APPROVAL_PATH, approvalBytes(exDigest, wkDigest));
    const probe = memIo(files);
    const code = await runCompareProduction(["--record-baseline", "--approval", APPROVAL_PATH, "--current", CURRENT_DIR, "--baseline", BASELINE_PATH], probe.io);
    expect(code).toBe(1);
    expect(probe.err().join("\n")).toContain("baseline-already-recorded");
    expect(Buffer.from(files.get(BASELINE_PATH) as Uint8Array).equals(sentinel)).toBe(true);
  });

  test("recovery: after a mismatch failure, an exact new approval succeeds without residual mutation", async () => {
    const files = await currentFiles();
    const [exDigest, wkDigest] = await digests(files);
    files.set(APPROVAL_PATH, approvalBytes("0".repeat(64), "0".repeat(64)));
    let probe = memIo(files);
    expect(await runCompareProduction(["--record-baseline", "--approval", APPROVAL_PATH, "--current", CURRENT_DIR, "--baseline", BASELINE_PATH], probe.io)).toBe(1);
    expect(files.has(BASELINE_PATH)).toBe(false);

    files.set(APPROVAL_PATH, approvalBytes(exDigest, wkDigest));
    probe = memIo(files);
    expect(await runCompareProduction(["--record-baseline", "--approval", APPROVAL_PATH, "--current", CURRENT_DIR, "--baseline", BASELINE_PATH], probe.io)).toBe(0);
    const recorded = files.get(BASELINE_PATH) as Uint8Array;
    expect(Buffer.from(recorded).equals(buildBaselineBytes(exDigest, wkDigest))).toBe(true);
  });

  test("fresh absent parent recovers after rejection and preserves a different target", async () => {
    const root = await mkdtemp(join(tmpdir(), "repjot-p9-baseline-"));
    try {
      const currentDir = join(root, "current");
      const baselinePath = join(root, "nested", ".compatibility", "baseline.json");
      const approvalPath = join(root, "approval.json");
      await mkdir(currentDir, { recursive: true });
      const candidate = baseBundle();
      const ex = new TextEncoder().encode(JSON.stringify(candidate.exercises, null, 2) + "\n");
      const wk = new TextEncoder().encode(JSON.stringify(candidate.workouts, null, 2) + "\n");
      await writeFile(join(currentDir, "exercises.json"), ex);
      await writeFile(join(currentDir, "workouts.json"), wk);
      const [exDigest, wkDigest] = [sha256Hex(ex), sha256Hex(wk)];
      const makeIo = () => {
        const outLines: string[] = [];
        const errLines: string[] = [];
        return { ...makeNodeIo(), out: (line: string) => outLines.push(line), err: (line: string) => errLines.push(line), outLines, errLines };
      };

      await writeFile(approvalPath, approvalBytes("0".repeat(64), "0".repeat(64)));
      const rejected = makeIo();
      expect(await runCompareProduction(["--record-baseline", "--approval", approvalPath, "--current", currentDir, "--baseline", baselinePath], rejected)).toBe(1);
      expect(rejected.errLines.join("\\n")).toContain("approval-mismatch");
      expect(await Bun.file(baselinePath).exists()).toBe(false);

      await writeFile(approvalPath, approvalBytes(exDigest, wkDigest));
      const recovered = makeIo();
      expect(await runCompareProduction(["--record-baseline", "--approval", approvalPath, "--current", currentDir, "--baseline", baselinePath], recovered)).toBe(0);
      expect(Buffer.from(await readFile(baselinePath)).equals(Buffer.from(buildBaselineBytes(exDigest, wkDigest)))).toBe(true);
      expect(await readdir(join(root, "nested", ".compatibility"))).toEqual(["baseline.json"]);

      const preservedPath = join(root, "other", "baseline.json");
      const sentinel = new TextEncoder().encode("DIFFERENT-BASELINE");
      await mkdir(join(root, "other"), { recursive: true });
      await writeFile(preservedPath, sentinel);
      const preserved = makeIo();
      expect(await runCompareProduction(["--record-baseline", "--approval", approvalPath, "--current", currentDir, "--baseline", preservedPath], preserved)).toBe(1);
      expect(Buffer.from(await readFile(preservedPath)).equals(Buffer.from(sentinel))).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("record-baseline validates the current bundle before touching approval or baseline", async () => {
    const files = new Map<string, Uint8Array>();
    files.set(join(CURRENT_DIR, "exercises.json"), new TextEncoder().encode("{ truncated"));
    files.set(join(CURRENT_DIR, "workouts.json"), new TextEncoder().encode(JSON.stringify(baseBundle().workouts)));
    const probe = memIo(files);
    const code = await runCompareProduction(["--record-baseline", "--approval", APPROVAL_PATH, "--current", CURRENT_DIR, "--baseline", BASELINE_PATH], probe.io);
    expect(code).toBe(1);
    expect(probe.err().join("\n")).toContain("bundle-json-invalid");
  });

  test("--record-baseline without --approval is a usage error (exit 2 in a subprocess)", async () => {
    const proc = Bun.spawn(["bun", "scripts/compare-production.ts", "--record-baseline"], { cwd: REPO_ROOT, stdout: "pipe", stderr: "pipe" });
    expect(await proc.exited).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Production mode safety (fake source; no real network)
// ---------------------------------------------------------------------------

describe("production comparison with a fake prior source", () => {
  const CURRENT_DIR = "/tmp/repjot-p9-prod-current";
  const BASELINE_PATH = "/tmp/repjot-p9-prod-baseline.json";

  async function prodFiles(): Promise<Map<string, Uint8Array>> {
    const ex = new TextEncoder().encode(JSON.stringify(baseBundle().exercises, null, 2) + "\n");
    const wk = new TextEncoder().encode(JSON.stringify(baseBundle().workouts, null, 2) + "\n");
    return new Map([
      [join(CURRENT_DIR, "exercises.json"), ex],
      [join(CURRENT_DIR, "workouts.json"), wk]
    ]);
  }

  test("network failure blocks the release instead of skipping validation", async () => {
    const files = await prodFiles();
    const probe = memIo(files); // fetchUrl returns null for every URL
    const code = await runCompareProduction(["--current", CURRENT_DIR, "--baseline", BASELINE_PATH], probe.io);
    expect(code).toBe(1);
    expect(probe.err().join("\n")).toContain("prior-download-failed");
    expect(probe.fetchCalls()).toEqual(["https://repjot.com/exercises.json"]);
  });

  test("a missing pinned manifest fails closed", async () => {
    const files = await prodFiles();
    const ex = files.get(join(CURRENT_DIR, "exercises.json")) as Uint8Array;
    const wk = files.get(join(CURRENT_DIR, "workouts.json")) as Uint8Array;
    const probe = memIo(files, { "https://repjot.com/exercises.json": ex, "https://repjot.com/workouts.json": wk });
    const code = await runCompareProduction(["--current", CURRENT_DIR, "--baseline", BASELINE_PATH], probe.io);
    expect(code).toBe(1);
    expect(probe.err().join("\n")).toContain("baseline-missing");
  });

  test("a prior bundle that does not match the pinned manifest fails closed", async () => {
    const files = await prodFiles();
    const ex = files.get(join(CURRENT_DIR, "exercises.json")) as Uint8Array;
    const wk = files.get(join(CURRENT_DIR, "workouts.json")) as Uint8Array;
    files.set(BASELINE_PATH, buildBaselineBytes("e".repeat(64), "e".repeat(64)));
    const probe = memIo(files, { "https://repjot.com/exercises.json": ex, "https://repjot.com/workouts.json": wk });
    const code = await runCompareProduction(["--current", CURRENT_DIR, "--baseline", BASELINE_PATH], probe.io);
    expect(code).toBe(1);
    expect(probe.err().join("\n")).toContain("prior-bundle-digest-mismatch");
  });

  test("a pinned prior matching the manifest compares successfully", async () => {
    const files = await prodFiles();
    const ex = files.get(join(CURRENT_DIR, "exercises.json")) as Uint8Array;
    const wk = files.get(join(CURRENT_DIR, "workouts.json")) as Uint8Array;
    files.set(BASELINE_PATH, buildBaselineBytes(sha256Hex(ex), sha256Hex(wk)));
    const probe = memIo(files, { "https://repjot.com/exercises.json": ex, "https://repjot.com/workouts.json": wk });
    const code = await runCompareProduction(["--current", CURRENT_DIR, "--baseline", BASELINE_PATH], probe.io);
    expect(code).toBe(0);
    expect(probe.out().join("\n")).toContain("result: compatible");
  });

  test("fixture mode never performs a network request even when fetch would be available", async () => {
    const files = await prodFiles();
    // Point a fixture-shaped directory at the production current bytes.
    const dir = "/tmp/repjot-p9-nofetch-fixture";
    files.set(join(dir, "current", "exercises.json"), files.get(join(CURRENT_DIR, "exercises.json")) as Uint8Array);
    files.set(join(dir, "current", "workouts.json"), files.get(join(CURRENT_DIR, "workouts.json")) as Uint8Array);
    files.set(join(dir, "prior", "exercises.json"), files.get(join(CURRENT_DIR, "exercises.json")) as Uint8Array);
    files.set(join(dir, "prior", "workouts.json"), files.get(join(CURRENT_DIR, "workouts.json")) as Uint8Array);
    const probe = memIo(files);
    const code = await runCompareProduction(["--fixture", dir], probe.io);
    expect(code).toBe(0);
    expect(probe.fetchCalls().length).toBe(0);
  });

  test("missing current production files fail closed", async () => {
    const probe = memIo(new Map());
    const code = await runCompareProduction(["--current", "/tmp/repjot-p9-absent", "--baseline", BASELINE_PATH], probe.io);
    expect(code).toBe(1);
    expect(probe.err().join("\n")).toContain("bundle-file-missing");
  });
});

// ---------------------------------------------------------------------------
// End-to-end: the required phase command against real fixture files
// ---------------------------------------------------------------------------

describe("end-to-end required command", () => {
  test("bun scripts/compare-production.ts --fixture tests/fixtures/compatibility/compatible exits 0", async () => {
    const proc = Bun.spawn(["bun", "scripts/compare-production.ts", "--fixture", "tests/fixtures/compatibility/compatible"], {
      cwd: REPO_ROOT,
      stdout: "pipe",
      stderr: "pipe"
    });
    const exit = await proc.exited;
    const stdout = await new Response(proc.stdout).text();
    expect(exit).toBe(0);
    expect(stdout).toContain("result: compatible");
    expect(stdout).toContain("exercise:plank affects workout:strength-day containers: engine-room");
  });

  test("a forbidden fixture command exits 1 through the real process", async () => {
    const proc = Bun.spawn(["bun", "scripts/compare-production.ts", "--fixture", "tests/fixtures/compatibility/unit-removed"], {
      cwd: REPO_ROOT,
      stdout: "pipe",
      stderr: "pipe"
    });
    const exit = await proc.exited;
    const stdout = await new Response(proc.stdout).text();
    expect(exit).toBe(1);
    expect(stdout).toContain("exercise-unit-removed");
  });
});
