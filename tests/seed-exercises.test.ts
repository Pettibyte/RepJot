import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SeedProblems,
  buildExercises,
  loadValidators,
  resolveTargetCommit,
  runSeed,
  type SourceExercise,
} from "../scripts/seed-exercises";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");

const ALLOWLIST_TEXT = readFileSync(join(ROOT, "scripts/exercise-allowlist.json"), "utf8");
const OUTPUT_TEXT = readFileSync(join(ROOT, "src/public/data/exercises.json"), "utf8");
const CONFIG_TEXT = () => readFileSync(join(ROOT, "scripts/seed-config.json"), "utf8");
const SOURCE_CACHE = join(
  ROOT,
  "scripts/.cache/free-exercise-db/yuhonas+free-exercise-db-a859101d633a01c4a1a920d6a8ce41dabba0705f.json",
);
// The source cache is a local build artifact, not a committed file.
const testWithCache = existsSync(SOURCE_CACHE) ? test : test.skip;

/** Output key order. The seed fixes it so the generated text stays stable. */
const OUTPUT_KEYS = [
  "id",
  "name",
  "instructions",
  "equipment",
  "force",
  "mechanic",
  "category",
  "level",
  "movementPattern",
  "primaryMuscles",
  "secondaryMuscles",
  "laterality",
  "measurements",
  "loadSemantics",
];

function sourceExercise(id: string, overrides: Partial<SourceExercise> = {}): SourceExercise {
  return {
    id,
    name: id.replace(/_/g, " "),
    instructions: ["Step one.", "Step two."],
    category: "strength",
    force: "push",
    mechanic: "compound",
    level: "beginner",
    primaryMuscles: ["chest"],
    secondaryMuscles: ["triceps"],
    equipment: "barbell",
    images: ["https://example.test/a.gif", "https://example.test/b.gif"],
    ...overrides,
  };
}

function onlyErrors(result: { errors: string[] }) {
  return result.errors.join("\n");
}

describe("seed: bare allowlist entry", () => {
  const source = [sourceExercise("Demo_Move")];
  const result = buildExercises(source, ["Demo_Move"], "test-source");
  const exercise = result.exercises[0] as Record<string, unknown>;

  test("reports no errors", () => {
    expect(result.errors).toEqual([]);
    expect(result.json).toStartWith('{\n  "format": "repjot/exercises"');
  });

  test("applies the curated defaults from requirement 13.16", () => {
    expect(exercise.laterality).toBe("bilateral");
    expect(exercise.movementPattern).toBe("none");
    expect(exercise.loadSemantics).toBe("total");
    expect(exercise.measurements).toEqual([
      { dimension: "reps", compatibleUnits: ["reps"] },
    ]);
    expect("icon" in exercise).toBe(false);
  });

  test("copies the source fields verbatim", () => {
    expect(exercise.name).toBe("Demo Move");
    expect(exercise.instructions).toEqual(["Step one.", "Step two."]);
    expect(exercise.category).toBe("strength");
    expect(exercise.force).toBe("push");
    expect(exercise.mechanic).toBe("compound");
    expect(exercise.level).toBe("beginner");
    expect(exercise.primaryMuscles).toEqual(["chest"]);
    expect(exercise.secondaryMuscles).toEqual(["triceps"]);
    expect(exercise.equipment).toBe("barbell");
  });

  test("writes exactly the schema keys, in a stable order, and drops images", () => {
    expect(Object.keys(exercise)).toEqual(OUTPUT_KEYS);
  });
});

describe("seed: equipment handling", () => {
  test("maps the source value 'body only' to null", () => {
    const result = buildExercises([sourceExercise("Body_Move", { equipment: "body only" })], ["Body_Move"]);
    expect(result.errors).toEqual([]);
    expect(result.exercises[0].equipment).toBeNull();
  });

  test("fails when the source equipment is null and no override exists", () => {
    const result = buildExercises([sourceExercise("Null_Gear", { equipment: null })], ["Null_Gear"]);
    expect(onlyErrors(result)).toContain('source equipment is null; add an "equipment" override');
  });

  test("fails when the source equipment is an empty string", () => {
    const result = buildExercises([sourceExercise("Blank_Gear", { equipment: "" })], ["Blank_Gear"]);
    expect(onlyErrors(result)).toContain("source equipment is empty");
  });

  test("an override replaces the source value, including with null", () => {
    const replaced = buildExercises([sourceExercise("Any_Gear", { equipment: "cable" })], [
      { id: "Any_Gear", equipment: "kettlebells" },
    ]);
    expect(replaced.errors).toEqual([]);
    expect(replaced.exercises[0].equipment).toBe("kettlebell");

    const cleared = buildExercises([sourceExercise("Any_Gear", { equipment: "cable" })], [
      { id: "Any_Gear", equipment: null },
    ]);
    expect(cleared.errors).toEqual([]);
    expect(cleared.exercises[0].equipment).toBeNull();
  });
});

