/**
 * The results family migration registry (P14-T01).
 *
 * Authority: specs/schema-versioning.md §Migration chains ("Maintain one current-version constant, schema
 * set, and migration registry for each family"), §Independent family versions ("Every monthly result shard
 * migrates independently. Thus, supported shards can remain at different persisted versions"), §Result
 * migrations and references, §Versioned schemas, docs/contracts/families-and-files.md FF-04, FF-07, FF-08,
 * FF-15, FF-16, FF-18, FF-19, FF-20, and docs/ARCHITECTURE.md §7 row `src/migrations/migration-registry.ts`,
 * §8 row `results-YYYY-MM.json` (canonical owner "Drive `appDataFolder`"), and §12 row "Ordered migration".
 *
 * The chain is empty on purpose, and nothing here invents a step. The accepted `CURRENT_VERSION` and
 * `SUPPORT_FLOOR_VERSION` both hold one for this family, so every supported shard is already at the current
 * version, and the first release stores no canonical result document to convert
 * (specs/schema-versioning.md §Versioned schemas). The example chain `repjot/results v1 -> v2 -> v3` in
 * §Independent family versions is an illustration of an independent sequence, not a contract that exists
 * today, and docs/implementation/GATES.md §3 makes "Do not fabricate historical production documents,
 * migration defects, prior-release bytes" an external gate. A step for a real shard version joins the list
 * below in version order in the phase that owns that version's schema and contract change (FF-16).
 *
 * One registry, many shards. FF-08 keeps every shard independent, so a registry is a per-family thing,
 * never a per-shard thing: each shard is migrated on its own read with its own declared version, and no
 * state, cursor, or "all shards reached version N" fact exists here.
 *
 * Reference identity is never invented here. §Result migrations and references requires a real step that
 * cannot resolve a reference to identify the shard, session, workout, and node and then fail, and this
 * phase holds no step that could resolve or invent one; a step that needs a reference receives it through
 * the read-only context of FF-19, which the caller builds. The version facts are read, never repeated:
 * `acceptedVersionRange` reads the two accepted constants for this one family.
 */
import type { FamilyMigrationStep, FamilyRegistryBuild } from "../migration-registry";
import { acceptedVersionRange, createFamilyMigrationRegistry } from "../migration-registry";

/** The results chain: no step, for the reason given in the header. Frozen, so it cannot grow later. */
export const RESULTS_MIGRATION_STEPS: readonly FamilyMigrationStep[] = Object.freeze([]);

/**
 * The one results registry, as its build outcome. The empty chain above cannot be refused, and
 * tests/migration-registry.test.ts proves the `created` arm and the family's accepted bounds rather than
 * assuming them; the outcome is exported instead of discarded so no module has to trust that claim and no
 * module throws while the bundle loads.
 */
export const RESULTS_MIGRATION_REGISTRY_BUILD: FamilyRegistryBuild = createFamilyMigrationRegistry({
  family: "results",
  range: acceptedVersionRange("results"),
  steps: RESULTS_MIGRATION_STEPS
});
