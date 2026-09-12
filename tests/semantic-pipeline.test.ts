// Stage 9: the semantic callback on the document pipeline.
// Phase 04 wiring, ARCHITECTURE section 14.
//
// The pipeline owns stages 1-8 and knows nothing about static data. The caller
// closes over its own `StaticData` and throws to reject. These tests prove the
// callback runs last, sees the current-version value, and that omitting it leaves
// the pipeline exactly as Phase 03 shipped it.

import { describe, expect, test } from 'bun:test';
import {
  processDocument,
  processJson,
  type SemanticStage
} from '../src/documents/document-pipeline';
import { AppError } from '../src/domain/errors';
import { validateShard } from '../src/validation/semantic-validator';
import { ISSUE_CODES } from '../src/validation/issues';
import { SHARD_MONTH, staticData, validShard } from './fixtures/semantic';

/** A stage that rejects every document with a semantic error. */
const rejectEverything: SemanticStage = () => {
  throw new AppError('invalid_document', { reason: 'semantic' }, 'Rejected by the semantic stage.');
};

describe('semantic stage placement', () => {
  test('the callback runs and receives the family', () => {
    const seen: string[] = [];
    const stage: SemanticStage = (_doc, family) => {
      seen.push(family);
    };

    processJson(validShard(), 'repjot/results', stage);
    expect(seen).toEqual(['repjot/results']);
  });

  test('the callback sees the current-version value, not the raw text', () => {
    let received: unknown;
    const stage: SemanticStage = (doc) => {
      received = doc;
    };

    const text = JSON.stringify(validShard());
    processDocument(text, 'repjot/results', stage);
    expect(received).toEqual(validShard());
  });

  test('the callback runs after the final schema pass', () => {
    // A document that fails the schema must never reach the semantic stage.
    let called = false;
    const stage: SemanticStage = () => {
      called = true;
    };

    const notAResult = { format: 'repjot/results', schemaVersion: 1 };
    expect(() => processJson(notAResult, 'repjot/results', stage)).toThrow();
    expect(called).toBe(false);
  });

  test('the callback never runs for a rejected future version', () => {
    let called = false;
    const stage: SemanticStage = () => {
      called = true;
    };

    const future = { ...validShard(), schemaVersion: 9 };
    expect(() => processJson(future, 'repjot/results', stage)).toThrow(AppError);
    expect(called).toBe(false);
  });

  test('omitting the callback leaves the pipeline unchanged', () => {
    const result = processJson(validShard(), 'repjot/results');
    expect(result.document).toEqual(validShard());
    expect(result.migrated).toBe(false);
  });
});

describe('semantic stage rejection', () => {
  test('a throwing callback rejects the document', () => {
    expect(() => processJson(validShard(), 'repjot/results', rejectEverything)).toThrow(AppError);
  });

  test('a callback wired to validateShard passes a valid shard', () => {
    const data = staticData();
    const stage: SemanticStage = (doc) => {
      const report = validateShard(doc as never, data, { fileName: `results-${SHARD_MONTH}.json` });
      if (report.issues.length > 0) {
        throw new AppError('invalid_document', { code: report.issues[0].code });
      }
    };

    expect(() => processJson(validShard(), 'repjot/results', stage)).not.toThrow();
  });

  test('a callback wired to validateShard rejects a malformed shard', () => {
    const data = staticData();
    const stage: SemanticStage = (doc) => {
      const report = validateShard(doc as never, data);
      if (report.issues.length > 0) {
        throw new AppError('invalid_document', { code: report.issues[0].code });
      }
    };

    const broken = validShard();
    // A fault the schema cannot see: the session start month leaves the shard.
    broken.sessions[Object.keys(broken.sessions)[0]].startedAtUtc = '2026-07-01T08:00:00Z';

    let thrown: AppError | undefined;
    try {
      processJson(broken, 'repjot/results', stage);
    } catch (error) {
      thrown = error instanceof AppError ? error : undefined;
    }

    expect(thrown?.kind).toBe('invalid_document');
    expect(thrown?.detail.code).toBe(ISSUE_CODES.SHARD_MONTH_MISMATCH);
  });

  test('a callback that treats unresolved references as nonfatal lets the shard through', () => {
    const data = staticData();
    // Drop one exercise so one result resolves to nothing.
    data.exercises = data.exercises.filter((exercise) => exercise.id !== 'push-up');

    const stage: SemanticStage = (doc) => {
      const report = validateShard(doc as never, data);
      if (report.issues.length > 0) {
        throw new AppError('invalid_document', { code: report.issues[0].code });
      }
    };

    let thrown: AppError | undefined;
    try {
      processJson(validShard(), 'repjot/results', stage);
    } catch (error) {
      thrown = error instanceof AppError ? error : undefined;
    }

    // Unresolved entries are data, not a rejection. REQUIREMENTS 6.10, 6.11.
    expect(thrown).toBeUndefined();
  });
});
