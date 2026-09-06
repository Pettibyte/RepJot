# REP JOT exercise curation process

This directory holds the human-owned inputs for building `src/public/exercises.json`. The build
never invents curation: every classification REP JOT needs but the source does not provide must be
recorded here by a human.

## Inputs

- `exercises.curation.template.json` — copy to `exercises.curation.json` (same directory) and fill
  in. It is the allowlist: one entry per source exercise you publish, plus the equipment registry.
- `approval.template.json` — copy to a new approval file after reviewing the generated artifact.

## Curation rules

- Every source exercise in the checkout needs exactly one entry with `sourceId`, `laterality`,
  `movementPattern`, and non-empty `measurements`. Any missing entry fails the build with that
  source ID.
- `loadSemantics` is required when an entry lists `weight` (`total` or `per_implement`),
  `addedWeight` (`added`), or `assistedWeight` (`assisted`), and is rejected otherwise.
- Equipment: source `body only` maps to no equipment automatically. Every other source equipment
  value must either have an `equipment` registry entry with a matching `source`, or the exercise
  entry must list explicit `equipmentIds`. Source `null` equipment always needs `equipmentIds`.
  All `equipmentIds` must reference declared registry entries.
- Muscle arrays, force, mechanic, category, instructions, and names come from the source. Entries
  may override `primaryMuscles` / `secondaryMuscles` only with the retained 17-value muscle
  vocabulary; an empty source `primaryMuscles` without an override fails the build.
- Source `force: null` and `mechanic: null` pass through as spec-defined values; they are not
  unresolved.

## Workflow (one operator, one invocation per output path)

1. Check out `yuhonas/free-exercise-db` locally at `../free-exercise-db` (or pass `--source`).
2. Record curation in `data/curation/exercises.curation.json`.
3. Generate: run `bun scripts/build-static-data.ts` from the repository root. On success it
   atomically replaces the one git-ignored review artifact
   `.curation-staging/exercises.review.json`, which contains the candidate document, its exact
   canonical-byte SHA-256, and candidate-derived review metadata in a single file. Generation never
   writes canonical data. The same semantic inputs always produce byte-identical artifact bytes.
   A failed generation publishes nothing: the prior complete artifact (if any) stays unchanged
   because it is regenerable, and a corrected run replaces it as one whole file (last completed
   replacement wins).
4. Review the artifact. Record approval: copy `approval.template.json`, paste the
   `candidateSha256` from the artifact, and save it as a new file. The approval binds the exact
   canonical candidate bytes, not raw artifact formatting.
5. Promote: run `bun scripts/promote-static-data.ts --approval <file>`. Promotion re-validates
   the artifact envelope, reconstructs the deterministic candidate bytes, confirms
   `candidateSha256`, runs the exercise schema and static semantic validation, validates the
   approval digest, and only then atomically replaces `src/public/exercises.json` (or
   `--canonical <file>`) with the exact approved candidate bytes. A missing, malformed, stale, or
   mismatched approval, a changed artifact candidate or digest, or any schema or semantic failure
   leaves the canonical file unchanged.

## Operating model

- One operator runs this development-time tool. One invocation per output path is supported;
  same-path multi-process concurrency is unsupported. Parallel work uses separate checkouts or
  output paths. There are no locks by design.
- The local workspace and operator are trusted against hostile concurrent filesystem mutation.
  Source, curation, review artifact, and approval JSON still require exact structural, schema,
  and semantic validation; protection against another process mutating paths between system calls
  is not claimed.
- Files are replaced by writing a temporary file in the destination directory and renaming it
  over the target, so an interrupted write never truncates an existing file. Crash guarantees
  are exactly what the platform provides for rename; no stronger durability is claimed.

No curation or approval is recorded in this directory yet; production static files remain absent
until a human completes steps 4-5.
