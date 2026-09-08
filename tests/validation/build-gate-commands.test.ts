/**
 * P10-T01 — Command-level tests for the contract build gates (GATES.md §2, Architecture §18).
 *
 * Covers the public acceptance categories for this phase at the command boundary:
 * - canonical static mode reads only the fixed `src/public` location, fails closed with the
 *   explicit content blocker while approved inputs are absent, and rejects any attempt to
 *   select an alternate (unapproved) canonical root;
 * - fixture mode enforces schemas, semantics, manifests, and trusted local SVG for one set;
 * - fixtures-root mode selects the complete repository fixture set and never passes silently;
 * - the repository command surface (`bun run ...`) returns the required exit codes;
 * - two sequential builds over unchanged inputs emit byte-identical output, and the loader
 *   cache-busting token is derived from the emitted app.js content rather than the wall clock.
 *
 * The validators under test are the real production modules; no generated-type-only assertions.
 * Inputs are temporary copies or reviewed repository fixtures, read exactly as bytes. No network
 * access and no clock reads: every expectation is deterministic.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";

import { runValidateStatic } from "../../scripts/validate-static";
import { runValidateSchemas } from "../../scripts/validate-schemas";
import { runCheckBrowserCompat } from "../../scripts/check-browser-compat";

const REPO_ROOT = join(import.meta.dir, "..", "..");
const VALID_FIXTURE = join(REPO_ROOT, "tests", "fixtures", "static", "valid");
const HOSTILE_SVGS = join(REPO_ROOT, "tests", "fixtures", "icons", "hostile");
const CANONICAL_DOCS = ["exercises.json", "workouts.json", "material-symbols.json"] as const;

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "repjot-gate-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

/** Capture the command's own console output while it runs. */
async function runCommand(args: readonly string[]): Promise<{ code: number; out: string[]; err: string[] }> {
  const out: string[] = [];
  const err: string[] = [];
  const realLog = console.log;
  const realError = console.error;
  console.log = (line: unknown): void => {
    out.push(String(line));
  };
  console.error = (line: unknown): void => {
    err.push(String(line));
  };
  try {
    const code = await runValidateStatic(args);
    return { code, out, err };
  } finally {
    console.log = realLog;
    console.error = realError;
  }
}

async function readDoc(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
}

/** Copy one complete canonical set (documents plus icons directly under the root). */
async function makeCanonicalRoot(): Promise<string> {
  const root = join(tempDir, "canonical");
  await mkdir(join(root, "icons"), { recursive: true });
  for (const name of CANONICAL_DOCS) {
    await cp(join(VALID_FIXTURE, name), join(root, name));
  }
  await cp(join(VALID_FIXTURE, "public", "icons"), join(root, "icons"), { recursive: true });
  return root;
}

/** Copy one complete fixture set (documents plus icons under <dir>/public). */
async function makeFixture(name: string): Promise<string> {
  const dir = join(tempDir, name);
  await cp(VALID_FIXTURE, dir, { recursive: true });
  return dir;
}

/** Point the fixture's local_svg icon at a chosen bundle-relative path. */
async function setLocalSvgPath(fixtureDir: string, path: string): Promise<void> {
  const docPath = join(fixtureDir, "exercises.json");
  const doc = await readDoc(docPath);
  for (const exercise of doc["exercises"] as Array<Record<string, unknown>>) {
    const icon = exercise["icon"] as Record<string, unknown> | undefined;
    if (icon !== undefined && icon["type"] === "local_svg") {
      icon["path"] = path;
    }
  }
  await writeFile(docPath, JSON.stringify(doc));
}

/** Write one reviewed hostile SVG into the fixture's icon directory. */
async function writeHostileSvg(fixtureDir: string, hostileName: string): Promise<void> {
  const target = join(fixtureDir, "public", "icons", "exercises", "evil.svg");
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, await readFile(join(HOSTILE_SVGS, hostileName + ".svg")));
}