describe("seed: equipment normalization", () => {
  test("folds case, plural, and loose whitespace from the source", () => {
    const source = [
      sourceExercise("A", { equipment: "Kettlebells" }),
      sourceExercise("B", { equipment: "  BANDS  " }),
      sourceExercise("C", { equipment: "DUMBBELL" }),
      sourceExercise("D", { equipment: "Medicine  Balls" }),
    ];
    const result = buildExercises(source, ["A", "B", "C", "D"]);
    expect(result.errors).toEqual([]);
    expect(result.exercises.map((item) => item.equipment)).toEqual([
      "kettlebell",
      "band",
      "dumbbell",
      "medicine ball",
    ]);
  });

  test("folds an override the same way it folds the source", () => {
    const result = buildExercises([sourceExercise("A")], [
      { id: "A", equipment: "  Kettlebells  " },
    ]);
    expect(result.errors).toEqual([]);
    expect(result.exercises[0].equipment).toBe("kettlebell");
  });

  test("maps any spelling of 'body only' to null", () => {
    for (const raw of ["body only", "Body Only", "BODY   ONLY"]) {
      const result = buildExercises([sourceExercise("A", { equipment: raw })], ["A"]);
      expect(result.errors).toEqual([]);
      expect(result.exercises[0].equipment).toBeNull();
    }
  });

  test("fails on a value outside the vocabulary and shows the normalized form", () => {
    const result = buildExercises([sourceExercise("A", { equipment: "Trap Bars" })], ["A"]);
    const message = onlyErrors(result);
    expect(result.json).toBeNull();
    expect(message).toContain('"Trap Bars" normalizes to "trap bar"');
    expect(message).toContain("not in the equipment vocabulary");
    expect(message).toContain("$defs.equipmentValue");
  });

  test("fails on a bad override value too", () => {
    const result = buildExercises([sourceExercise("A")], [{ id: "A", equipment: "pads" }]);
    expect(onlyErrors(result)).toContain('equipment override "pads" normalizes to "pad"');
  });

  test("reports the full diagnostic for an override the shape check cannot see", () => {
    // '/', '|', and ':' are banned in IDs. The override schema stays loose so the
    // normalizer still produces the raw value, the folded value, and the field to
    // edit, instead of a generic schema message.
    const result = buildExercises([sourceExercise("A")], [{ id: "A", equipment: "Trap/Bars" }]);
    const message = onlyErrors(result);
    expect(message).toContain('equipment override "Trap/Bars" normalizes to');
    expect(message).toContain("not in the equipment vocabulary");
    expect(message).toContain("$defs.equipmentValue");
  });

  test("rejects a repeated measurement dimension", () => {
    const result = buildExercises([sourceExercise("A")], [
      {
        id: "A",
        measurements: [
          { dimension: "weight", units: ["kg"] },
          { dimension: "weight", units: ["lb"] },
        ],
      },
    ]);
    expect(result.json).toBeNull();
    expect(onlyErrors(result)).toContain('dimension "weight" appears more than once');
  });

  test("reports every repeated dimension in one run", () => {
    const result = buildExercises([sourceExercise("A")], [
      {
        id: "A",
        measurements: [
          { dimension: "weight", units: ["kg"] },
          { dimension: "distance", units: ["m"] },
          { dimension: "weight", units: ["lb"] },
          { dimension: "distance", units: ["km"] },
        ],
      },
    ]);
    const message = onlyErrors(result);
    expect(message).toContain('"weight"');
    expect(message).toContain('"distance"');
  });

  test("the allowlist schema also rejects an identical duplicate entry", () => {
    const result = buildExercises([sourceExercise("A")], [
      {
        id: "A",
        measurements: [
          { dimension: "reps", units: ["reps"] },
          { dimension: "reps", units: ["reps"] },
        ],
      },
    ]);
    expect(result.json).toBeNull();
    expect(result.errors.length).toBeGreaterThan(0);
  });

  test("the vocabulary itself is lower case, singular, and free of 'body only'", () => {
    const { equipmentValues } = loadValidators();
    expect(equipmentValues).toEqual([
      "band",
      "barbell",
      "cable",
      "dumbbell",
      "e-z curl bar",
      "exercise ball",
      "foam roll",
      "kettlebell",
      "machine",
      "medicine ball",
      "other",
    ]);
  });

  test("every equipment value in the committed output is in the vocabulary", () => {
    const { equipmentValues } = loadValidators();
    const document = JSON.parse(OUTPUT_TEXT) as { exercises: { equipment: string | null }[] };
    for (const item of document.exercises) {
      if (item.equipment === null) continue;
      expect(equipmentValues).toContain(item.equipment);
    }
  });
});

