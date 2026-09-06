/**
 * P8-T01 — Strict parsing of the REP JOT exercise curation document.
 *
 * Authority: docs/REQUIREMENTS.md 13.2-13.5; specs/rep-jot-json-schema-spec.md Section 2
 * (classification enums, measurements and units, load semantics); ../free-exercise-db/schema.json
 * for the source equipment vocabulary referenced by the mapping registry.
 *
 * The curation document is explicit human input. This module is pure: no file access, no clock,
 * no randomness, no browser APIs. Every field is validated against allowlists; unknown keys and
 * values fail closed with stable diagnostic codes that name the exercise and field.
 */
import { SOURCE_EQUIPMENT_VALUES, SOURCE_MUSCLE_VALUES } from "./source";
import type { CurationDiagnostic } from "./source";

/** Laterality values from specs/rep-jot-json-schema-spec.md Section 2. */
export const LATERALITY_VALUES: readonly string[] = ["bilateral", "unilateral"];

/** Movement pattern values from specs/rep-jot-json-schema-spec.md Section 2. */
export const MOVEMENT_PATTERN_VALUES: readonly string[] = [
  "squat",
  "hinge",
  "horizontal_push",
  "vertical_push",
  "horizontal_pull",
  "vertical_pull",
  "carry",
  "locomotion",
  "rotation",
  "anti_rotation",
  "flexion",
  "extension",
  "other"
];

/** Load semantics values from specs/rep-jot-json-schema-spec.md Section 2. */
export const LOAD_SEMANTIC_VALUES: readonly string[] = ["total", "per_implement", "added", "assisted"];

/** REP JOT retains the source muscle vocabulary (docs/REQUIREMENTS.md 13.3). */
export const MUSCLE_VALUES: readonly string[] = SOURCE_MUSCLE_VALUES;

/** Dimension to compatible-unit table from specs/rep-jot-json-schema-spec.md Section 2. */
export const MEASUREMENT_COMPATIBLE_UNITS: Readonly<Record<string, readonly string[]>> = {
  reps: ["rep"],
  weight: ["kg", "lb"],
  addedWeight: ["kg", "lb"],
  assistedWeight: ["kg", "lb"],
  distance: ["m", "km", "ft", "mi"],
  duration: ["second", "minute"],
  calories: ["kcal"]
};

/** One curated equipment entity. `source` binds it to one non-`body only` source equipment value. */
export interface CurationEquipment {
  readonly id: string;
  readonly name: string;
  readonly source?: string;
}

/** One curated measurement support entry. */
export interface CurationMeasurement {
  readonly dimension: string;
  readonly compatibleUnits: readonly string[];
}

/** One explicit curation entry for one source exercise. */
export interface CurationExerciseEntry {
  readonly sourceId: string;
  readonly laterality: string;
  readonly movementPattern: string;
  readonly measurements: readonly CurationMeasurement[];
  readonly loadSemantics?: string;
  /** Explicit equipment override; required when the source equipment is null or unmapped. */
  readonly equipmentIds?: readonly string[];
  readonly primaryMuscles?: readonly string[];
  readonly secondaryMuscles?: readonly string[];
}

/** The complete curation document: equipment registry plus one entry per published exercise. */
export interface CurationDocument {
  readonly format: "repjot/curation/exercises";
  readonly schemaVersion: 1;
  readonly equipment: readonly CurationEquipment[];
  readonly exercises: readonly CurationExerciseEntry[];
}

type CurationParseResult =
  | { readonly ok: true; readonly document: CurationDocument }
  | { readonly ok: false; readonly diagnostics: readonly CurationDiagnostic[] };

function isEnumValue(value: unknown, allowed: readonly string[]): boolean {
  return typeof value === "string" && allowed.indexOf(value) !== -1;
}

function hasOnlyKeys(record: Record<string, unknown>, allowed: readonly string[]): boolean {
  for (const key of Object.keys(record)) {
    if (allowed.indexOf(key) === -1) {
      return false;
    }
  }
  return true;
}

