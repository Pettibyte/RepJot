# Families, versions, filenames, envelopes

Status legend: see `docs/contracts/README.md`. Sources use these abbreviations: Arch = `docs/ARCHITECTURE.md`, Req = `docs/REQUIREMENTS.md`, spec = `specs/rep-jot-json-schema-spec.md`, storage = `specs/storage-and-lookup.md`, versioning = `specs/schema-versioning.md`.

## 1. Family and file registry

| ID | Family | `format` value | Version | Recognized filename(s) | Canonical owner | Reader | Sole write path | Schema | Source | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| FF-01 | Exercises | `repjot/exercises` | 1 | `exercises.json` (static bundle) | Static bundle | Static loader | Curated build pipeline only | `schemas/exercises/v1.schema.json` | spec §2 (supporting: Arch §8; storage) | RESOLVED |
| FF-02 | Workouts | `repjot/workouts` | 1 | `workouts.json` (static bundle) | Static bundle | Static loader | Curated build pipeline only | `schemas/workouts/v1.schema.json` | spec §3 (supporting: Arch §8; storage) | RESOLVED |
| FF-03 | Preferences | `repjot/preferences` | 1 | `preferences.json` in Drive `appDataFolder` | Drive `appDataFolder` | Sync coordinator | Preference service → pending edit → sync coordinator | `schemas/preferences/v1.schema.json` | spec §4 (supporting: Arch §8; storage) | RESOLVED |
| FF-04 | Results | `repjot/results` | 1 | `results-YYYY-MM.json`; `YYYY-MM` equals the UTC month of every session's `startedAtUtc` | Drive `appDataFolder` | Sync coordinator | Session service → pending edit → sync coordinator | `schemas/results/v1.schema.json` | Req 3.3-3.4 (supporting: spec §5; Arch §8) | RESOLVED |
| FF-05 | (all) | — | — | Unknown `appDataFolder` files | Never canonical | Diagnostics and raw export only | None: never deleted, edited, or migrated | None | Req 21.4 (supporting: storage §Drive catalog; Arch §11 (C-13)) | RESOLVED |

Positive case FF-01: `exercises.json` in the bundle is recognized as a `repjot/exercises` v1 document and loads into the read-only static model. Negative: an `exercises.json` with a missing or foreign `format` receives the typed rejection of FF-10 and never becomes a user file.

Positive case FF-02: `workouts.json` in the bundle is recognized as a `repjot/workouts` v1 document and loads. Negative: same as FF-01 for the workouts family; the results schema's external `$id` reference resolves against this file (FF-17).

Positive case FF-03: `preferences.json` in Drive `appDataFolder` is the only canonical preferences location per account. Negative: any other filename carrying preference content is an unknown file (FF-05/FF-06), never migrated or edited.

Positive case FF-04: `results-2026-09.json` whose sessions all start in UTC month 2026-09 loads as that shard. Negative: a filename month disagreeing with any session's `startedAtUtc` month fails semantic validation (RS-01, invariant 19).

Positive case FF-05: a catalog containing an unknown file syncs normally, leaves the file untouched, and records a salted diagnostic alias. Negative case: any code path that deletes or rewrites an unknown file (delete excludes unknown names per C-13; export includes them).

## 2. Envelope and version rules

