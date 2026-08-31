/**
 * Compile-time evidence for the conditional shapes in src/domain/documents.ts. No runtime behavior:
 * this module exists only so that `tsc --noEmit tests/domain/document-shapes.ts` proves, by
 * construction, which object shapes the conditional types accept and refuse. Every
 * `@ts-expect-error` marks a refused shape; if any directive ever stops matching an error, tsc
 * reports the unused directive and this file fails to compile, so the evidence holds in both
 * directions. Authority: the session and result conditionals in schemas/results/v1.schema.json and
 * the approved RS-03 (session terminal/in-progress), RS-09 (side/startingSide), RS-12 (container
 * score), and RS-18 (effort outcome) rows.
 */

import type {
  ContainerResult,
  DocumentForFamily,
  ExerciseResult,
  InProgressWorkoutSession,
  ResultsShardDocument,
  TerminalWorkoutSession,
  V1Document
} from "../../src/domain/documents";
import type { DocumentFamily } from "../../src/domain/families";

const path = [{ nodeId: "root" }, { nodeId: "squat-set" }] as const;
const exerciseBase = { type: "exercise", workoutId: "w", executionPath: path, exerciseId: "e" } as const;
const containerBase = { type: "container", workoutId: "w", executionPath: path } as const;
const sessionBase = {
  id: "session-550e8400-e29b-41d4-a716-446655440000",
  workoutId: "w",
  startedAtUtc: "2026-09-01T06:30:00Z",
  updatedAtUtc: "2026-09-01T07:15:00Z",
  results: []
} as const;
const plan = { id: "root", type: "container", strategy: "sequence", strategyConfig: {}, children: [] } as const;

// RS-09: startingSide is present exactly when side is alternating.
const alternatingWithStartingSide: ExerciseResult = {
  ...exerciseBase, status: "completed", side: "alternating", startingSide: "left", values: { reps: 8 }
};
const bothWithoutStartingSide: ExerciseResult = { ...exerciseBase, status: "completed", side: "both" };
const noSideAtAll: ExerciseResult = { ...exerciseBase, status: "incomplete" };

// @ts-expect-error RS-09: startingSide without alternating is refused.
const startingSideWithoutAlternating: ExerciseResult = { ...exerciseBase, status: "completed", side: "both", startingSide: "left" };

// Skipped exercise result: the schema forbids only `values`; an optional `effort` outcome stays permitted (RS-18).
const skippedWithEffort: ExerciseResult = {
  ...exerciseBase, status: "skipped", reasonCode: "user_skipped", effort: { type: "rpe", value: 8 }
};

// @ts-expect-error a skipped exercise result may not carry values.
const skippedWithValues: ExerciseResult = { ...exerciseBase, status: "skipped", values: { reps: 1 } };

// RS-12: completed requires a score; incomplete may hold one; skipped has none.
const completedWithScore: ContainerResult = {
  ...containerBase, status: "completed", score: { type: "cycles", completedCycles: 3 }
};
const incompleteWithoutScore: ContainerResult = { ...containerBase, status: "incomplete", reasonCode: "time_constraint" };

// @ts-expect-error RS-12: a completed container result requires its score.
const completedWithoutScore: ContainerResult = { ...containerBase, status: "completed" };
// @ts-expect-error RS-12: a skipped container result carries no score.
const skippedWithScore: ContainerResult = { ...containerBase, status: "skipped", score: { type: "nonstandard" } };

// RS-03: in_progress carries the frozen plan and no endedAtUtc.
const inProgress: InProgressWorkoutSession = { ...sessionBase, status: "in_progress", executionPlan: plan };

// @ts-expect-error RS-03: endedAtUtc is forbidden while in_progress.
const inProgressWithEnd: InProgressWorkoutSession = { ...sessionBase, status: "in_progress", executionPlan: plan, endedAtUtc: "2026-09-01T07:15:00Z" };

// RS-03: terminal carries exactly an end time and no plan.
const completedSession: TerminalWorkoutSession = { ...sessionBase, status: "abandoned", endedAtUtc: "2026-09-01T07:15:00Z" };

// @ts-expect-error RS-03: executionPlan is forbidden on terminal sessions.
const terminalWithPlan: TerminalWorkoutSession = { ...sessionBase, status: "completed", endedAtUtc: "2026-09-01T07:15:00Z", executionPlan: plan };

// The four families are consumable as one format-discriminated union, and the family-to-document
// mapping resolves each family to its own shape.
const shard: ResultsShardDocument = {
  format: "repjot/results",
  schemaVersion: 1,
  yearMonthUtc: "2026-09",
  sessions: [completedSession],
  sessionTombstones: []
};
const anyV1Document: V1Document = shard;

type FamilyDocuments = { readonly [F in DocumentFamily]: DocumentForFamily<F> };
const documentsByFamily: FamilyDocuments = {
  exercises: { format: "repjot/exercises", schemaVersion: 1, equipment: [], exercises: [] },
  workouts: { format: "repjot/workouts", schemaVersion: 1, workouts: [] },
  preferences: {
    format: "repjot/preferences",
    schemaVersion: 1,
    revision: 0,
    updatedAtUtc: "2026-08-15T15:25:00Z",
    exerciseUnits: {}
  },
  results: shard
};
