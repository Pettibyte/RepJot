/**
 * P8-T01 — Structural ingestion of one local free-exercise-db exercise document.
 *
 * Authority: docs/REQUIREMENTS.md 13.1-13.5; ../free-exercise-db/schema.json at baseline commit
 * b0eed061e1c832b3ed815fbaa4b45b3cdc14df49; specs/rep-jot-json-schema-spec.md Section 2.
 *
 * This module is pure: no file access, no clock, no randomness, no browser APIs. It validates one
 * already-parsed JSON value against the source schema's allowlists and fails closed with stable
 * diagnostic codes that name the offending field. The input is never mutated.
 */

/** Source ID pattern from ../free-exercise-db/schema.json. */
export const SOURCE_ID_PATTERN = /^[0-9a-zA-Z_-]+$/;

/** `force` values allowed by the source schema (null is handled separately). */
export const SOURCE_FORCE_VALUES: readonly string[] = ["pull", "push", "static"];

/** `level` values allowed by the source schema. */
export const SOURCE_LEVEL_VALUES: readonly string[] = ["beginner", "intermediate", "expert"];

/** `mechanic` values allowed by the source schema (null is handled separately). */
export const SOURCE_MECHANIC_VALUES: readonly string[] = ["compound", "isolation"];

/** Non-null `equipment` values allowed by the source schema. `body only` maps to no equipment. */
export const SOURCE_EQUIPMENT_VALUES: readonly string[] = [
  "medicine ball",
  "dumbbell",
  "body only",
  "bands",
  "kettlebells",
  "foam roll",
  "cable",
  "machine",
  "barbell",
  "exercise ball",
  "e-z curl bar",
  "other"
];

/** The 17-value muscle vocabulary retained by REP JOT (docs/REQUIREMENTS.md 13.3). */
export const SOURCE_MUSCLE_VALUES: readonly string[] = [
  "abdominals",
  "abductors",
  "adductors",
  "biceps",
  "calves",
  "chest",
  "forearms",
  "glutes",
  "hamstrings",
  "lats",
  "lower back",
  "middle back",
  "neck",
  "quadriceps",
  "shoulders",
  "traps",
  "triceps"
];

/** `category` values allowed by the source schema. */
export const SOURCE_CATEGORY_VALUES: readonly string[] = [
  "powerlifting",
  "strength",
  "stretching",
  "cardio",
  "olympic weightlifting",
  "strongman",
  "plyometrics"
];

/** One validated free-exercise-db exercise document. */
export interface SourceExercise {
  readonly id: string;
  readonly name: string;
  readonly force: string | null;
  readonly level: string;
  readonly mechanic: string | null;
  readonly equipment: string | null;
  readonly primaryMuscles: readonly string[];
  readonly secondaryMuscles: readonly string[];
  readonly instructions: readonly string[];
  readonly category: string;
  /** Validated for source shape only. Never copied into REP JOT output (no remote assets). */
  readonly images: readonly string[];
}

/** One stable ingestion or curation diagnostic. `sourceId` is set when attributable to one exercise. */
export interface CurationDiagnostic {
  readonly code: string;
  readonly sourceId: string | null;
  readonly message: string;
}

type SourceParseResult =
  | { readonly ok: true; readonly exercise: SourceExercise }
  | { readonly ok: false; readonly diagnostics: readonly CurationDiagnostic[] };

function isEnumValue(value: unknown, allowed: readonly string[]): boolean {
  return typeof value === "string" && allowed.indexOf(value) !== -1;
}

function isStringArray(value: unknown): value is string[] {
  if (!Array.isArray(value)) {
    return false;
  }
  for (const item of value) {
    if (typeof item !== "string") {
      return false;
    }
  }
  return true;
}

function isMuscleArray(value: unknown): value is string[] {
  if (!isStringArray(value)) {
    return false;
  }
  for (const item of value) {
    if (SOURCE_MUSCLE_VALUES.indexOf(item) === -1) {
      return false;
    }
  }
  return true;
}

/**
 * Validate one parsed source document. Returns every structural problem found so a human can
 * correct all of them in one pass. `body only` and `null` equipment are valid source shapes here;
 * their REP JOT resolution is owned by the transform (curation).
 */
export function parseSourceExercise(raw: unknown): SourceParseResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return {
      ok: false,
      diagnostics: [
        {
          code: "source-document-not-object",
          sourceId: null,
          message: "the source document is not a JSON object"
        }
      ]
    };
  }

  const record = raw as Record<string, unknown>;
  const diagnostics: CurationDiagnostic[] = [];

  let id: string | null = null;
  if (typeof record["id"] === "string" && SOURCE_ID_PATTERN.test(record["id"])) {
    id = record["id"];
  } else {
    diagnostics.push({
      code: "source-field-invalid",
      sourceId: null,
      message: 'field "id" is missing or does not match the source ID pattern'
    });
  }

  const report = (field: string, reason: string): void => {
    diagnostics.push({ code: "source-field-invalid", sourceId: id, message: 'field "' + field + '" ' + reason });
  };

  if (typeof record["name"] !== "string" || record["name"].length === 0) {
    report("name", "must be a non-empty string");
  }

  if (record["force"] !== null && !isEnumValue(record["force"], SOURCE_FORCE_VALUES)) {
    report("force", "must be one of " + SOURCE_FORCE_VALUES.join(", ") + " or null");
  }

  if (!isEnumValue(record["level"], SOURCE_LEVEL_VALUES)) {
    report("level", "must be one of " + SOURCE_LEVEL_VALUES.join(", "));
  }

  if (record["mechanic"] !== null && !isEnumValue(record["mechanic"], SOURCE_MECHANIC_VALUES)) {
    report("mechanic", "must be one of " + SOURCE_MECHANIC_VALUES.join(", ") + " or null");
  }

  if (record["equipment"] !== null && !isEnumValue(record["equipment"], SOURCE_EQUIPMENT_VALUES)) {
    report("equipment", "must be one of " + SOURCE_EQUIPMENT_VALUES.join(", ") + " or null");
  }

  if (!isMuscleArray(record["primaryMuscles"])) {
    report("primaryMuscles", "must be an array of allowed muscle values");
  }

  if (!isMuscleArray(record["secondaryMuscles"])) {
    report("secondaryMuscles", "must be an array of allowed muscle values");
  }

  if (!isStringArray(record["instructions"])) {
    report("instructions", "must be an array of strings");
  }

  if (!isEnumValue(record["category"], SOURCE_CATEGORY_VALUES)) {
    report("category", "must be one of " + SOURCE_CATEGORY_VALUES.join(", "));
  }

  if (!isStringArray(record["images"])) {
    report("images", "must be an array of strings");
  }

  if (diagnostics.length > 0) {
    return { ok: false, diagnostics };
  }

  const exercise: SourceExercise = {
    id: record["id"] as string,
    name: record["name"] as string,
    force: record["force"] === null ? null : (record["force"] as string),
    level: record["level"] as string,
    mechanic: record["mechanic"] === null ? null : (record["mechanic"] as string),
    equipment: record["equipment"] === null ? null : (record["equipment"] as string),
    primaryMuscles: record["primaryMuscles"] as string[],
    secondaryMuscles: record["secondaryMuscles"] as string[],
    instructions: record["instructions"] as string[],
    category: record["category"] as string,
    images: record["images"] as string[]
  };
  return { ok: true, exercise };
}