describe("seed: curated overrides", () => {
  test("renames the allowlist 'units' key to 'compatibleUnits'", () => {
    const result = buildExercises([sourceExercise("Loaded_Move")], [
      {
        id: "Loaded_Move",
        measurements: [
          { dimension: "reps", units: ["reps"] },
          { dimension: "weight", units: ["kg", "lb"] },
        ],
      },
    ]);
    expect(result.errors).toEqual([]);
    expect(result.exercises[0].measurements).toEqual([
      { dimension: "reps", compatibleUnits: ["reps"] },
      { dimension: "weight", compatibleUnits: ["kg", "lb"] },
    ]);
  });

  test("keeps an icon override and places it after instructions", () => {
    const result = buildExercises([sourceExercise("Shown_Move")], [
      { id: "Shown_Move", icon: { type: "material_symbol", name: "fitness_center" } },
    ]);
    expect(result.errors).toEqual([]);
    expect(result.exercises[0].icon).toEqual({ type: "material_symbol", name: "fitness_center" });
    expect(Object.keys(result.exercises[0])).toEqual([
      "id",
      "name",
      "instructions",
      "icon",
      ...OUTPUT_KEYS.slice(3),
    ]);
  });

  test("requires a matching dimension for added and assisted load", () => {
    const badAdded = buildExercises([sourceExercise("Added_Move")], [
      { id: "Added_Move", loadSemantics: "added" },
    ]);
    expect(onlyErrors(badAdded)).toContain('loadSemantics "added" requires an "addedWeight" measurement');

    const goodAdded = buildExercises([sourceExercise("Added_Move")], [
      {
        id: "Added_Move",
        loadSemantics: "added",
        measurements: [{ dimension: "addedWeight", units: ["kg"] }],
      },
    ]);
    expect(goodAdded.errors).toEqual([]);
    expect(goodAdded.exercises[0].loadSemantics).toBe("added");

    const badAssisted = buildExercises([sourceExercise("Assisted_Move")], [
      { id: "Assisted_Move", loadSemantics: "assisted" },
    ]);
    expect(onlyErrors(badAssisted)).toContain('loadSemantics "assisted" requires an "assistedWeight" measurement');
  });
});

