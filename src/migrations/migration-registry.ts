// Ordered migration chains, one per document family.
// REQUIREMENTS 5.2, 5.3, 5.9, 5.10.
//
// Migration author rules. Every registered step MUST satisfy all of them, and
// tests enforce them for every registered step:
//
// 1. Accept exactly one known input version and return exactly the next version.
//    `fromVersion` and `toVersion` state that pair. `toVersion` equals
//    `fromVersion + 1`. No step skips a version.
// 2. Return a new object. Never mutate the input.
// 3. Same input produces the same output. No hidden state.
// 4. Touch no Drive, cache, network, DOM, UI, time, random, or locale API.
// 5. Never invent exercise identity, workout identity, measurements, or history.
//    When a required value cannot be derived, throw. Do not guess.
// 6. Produce output that validates against the next schema for the family.

import { AppError } from '../domain/errors';
import { DOC_FAMILIES, type DocFamily } from '../validation/schema-validator';

/** One pure migration step from one version to the next. */
export interface Migration {
  readonly family: DocFamily;
  readonly fromVersion: number;
  readonly toVersion: number;
  /** Pure: no Drive, cache, DOM, time, random, or locale. */
  migrate(input: unknown): unknown;
}

/**
 * One chain per family. A chain holds every step ever written, in version order.
 *
 * At v1 all four chains are empty. The empty chain is a supported state, not a
 * placeholder: a v1 document loads through it unchanged. REQUIREMENTS 5.3.
 */
const chains = new Map<DocFamily, Migration[]>();

function emptyChains(): void {
  chains.clear();
  for (const family of DOC_FAMILIES) {
    chains.set(family, []);
  }
}

emptyChains();

/**
 * Register one migration step.
 *
 * Rejects a step that is not a one-version step, a duplicate of a step already
 * registered for the same `family` and `fromVersion`, or a step for an unknown
 * family. Throws `AppError('migration')`.
 */
export function registerMigration(step: Migration): void {
  if (step === null || typeof step !== 'object') {
    throw new AppError('migration', { reason: 'bad_step' });
  }
  if (!DOC_FAMILIES.includes(step.family)) {
    throw new AppError('migration', { family: String(step.family), reason: 'unknown_family' });
  }
  if (!Number.isInteger(step.fromVersion) || step.fromVersion < 1) {
    throw new AppError(
      'migration',
      { family: step.family, fromVersion: step.fromVersion, reason: 'bad_from_version' }
    );
  }
  if (step.toVersion !== step.fromVersion + 1) {
    throw new AppError(
      'migration',
      {
        family: step.family,
        fromVersion: step.fromVersion,
        toVersion: step.toVersion,
        reason: 'not_a_single_step'
      },
      'A migration must move exactly one version forward.'
    );
  }
  if (typeof step.migrate !== 'function') {
    throw new AppError(
      'migration',
      { family: step.family, fromVersion: step.fromVersion, reason: 'missing_migrate' }
    );
  }

  const chain = chains.get(step.family);
  if (chain === undefined) {
    throw new AppError('migration', { family: step.family, reason: 'unknown_family' });
  }
  if (chain.some((existing) => existing.fromVersion === step.fromVersion)) {
    throw new AppError(
      'migration',
      { family: step.family, fromVersion: step.fromVersion, reason: 'duplicate_step' }
    );
  }

  chain.push(step);
  chain.sort((a, b) => a.fromVersion - b.fromVersion);
}

/** The chain for one family, ordered by `fromVersion`. Empty when none exists. */
export function getChain(family: DocFamily): Migration[] {
  const chain = chains.get(family);
  if (chain === undefined) {
    throw new AppError('migration', { family: String(family), reason: 'unknown_family' });
  }
  return chain.slice();
}

/** The step that moves the family from `from` to `from + 1`, when one exists. */
export function findStep(family: DocFamily, from: number): Migration | undefined {
  const chain = chains.get(family);
  if (chain === undefined) return undefined;
  return chain.find((step) => step.fromVersion === from);
}

/** Remove every registered step and restore the empty v1 chains. Test-only. */
export function resetMigrationsForTesting(): void {
  emptyChains();
}
