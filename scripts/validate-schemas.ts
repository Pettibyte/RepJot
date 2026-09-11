/**
 * Validates every checked-in REP JOT JSON Schema with Ajv.
 *
 * Checks that each file is a valid Draft 2020-12 schema and compiles under Ajv
 * strict mode. This script validates schemas only. It reads no data files and
 * creates no fixtures.
 *
 * Usage: bun run check:schemas
 */

import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const SCHEMA_ROOT = new URL("../schemas/", import.meta.url).pathname;

const FAMILIES = ["exercises", "workouts", "preferences", "results"];

function listSchemaFiles(family: string): string[] {
  const dir = join(SCHEMA_ROOT, family);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".schema.json"))
    .sort();
}

const ajv = new Ajv2020({ strict: true });
// The spec requires the validator to assert formats, not treat them as annotations.
addFormats(ajv, { assertion: true });

let failed = 0;

for (const family of FAMILIES) {
  const files = listSchemaFiles(family);
  if (files.length === 0) {
    console.error(`${family}: no schema files found in ${SCHEMA_ROOT}${family}`);
    failed += 1;
    continue;
  }

  for (const file of files) {
    const path = join(SCHEMA_ROOT, family, file);
    let schema: unknown;
    try {
      schema = JSON.parse(readFileSync(path, "utf8"));
    } catch (error) {
      console.error(`${family}/${file}: invalid JSON: ${(error as Error).message}`);
      failed += 1;
      continue;
    }

    try {
      ajv.addSchema(schema);
      console.log(`${family}/${file}: valid Draft 2020-12 schema`);
    } catch (error) {
      console.error(`${family}/${file}: ${(error as Error).message}`);
      failed += 1;
    }
  }
}

if (failed > 0) {
  console.error(`\n${failed} schema check(s) failed.`);
  process.exit(1);
}

console.log("\nAll schemas valid.");
