/**
 * P10-D003 — Exact schema-command ingress (GATES.md §2 malformed-input and unchanged-byte rules).
 *
 * `validate:schemas` must read every contract fixture and repository schema as exact bytes through
 * the shared exact JSON parser: invalid UTF-8, a leading BOM, duplicate members (including
 * escape-equivalent names), malformed JSON, and schema compile errors all return nonzero; the
 * input files are never mutated; restoring valid bytes makes the command pass again.
 *
 * Fixture-level cases run `runValidateSchemas` in-process on a temporary copy of the repository
 * contract-acceptance set (importing the module must not execute the command as a side effect).
 * Schema-file cases run the real command at the process boundary because the production registry
 * is built once per process from the fixed repository schema paths. The corrupted schema file is
 * restored byte-for-byte in `finally`, and the recovered run is proven to pass. No randomness,
 * no network, no clock: every expectation is deterministic.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runValidateSchemas } from "../../scripts/validate-schemas";

const REPO_ROOT = join(import.meta.dir, "..", "..");
const CONTRACT_FIXTURES = join(REPO_ROOT, "tests", "fixtures", "contract-acceptance");
const SCHEMA_PATH = join(REPO_ROOT, "schemas", "exercises", "v1.schema.json");
const TARGET_FIXTURE = "workouts.scenario.json";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "repjot-ingress-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

/** Copy the repository contract-acceptance fixture set into a temporary directory. */
function makeContractSet(): string {
  const dir = join(tempDir, "contract");
  cpSync(CONTRACT_FIXTURES, dir, { recursive: true });
  return dir;
}

/** Run the schema gate over one selected fixture set and capture its own console output. */
function runSchemaGate(fixtureDir: string): { code: number; out: string[] } {
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

function targetPath(dir: string): string {
  return join(dir, TARGET_FIXTURE);
}

describe("exact fixture ingress", () => {
  test("the valid repository contract set passes, with and without a trailing slash", () => {
    const dir = makeContractSet();
    expect(runSchemaGate(dir).code).toBe(0);
    const slashed = runSchemaGate(dir + "/");
    expect(slashed.code).toBe(0);
    expect(slashed.out.some((line) => line === "validate:schemas ok")).toBe(true);
  });

  test("an ordinary duplicate member fails closed and leaves the bytes unchanged", () => {
    const dir = makeContractSet();
    const path = targetPath(dir);
    const original = readFileSync(path);
    const text = Buffer.from(original).toString("utf8");
    const corrupted = Buffer.from(
      text.replace('"id": "cindy-omission"', '"id": "cindy-omission", "id": "cindy-omission"'),
      "utf8"
    );
    writeFileSync(path, corrupted);
    const result = runSchemaGate(dir);
    expect(result.code).toBe(1);
    expect(
      result.out.some((line) => line.indexOf("FAILED   " + TARGET_FIXTURE) === 0 && line.indexOf("duplicate member") !== -1)
    ).toBe(true);
    expect(readFileSync(path)).toEqual(corrupted);
    writeFileSync(path, original);
  });

  test("an escape-equivalent duplicate member fails closed and leaves the bytes unchanged", () => {
    const dir = makeContractSet();
    const path = targetPath(dir);
    const original = readFileSync(path);
    const text = Buffer.from(original).toString("utf8");
    // "\u0069\u0064" decodes to the same member name as "id".
    const corrupted = Buffer.from(
      text.replace('"id": "cindy-omission"', '"\\u0069\\u0064": "cindy-omission", "id": "cindy-omission"'),
      "utf8"
    );
    writeFileSync(path, corrupted);
    const result = runSchemaGate(dir);
    expect(result.code).toBe(1);
    expect(
      result.out.some((line) => line.indexOf("FAILED   " + TARGET_FIXTURE) === 0 && line.indexOf("duplicate member") !== -1)
    ).toBe(true);
    expect(readFileSync(path)).toEqual(corrupted);
    writeFileSync(path, original);
  });

  test("invalid UTF-8 fails closed and leaves the bytes unchanged", () => {
    const dir = makeContractSet();
    const path = targetPath(dir);
    const original = readFileSync(path);
    const text = Buffer.from(original).toString("utf8");
    const index = text.indexOf("cindy-omission");
    expect(index).toBeGreaterThan(-1);
    const corrupted = Buffer.from(text, "utf8");
    // A stray 0xFF byte is never a valid UTF-8 leading byte.
    corrupted[index] = 0xff;
    writeFileSync(path, corrupted);
    const result = runSchemaGate(dir);
    expect(result.code).toBe(1);
    expect(
      result.out.some((line) => line.indexOf("FAILED   " + TARGET_FIXTURE) === 0 && line.indexOf("invalid UTF-8") !== -1)
    ).toBe(true);
    expect(readFileSync(path)).toEqual(corrupted);
    writeFileSync(path, original);
  });

  test("a leading byte-order mark fails closed and leaves the bytes unchanged", () => {
    const dir = makeContractSet();
    const path = targetPath(dir);
    const original = readFileSync(path);
    const corrupted = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), original]);
    writeFileSync(path, corrupted);
    const result = runSchemaGate(dir);
    expect(result.code).toBe(1);
    expect(
      result.out.some((line) => line.indexOf("FAILED   " + TARGET_FIXTURE) === 0 && line.indexOf("byte-order mark") !== -1)
    ).toBe(true);
    expect(readFileSync(path)).toEqual(corrupted);
    writeFileSync(path, original);
  });

  test("malformed JSON fails closed and leaves the bytes unchanged", () => {
    const dir = makeContractSet();
    const path = targetPath(dir);
    const original = readFileSync(path);
    const corrupted = Buffer.from(original.subarray(0, 100));
    writeFileSync(path, corrupted);
    const result = runSchemaGate(dir);
    expect(result.code).toBe(1);
    expect(result.out.some((line) => line.indexOf("FAILED   " + TARGET_FIXTURE) === 0)).toBe(true);
    expect(readFileSync(path)).toEqual(corrupted);
    writeFileSync(path, original);
  });

  test("a duplicate member in the shared exercises fixture fails the cross-file gate closed", () => {
    const dir = makeContractSet();
    const path = join(dir, "exercises.min.json");
    const original = readFileSync(path);
    const text = Buffer.from(original).toString("utf8");
    expect(text.indexOf('"id": "back-squat"')).toBeGreaterThan(-1);
    writeFileSync(
      path,
      text.replace('"id": "back-squat"', '"id": "back-squat", "id": "back-squat"')
    );
    const result = runSchemaGate(dir);
    expect(result.code).toBe(1);
    expect(result.out.some((line) => line.indexOf("exercises.min.json") !== -1 && line.indexOf("duplicate member") !== -1)).toBe(true);
    expect(readFileSync(path)).toEqual(Buffer.from(text.replace('"id": "back-squat"', '"id": "back-squat", "id": "back-squat"'), "utf8"));
    writeFileSync(path, original);
  });

  test("restoring the valid bytes recovers to a pass", () => {
    const dir = makeContractSet();
    const path = targetPath(dir);
    const original = readFileSync(path);
    writeFileSync(path, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), original]));
    expect(runSchemaGate(dir).code).toBe(1);
    writeFileSync(path, original);
    const recovered = runSchemaGate(dir);
    expect(recovered.code).toBe(0);
    expect(recovered.out.some((line) => line === "validate:schemas ok")).toBe(true);
  });
});