describe("canonical mode", () => {
  test("absent approved inputs are an explicit content blocker, never a pass", async () => {
    const before = (await readdir(join(REPO_ROOT, "src", "public"))).sort();
    const result = await runCommand([]);
    const after = (await readdir(join(REPO_ROOT, "src", "public"))).sort();
    expect(result.code).toBe(1);
    expect(result.out).toEqual([]);
    const blocker = result.err.find((line) => line.indexOf("canonical-content-missing") === 0);
    // The blocker names the fixed canonical location and every required document absent from it.
    expect(blocker !== undefined && blocker.indexOf(join(REPO_ROOT, "src", "public")) !== -1).toBe(true);
    for (const name of CANONICAL_DOCS) {
      if (!before.includes(name)) {
        expect(blocker !== undefined && blocker.indexOf(name) !== -1).toBe(true);
      }
    }
    expect(after).toEqual(before);
  });

  test("a complete unapproved set elsewhere is invisible to canonical mode", async () => {
    const root = await makeCanonicalRoot();
    const result = await runCommand([]);
    expect(result.code).toBe(1);
    expect(result.out).toEqual([]);
    const blocker = result.err.find((line) => line.indexOf("canonical-content-missing") === 0);
    expect(blocker !== undefined && blocker.indexOf(join(REPO_ROOT, "src", "public")) !== -1).toBe(true);
    // The unapproved directory is never read or reported as canonical content.
    expect(result.err.join("\n").indexOf(root) === -1).toBe(true);
  });

  test("--root is rejected as a usage error and never produces a canonical success", async () => {
    // The usage-error path exits the process, so it is probed at the command boundary, exactly
    // like the other exit-code-2 cases in this file.
    const root = await makeCanonicalRoot();
    const present = spawnSync("bun", ["scripts/validate-static.ts", "--root", root], { cwd: REPO_ROOT, encoding: "utf8" });
    expect(present.status).toBe(2);
    expect((present.stdout + present.stderr).indexOf("Usage error") !== -1).toBe(true);
    // Structurally valid unapproved content can never be reported as a canonical success.
    expect((present.stdout + present.stderr).indexOf("canonical static validation passed") === -1).toBe(true);
    const absent = spawnSync("bun", ["scripts/validate-static.ts", "--root", join(tempDir, "absent-root")], {
      cwd: REPO_ROOT,
      encoding: "utf8"
    });
    expect(absent.status).toBe(2);
    expect((absent.stdout + absent.stderr).indexOf("Usage error") !== -1).toBe(true);
  });

  test("--root cannot be smuggled in alongside an explicit fixture mode", async () => {
    const dir = await makeFixture("smuggled");
    const result = spawnSync("bun", ["scripts/validate-static.ts", "--fixture", dir, "--root", dir], {
      cwd: REPO_ROOT,
      encoding: "utf8"
    });
    expect(result.status).toBe(2);
    expect((result.stdout + result.stderr).indexOf("Usage error") !== -1).toBe(true);
  });
});

describe("fixture mode", () => {
  test("the reviewed valid fixture set passes deterministically", async () => {
    const dir = await makeFixture("good");
    const first = await runCommand(["--fixture", dir]);
    const second = await runCommand(["--fixture", dir]);
    expect(first.code).toBe(0);
    expect(second.code).toBe(0);
    expect(second.out).toEqual(first.out);
  });

  test("a missing selected input fails closed and names the file", async () => {
    const dir = await makeFixture("missing");
    await rm(join(dir, "workouts.json"));
    const result = await runCommand(["--fixture", dir]);
    expect(result.code).toBe(1);
    expect(result.err.some((line) => line.indexOf("static-input-missing") === 0 && line.indexOf("workouts.json") !== -1)).toBe(true);
  });

  test("malformed bytes fail closed without mutating the input", async () => {
    const dir = await makeFixture("malformed");
    const docPath = join(dir, "exercises.json");
    const corrupted = new TextEncoder().encode("\uFEFF{");
    await writeFile(docPath, corrupted);
    const result = await runCommand(["--fixture", dir]);
    expect(result.code).toBe(1);
    expect(result.err.some((line) => line.indexOf("static-json-invalid") === 0)).toBe(true);
    // The command is read-only: it never rewrites, repairs, or removes its inputs.
    expect(new Uint8Array(await readFile(docPath))).toEqual(corrupted);
  });

  test("an invalid Material Symbol manifest fails closed", async () => {
    const dir = await makeFixture("manifest");
    await writeFile(join(dir, "material-symbols.json"), JSON.stringify(["ok", ""]));
    const result = await runCommand(["--fixture", dir]);
    expect(result.code).toBe(1);
    expect(result.err.some((line) => line.indexOf("static-manifest-invalid") === 0)).toBe(true);
  });

  test("a wrong-family envelope fails at the schema gate", async () => {
    const dir = await makeFixture("family");
    const docPath = join(dir, "exercises.json");
    const doc = await readDoc(docPath);
    doc["format"] = "repjot/results";
    await writeFile(docPath, JSON.stringify(doc));
    const result = await runCommand(["--fixture", dir]);
    expect(result.code).toBe(1);
    expect(result.err.some((line) => line.indexOf("static-schema-invalid") === 0)).toBe(true);
  });

  test("a dangling exercise reference fails at the semantic gate", async () => {
    const dir = await makeFixture("semantic");
    const docPath = join(dir, "workouts.json");
    const doc = await readDoc(docPath);
    const visit = (node: Record<string, unknown>): void => {
      if (node["type"] === "exercise") {
        node["exerciseId"] = "ghost-exercise";
        return;
      }
      const children = node["children"] as Array<Record<string, unknown>> | undefined;
      if (Array.isArray(children)) for (const child of children) visit(child);
    };
    const root = (doc["workouts"] as Array<Record<string, unknown>>)[0]["root"] as Record<string, unknown>;
    visit(root);
    await writeFile(docPath, JSON.stringify(doc));
    const result = await runCommand(["--fixture", dir]);
    expect(result.code).toBe(1);
    expect(result.err.some((line) => line.indexOf("static-semantic-invalid") === 0)).toBe(true);
    expect(result.err.some((line) => line.indexOf("exercise-reference-missing") !== -1)).toBe(true);
  });

  const SVG_NEGATIVE_CASES: readonly (readonly [string, string, string])[] = [
    ["script content is rejected", "icons/exercises/evil.svg", "svg-forbidden-element"],
    ["event-handler attributes are rejected", "icons/exercises/evil.svg", "svg-event-attribute-forbidden"],
    ["external references are rejected", "icons/exercises/evil.svg", "svg-external-reference-forbidden"],
    ["malformed SVG bytes are rejected", "icons/exercises/evil.svg", "svg-malformed"],
    ["traversal paths are rejected at the schema gate", "icons/exercises/../workouts.svg", "static-schema-invalid"]
  ];

  for (const [label, path, expectedCode] of SVG_NEGATIVE_CASES) {
    test(label, async () => {
      const dir = await makeFixture("svg");
      await setLocalSvgPath(dir, path);
      if (expectedCode !== "static-schema-invalid") {
        const hostileName =
          expectedCode === "svg-forbidden-element"
            ? "script"
            : expectedCode === "svg-event-attribute-forbidden"
              ? "event"
              : expectedCode === "svg-external-reference-forbidden"
                ? "external-reference"
                : "malformed";
        await writeHostileSvg(dir, hostileName);
      }
      const result = await runCommand(["--fixture", dir]);
      expect(result.code).toBe(1);
      if (expectedCode === "static-schema-invalid") {
        expect(result.err.some((line) => line.indexOf("static-schema-invalid") === 0)).toBe(true);
      } else {
        expect(result.err.some((line) => line.indexOf("static-icon-invalid") === 0 && line.indexOf(expectedCode) !== -1)).toBe(
          true
        );
      }
    });
  }

  test("a missing SVG file is rejected", async () => {
    const dir = await makeFixture("svg-missing");
    await setLocalSvgPath(dir, "icons/exercises/absent.svg");
    const result = await runCommand(["--fixture", dir]);
    expect(result.code).toBe(1);
    expect(result.err.some((line) => line.indexOf("local-svg-missing") !== -1)).toBe(true);
  });

  test("restoring the fixture bytes recovers to a pass", async () => {
    const dir = await makeFixture("recover");
    const docPath = join(dir, "exercises.json");
    const before = await readFile(docPath);
    await writeFile(docPath, "{ broken");
    expect((await runCommand(["--fixture", dir])).code).toBe(1);
    await writeFile(docPath, before);
    const recovered = await runCommand(["--fixture", dir]);
    expect(recovered.code).toBe(0);
  });
});

