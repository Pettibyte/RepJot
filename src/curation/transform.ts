/**
 * P8-T01 — Pure deterministic transform from validated source exercises plus explicit curation to
 * one REP JOT `repjot/exercises` v1 candidate document.
 *
 * Authority: docs/REQUIREMENTS.md 13.1-13.5; specs/rep-jot-json-schema-spec.md Section 2 (stable
 * IDs, equipment, exercise fields, classification enums, measurements and units, load semantics).
 *
 * This module is pure: no file access, no clock, no randomness, no browser APIs. The output is a
 * canonical form: exercises sorted by ID, equipment sorted by ID, muscle/equipment arrays
 * deduplicated and sorted, and measurement dimensions and units normalized to their authoritative
 * order. Equivalent inputs (reordered files, reordered arrays) always produce the same document.
 * Every unresolved value yields a diagnostic
 * that names the source exercise ID, so a human can correct curation in one pass.
 */
import type { CurationDiagnostic, SourceExercise } from "./source";
import { MEASUREMENT_COMPATIBLE_UNITS } from "./curation";
import type { CurationDocument } from "./curation";

/** One candidate equipment entity (icon is curated separately and omitted here). */
export interface CandidateEquipment {
  readonly id: string;
  readonly name: string;
}

/** One candidate measurement support entry. */
export interface CandidateMeasurement {
  readonly dimension: string;
  readonly compatibleUnits: readonly string[];
}

/** One candidate exercise in REP JOT `repjot/exercises` v1 shape. */
export interface CandidateExercise {
  readonly id: string;
  readonly name: string;
  readonly instructions: readonly string[];
  readonly equipmentIds: readonly string[];
  readonly force: string | null;
  readonly mechanic: string | null;
  readonly category: string;
  readonly movementPattern: string;
  readonly primaryMuscles: readonly string[];
  readonly secondaryMuscles: readonly string[];
  readonly laterality: string;
  readonly measurements: readonly CandidateMeasurement[];
  readonly loadSemantics?: string;
}

/** One candidate `repjot/exercises` v1 document. */
export interface CandidateDocument {
  readonly format: "repjot/exercises";
  readonly schemaVersion: 1;
  readonly equipment: readonly CandidateEquipment[];
  readonly exercises: readonly CandidateExercise[];
}

/** Transform outcome. `diagnostics` is empty exactly when the document is publishable. */
export interface TransformResult {
  readonly document: CandidateDocument;
  readonly diagnostics: readonly CurationDiagnostic[];
}

/** Deterministic REP JOT exercise ID derived from the stable source ID. */
export function deriveExerciseId(sourceId: string): string {
  return sourceId.toLowerCase().replace(/_/g, "-");
}

function sortedUnique(values: readonly string[]): string[] {
  const seen: string[] = [];
  for (const value of values) {
    if (seen.indexOf(value) === -1) {
      seen.push(value);
    }
  }
  return seen.sort();
}

/**
 * Normalize a validated controlled list in authority order, not lexical order. The curation
 * parser already restricts values to this table, so this also makes the first unit the documented
 * metric-first default for every dimension.
 */
function authoritativeUnique(values: readonly string[], authority: readonly string[]): string[] {
  const unique: string[] = [];
  for (const value of authority) {
    if (values.indexOf(value) !== -1) {
      unique.push(value);
    }
  }
  return unique;
}

function canonicalMeasurementOrder(dimension: string): number {
  const dimensions = Object.keys(MEASUREMENT_COMPATIBLE_UNITS);
  const index = dimensions.indexOf(dimension);
  return index === -1 ? dimensions.length : index;
}

/**
 * Transform validated source exercises and a parsed curation document into one candidate. All
 * problems are collected; the returned document is only meaningful when `diagnostics` is empty.
 */