describe("exact schema-file ingress (process boundary)", () => {
  function runCommand(): { status: number; out: string } {
    const result = spawnSync("bun", ["scripts/validate-schemas.ts"], { cwd: REPO_ROOT, encoding: "utf8" });
    return { status: result.status === null ? -1 : result.status, out: result.stdout + result.stderr };
  }

  test("a duplicate member in a repository schema file fails the command closed and recovers", () => {
    const original = readFileSync(SCHEMA_PATH);
    try {
      const text = Buffer.from(original).toString("utf8");
      const idIndex = text.indexOf('"$id"');
      expect(idIndex).toBeGreaterThan(-1);
      // "\u0024\u0069d" decodes to the same member name as "$id".
      const corruptedText =
        text.slice(0, idIndex) +
        '"\\u0024\\u0069d": "https://repjot.com/schemas/exercises/v1.schema.json", ' +
        text.slice(idIndex);
      const corrupted = Buffer.from(corruptedText, "utf8");
      writeFileSync(SCHEMA_PATH, corrupted);
      const failed = runCommand();
      expect(failed.status).toBe(1);
      expect(failed.out.indexOf("schema-ingress") !== -1).toBe(true);
      // The command is read-only: the corrupted bytes are still exactly on disk.
      expect(readFileSync(SCHEMA_PATH)).toEqual(corrupted);

      writeFileSync(SCHEMA_PATH, original);
      const recovered = runCommand();
      expect(recovered.status).toBe(0);
      expect(recovered.out.indexOf("validate:schemas ok") !== -1).toBe(true);
    } finally {
      if (!readFileSync(SCHEMA_PATH).equals(original)) {
        writeFileSync(SCHEMA_PATH, original);
      }
    }
  });
});