describe("complete repository fixture set mode", () => {
  test("the repository fixture set passes and reports every selected set", async () => {
    const result = await runCommand(["--fixtures-root", join(REPO_ROOT, "tests", "fixtures", "static")]);
    expect(result.code).toBe(0);
    expect(result.out.some((line) => line === "valid: ok")).toBe(true);
    expect(result.out.some((line) => line.indexOf("validate:static ok") === 0)).toBe(true);
  });

  test("one broken set fails the whole run while valid sets are still reported", async () => {
    const root = join(tempDir, "sets");
    await cp(VALID_FIXTURE, join(root, "good"), { recursive: true });
    await cp(VALID_FIXTURE, join(root, "bad"), { recursive: true });
    await rm(join(root, "bad", "workouts.json"));
    const result = await runCommand(["--fixtures-root", root]);
    expect(result.code).toBe(1);
    expect(result.out.some((line) => line === "good: ok")).toBe(true);
    expect(result.err.some((line) => line.indexOf("bad: static-input-missing") === 0)).toBe(true);
    expect(result.err.some((line) => line.indexOf("validate:static FAILED") === 0)).toBe(true);
  });

  test("an empty fixtures root never passes silently", async () => {
    const root = join(tempDir, "empty");
    await mkdir(root);
    const result = await runCommand(["--fixtures-root", root]);
    expect(result.code).toBe(1);
    expect(result.err.some((line) => line.indexOf("fixtures-set-empty") === 0)).toBe(true);
  });

  test("a missing fixtures root fails closed", async () => {
    const result = await runCommand(["--fixtures-root", join(tempDir, "absent")]);
    expect(result.code).toBe(1);
    expect(result.err.some((line) => line.indexOf("static-input-missing") === 0)).toBe(true);
  });
});

