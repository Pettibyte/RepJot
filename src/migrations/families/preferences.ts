/**
 * The preferences family migration registry (P14-T01).
 *
 * Authority: specs/schema-versioning.md §Migration chains ("Maintain one current-version constant, schema
 * set, and migration registry for each family"), §Read and migration policy, and §Versioned schemas ("The
 * prototype stores no canonical preference, result, or workout document, so these corrections do not
 * migrate released data"), docs/contracts/families-and-files.md FF-03, FF-07, FF-15, FF-16, FF-18, FF-20,
 * and docs/ARCHITECTURE.md §7 row `src/migrations/migration-registry.ts`, §8 row `preferences.json`
 * (canonical owner "Drive `appDataFolder`"), and §12 row "Ordered migration" with its failure column
 * "Report migration context and preserve source unchanged".
 *
 * The chain is empty on purpose, and nothing here invents a step. The accepted `CURRENT_VERSION` and
 * `SUPPORT_FLOOR_VERSION` both hold one for this family, so every supported preferences document is
 * already at the current version, and no preference document has ever shipped to convert. A step that
 * merely rewrote a v1 document into a v1 document would be the no-op migration
 * docs/implementation/phase-14.md forbids. When a persisted preference contract changes, that change
 * carries the family to its next version (FF-16) and its step joins the list below in version order.
 *
 * Migration here stays in memory: §Read and migration policy states "Migration occurs in memory before
 * canonical data changes" and §Drive migration atomicity states "`preferences.json` and every result shard
 * must remain independently valid and readable", so this registry writes nothing and owns no write-back
 * sequence (Phase 19+ owns the Drive write path, FF-20 keeps a rejected document untouched).
 *
 * The version facts are read, never repeated: `acceptedVersionRange` reads the two accepted constants for
 * this one family. Preferences sit before the result shards in the context order of FF-19, and that order
 * is not expressed here — this file neither reads a context nor orders anything.
 */
import type { FamilyMigrationStep, FamilyRegistryBuild } from "../migration-registry";
import { acceptedVersionRange, createFamilyMigrationRegistry } from "../migration-registry";

/** The preferences chain: no step, for the reason given in the header. Frozen, so it cannot grow later. */
export const PREFERENCES_MIGRATION_STEPS: readonly FamilyMigrationStep[] = Object.freeze([]);

/**
 * The one preferences registry, as its build outcome. The empty chain above cannot be refused, and
 * tests/migration-registry.test.ts proves the `created` arm and the family's accepted bounds rather than
 * assuming them; the outcome is exported instead of discarded so no module has to trust that claim and no
 * module throws while the bundle loads.
 */
export const PREFERENCES_MIGRATION_REGISTRY_BUILD: FamilyRegistryBuild = createFamilyMigrationRegistry({
  family: "preferences",
  range: acceptedVersionRange("preferences"),
  steps: PREFERENCES_MIGRATION_STEPS
});
