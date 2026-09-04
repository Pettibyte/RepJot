/** Validate one static-data fixture directory. P7 keeps this command narrow: schemas, current static
 * semantics, the injected Material Symbol manifest, and trusted local SVG assets.
 *
 * Usage: bun scripts/validate-static.ts --fixture <directory>
 */
import { lstat, readFile, realpath } from "node:fs/promises";
import { resolve } from "node:path";

import { createProductionValidator } from "../src/validation/schema-validator";
import { validateStaticDocuments } from "../src/validation/semantic";
import { validateTrustedLocalIcons } from "../src/validation/semantic/icon-validation";
import type { IconFileAccess } from "../src/validation/semantic/icon-validation";

interface FixtureInput {
  readonly exercises: unknown;
  readonly workouts: unknown;
  readonly symbols: ReadonlySet<string>;
}

function fixtureArgument(args: readonly string[]): string | null {
  const index = args.indexOf("--fixture");
  if (index === -1 || index + 1 >= args.length || args[index + 1].length === 0) {
    return null;
  }
  return resolve(args[index + 1]);
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

async function readFixture(root: string): Promise<FixtureInput> {
  const exercises = await readJson(resolve(root, "exercises.json"));
  const workouts = await readJson(resolve(root, "workouts.json"));
  const manifest = await readJson(resolve(root, "material-symbols.json"));
  if (!Array.isArray(manifest) || manifest.some((name) => typeof name !== "string" || name.length === 0)) {
    throw new Error("material-symbols.json must be an array of non-empty symbol names");
  }
  return { exercises, workouts, symbols: new Set(manifest as string[]) };
}

function nodeFiles(staticRoot: string): IconFileAccess {
  return {
    rootRealPath: () => realpath(staticRoot),
    fileRealPath: async (candidatePath: string): Promise<string | null> => {
      try {
        const canonical = await realpath(candidatePath);
        const details = await lstat(canonical);
        return details.isFile() ? canonical : null;
      } catch (_error) {
        return null;
      }
    },
    readBytes: async (path: string) => new Uint8Array(await readFile(path))
  };
}

async function main(): Promise<number> {
  const root = fixtureArgument(process.argv.slice(2));
  if (root === null) {
    console.error("Usage: bun scripts/validate-static.ts --fixture <directory>");
    return 2;
  }

  let input: FixtureInput;
  try {
    input = await readFixture(root);
  } catch (_error) {
    console.error("Static validation failed: fixture files are missing or malformed.");
    return 1;
  }

  const schema = createProductionValidator();
  const exerciseSchema = schema.validate("exercises", 1, input.exercises);
  const workoutSchema = schema.validate("workouts", 1, input.workouts);
  if (!exerciseSchema.valid || !workoutSchema.valid) {
    console.error("Static validation failed: schema validation rejected a static document.");
    return 1;
  }

  const semantic = validateStaticDocuments(input.exercises, input.workouts);
  if (!semantic.valid) {
    for (const item of semantic.diagnostics) {
      console.error(item.code + " " + item.path);
    }
    return 1;
  }

  let icons;
  try {
    const staticRoot = resolve(root, "public");
    icons = await validateTrustedLocalIcons(input.exercises, {
      staticRoot,
      materialSymbols: input.symbols,
      files: nodeFiles(staticRoot)
    });
  } catch (_error) {
    console.error("Static validation failed: the static asset root is missing or unreadable.");
    return 1;
  }
  if (!icons.valid) {
    for (const item of icons.diagnostics) {
      console.error(item.code + " " + item.path);
    }
    return 1;
  }

  console.log("Static fixture validation passed.");
  return 0;
}

process.exitCode = await main();
