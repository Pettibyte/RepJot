/**
 * Build gate: compile every supported repository schema under Draft 2020-12 and validate the
 * approved Phase 1 contract-acceptance fixtures against them (P3-T01).
 *
 * The command reuses the single shared production registry (exact `$id`s, asserted `date-time`,
 * results' external reference to workouts available) for both reporting and fixture validation,
 * so the repository schemas compile once per process (ADR-005). It reports one line per supported
 * identity, then validates each fixture in `tests/fixtures/contract-acceptance/` by filename
 * family. Output is
 * deterministic: fixed line format, sorted fixture names, no timestamps or randomness. Exits 1
 * when any schema fails to compile or any fixture violates its schema.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  getProductionRegistry,
  SUPPORTED_SCHEMA_IDENTITIES
} from "../src/validation/schema-registry";
import type { DocumentFamily } from "../src/domain/families";
import { createProductionValidator } from "../src/validation/schema-validator";

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

function main(): number {
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
  const fixtureDir = fileURLToPath(new URL("../tests/fixtures/contract-acceptance/", import.meta.url));
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
    try {
      document = JSON.parse(readFileSync(fixtureDir + name, "utf8"));
    } catch (error) {
      console.log("FAILED   " + name + ": fixture is not valid JSON");
      failed = true;
      continue;
    }
    const result = validator.validate(family, 1, document);
    if (result.valid) {
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

process.exitCode = main();