| ID | Contract | Source | Owner | Positive case | Negative case | Status |
| --- | --- | --- | --- | --- | --- | --- |
| FF-06 | Only `preferences.json` and names matching `results-YYYY-MM.json` are recognized canonical user names. | storage (supporting: Arch §11 Drive discovery) | Drive catalog service | `results-2026-09.json` recognized. | `results-2026-13.json`, `Results-2026-09.json`, `index.json` treated as unknown files (FF-05). | RESOLVED |
| FF-07 | Each family owns an independent, monotonically increasing version sequence; no application-wide persisted schema version exists. | versioning §Independent family versions | Migration registry | `repjot/results` v2 while `repjot/preferences` stays v1. | One family's version selecting another family's migration. | RESOLVED |
| FF-08 | Different monthly shards may hold different supported versions; every shard migrates independently. | versioning §Independent family versions | Migration registry | Two shards at v1 and v2 load in one reconciliation. | A migration assuming all shards share a version. | RESOLVED |
| FF-09 | `schemaVersion` is a positive integer describing persisted shape and semantics; it never identifies an app release, Drive revision, cache layout, or content edit. | versioning §Document envelope | Document pipeline | `{ "format": "repjot/results", "schemaVersion": 2 }` recognized when v2 is current. | `0`, `-1`, `1.5`, `"1"` rejected with distinct errors. | RESOLVED |
| FF-10 | Envelope recognition reads only `format` and `schemaVersion` and matches the expected filename family. Missing, absent (inherited), wrong-family, non-integer, unsupported-old, and future versions each produce a distinct typed error. The loader never infers either value from shape; a legacy document without `format` or `schemaVersion` loads only through an explicit tested importer. | versioning §Document envelope, §Version handling (supporting: Arch §12 stage 2) | Document pipeline | Current version validates without migration. | Six rejection fixtures, one per error kind; source bytes preserved unchanged in every case. | RESOLVED |
| FF-11 | Drive `version`, `md5Checksum`, `modifiedTime` are change indicators only (checksum preferred, then version, then modified time). None selects a schema migration or provides a write lock. | storage §Full reconciliation (supporting: Arch §11) | Sync coordinator | Checksum change triggers re-download while the declared version still selects the historical schema. | Metadata choosing a migration target. | RESOLVED |
| FF-12 | Every persisted application timestamp field ends in `Utc` and holds an RFC 3339 value ending in `Z`. Numeric offsets are not canonical. Schemas combine `format: "date-time"` with a `Z` suffix; the validator asserts formats instead of treating them as annotations. | Req 3.5 (supporting: spec §1 (C-12); four schemas) | Schema validator (supporting: semantic validator) | `2026-09-01T06:30:00Z` accepted. | `2026-08-31T23:30:00-07:00`, `2026-09-01 06:30:00Z`, lowercase `z` rejected. | RESOLVED |
| FF-13 | Local dates, times, and zones are display-only; they never select storage, shard identity, or migration context. | Req 3.6 (supporting: spec §1; versioning §Document envelope) | Clock service (supporting: UI formatters) | Local `2026-08-31T23:30:00-07:00` persists as `2026-09-01T06:30:00Z` in `results-2026-09.json`. | Any shard or store key derived from a localized string. | RESOLVED |
| FF-14 | Parsing entry: source bytes are decoded and parsed once as exact bytes with no project byte, nesting, or node thresholds; malformed encoding or JSON fails the document, keeps pending edits and last valid cache, and never overwrites remote bytes. Byte-order mark policy (D-02, approved Option BOM-2): exactly one leading UTF-8 BOM (`EF BB BF`) is supported — those three bytes are stripped only for the parsed/validated view, then UTF-8 is decoded strictly; a repeated BOM or a BOM anywhere except offset 0 is invalid with a distinct parsing-stage diagnostic. Cache, recovery, and export preserve the exact original bytes, BOM included. REP JOT never emits a BOM. | `docs/decisions/document-parsing-byte-order-mark.md` (supporting: Arch §12 stage 1; versioning loader step 1; phase-12.md) | Document pipeline | Valid UTF-8 JSON parses to `unknown` and proceeds to envelope recognition; a single leading BOM is stripped for the parsed view while original bytes are retained. | Invalid UTF-8 or malformed JSON: distinct error, input bytes preserved, no overwrite. A second BOM or a mid-document BOM: distinct rejection, source bytes preserved. | RESOLVED |

## 3. Schema files and freezing