function validateMeasurement(
  raw: unknown,
  sourceId: string,
  diagnostics: CurationDiagnostic[]
): CurationMeasurement | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    diagnostics.push({
      code: "curation-measurement-invalid",
      sourceId,
      message: 'field "measurements" item is not an object'
    });
    return null;
  }
  const record = raw as Record<string, unknown>;
  if (!hasOnlyKeys(record, ["dimension", "compatibleUnits"])) {
    diagnostics.push({
      code: "curation-measurement-invalid",
      sourceId,
      message: 'field "measurements" item has unknown keys (allowed: dimension, compatibleUnits)'
    });
    return null;
  }
  const dimension = record["dimension"];
  if (typeof dimension !== "string" || MEASUREMENT_COMPATIBLE_UNITS[dimension] === undefined) {
    diagnostics.push({
      code: "curation-measurement-invalid",
      sourceId,
      message: 'field "measurements" item has unknown or missing dimension "' + String(dimension) + '"'
    });
    return null;
  }
  const units = record["compatibleUnits"];
  if (!Array.isArray(units) || units.length === 0) {
    diagnostics.push({
      code: "curation-measurement-invalid",
      sourceId,
      message: 'field "measurements" item for dimension "' + dimension + '" needs a non-empty compatibleUnits array'
    });
    return null;
  }
  const allowed = MEASUREMENT_COMPATIBLE_UNITS[dimension];
  for (const unit of units) {
    if (typeof unit !== "string" || allowed.indexOf(unit) === -1) {
      diagnostics.push({
        code: "curation-measurement-invalid",
        sourceId,
        message:
          'field "measurements" item for dimension "' +
          dimension +
          '" has incompatible unit "' +
          String(unit) +
          '" (allowed: ' +
          allowed.join(", ") +
          ")"
      });
      return null;
    }
  }
  return { dimension, compatibleUnits: units as string[] };
}