describe("seed: failures", () => {
  test("fails when an allowlist id is absent from the source", () => {
    const result = buildExercises([sourceExercise("Real_Move")], ["Real_Move", "Ghost_Move"]);
    expect(result.json).toBeNull();
    expect(result.errors).toHaveLength(1);
    expect(onlyErrors(result)).toContain('allowlist[1] "Ghost_Move": not found in source');
  });

  test("fails when one id appears twice in the allowlist", () => {
    const result = buildExercises([sourceExercise("Twice")], ["Twice", { id: "Twice" }]);
    expect(onlyErrors(result)).toContain('allowlist[1] "Twice": listed more than once');
  });

  test("rejects an unknown curated field", () => {
    const result = buildExercises([sourceExercise("Odd")], [
      { id: "Odd", laterality: "sideways" } as never,
    ]);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(onlyErrors(result)).toContain("laterality");
  });

  test("rejects an unknown measurement dimension", () => {
    const result = buildExercises([sourceExercise("Odd_Units")], [
      { id: "Odd_Units", measurements: [{ dimension: "vibes", units: ["reps"] }] },
    ]);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  test("rejects a source that is not an array", () => {
    const result = buildExercises({ nope: true }, ["Demo_Move"]);
    expect(onlyErrors(result)).toContain("expected a JSON array of exercises");
  });

  test("reports every problem in one run instead of stopping at the first", () => {
    const result = buildExercises(
      [sourceExercise("Good_One"), sourceExercise("Null_Gear", { equipment: null })],
      ["Ghost_One", "Null_Gear", "Ghost_Two"],
    );
    expect(result.errors).toHaveLength(3);
  });
});

describe("seed: determinism", () => {
  const source = [sourceExercise("Alpha"), sourceExercise("Beta", { equipment: "body only" })];
  const allowlist = ["Alpha", { id: "Beta", movementPattern: "hinge" }];

  test("the same input produces byte-identical output", () => {
    const first = buildExercises(source, allowlist);
    const second = buildExercises(source, allowlist);
    expect(first.json).toBe(second.json);
    expect(first.json?.endsWith("\n")).toBe(true);
  });

  test("the generated document validates against the exercise schema", () => {
    const result = buildExercises(source, allowlist);
    const document = JSON.parse(result.json!);
    const { document: validateDocument } = loadValidators();
    expect(validateDocument(document)).toBe(true);
  });
});

describe("seed: committed files", () => {
  test("the checked-in allowlist validates against the allowlist schema", () => {
    const { allowlist } = loadValidators();
    expect(allowlist(JSON.parse(ALLOWLIST_TEXT))).toBe(true);
  });

  test("the checked-in output validates against the exercise schema", () => {
    const { document: validateDocument } = loadValidators();
    expect(validateDocument(JSON.parse(OUTPUT_TEXT))).toBe(true);
  });

  // The source cache is a local build artifact, not a committed file.
  // The test that reads it skips on a fresh clone.
  testWithCache("the checked-in output matches a fresh run against the checked-in allowlist", () => {
    const source = JSON.parse(readFileSync(SOURCE_CACHE, "utf8"));
    const result = buildExercises(source, JSON.parse(ALLOWLIST_TEXT));
    expect(result.errors).toEqual([]);
    expect(result.json).toBe(OUTPUT_TEXT);
  });

  test("publishes the three barbell lifts with the expected patterns", () => {
    interface PublishedExercise {
      id: string;
      movementPattern: string;
      equipment: string | null;
      loadSemantics: string;
      measurements: { dimension: string; compatibleUnits: string[] }[];
    }
    const document = JSON.parse(OUTPUT_TEXT) as { exercises: PublishedExercise[] };
    const byId = new Map(document.exercises.map((item) => [item.id, item]));
    expect([...byId.keys()]).toEqual([
      "Barbell_Squat",
      "Barbell_Bench_Press_-_Medium_Grip",
      "Barbell_Deadlift",
    ]);
    expect(byId.get("Barbell_Squat")?.movementPattern).toBe("squat");
    expect(byId.get("Barbell_Bench_Press_-_Medium_Grip")?.movementPattern).toBe("horizontal_push");
    expect(byId.get("Barbell_Deadlift")?.movementPattern).toBe("hinge");
    for (const item of byId.values()) {
      expect(item.equipment).toBe("barbell");
      expect(item.loadSemantics).toBe("total");
      expect(item.measurements).toEqual([
        { dimension: "reps", compatibleUnits: ["reps"] },
        { dimension: "weight", compatibleUnits: ["kg", "lb"] },
      ]);
    }
  });
});

describe("seed: commit resolution", () => {
  const pinned = "a".repeat(40);
  const other = "b".repeat(40);
  const config = {
    source: { repo: "someone/somewhere", ref: "main", commit: pinned, path: "dist/exercises.json" },
    allowlist: "scripts/exercise-allowlist.json",
    output: "src/public/data/exercises.json",
  };

  test("rejects a malformed SHA in every mode", () => {
    for (const mode of ["seed", "check", "bump"] as const) {
      expect(() => resolveTargetCommit(config, { mode, commit: "abc" })).toThrow(
        "full 40-character commit SHA",
      );
    }
  });

  test("uses an explicit commit in every mode", async () => {
    for (const mode of ["seed", "check", "bump"] as const) {
      expect(await resolveTargetCommit(config, { mode, commit: other })).toBe(other);
    }
  });

  test("falls back to the pinned commit outside bump mode", async () => {
    expect(await resolveTargetCommit(config, { mode: "seed" })).toBe(pinned);
    expect(await resolveTargetCommit(config, { mode: "check" })).toBe(pinned);
  });
});

describe("seed: bump atomicity", () => {
  const bumpOptions = (allowlistFile: string) => ({
    mode: "bump" as const,
    commit: "1111111111111111111111111111111111111111",
    sourceFile: SOURCE_CACHE,
    allowlistFile,
    outFile: join(tmpdir(), "repjot-bump-out.json"),
    useCache: true,
    help: false,
  });

  testWithCache("a failed bump leaves the pinned commit untouched", async () => {
    const before = CONFIG_TEXT();
    const badAllowlist = join(tmpdir(), "repjot-bump-bad-allowlist.json");
    writeFileSync(badAllowlist, JSON.stringify(["Ghost_Move"]));

    await expect(runSeed(bumpOptions(badAllowlist))).rejects.toBeInstanceOf(SeedProblems);
    expect(CONFIG_TEXT()).toBe(before);
  });

  test("a malformed --commit never reaches the config file", async () => {
    const before = CONFIG_TEXT();
    const badAllowlist = join(tmpdir(), "repjot-bump-sha-allowlist.json");
    writeFileSync(badAllowlist, "[]");

    await expect(
      runSeed({ ...bumpOptions(badAllowlist), commit: "abc" }),
    ).rejects.toThrow("full 40-character commit SHA");
    expect(CONFIG_TEXT()).toBe(before);
  });
});

describe("seed: build gates", () => {
  test("the production build validates static data before vite runs", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    const build = pkg.scripts.build;
    expect(build).toContain("check:schemas");
    expect(build).toContain("seed:check");
    expect(build.indexOf("seed:check")).toBeLessThan(build.indexOf("vite build"));
  });
});