| ID | Contract | Source | Owner | Positive case | Negative case | Status |
| --- | --- | --- | --- | --- | --- | --- |
| FF-15 | One machine-readable schema per supported family version, kept beside historical schemas; a historical schema is never rewritten to describe a newer contract. The v1 UTC-timestamp naming and prescription-override rules are part of the first production v1 contract; v1 freezes when the first release publishes it. No canonical user document has shipped, so these corrections need no migration. | versioning §Versioned schemas | Schema registry (Phase 3) | A later contract ships as a new `v2.schema.json` beside untouched `v1.schema.json`. | Editing a historical schema to change its validation semantics. | RESOLVED |
| FF-16 | A family schema version increments only on a persisted contract change (field, type, reference semantics, required status, validation semantics, ownership movement). UI, cache layout, derived indexes, and TypeScript refactors never increment it. | versioning §Versioned schemas | Schema registry | Adding an optional persisted field bumps that family to v2. | A UI refactor or TypeScript-only change bumping `schemaVersion`. | RESOLVED |
| FF-17 | All four current schemas are Draft 2020-12 with `$id` `https://repjot.com/schemas/<family>/v1.schema.json`; the results schema references the workouts schema for `executionPlan` by that external `$id`. External reference handling is owned by the Phase 3 registry. | Four files in `schemas/` (supporting: versioning §Versioned schemas) | Schema registry | All four files parse under Draft 2020-12 with the expected `$id`s; the results external reference resolves through the registry. | A schema file with a wrong `$id` or a non-Draft-2020-12 keyword. | RESOLVED |
| FF-18 | Migration chains are ordered pure `vN -> vN+1` functions: accept exactly one input version, return exactly the next, produce a new object (input unchanged), deterministic for same input and context, no DOM/clock/locale/random/Drive/IndexedDB, fail with a precise diagnostic when a value cannot be derived. No direct-conversion matrix to current. | versioning §Migration chains (supporting: Arch §12 stage 4) | Migration registry | A v1→v2 migration returns v2, leaves the input object unchanged, and is deterministic across runs. | A migration accepting v1 but returning v3; a migration reading the clock or Drive. | RESOLVED |
| FF-19 | Context-dependent loading and migration order is exercises → workouts → preferences → result shards; only current, validated static references enter the read-only migration context. | versioning §Result migrations (supporting: Arch §12) | Document pipeline | A shard migrates after the static families validate, with a context of current references only. | Migrating a result shard before `workouts.json` validates. | RESOLVED |
| FF-20 | Unsupported-old data reports the support floor and is never overwritten; future data is never edited or overwritten and reports that newer code is required; a corrupt remote document blocks writes to that logical file while last valid cache stays visible and raw bytes can be downloaded. | versioning §Version handling (supporting: storage §Failure and recovery; Arch §9 startup states) | Document pipeline (supporting: sync coordinator blocks the writes) | Unaffected families remain usable. | Any overwrite of blocked bytes. Recovery: external repair, then normal load. | RESOLVED |

## 4. Input and persisted facts

| Rule | Required input facts | Required persisted facts |
| --- | --- | --- |
| FF-01 | None (the bundle file bytes). | `format` + `schemaVersion` envelope in the bundle file. |
| FF-02 | None (the bundle file bytes). | `format` + `schemaVersion` envelope in the bundle file. |
| FF-03 | None (the Drive file bytes). | `format` + `schemaVersion` envelope in the Drive file. |
| FF-04 | The session's `startedAtUtc` UTC month. | Filename + `yearMonthUtc` + envelope fields. |
| FF-05 | Drive catalog listing. | None — unknown files are never read, edited, or deleted. |
| FF-06 | Candidate filename. | None. |
| FF-07 | Each document's declared `schemaVersion`. | Per-document `schemaVersion`; no application-wide persisted version exists. |
| FF-08 | Each shard's declared `schemaVersion`. | Per-shard `schemaVersion`. |
| FF-09 | The envelope `schemaVersion` value. | Persisted `schemaVersion` (never an app release, Drive revision, cache layout, or edit). |
| FF-10 | Raw bytes + filename. | None on rejection — original bytes preserved unchanged. |
| FF-11 | Cached Drive metadata (`md5Checksum`, `version`, `modifiedTime`). | Cached metadata only (persisted-facts §1); never a migration target or lock. |
| FF-12 | The document's timestamp fields. | Persisted `*Utc` fields, all Z-suffixed. |
| FF-13 | None — local time is display-only. | None; no localized string may be persisted. |
| FF-14 | Source bytes. | Original bytes (BOM included) in cache, pending edits, and export. |
| FF-15 | The schema files in the repository. | Historical schema files unchanged on disk. |
| FF-16 | The proposed contract change. | Per-family persisted `schemaVersion`. |
| FF-17 | The four schema files. | `$id`s + the results→workouts external reference. |
| FF-18 | One single-version document + migration context. | None (migrations are pure; no new persistence). |
| FF-19 | Validated static families + shards to load. | Read-only migration context (derived, not persisted). |
| FF-20 | The rejected or corrupt remote bytes. | Last valid cache + raw remote bytes preserved for download. |