function validateEntry(raw: unknown, diagnostics: CurationDiagnostic[]): CurationExerciseEntry | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    diagnostics.push({ code: "curation-entry-invalid-field", sourceId: null, message: "entry is not an object" });
    return null;
  }
  const record = raw as Record<string, unknown>;
  const allowedKeys = [
    "sourceId",
    "laterality",
    "movementPattern",
    "measurements",
    "loadSemantics",
    "equipmentIds",
    "primaryMuscles",
    "secondaryMuscles"
  ];
  if (!hasOnlyKeys(record, allowedKeys)) {
    diagnostics.push({
      code: "curation-entry-invalid-field",
      sourceId: typeof record["sourceId"] === "string" ? record["sourceId"] : null,
      message: "entry has unknown keys (allowed: " + allowedKeys.join(", ") + ")"
    });
    return null;
  }

  const sourceId = record["sourceId"];
  if (typeof sourceId !== "string" || sourceId.length === 0) {
    diagnostics.push({
      code: "curation-entry-invalid-field",
      sourceId: null,
      message: 'field "sourceId" must be a non-empty string'
    });
    return null;
  }

  const bad = (field: string, reason: string): void => {
    diagnostics.push({ code: "curation-entry-invalid-field", sourceId, message: 'field "' + field + '" ' + reason });
  };
  const loadBad = (reason: string): void => {
    diagnostics.push({ code: "curation-load-semantics-invalid", sourceId, message: 'field "loadSemantics" ' + reason });
  };

  if (!isEnumValue(record["laterality"], LATERALITY_VALUES)) {
    bad("laterality", "must be one of " + LATERALITY_VALUES.join(", "));
  }
  if (!isEnumValue(record["movementPattern"], MOVEMENT_PATTERN_VALUES)) {
    bad("movementPattern", "must be one of " + MOVEMENT_PATTERN_VALUES.join(", "));
  }

  const measurementsRaw = record["measurements"];
  let measurements: CurationMeasurement[] = [];
  if (!Array.isArray(measurementsRaw) || measurementsRaw.length === 0) {
    bad("measurements", "must be a non-empty array");
  } else {
    const seenDimensions: string[] = [];
    for (const item of measurementsRaw) {
      const measurement = validateMeasurement(item, sourceId, diagnostics);
      if (measurement !== null) {
        if (seenDimensions.indexOf(measurement.dimension) !== -1) {
          bad("measurements", "lists dimension \"" + measurement.dimension + "\" more than once");
        } else {
          seenDimensions.push(measurement.dimension);
          measurements.push(measurement);
        }
      }
    }
  }

  const hasWeight = measurements.some((m) => m.dimension === "weight");
  const hasAddedWeight = measurements.some((m) => m.dimension === "addedWeight");
  const hasAssistedWeight = measurements.some((m) => m.dimension === "assistedWeight");
  const loadSemantics = record["loadSemantics"];
  if (hasWeight || hasAddedWeight || hasAssistedWeight) {
    if (!isEnumValue(loadSemantics, LOAD_SEMANTIC_VALUES)) {
      loadBad("is required because a load dimension is present (" + LOAD_SEMANTIC_VALUES.join(", ") + ")");
    } else if (hasWeight && (loadSemantics !== "total" && loadSemantics !== "per_implement")) {
      loadBad("must be total or per_implement when the weight dimension is present");
    } else if (hasAddedWeight && loadSemantics !== "added") {
      loadBad("must be added when the addedWeight dimension is present");
    } else if (hasAssistedWeight && loadSemantics !== "assisted") {
      loadBad("must be assisted when the assistedWeight dimension is present");
    }
  } else if (loadSemantics !== undefined) {
    loadBad("is only allowed when a load dimension (weight, addedWeight, assistedWeight) is present");
  }

  let equipmentIds: string[] | undefined;
  if (record["equipmentIds"] !== undefined) {
    const rawIds = record["equipmentIds"];
    if (!Array.isArray(rawIds)) {
      bad("equipmentIds", "must be an array of equipment IDs");
    } else {
      equipmentIds = [];
      for (const item of rawIds) {
        if (typeof item !== "string" || item.length === 0) {
          bad("equipmentIds", 'contains a non-string or empty ID "' + String(item) + '"');
        } else {
          equipmentIds.push(item);
        }
      }
    }
  }

  let primaryMuscles: string[] | undefined;
  if (record["primaryMuscles"] !== undefined) {
    if (!Array.isArray(record["primaryMuscles"])) {
      bad("primaryMuscles", "must be an array of muscle values");
    } else {
      primaryMuscles = [];
      for (const item of record["primaryMuscles"] as unknown[]) {
        if (!isEnumValue(item, MUSCLE_VALUES)) {
          bad("primaryMuscles", 'value "' + String(item) + '" is not an allowed muscle');
        } else {
          primaryMuscles.push(item as string);
        }
      }
    }
  }

  let secondaryMuscles: string[] | undefined;
  if (record["secondaryMuscles"] !== undefined) {
    if (!Array.isArray(record["secondaryMuscles"])) {
      bad("secondaryMuscles", "must be an array of muscle values");
    } else {
      secondaryMuscles = [];
      for (const item of record["secondaryMuscles"] as unknown[]) {
        if (!isEnumValue(item, MUSCLE_VALUES)) {
          bad("secondaryMuscles", 'value "' + String(item) + '" is not an allowed muscle');
        } else {
          secondaryMuscles.push(item as string);
        }
      }
    }
  }

  // Placeholder values are safe: the caller rejects the whole document when any diagnostic exists.
  const entry: {
    sourceId: string;
    laterality: string;
    movementPattern: string;
    measurements: CurationMeasurement[];
    loadSemantics?: string;
    equipmentIds?: string[];
    primaryMuscles?: string[];
    secondaryMuscles?: string[];
  } = {
    sourceId,
    laterality: isEnumValue(record["laterality"], LATERALITY_VALUES) ? (record["laterality"] as string) : "bilateral",
    movementPattern: isEnumValue(record["movementPattern"], MOVEMENT_PATTERN_VALUES)
      ? (record["movementPattern"] as string)
      : "other",
    measurements
  };
  if (isEnumValue(loadSemantics, LOAD_SEMANTIC_VALUES)) {
    entry.loadSemantics = loadSemantics as string;
  }
  if (equipmentIds !== undefined) {
    entry.equipmentIds = equipmentIds;
  }
  if (primaryMuscles !== undefined && primaryMuscles.length > 0) {
    entry.primaryMuscles = primaryMuscles;
  }
  if (secondaryMuscles !== undefined) {
    entry.secondaryMuscles = secondaryMuscles;
  }
  return entry;
}

/**
 * Validate the complete curation document. Duplicate equipment sources/IDs and duplicate
 * exercise entries are rejected so the transform can rely on unique lookups.
 */
