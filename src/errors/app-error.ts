/**
 * The one user-facing error contract for REP JOT (P11-T01).
 *
 * Authority: docs/ARCHITECTURE.md Section 16 — the normative `AppErrorKind` union, the normative
 * `AppError` interface, and the category table whose rows name the user-visible behaviour and the
 * recovery for each kind. This module defines that shape and nothing else: no message table, no
 * factory, no cause mapping, and no recovery behaviour, because Sections 25 and 44 own diagnostics
 * and the later caller layers own the user-facing sentence for their own state.
 *
 * Dependency direction: docs/ARCHITECTURE.md Section 7 lists `src/errors/app-error.ts` with
 * "Can depend on: No infrastructure", and docs/implementation/GATES.md Section 3 forbids a DOM,
 * clock, locale, random, Svelte, Drive, or IndexedDB import on this path. This file therefore
 * imports nothing at all.
 *
 * Field discipline. docs/ARCHITECTURE.md Section 15 states "Safe logs redact authorization headers,
 * URL fragments, browser-storage values, user names, file content, session IDs, notes, and
 * measurements", and Section 16 states "Diagnostics exclude tokens and health-related values by
 * default". Applied to each field:
 * - `safeMessage` holds one fixed, human-authored sentence per emitting code. It never holds text
 *   read from a document, a note, a measurement, a name, a token, or any other value.
 * - `operation` is a stable label the caller chooses for the user action in progress, not a sentence.
 * - `causeCode` is a stable machine code from a lower layer, never an engine message or a value.
 * - `logicalName` is one canonical logical filename (docs/contracts/families-and-files.md FF-06),
 *   never a Drive file ID.
 * Each emitting module owns its own per-code fixed message table; this file is what stops every
 * caller from inventing a different shape.
 */

/**
 * The complete user-facing error kind set: the thirteen members of the Section 16 union, in that
 * order. No stage-specific, file-specific, or rule-specific member exists here by design — the
 * Section 16 union is user-facing, and per-stage detail lives in the pipeline error layer
 * (`src/documents/pipeline-types.ts`), which maps each of its kinds to exactly one member here.
 */
export type AppErrorKind =
  | "authentication"
  | "authorization"
  | "network"
  | "drive_rate_limit"
  | "drive_quota"
  | "duplicate_drive_file"
  | "unsupported_schema"
  | "invalid_document"
  | "migration"
  | "semantic_reference"
  | "sync_conflict"
  | "storage"
  | "ambiguous_upload";

/**
 * The same thirteen members as one enumerable value, so a caller can list them without parsing any
 * message. `APP_ERROR_KIND_LIST_COVERAGE` below fails type-checking if this list and the union ever
 * disagree in either direction.
 */
const APP_ERROR_KIND_LIST = [
  "authentication",
  "authorization",
  "network",
  "drive_rate_limit",
  "drive_quota",
  "duplicate_drive_file",
  "unsupported_schema",
  "invalid_document",
  "migration",
  "semantic_reference",
  "sync_conflict",
  "storage",
  "ambiguous_upload"
] as const satisfies readonly AppErrorKind[];

/** A type-level assertion: instantiation only type-checks when the argument is `never`. */
type AssertNever<T extends never> = T;

/** Compile-time coverage guard for the list above; a member of either `Exclude` names the drift. */
type AppErrorKindListCoverage = AssertNever<
  Exclude<(typeof APP_ERROR_KIND_LIST)[number], AppErrorKind> | Exclude<AppErrorKind, (typeof APP_ERROR_KIND_LIST)[number]>
>;

/** One user-facing error, exactly the Section 16 normative interface. */
export interface AppError {
  /** Stable user-facing category from the Section 16 union; the caller branches on this value. */
  readonly kind: AppErrorKind;
  /** Stable label for the user action the failure belongs to. */
  readonly operation: string;
  /** Canonical logical filename (FF-06) when one logical file is named; never a Drive file ID. */
  readonly logicalName?: string;
  /** Whether repeating the operation can change the outcome, per the Section 16 recovery column. */
  readonly retryable: boolean;
  /** Fixed sentence chosen by the emitting module for its code; never document content. */
  readonly safeMessage: string;
  /** Stable lower-layer code, when one exists; never an engine message or a document value. */
  readonly causeCode?: string;
  /**
   * Opaque value that ties one failure to one diagnostic record. Section 16 requires "Errors contain
   * a correlation ID generated locally"; the local generator belongs to the diagnostic service
   * (Phases 25 and 44), which owns event correlation, so this phase carries the optional
   * caller-supplied field and no generator. No clock and no random dependency appears here.
   */
  readonly correlationId?: string;
}

/**
 * The Section 16 kind set as a stable, ordered, enumerable value. Frozen by the exported type
 * (`readonly`), and its contents are pinned by `tests/document-pipeline.test.ts`.
 */
export const APP_ERROR_KINDS: readonly AppErrorKind[] = APP_ERROR_KIND_LIST;