describe("validate:schemas cross-file preference gate (PF-02, invariant 9)", () => {
  const CONTRACT_FIXTURES_DIR = join(REPO_ROOT, "tests", "fixtures", "contract-acceptance");

  /** One schema-valid but semantically hostile preferences document for the shared directory. */
  function hostilePreferences(): Record<string, unknown> {
    return {
      format: "repjot/preferences",
      schemaVersion: 1,
      revision: 0,
      updatedAtUtc: "2026-08-15T15:25:00Z",
      exerciseUnits: { "ghost-exercise": { weight: "lb" }, "back-squat": { calories: "kcal" } }
    };
  }

  /** Copy the repository contract-acceptance fixture set into a temporary directory. */
  async function makeContractSet(): Promise<string> {
    const dir = join(tempDir, "contract");
    await cp(CONTRACT_FIXTURES_DIR, dir, { recursive: true });
    return dir;
  }

  /** Run the schema gate over one selected fixture set and capture its own console output. */
  async function runSchemaGate(fixtureDir: string): Promise<{ code: number; out: string[] }> {
    const out: string[] = [];
    const realLog = console.log;
    console.log = (line: unknown): void => {
      out.push(String(line));
    };
    try {
      const code = runValidateSchemas(fixtureDir);
      return { code, out };
    } finally {
      console.log = realLog;
    }
  }

  test("schema-valid but incompatible preference mappings fail the gate", async () => {
    const dir = await makeContractSet();
    await writeFile(join(dir, "preferences.hostile.json"), JSON.stringify(hostilePreferences()));
    const result = await runSchemaGate(dir);
    expect(result.code).toBe(1);
    expect(result.out.some((line) => line.indexOf("FAILED   preferences.hostile.json (preference-semantic)") === 0)).toBe(true);
    expect(result.out.some((line) => line.indexOf("preference-exercise-unknown") !== -1)).toBe(true);
    expect(result.out.some((line) => line.indexOf("preference-dimension-unsupported") !== -1)).toBe(true);
    expect(result.out.some((line) => line === "validate:schemas FAILED")).toBe(true);
  });

  test("a unit absent from the exercise's supported list fails the gate", async () => {
    const dir = await makeContractSet();
    // Reduce back-squat's supported weight units to kg: the directory stays schema-valid, but the
    // accepted preferences.min.json (back-squat.weight = lb) is no longer compatible with it.
    const docPath = join(dir, "exercises.min.json");
    const doc = await readDoc(docPath);
    for (const exercise of doc["exercises"] as Array<Record<string, unknown>>) {
      if (exercise["id"] === "back-squat") {
        for (const measurement of exercise["measurements"] as Array<Record<string, unknown>>) {
          if (measurement["dimension"] === "weight") {
            measurement["compatibleUnits"] = ["kg"];
          }
        }
      }
    }
    await writeFile(docPath, JSON.stringify(doc));
    const result = await runSchemaGate(dir);
    expect(result.code).toBe(1);
    expect(result.out.some((line) => line.indexOf("FAILED   preferences.min.json (preference-semantic)") === 0)).toBe(true);
    expect(result.out.some((line) => line.indexOf("preference-unit-incompatible") !== -1)).toBe(true);
  });

  test("a missing shared exercises fixture fails the gate closed", async () => {
    const dir = await makeContractSet();
    await rm(join(dir, "exercises.min.json"));
    const result = await runSchemaGate(dir);
    expect(result.code).toBe(1);
    expect(result.out.some((line) => line.indexOf("no shared exercises.min.json") !== -1)).toBe(true);
  });

  test("removing the hostile fixture recovers to a pass", async () => {
    const dir = await makeContractSet();
    await writeFile(join(dir, "preferences.hostile.json"), JSON.stringify(hostilePreferences()));
    expect((await runSchemaGate(dir)).code).toBe(1);
    await rm(join(dir, "preferences.hostile.json"));
    const recovered = await runSchemaGate(dir);
    expect(recovered.code).toBe(0);
    expect(recovered.out.some((line) => line === "validate:schemas ok")).toBe(true);
  });
});

