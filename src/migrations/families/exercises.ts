/**
 * The exercises family migration registry (P14-T01).
 *
 * Authority: specs/schema-versioning.md §Migration chains ("Maintain one current-version constant, schema
 * set, and migration registry for each family") and §Drive migration atomicity ("Drive migration never
 * writes `exercises.json`"), docs/contracts/families-and-files.md FF-01, FF-07, FF-15, FF-16, FF-18, and
 * docs/ARCHITECTURE.md §7 row `src/migrations/migration-registry.ts`, §8 row `exercises.json` (canonical
 * owner "Static bundle", sole write path "Curated build pipeline"), and §12 row "Ordered migration".
 *
 * The chain is empty on purpose, and nothing here invents a step. The accepted `CURRENT_VERSION` and
 * `SUPPORT_FLOOR_VERSION` both hold one for this family, so every supported exercise document is already
 * at the current version and the chain has no transition to describe: a first release has no released
 * exercise document to convert, and docs/implementation/phase-14.md states "Production registries contain
 * no invented migration" and "Do not add a no-op `v0 -> v1` migration". A `v1` to `v2` step belongs
 * beside the `v2` schema and contract change that will require it (FF-16 "A family schema version
 * increments only on a persisted contract change"), and it will be added to the list below, in version
 * order, in a phase that owns that contract change.
 *
 * The version facts are read, never repeated: `acceptedVersionRange` reads the two accepted constants for
 * this one family, so this file declares no version of its own and cannot disagree with
 * src/domain/families.ts. Because the family's registry is selected from the accepted envelope stage
 * alone, an exercise document can never reach another family's chain (FF-07 negative case).
 */
import type { FamilyMigrationStep, FamilyRegistryBuild } from "../migration-registry";
import { acceptedVersionRange, createFamilyMigrationRegistry } from "../migration-registry";

/** The exercises chain: no step, for the reason given in the header. Frozen, so it cannot grow later. */
export const EXERCISES_MIGRATION_STEPS: readonly FamilyMigrationStep[] = Object.freeze([]);

/**
 * The one exercises registry, as its build outcome. The empty chain above cannot be refused, and
 * tests/migration-registry.test.ts proves the `created` arm and the family's accepted bounds rather than
 * assuming them; the outcome is exported instead of discarded so no module has to trust that claim and no
 * module throws while the bundle loads.
 */
export const EXERCISES_MIGRATION_REGISTRY_BUILD: FamilyRegistryBuild = createFamilyMigrationRegistry({
  family: "exercises",
  range: acceptedVersionRange("exercises"),
  steps: EXERCISES_MIGRATION_STEPS
});