export function transformExercises(
  sourceExercises: readonly SourceExercise[],
  curation: CurationDocument
): TransformResult {
  const diagnostics: CurationDiagnostic[] = [];

  const sortedSource = [...sourceExercises].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const entriesById = new Map<string, (typeof curation.exercises)[number]>();
  for (const entry of curation.exercises) {
    entriesById.set(entry.sourceId, entry);
  }

  // Curation entries that name a source exercise that does not exist fail closed.
  const knownSourceIds = new Set(sortedSource.map((exercise) => exercise.id));
  const unknownEntries = [...curation.exercises]
    .filter((entry) => !knownSourceIds.has(entry.sourceId))
    .sort((a, b) => (a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : 0));
  for (const entry of unknownEntries) {
    diagnostics.push({
      code: "curation-unknown-source",
      sourceId: entry.sourceId,
      message: 'curation entry names source exercise "' + entry.sourceId + '" which is not in the source checkout'
    });
  }

  const equipmentById = new Map<string, CandidateEquipment>();
  for (const item of curation.equipment) {
    equipmentById.set(item.id, { id: item.id, name: item.name });
  }
  const mappedBySource = new Map<string, string>();
  for (const item of curation.equipment) {
    if (item.source !== undefined) {
      mappedBySource.set(item.source, item.id);
    }
  }

  const seenDerivedIds = new Map<string, string>();
  const candidateExercises: CandidateExercise[] = [];

  for (const source of sortedSource) {
    const derivedId = deriveExerciseId(source.id);
    const collidingSourceId = seenDerivedIds.get(derivedId);
    if (collidingSourceId !== undefined) {
      diagnostics.push({
        code: "source-duplicate-id",
        sourceId: source.id,
        message:
          'source exercises "' +
          collidingSourceId +
          '" and "' +
          source.id +
          '" both derive the REP JOT ID "' +
          derivedId +
          '"'
      });
      continue;
    }
    seenDerivedIds.set(derivedId, source.id);

    const entry = entriesById.get(source.id);
    if (entry === undefined) {
      diagnostics.push({
        code: "curation-entry-missing",
        sourceId: source.id,
        message: 'source exercise "' + source.id + '" has no curation entry'
      });
      continue;
    }

    let equipmentIds: string[] | null = null;
    if (source.equipment === "body only") {
      // Requirements 13.5 is authoritative: curation cannot turn body-only work into equipment.
      equipmentIds = [];
    } else if (entry.equipmentIds !== undefined) {
      equipmentIds = sortedUnique(entry.equipmentIds);
      for (const reference of equipmentIds) {
        if (!equipmentById.has(reference)) {
          diagnostics.push({
            code: "curation-equipment-reference-unknown",
            sourceId: source.id,
            message: 'source exercise "' + source.id + '" references undeclared equipment ID "' + reference + '"'
          });
        }
      }
    } else if (source.equipment === null) {
      diagnostics.push({
        code: "unresolved-equipment",
        sourceId: source.id,
        message: 'source exercise "' + source.id + '" has null equipment and no curated equipmentIds'
      });
    } else {
      const mapped = mappedBySource.get(source.equipment);
      if (mapped === undefined) {
        diagnostics.push({
          code: "unresolved-equipment",
          sourceId: source.id,
          message:
            'source exercise "' +
            source.id +
            '" has source equipment "' +
            source.equipment +
            '" with no equipment registry mapping and no curated equipmentIds'
        });
      } else {
        equipmentIds = [mapped];
      }
    }
    if (diagnostics.some((item) => item.sourceId === source.id)) {
      continue;
    }

    const primaryMuscles = sortedUnique(entry.primaryMuscles !== undefined ? entry.primaryMuscles : source.primaryMuscles);
    if (primaryMuscles.length === 0) {
      diagnostics.push({
        code: "unresolved-primary-muscles",
        sourceId: source.id,
        message: 'source exercise "' + source.id + '" has no primary muscles and no curated override'
      });
      continue;
    }
    const secondaryMuscles = sortedUnique(
      entry.secondaryMuscles !== undefined ? entry.secondaryMuscles : source.secondaryMuscles
    );

    const measurements = [...entry.measurements]
      .sort((a, b) => {
        const order = canonicalMeasurementOrder(a.dimension) - canonicalMeasurementOrder(b.dimension);
        return order !== 0 ? order : a.dimension < b.dimension ? -1 : a.dimension > b.dimension ? 1 : 0;
      })
      .map((measurement) => ({
        dimension: measurement.dimension,
        compatibleUnits: authoritativeUnique(measurement.compatibleUnits, MEASUREMENT_COMPATIBLE_UNITS[measurement.dimension])
      }));

    let exercise: CandidateExercise = {
      id: derivedId,
      name: source.name,
      instructions: [...source.instructions],
      equipmentIds: equipmentIds as string[],
      force: source.force,
      mechanic: source.mechanic,
      category: source.category,
      movementPattern: entry.movementPattern,
      primaryMuscles,
      secondaryMuscles,
      laterality: entry.laterality,
      measurements
    };
    if (entry.loadSemantics !== undefined) {
      exercise = { ...exercise, loadSemantics: entry.loadSemantics };
    }
    candidateExercises.push(exercise);
  }

  const equipment = [...curation.equipment]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((item) => ({ id: item.id, name: item.name }));

  candidateExercises.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const document: CandidateDocument = {
    format: "repjot/exercises",
    schemaVersion: 1,
    equipment,
    exercises: candidateExercises
  };
  return { document, diagnostics };
}
