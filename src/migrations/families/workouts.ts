/**
 * The workouts family migration registry (P14-T01).
 *
 * Authority: specs/schema-versioning.md §Migration chains ("Maintain one current-version constant, schema
 * set, and migration registry for each family") and §Drive migration atomicity ("Drive migration never
 * writes `exercises.json` or `workouts.json`"), docs/contracts/families-and-files.md FF-02, FF-07, FF-15,
 * FF-16, FF-18, and docs/ARCHITECTURE.md §7 row `src/migrations/migration-registry.ts`, §8 row
 * `workouts.json` (canonical owner "Static bundle", sole write path "Curated build pipeline"), and §12
 * row "Ordered migration".
 *
 * The chain is empty on purpose, and nothing here invents a step. The accepted `CURRENT_VERSION` and
 * `SUPPORT_FLOOR_VERSION` both hold one for this family, so every supported workout document is already at
 * the current version. §Independent family versions sketches `repjot/workouts v1 -> v2 -> v3` as an
 * example of an independent sequence, not as a contract that exists today, and the static bundle changes
 * through a validated build rather than through a Drive migration, so no released workout document needs
 * a conversion and docs/implementation/GATES.md §3 asks the parent to confirm that none was invented. A
 * real step belongs beside the `v2` schema and the persisted contract change that requires it (FF-16),
 * and it will be added to the list below in version order.
 *
 * The version facts are read, never repeated: `acceptedVersionRange` reads the two accepted constants for
 * this one family, so this file declares no version of its own. Workout identity itself is never derived
 * here: §Result migrations and references forbids a migration inventing workout identity, and this chain
 * has no step that could.
 */
import type { FamilyMigrationStep, FamilyRegistryBuild } from "../migration-registry";
import { acceptedVersionRange, createFamilyMigrationRegistry } from "../migration-registry";

/** The workouts chain: no step, for the reason given in the header. Frozen, so it cannot grow later. */
export const WORKOUTS_MIGRATION_STEPS: readonly FamilyMigrationStep[] = Object.freeze([]);

/**
 * The one workouts registry, as its build outcome. The empty chain above cannot be refused, and
 * tests/migration-registry.test.ts proves the `created` arm and the family's accepted bounds rather than
 * assuming them; the outcome is exported instead of discarded so no module has to trust that claim and no
 * module throws while the bundle loads.
 */
export const WORKOUTS_MIGRATION_REGISTRY_BUILD: FamilyRegistryBuild = createFamilyMigrationRegistry({
  family: "workouts",
  range: acceptedVersionRange("workouts"),
  steps: WORKOUTS_MIGRATION_STEPS
});