describe("complete bundle policy (Architecture \u00a718 gate 9, Requirements 2.1-2.3 and 7.5)", () => {
  const APP_DATA_SCOPE = "https://www.googleapis.com/auth/drive.appdata";
  const BROAD_DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";

  /** Copy the generated dist into a temp directory so probes never touch the repository output. */
  async function makeDistCopy(name: string): Promise<string> {
    const dir = join(tempDir, name);
    await cp(join(REPO_ROOT, "dist"), dir, { recursive: true });
    return dir;
  }

  test("the valid generated bundle passes the complete policy", async () => {
    const dir = await makeDistCopy("bundle-valid");
    expect(await runCheckBrowserCompat(dir)).toBe(0);
  });

  test("an extra broader scope literal fails the exact-scope gate", async () => {
    const dir = await makeDistCopy("bundle-scope-extra");
    await writeFile(join(dir, "app.js"), `${await readFile(join(dir, "app.js"), "utf8")}var __extra="${BROAD_DRIVE_SCOPE}";\n`);
    expect(await runCheckBrowserCompat(dir)).toBe(1);
  });

  test("required plus broader scope in one literal fails, in either order", async () => {
    for (const [name, combined] of [
      ["bundle-scope-appdata-first", `${APP_DATA_SCOPE} ${BROAD_DRIVE_SCOPE}`],
      ["bundle-scope-reordered", `${BROAD_DRIVE_SCOPE} ${APP_DATA_SCOPE}`]
    ] as const) {
      const dir = await makeDistCopy(name);
      const appPath = join(dir, "app.js");
      await writeFile(appPath, (await readFile(appPath, "utf8")).split(APP_DATA_SCOPE).join(combined));
      expect(await runCheckBrowserCompat(dir)).toBe(1);
    }
  });

  test("replacing the required scope with a broader one fails (required scope absent)", async () => {
    const dir = await makeDistCopy("bundle-scope-replaced");
    const appPath = join(dir, "app.js");
    await writeFile(appPath, (await readFile(appPath, "utf8")).split(APP_DATA_SCOPE).join(BROAD_DRIVE_SCOPE));
    expect(await runCheckBrowserCompat(dir)).toBe(1);
  });

  test("an unrelated set method cannot substitute for a URLSearchParams scope sink", async () => {
    const dir = await makeDistCopy("bundle-scope-lookalike-sink");
    await writeFile(
      join(dir, "app.js"),
      `var fake={set:function(){}};fake.set("scope","${APP_DATA_SCOPE}");\n`
    );
    expect(await runCheckBrowserCompat(dir)).toBe(1);
  });

  test("a locally shadowed URLSearchParams constructor cannot prove a native scope sink", async () => {
    const dir = await makeDistCopy("bundle-scope-shadowed-constructor");
    await writeFile(
      join(dir, "app.js"),
      `function URLSearchParams(){};URLSearchParams.prototype.set=function(){};var params=new URLSearchParams();params.set("scope","${APP_DATA_SCOPE}");\n`
    );
    expect(await runCheckBrowserCompat(dir)).toBe(1);
  });

  test("an exact concatenated URLSearchParams scope value passes", async () => {
    const dir = await makeDistCopy("bundle-scope-concatenation");
    await writeFile(
      join(dir, "app.js"),
      'var params=new URLSearchParams();params.set("scope","https://www.googleapis.com/"+"auth/drive.appdata");\n'
    );
    expect(await runCheckBrowserCompat(dir)).toBe(0);
  });

  test("an exact URLSearchParams scope value resolves through identifier aliases", async () => {
    const dir = await makeDistCopy("bundle-scope-alias-chain");
    await writeFile(
      join(dir, "app.js"),
      `var params=new URLSearchParams();var exact="${APP_DATA_SCOPE}";var alias=exact;params.set("scope",alias);\n`
    );
    expect(await runCheckBrowserCompat(dir)).toBe(0);
  });

  test("an exact scope value resolves through an assigned identifier alias chain", async () => {
    const dir = await makeDistCopy("bundle-scope-assigned-alias-chain");
    await writeFile(
      join(dir, "app.js"),
      `var params=new URLSearchParams();var exact;exact="${APP_DATA_SCOPE}";var alias=exact;params.set("scope",alias);\n`
    );
    expect(await runCheckBrowserCompat(dir)).toBe(0);
  });

  test("an exact statically evaluable template scope value passes", async () => {
    const dir = await makeDistCopy("bundle-scope-template-expression");
    await writeFile(
      join(dir, "app.js"),
      'var params=new URLSearchParams();var leaf="drive.appdata";params.set("scope",`https://www.googleapis.com/auth/${leaf}`);\n'
    );
    expect(await runCheckBrowserCompat(dir)).toBe(0);
  });

  const OPEN_CALL_VARIANTS: readonly (readonly [string, string])[] = [
    ["window bracket access", `window["open"]("about:blank");`],
    ["self dot access", `self.open("about:blank");`],
    ["globalThis bracket access", `globalThis["open"]("about:blank");`],
    ["indirect alias of a global", `var __w=window;__w["open"]("about:blank");`],
    ["alias of an alias", `var __a=self;var __b=__a;__b.open("about:blank");`],
    ["bare global call", `open("about:blank");`],
    ["document.defaultView access", `document.defaultView.open("x");`],
    ["sequence-expression wrapper (exact R6 probe)", `(0, window.open)("about:blank");`],
    ["function-value alias (exact R6 probe)", `var p10open = window.open; p10open("about:blank");`],
    ["alias of a function-value alias", `var p10open = window.open; var p10second = p10open; p10second("about:blank");`],
    ["direct call() invocation", `window.open.call(null, "about:blank");`],
    ["aliased apply() invocation", `var p10open = window.open; p10open.apply(null, ["about:blank"]);`],
    ["Reflect.apply of the global value", `Reflect.apply(window.open, null, ["about:blank"]);`],
    ["top-level reassignment of open keeps its provenance", `var open = window.open; open("about:blank");`]
  ];

  for (const [label, statement] of OPEN_CALL_VARIANTS) {
    test(`an equivalent popup call (${label}) fails the no-window gate`, async () => {
      const dir = await makeDistCopy("bundle-open");
      const appPath = join(dir, "app.js");
      await writeFile(appPath, `${await readFile(appPath, "utf8")}${statement}\n`);
      expect(await runCheckBrowserCompat(dir)).toBe(1);
    });
  }

  test("a non-window open call (IndexedDB) does not trip the no-window gate", async () => {
    const dir = await makeDistCopy("bundle-open-control");
    const appPath = join(dir, "app.js");
    await writeFile(appPath, `${await readFile(appPath, "utf8")}window.indexedDB.open("repjot",1);\n`);
    expect(await runCheckBrowserCompat(dir)).toBe(0);
  });

  test("a local function named open does not trip the no-window gate", async () => {
    const dir = await makeDistCopy("bundle-open-local-fn");
    const appPath = join(dir, "app.js");
    await writeFile(appPath, `${await readFile(appPath, "utf8")}function open(){return 1;}void open();\n`);
    expect(await runCheckBrowserCompat(dir)).toBe(0);
  });

  test("an unrelated object method and its alias do not trip the no-window gate", async () => {
    const dir = await makeDistCopy("bundle-open-unrelated");
    const appPath = join(dir, "app.js");
    await writeFile(
      appPath,
      `${await readFile(appPath, "utf8")}var p10store={open:function(){return 1;}};p10store.open();var p10m=p10store.open;p10m();\n`
    );
    expect(await runCheckBrowserCompat(dir)).toBe(0);
  });

  test("a parameter named open does not trip the no-window gate", async () => {
    const dir = await makeDistCopy("bundle-open-param");
    const appPath = join(dir, "app.js");
    await writeFile(appPath, `${await readFile(appPath, "utf8")}function f(open){ open(); } f(1);\n`);
    expect(await runCheckBrowserCompat(dir)).toBe(0);
  });

  test("a local shadow does not suppress a global bare call outside its scope (exact R7 probe)", async () => {
    const dir = await makeDistCopy("bundle-open-scope-shadow");
    const appPath = join(dir, "app.js");
    await writeFile(appPath, `${await readFile(appPath, "utf8")}function f(){let open=function(){};open();} open("x");\n`);
    expect(await runCheckBrowserCompat(dir)).toBe(1);
  });

  test("a local window parameter is not the global object (exact R7 probe)", async () => {
    const dir = await makeDistCopy("bundle-open-window-param");
    const appPath = join(dir, "app.js");
    await writeFile(appPath, `${await readFile(appPath, "utf8")}function f(window){var p=window.open;p();}\n`);
    expect(await runCheckBrowserCompat(dir)).toBe(0);
  });

  test("a direct member call on a local window parameter does not trip the gate", async () => {
    const dir = await makeDistCopy("bundle-open-window-param-direct");
    const appPath = join(dir, "app.js");
    await writeFile(appPath, `${await readFile(appPath, "utf8")}function f(window){ window.open("x"); }\n`);
    expect(await runCheckBrowserCompat(dir)).toBe(0);
  });

  test("nested functions with local shadows do not trip the gate", async () => {
    const dir = await makeDistCopy("bundle-open-nested-shadow");
    const appPath = join(dir, "app.js");
    await writeFile(
      appPath,
      `${await readFile(appPath, "utf8")}function outer(){ var w={open:function(){}}; function inner(w){ w.open(); } inner({}); }\n`
    );
    expect(await runCheckBrowserCompat(dir)).toBe(0);
  });

  test("a block-scoped local open does not suppress a global bare call after the block", async () => {
    const dir = await makeDistCopy("bundle-open-block-shadow");
    const appPath = join(dir, "app.js");
    await writeFile(appPath, `${await readFile(appPath, "utf8")}{ let open = function(){}; } open("y");\n`);
    expect(await runCheckBrowserCompat(dir)).toBe(1);
  });

  test("a global-object alias shadowed by a parameter does not trip the gate", async () => {
    const dir = await makeDistCopy("bundle-open-alias-shadow");
    const appPath = join(dir, "app.js");
    await writeFile(appPath, `${await readFile(appPath, "utf8")}var __w=window; function f(__w){ __w.open("x"); }\n`);
    expect(await runCheckBrowserCompat(dir)).toBe(0);
  });

  test("a global object call inside a function without shadowing still fails the gate", async () => {
    const dir = await makeDistCopy("bundle-open-in-fn");
    const appPath = join(dir, "app.js");
    await writeFile(appPath, `${await readFile(appPath, "utf8")}function f(){ self.open("x"); }\n`);
    expect(await runCheckBrowserCompat(dir)).toBe(1);
  });

  const OPEN_DATAFLOW_CASES: readonly (readonly [string, string, number])[] = [
    ["array declaration destructuring preserves global-open provenance", `var [p10array]=[window.open];p10array();`, 1],
    ["array assignment destructuring preserves global-open provenance", `var p10arrayassign;([p10arrayassign]=[window.open]);p10arrayassign();`, 1],
    ["global-open provenance crosses an alias chain longer than one hop", `var p10a=window.open;var p10b=p10a;var p10c=p10b;p10c();`, 1],
    ["a later local receiver assignment removes global-object provenance", `var p10receiver=window;p10receiver={open:function(){}};p10receiver.open();`, 0],
    ["a later local function assignment removes provenance for call invocation", `var p10call=window.open;p10call=function(){};p10call.call(null);`, 0]
  ];

  for (const [label, statement, expected] of OPEN_DATAFLOW_CASES) {
    test(label, async () => {
      const dir = await makeDistCopy("bundle-open-dataflow");
      const appPath = join(dir, "app.js");
      await writeFile(appPath, `${await readFile(appPath, "utf8")}${statement}\n`);
      expect(await runCheckBrowserCompat(dir)).toBe(expected);
    });
  }

  test("post-ES2019 syntax in an external executable output fails the ES2019 gate", async () => {
    const dir = await makeDistCopy("bundle-es2019-external");
    await writeFile(join(dir, "probe.js"), `var p=({}).missing?.value ?? 1;\n`);
    expect(await runCheckBrowserCompat(dir)).toBe(1);
  });

  test("post-ES2019 syntax appended to an emitted classic script fails the ES2019 gate", async () => {
    const dir = await makeDistCopy("bundle-es2019-classic-js");
    const path = join(dir, "capability-classic.js");
    await writeFile(path, `${await readFile(path, "utf8")}({}).missing?.value ?? 1;\n`);
    expect(await runCheckBrowserCompat(dir)).toBe(1);
  });

  for (const htmlName of ["capabilities.html", "index.html"] as const) {
    test(`post-ES2019 syntax in an executable inline script (${htmlName}) fails the ES2019 gate`, async () => {
      const dir = await makeDistCopy("bundle-es2019-inline");
      const path = join(dir, htmlName);
      const source = await readFile(path, "utf8");
      const at = source.lastIndexOf("</body>");
      await writeFile(path, `${source.slice(0, at)}<script>var q=({}).m?.n ?? 1;</script>\n${source.slice(at)}`);
      expect(await runCheckBrowserCompat(dir)).toBe(1);
    });
  }

  test("a referenced module .mjs file with post-ES2019 syntax fails the ES2019 gate (exact R6 probe)", async () => {
    const dir = await makeDistCopy("bundle-es2019-mjs");
    const path = join(dir, "capabilities.html");
    const source = await readFile(path, "utf8");
    const at = source.lastIndexOf("</body>");
    await writeFile(path, `${source.slice(0, at)}<script type="module" src="./probe.mjs"></script>\n${source.slice(at)}`);
    await writeFile(join(dir, "probe.mjs"), `var x = ({}).a?.b ?? 1;\n`);
    expect(await runCheckBrowserCompat(dir)).toBe(1);
  });

  test("a referenced .mjs file that is valid ES2019 passes the gate", async () => {
    const dir = await makeDistCopy("bundle-es2019-mjs-valid");
    const path = join(dir, "capabilities.html");
    const source = await readFile(path, "utf8");
    const at = source.lastIndexOf("</body>");
    await writeFile(path, `${source.slice(0, at)}<script type="module" src="./probe.mjs"></script>\n${source.slice(at)}`);
    await writeFile(join(dir, "probe.mjs"), `var x = ({}).a !== undefined ? 1 : 2;\n`);
    expect(await runCheckBrowserCompat(dir)).toBe(0);
  });

  test("a referenced extensionless local script with post-ES2019 syntax fails the ES2019 gate", async () => {
    const dir = await makeDistCopy("bundle-es2019-extensionless");
    const path = join(dir, "capabilities.html");
    const source = await readFile(path, "utf8");
    const at = source.lastIndexOf("</body>");
    await writeFile(path, `${source.slice(0, at)}<script src="./probe-es"></script>\n${source.slice(at)}`);
    await writeFile(join(dir, "probe-es"), `var z = ({}).a?.b ?? 1;\n`);
    expect(await runCheckBrowserCompat(dir)).toBe(1);
  });

  test("a referenced script path with a query string still parses the local bytes", async () => {
    const dir = await makeDistCopy("bundle-es2019-query");
    const path = join(dir, "capabilities.html");
    const source = await readFile(path, "utf8");
    const at = source.lastIndexOf("</body>");
    await writeFile(path, `${source.slice(0, at)}<script src="./probe-q.js?v=1"></script>\n${source.slice(at)}`);
    await writeFile(join(dir, "probe-q.js"), `var q2 = ({}).a?.b ?? 1;\n`);
    expect(await runCheckBrowserCompat(dir)).toBe(1);
  });

  test("a query string on an existing valid reference keeps the gate passing", async () => {
    const dir = await makeDistCopy("bundle-es2019-query-valid");
    const path = join(dir, "capabilities.html");
    await writeFile(path, (await readFile(path, "utf8")).replace('src="./capability-defer.js"', 'src="./capability-defer.js?v=9"'));
    expect(await runCheckBrowserCompat(dir)).toBe(0);
  });

  test("invalid JavaScript in an executable output fails the gate", async () => {
    const dir = await makeDistCopy("bundle-invalid-js");
    const path = join(dir, "capability-classic.js");
    await writeFile(path, `${await readFile(path, "utf8")}var broken = ;\n`);
    expect(await runCheckBrowserCompat(dir)).toBe(1);
  });

  test("a non-JavaScript data script is not parsed as executable JavaScript", async () => {
    const dir = await makeDistCopy("bundle-data-script");
    const path = join(dir, "capabilities.html");
    const source = await readFile(path, "utf8");
    const at = source.lastIndexOf("</body>");
    await writeFile(path, `${source.slice(0, at)}<script type="application/json">{"a": 1}</script>\n${source.slice(at)}`);
    expect(await runCheckBrowserCompat(dir)).toBe(0);
  });

  test("a referenced script missing from the output fails closed", async () => {
    const dir = await makeDistCopy("bundle-missing-ref");
    const path = join(dir, "capabilities.html");
    await writeFile(path, (await readFile(path, "utf8")).replace('src="./capability-defer.js"', 'src="./gone.js"'));
    expect(await runCheckBrowserCompat(dir)).toBe(1);
  });

  test("an absent dist directory fails closed", async () => {
    expect(await runCheckBrowserCompat(join(tempDir, "absent-dist"))).toBe(1);
  });

  test("restoring the exact output bytes recovers to a pass", async () => {
    const dir = await makeDistCopy("bundle-recover");
    const appPath = join(dir, "app.js");
    const before = await readFile(appPath);
    await writeFile(appPath, (await readFile(appPath, "utf8")).split(APP_DATA_SCOPE).join(BROAD_DRIVE_SCOPE));
    expect(await runCheckBrowserCompat(dir)).toBe(1);
    await writeFile(appPath, before);
    expect(await runCheckBrowserCompat(dir)).toBe(0);
  });

  test("the repository command runs the complete policy over the generated dist", () => {
    const result = spawnSync("bun", ["scripts/check-browser-compat.ts"], { cwd: REPO_ROOT, encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stdout.indexOf("parses as ES2019") !== -1).toBe(true);
  });
});

describe("repository command surface (process level)", () => {
  function bunRun(args: readonly string[]): { status: number; stdout: string; stderr: string } {
    const result = spawnSync("bun", ["run", ...args], { cwd: REPO_ROOT, encoding: "utf8" });
    return { status: result.status === null ? -1 : result.status, stdout: result.stdout, stderr: result.stderr };
  }

  test("validate:schemas compiles every schema and passes the contract fixtures", () => {
    const result = bunRun(["validate:schemas"]);
    expect(result.status).toBe(0);
    expect(result.stdout.indexOf("validate:schemas ok") !== -1).toBe(true);
  });

  test("validate:static reports the content blocker with a nonzero exit", () => {
    const result = bunRun(["validate:static"]);
    expect(result.status).toBe(1);
    expect(result.stderr.indexOf("canonical-content-missing") !== -1).toBe(true);
  });

  test("validate:static:fixtures validates the repository fixture set", () => {
    const result = bunRun(["validate:static:fixtures"]);
    expect(result.status).toBe(0);
    expect(result.stdout.indexOf("validate:static ok") !== -1).toBe(true);
  });

  test("compare:production fixture mode passes the compatible fixture and fails a broken set", () => {
    const good = bunRun(["compare:production", "--fixture", "tests/fixtures/compatibility/compatible"]);
    expect(good.status).toBe(0);
    expect(good.stdout.indexOf("result: compatible") !== -1).toBe(true);

    const bad = spawnSync(
      "bun",
      ["scripts/compare-production.ts", "--fixture", join(REPO_ROOT, "tests", "fixtures", "compatibility", "exercise-deleted")],
      { cwd: REPO_ROOT, encoding: "utf8" }
    );
    expect(bad.status === null ? -1 : bad.status).toBe(1);
    expect((bad.stdout + bad.stderr).indexOf("incompatible") !== -1).toBe(true);
  });

  test("a usage error exits with code 2", () => {
    const result = spawnSync("bun", ["scripts/validate-static.ts", "--bogus"], { cwd: REPO_ROOT, encoding: "utf8" });
    expect(result.status === null ? -1 : result.status).toBe(2);
  });
});

describe("build output determinism (P10-D008 / NEW-9, GATES.md §2)", () => {
  const DIST_DIR = join(REPO_ROOT, "dist");
  const MAIN_TS = join(REPO_ROOT, "src", "main.ts");

  function build(): number {
    const result = spawnSync("bun", ["run", "build"], { cwd: REPO_ROOT, encoding: "utf8" });
    return result.status === null ? -1 : result.status;
  }

  /** sha256 hex of every generated dist file, keyed by its relative path. */
  async function distDigests(): Promise<Record<string, string>> {
    const digests: Record<string, string> = {};
    async function walk(dir: string, prefix: string): Promise<void> {
      for (const entry of (await readdir(dir)).sort()) {
        const full = join(dir, entry);
        const rel = prefix === "" ? entry : `${prefix}/${entry}`;
        if ((await stat(full)).isDirectory()) {
          await walk(full, rel);
        } else {
          digests[rel] = createHash("sha256").update(await readFile(full)).digest("hex");
        }
      }
    }
    await walk(DIST_DIR, "");
    return digests;
  }

  /** The cache-busting token in the classic loader call, or null when absent. */
  function loaderToken(indexHtml: string): string | null {
    const match = /window\.__repjotLoadApp\("\.\/app\.js\?v=([a-f0-9]{64})"\)/.exec(indexHtml);
    return match === null ? null : match[1];
  }

  test("two unchanged builds emit byte-identical output with a content-derived token", async () => {
    expect(build()).toBe(0);
    const first = await distDigests();
    const indexFirst = await readFile(join(DIST_DIR, "index.html"), "utf8");
    const tokenFirst = loaderToken(indexFirst);
    // The cache-busting token is the sha256 of the emitted app.js bytes, not the wall clock.
    expect(tokenFirst).toBe(createHash("sha256").update(await readFile(join(DIST_DIR, "app.js"))).digest("hex"));

    // A fixed delay proves that elapsed wall-clock time does not affect the output.
    await new Promise((resolve) => setTimeout(resolve, 2000));
    expect(build()).toBe(0);
    expect(await distDigests()).toEqual(first);
    expect(await readFile(join(DIST_DIR, "index.html"), "utf8")).toBe(indexFirst);
  });

  test("a source change changes the token and restoring the bytes recovers it", async () => {
    const original = await readFile(MAIN_TS);
    try {
      expect(build()).toBe(0);
      const baseline = loaderToken(await readFile(join(DIST_DIR, "index.html"), "utf8"));
      expect(baseline).not.toBeNull();

      await writeFile(MAIN_TS, `${original.toString("utf8")}\nconsole.log("repjot determinism probe");\n`);
      expect(build()).toBe(0);
      const changed = loaderToken(await readFile(join(DIST_DIR, "index.html"), "utf8"));
      expect(changed).not.toBeNull();
      expect(changed).not.toBe(baseline);

      await writeFile(MAIN_TS, original);
      expect(build()).toBe(0);
      expect(loaderToken(await readFile(join(DIST_DIR, "index.html"), "utf8"))).toBe(baseline);
    } finally {
      await writeFile(MAIN_TS, original);
    }
  });
});