export function parseCurationDocument(raw: unknown): CurationParseResult {
  const diagnostics: CurationDiagnostic[] = [];
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return {
      ok: false,
      diagnostics: [{ code: "curation-format-invalid", sourceId: null, message: "the curation document is not a JSON object" }]
    };
  }
  const record = raw as Record<string, unknown>;

  if (record["format"] !== "repjot/curation/exercises") {
    diagnostics.push({
      code: "curation-format-invalid",
      sourceId: null,
      message: 'field "format" must be "repjot/curation/exercises"'
    });
  }
  if (record["schemaVersion"] !== 1) {
    diagnostics.push({ code: "curation-format-invalid", sourceId: null, message: 'field "schemaVersion" must be 1' });
  }
  if (!hasOnlyKeys(record, ["format", "schemaVersion", "equipment", "exercises"])) {
    diagnostics.push({
      code: "curation-format-invalid",
      sourceId: null,
      message: "document has unknown keys (allowed: format, schemaVersion, equipment, exercises)"
    });
  }

  const equipment: CurationEquipment[] = [];
  const seenSources: string[] = [];
  const seenIds: string[] = [];
  if (!Array.isArray(record["equipment"])) {
    diagnostics.push({ code: "curation-format-invalid", sourceId: null, message: 'field "equipment" must be an array' });
  } else {
    for (const item of record["equipment"] as unknown[]) {
      if (typeof item !== "object" || item === null || Array.isArray(item)) {
        diagnostics.push({ code: "curation-equipment-invalid", sourceId: null, message: "equipment item is not an object" });
        continue;
      }
      const entry = item as Record<string, unknown>;
      if (!hasOnlyKeys(entry, ["id", "name", "source"])) {
        diagnostics.push({
          code: "curation-equipment-invalid",
          sourceId: null,
          message: "equipment item has unknown keys (allowed: id, name, source)"
        });
        continue;
      }
      const id = entry["id"];
      if (typeof id !== "string" || id.length === 0) {
        diagnostics.push({ code: "curation-equipment-invalid", sourceId: null, message: 'equipment field "id" must be a non-empty string' });
        continue;
      }
      if (seenIds.indexOf(id) !== -1) {
        diagnostics.push({ code: "curation-equipment-duplicate-id", sourceId: null, message: 'equipment ID "' + id + '" is declared more than once' });
        continue;
      }
      seenIds.push(id);
      if (typeof entry["name"] !== "string" || (entry["name"] as string).length === 0) {
        diagnostics.push({ code: "curation-equipment-invalid", sourceId: null, message: 'equipment "' + id + '" field "name" must be a non-empty string' });
        continue;
      }
      let source: string | undefined;
      const rawSource = entry["source"];
      if (rawSource !== undefined) {
        if (typeof rawSource !== "string" || SOURCE_EQUIPMENT_VALUES.indexOf(rawSource) === -1) {
          diagnostics.push({
            code: "curation-equipment-source-unknown",
            sourceId: null,
            message: 'equipment "' + id + '" field "source" value "' + String(rawSource) + '" is not a known source equipment value'
          });
          continue;
        }
        if (rawSource === "body only") {
          diagnostics.push({
            code: "curation-equipment-source-unknown",
            sourceId: null,
            message: 'equipment "' + id + '" cannot map source value "body only" (it maps to no equipment)'
          });
          continue;
        }
        if (seenSources.indexOf(rawSource) !== -1) {
          diagnostics.push({
            code: "curation-equipment-duplicate-source",
            sourceId: null,
            message: 'source equipment value "' + rawSource + '" is mapped more than once'
          });
          continue;
        }
        seenSources.push(rawSource);
        source = rawSource;
      }
      const name = entry["name"] as string;
      const curated: CurationEquipment = source === undefined ? { id, name } : { id, name, source };
      equipment.push(curated);
    }
  }

  const exercises: CurationExerciseEntry[] = [];
  const seenSourceIds: string[] = [];
  if (!Array.isArray(record["exercises"])) {
    diagnostics.push({ code: "curation-format-invalid", sourceId: null, message: 'field "exercises" must be an array' });
  } else {
    for (const item of record["exercises"] as unknown[]) {
      const entry = validateEntry(item, diagnostics);
      if (entry === null) {
        continue;
      }
      if (seenSourceIds.indexOf(entry.sourceId) !== -1) {
        diagnostics.push({
          code: "curation-entry-duplicate",
          sourceId: entry.sourceId,
          message: 'source exercise "' + entry.sourceId + '" has more than one curation entry'
        });
        continue;
      }
      seenSourceIds.push(entry.sourceId);
      exercises.push(entry);
    }
  }

  if (diagnostics.length > 0) {
    return { ok: false, diagnostics };
  }
  const document: CurationDocument = {
    format: "repjot/curation/exercises",
    schemaVersion: 1,
    equipment,
    exercises
  };
  return { ok: true, document };
}
