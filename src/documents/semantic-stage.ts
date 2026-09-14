// The stage-9 semantic pass, built once and shared.
// ARCHITECTURE section 14, Phase 04. Phase 11 lifts the coordinator's inline
// stage here so duplicate consolidation runs the identical check instead of a
// second copy that could drift from it.
//
// The pipeline holds no `StaticData`, so the caller closes over the loaded
// bundle and throws to reject a document. Only a fatal issue throws: this stage
// reads `report.issues` and ignores the nonfatal unresolved list, because the
// screens carry unresolved state through their own path rather than through the
// pipeline. A stage that returns normally lets the document through.

import { AppError } from '../domain/errors';
import type { ResultsShard } from '../domain/types';
import type { LoadedStaticData } from './static-loader';
import type { SemanticStage } from './document-pipeline';
import type { DocFamily } from '../validation/schema-validator';
import { validatePreferences, validateShard } from '../validation/semantic-validator';

/**
 * Build the semantic stage for one logical file.
 *
 * @param logicalName The logical file name. The shard validator uses it to
 *        check that a shard's own `yearMonthUtc` matches the file it lives in.
 * @param staticData The validated static bundle the checks resolve against.
 */
export function semanticStageFor(logicalName: string, staticData: LoadedStaticData): SemanticStage {
  return (doc: unknown, family: DocFamily): void => {
    if (family === 'repjot/results') {
      const report = validateShard(doc as ResultsShard, staticData, { fileName: logicalName });
      if (report.issues.length > 0) {
        throw new AppError(
          'semantic_reference',
          { reason: 'semantic_invalid', code: report.issues[0].code },
          'The document failed semantic validation.'
        );
      }
      return;
    }

    if (family === 'repjot/preferences') {
      const units = (doc as { exerciseUnits?: Record<string, Record<string, string>> }).exerciseUnits;
      const report = validatePreferences({ exerciseUnits: units ?? {} }, staticData.exercises);
      if (report.issues.length > 0) {
        throw new AppError(
          'semantic_reference',
          { reason: 'semantic_invalid', code: report.issues[0].code },
          'The preferences document failed semantic validation.'
        );
      }
    }
  };
}
