/**
 * Build gate: compile every supported repository schema under Draft 2020-12 and validate the
 * approved Phase 1 contract-acceptance fixtures against them (P3-T01).
 *
 * The command reuses the single shared production registry (exact `$id`s, asserted `date-time`,
 * results' external reference to workouts available) for both reporting and fixture validation,
 * so the repository schemas compile once per process (ADR-005). It reports one line per supported
 * identity, then validates each fixture in `tests/fixtures/contract-acceptance/` by filename
 * family. Every schema and fixture file enters as exact bytes through the shared exact JSON
 * parser (`parseExactJson`, GATES.md Section 2): invalid UTF-8, a leading BOM, duplicate members
 * (including escape-equivalent names), and malformed JSON all fail closed with a nonzero exit,
 * and the input files are never mutated. A schema-valid preferences fixture additionally passes the cross-file semantic gate
 * (PF-02, invariant 9) against the shared `exercises.min.json` directory of the same fixture set
 * before it is accepted: the schema cannot see the static file, so a mapping for an unknown
 * exercise, an unsupported dimension, or an unsupported unit fails the command. Output is
 * deterministic: fixed line format, sorted fixture names, no timestamps or randomness. Exits 1
 * when any schema fails to compile or any fixture violates its schema or the semantic gate.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { parseExactJson } from "../src/curation/exact-json";
import type { ExactJsonResult } from "../src/curation/exact-json";

import {
  getProductionRegistry,
  SUPPORTED_SCHEMA_IDENTITIES
} from "../src/validation/schema-registry";
import type { DocumentFamily } from "../src/domain/families";
import { createProductionValidator } from "../src/validation/schema-validator";
import { validatePreferencesSemantics } from "../src/validation/semantic/index";

/** The shared exercise directory the contract-acceptance preferences fixtures pair with (invariant 9). */
const PREFERENCES_EXERCISES_FIXTURE = "exercises.min.json";

/** Read one ingress file as exact bytes and parse it with the exact JSON parser (GATES.md §2). */
function readExactJsonFile(path: string): ExactJsonResult {
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(readFileSync(path));
  } catch {
    return { ok: false, detail: "the file could not be read" };
  }
  return parseExactJson(bytes);
}

function defaultFixtureDir(): string {
  return fileURLToPath(new URL("../tests/fixtures/contract-acceptance/", import.meta.url));
}

function familyForFixture(name: string): DocumentFamily | null {
  if (name.indexOf("exercises.") === 0) {
    return "exercises";
  }
  if (name.indexOf("workouts.") === 0) {
    return "workouts";
  }
  if (name.indexOf("preferences.") === 0) {
    return "preferences";
  }
  if (name.indexOf("results.") === 0) {
    return "results";
  }
  return null;
}

/** Validate one contract-fixture directory (the repository contract-acceptance set is the default caller); returns the exit code. */
export function runValidateSchemas(fixtureDir: string): number {
  // One shared production registry for the whole command (ADR-005): reporting and fixture
  // validation below use the same compiled validators; the schemas compile exactly once.
  const registry = getProductionRegistry();
  let failed = false;

  for (const identity of SUPPORTED_SCHEMA_IDENTITIES) {
    if (registry.getValidator(identity.family, identity.version) !== null) {
      console.log("compiled " + identity.id);
    } else {
      console.log("FAILED   " + identity.id);
      failed = true;
    }
  }
  for (const problem of registry.problems) {
    console.log("problem  " + problem.code + " " + problem.id + ": " + problem.detail);
    failed = true;
  }

  const validator = createProductionValidator();
  const fixtureNames = readdirSync(fixtureDir)
    .filter((name) => name.indexOf(".json") === name.length - 5)
    .sort();

  for (const name of fixtureNames) {
    const family = familyForFixture(name);
    if (family === null) {
      console.log("FAILED   " + name + ": no family recognized from the fixture filename");
      failed = true;
      continue;
    }
    let document: unknown;
    const fixtureIngress = readExactJsonFile(join(fixtureDir, name));
    if (!fixtureIngress.ok) {
      console.log("FAILED   " + name + ": fixture is not exact ingress JSON (" + fixtureIngress.detail + ")");
      failed = true;
      continue;
    }
    document = fixtureIngress.value;
    const result = validator.validate(family, 1, document);
    if (result.valid) {
      // PF-02 / invariant 9: a schema-valid preferences fixture must also resolve every mapping
      // against the shared exercise directory before it is accepted (schema-only validation
      // cannot see the static file). The exercises context is a required input fact of the gate:
      // without it invariant 9 cannot be proven, so the command fails closed.
      if (family === "preferences") {
        const exercisesIngress = readExactJsonFile(join(fixtureDir, PREFERENCES_EXERCISES_FIXTURE));
        if (!exercisesIngress.ok) {
          const detail =
            exercisesIngress.detail === "the file could not be read"
              ? "no shared " + PREFERENCES_EXERCISES_FIXTURE + " for cross-file preference validation"
              : "shared " + PREFERENCES_EXERCISES_FIXTURE + " is not exact ingress JSON (" + exercisesIngress.detail + ")";
          console.log("FAILED   " + name + ": " + detail);
          failed = true;
          continue;
        }
        const semantic = validatePreferencesSemantics(document, exercisesIngress.value);
        if (!semantic.valid) {
          console.log("FAILED   " + name + " (preference-semantic)");
          for (const diagnostic of semantic.diagnostics) {
            console.log("  " + diagnostic.code + " " + diagnostic.path + ": " + diagnostic.message);
          }
          failed = true;
          continue;
        }
      }
      console.log("valid    " + name);
    } else {
      console.log("FAILED   " + name + " (" + result.code + ")");
      for (const error of result.errors) {
        const property = error["property"] !== undefined ? " " + error["property"] : "";
        console.log("  " + error.instancePath + " " + error.keyword + property + ": " + error.message);
      }
      failed = true;
    }
  }

  console.log(failed ? "validate:schemas FAILED" : "validate:schemas ok");
  return failed ? 1 : 0;
}

// Runs only when executed directly (`bun scripts/validate-schemas.ts`), not when imported by tests.
if (import.meta.main) {
  process.exitCode = runValidateSchemas(defaultFixtureDir());
}
