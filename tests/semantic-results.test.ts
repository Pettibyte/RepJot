// Fatal semantic checks on a stored session and its shard.
// Spec items 1-18, 20-22. REQUIREMENTS 3.17, 3.18, 6.17, 11.5, 11.6, 22.4.9.

import { describe, expect, test } from 'bun:test';
import {
  validatePreferences,
  validateSession,
  validateShard
} from '../src/validation/semantic-validator';
import { ISSUE_CODES } from '../src/validation/issues';
import {
  SESSION_KEY,
  SHARD_MONTH,
  clone,
  hasCode,
  nestedSession,
  nestedStaticData,
  staticData,
  validSession,
  validShard
} from './fixtures/semantic';
import type { Session } from '../src/domain/types';

const WARMUP_KEY = 'root/warmup/warmup-squat|both|1';
const CINDY_KEY = 'root/cindy|1';

/** Run the session checks with the fixture static data. */
function check(session: Session) {
  return validateSession(session, staticData(), {
    shardYearMonthUtc: SHARD_MONTH,
    sessionKey: session.id
  });
}

describe('baseline', () => {
  test('the valid session produces no issue and nothing unresolved', () => {
    const report = check(validSession());
    expect(report.issues).toEqual([]);
    expect(report.unresolved).toEqual([]);
  });
});

describe('session identity', () => {
  test('a sessions map key that differs from the session id fails', () => {
    const session = validSession();
    const report = validateSession(session, staticData(), {
      shardYearMonthUtc: SHARD_MONTH,
      sessionKey: 'session-00000000-0000-4000-8000-000000000000'
    });
    expect(hasCode(report.issues, ISSUE_CODES.SESSION_KEY_MISMATCH)).toBe(true);
  });

  test('a session id without the session- prefix fails', () => {
    const session = validSession();
    session.id = 'sprint-1';
    expect(hasCode(check(session).issues, ISSUE_CODES.SESSION_ID_PREFIX)).toBe(true);
  });

  test('an in_progress session with completedAtUtc fails', () => {
    const session = validSession();
    session.status = 'in_progress';
    expect(hasCode(check(session).issues, ISSUE_CODES.SESSION_STATUS_TIMESTAMP)).toBe(true);
  });

  test('a completed session without completedAtUtc fails', () => {
    const session = validSession();
    delete session.completedAtUtc;
    expect(hasCode(check(session).issues, ISSUE_CODES.SESSION_STATUS_TIMESTAMP)).toBe(true);
  });

  test('an abandoned session without completedAtUtc fails', () => {
    const session = validSession();
    session.status = 'abandoned';
    delete session.completedAtUtc;
    expect(hasCode(check(session).issues, ISSUE_CODES.SESSION_STATUS_TIMESTAMP)).toBe(true);
  });

  test('a session carrying executionPlan fails', () => {
    const session = validSession() as Session & { executionPlan?: unknown };
    session.executionPlan = { nodes: [] };
    expect(hasCode(check(session).issues, ISSUE_CODES.FORBIDDEN_FIELD)).toBe(true);
  });

  test('executionPlan fails on an in_progress session too', () => {
    const session = validSession();
    session.status = 'in_progress';
    session.completedAtUtc = undefined;
    const target = session as Session & { executionPlan?: unknown };
    target.executionPlan = {};
    expect(hasCode(check(session).issues, ISSUE_CODES.FORBIDDEN_FIELD)).toBe(true);
  });
});

describe('composite keys', () => {
  test('an exercise result key that does not match its value fails with key_mismatch', () => {
    const session = validSession();
    const entry = session.exerciseResults[WARMUP_KEY];
    delete session.exerciseResults[WARMUP_KEY];
    session.exerciseResults['root/warmup/warmup-squat|both|2'] = entry;

    const issues = check(session).issues.filter((candidate) =>
      candidate.path.includes('warmup-squat')
    );
    expect(issues.some((candidate) => candidate.code === ISSUE_CODES.KEY_MISMATCH)).toBe(true);
  });

  test('a container result key that does not match its value fails with key_mismatch', () => {
    const session = validSession();
    const entry = session.containerResults[CINDY_KEY];
    delete session.containerResults[CINDY_KEY];
    session.containerResults['root/cindy|3'] = entry;

    expect(hasCode(check(session).issues, ISSUE_CODES.KEY_MISMATCH)).toBe(true);
  });

  test('two container results that claim one path and attempt fail', () => {
    const session = validSession();
    const entry = session.containerResults[CINDY_KEY];
    // A second claimant stored under a key that recomputes to the same identity.
    session.containerResults['root/cindy|1-copy'] = { ...entry };

    expect(hasCode(check(session).issues, ISSUE_CODES.DUPLICATE_CONTAINER_RESULT)).toBe(true);
  });
});

describe('result identity and sides', () => {
  test('a result workoutId that differs from its session fails', () => {
    const session = validSession();
    session.exerciseResults[WARMUP_KEY].workoutId = 'some-other-workout';
    expect(hasCode(check(session).issues, ISSUE_CODES.WORKOUT_ID_MISMATCH)).toBe(true);
  });

  test('an alternating result without startingSide fails', () => {
    const session = validSession();
    const entry = clone(session.exerciseResults[WARMUP_KEY]);
    entry.side = 'alternating';
    session.exerciseResults['root/warmup/warmup-squat|alternating|1'] = entry;
    delete session.exerciseResults[WARMUP_KEY];

    expect(hasCode(check(session).issues, ISSUE_CODES.STARTING_SIDE)).toBe(true);
  });

  test('a both result carrying startingSide fails', () => {
    const session = validSession();
    session.exerciseResults[WARMUP_KEY].startingSide = 'left';
    expect(hasCode(check(session).issues, ISSUE_CODES.STARTING_SIDE)).toBe(true);
  });

  test('an alternating result with startingSide passes', () => {
    const session = validSession();
    const entry = clone(session.exerciseResults[WARMUP_KEY]);
    entry.side = 'alternating';
    entry.startingSide = 'right';
    session.exerciseResults['root/warmup/warmup-squat|alternating|1'] = entry;
    delete session.exerciseResults[WARMUP_KEY];

    expect(check(session).issues).toEqual([]);
  });
});

describe('status and reason code', () => {
  const WARMUP = 'root/warmup/warmup-squat|both|1';
  const CINDY_SCORE = 'root/cindy|1';

  test('an incomplete exercise result with no reason code fails', () => {
    const session = validSession();
    session.exerciseResults[WARMUP].status = 'incomplete';

    expect(hasCode(check(session).issues, ISSUE_CODES.REASON_CODE_MISSING)).toBe(true);
  });

  test('an incomplete exercise result with a reason code passes', () => {
    const session = validSession();
    session.exerciseResults[WARMUP].status = 'incomplete';
    session.exerciseResults[WARMUP].reasonCode = 'not_completed';

    expect(hasCode(check(session).issues, ISSUE_CODES.REASON_CODE_MISSING)).toBe(false);
  });

  test('a skipped exercise result that keeps its measured values fails', () => {
    const session = validSession();
    session.exerciseResults[WARMUP].status = 'skipped';
    session.exerciseResults[WARMUP].reasonCode = 'user_skipped';

    expect(hasCode(check(session).issues, ISSUE_CODES.SKIPPED_RESULT_HAS_PAYLOAD)).toBe(true);
  });

  test('a skipped exercise result with no values passes', () => {
    const session = validSession();
    session.exerciseResults[WARMUP].status = 'skipped';
    session.exerciseResults[WARMUP].reasonCode = 'user_skipped';
    delete session.exerciseResults[WARMUP].values;

    expect(check(session).issues).toEqual([]);
  });

  test('a completed result that carries a reason code fails', () => {
    const session = validSession();
    session.containerResults[CINDY_SCORE].reasonCode = 'other';

    expect(hasCode(check(session).issues, ISSUE_CODES.REASON_CODE_FORBIDDEN)).toBe(true);
  });

  test('a skipped container result that keeps its score fails', () => {
    const session = validSession();
    session.containerResults[CINDY_SCORE].status = 'skipped';
    session.containerResults[CINDY_SCORE].reasonCode = 'time_constraint';

    expect(hasCode(check(session).issues, ISSUE_CODES.SKIPPED_RESULT_HAS_PAYLOAD)).toBe(true);
  });
});

describe('keyed maps', () => {
  test('an exerciseResults array fails', () => {
    const session = validSession();
    (session as unknown as Record<string, unknown>).exerciseResults = [];

    expect(hasCode(check(session).issues, ISSUE_CODES.KEYED_MAP_REQUIRED)).toBe(true);
  });

  test('a containerResults array fails', () => {
    const session = validSession();
    (session as unknown as Record<string, unknown>).containerResults = [];

    expect(hasCode(check(session).issues, ISSUE_CODES.KEYED_MAP_REQUIRED)).toBe(true);
  });

  test('a shard sessions array fails', () => {
    const shard = validShard();
    (shard as unknown as Record<string, unknown>).sessions = [];

    const report = validateShard(shard, staticData());
    expect(hasCode(report.issues, ISSUE_CODES.KEYED_MAP_REQUIRED)).toBe(true);
  });

  test('an exerciseUnits array fails', () => {
    const report = validatePreferences(
      { exerciseUnits: [] as unknown as Record<string, Record<string, string>> },
      staticData().exercises
    );
    expect(hasCode(report.issues, ISSUE_CODES.KEYED_MAP_REQUIRED)).toBe(true);
  });
});

describe('units', () => {
  test('a unit incompatible with its dimension fails', () => {
    const session = validSession();
    session.exerciseResults[WARMUP_KEY].values.weight.unit = 'stone';
    expect(hasCode(check(session).issues, ISSUE_CODES.UNIT_UNSUPPORTED)).toBe(true);
  });

  test('an unknown result dimension fails', () => {
    const session = validSession();
    const values = session.exerciseResults[WARMUP_KEY].values as Record<string, unknown>;
    values.jumps = { value: 4, unit: 'reps' };
    expect(hasCode(check(session).issues, ISSUE_CODES.UNIT_UNSUPPORTED)).toBe(true);
  });
});

describe('timestamps and keys', () => {
  test('a Utc value that does not end in Z fails', () => {
    const session = validSession();
    session.updatedAtUtc = '2026-08-15T15:05:00+02:00';
    expect(hasCode(check(session).issues, ISSUE_CODES.TIMESTAMP_NOT_UTC)).toBe(true);
  });

  test('an integer-like session key fails', () => {
    const shard = validShard();
    const session = validSession();
    session.id = '42';
    delete shard.sessions[SESSION_KEY];
    shard.sessions['42'] = session;

    const report = validateShard(shard, staticData());
    expect(hasCode(report.issues, ISSUE_CODES.INTEGER_LIKE_KEY)).toBe(true);
  });
});

describe('scores', () => {
  test('a score type that mismatches the container scoreType fails', () => {
    const session = validSession();
    session.containerResults[CINDY_KEY].score = { type: 'cycles', completedCycles: 2 };
    expect(hasCode(check(session).issues, ISSUE_CODES.SCORE_TYPE_MISMATCH)).toBe(true);
  });

  test('a nonstandard score passes', () => {
    const session = validSession();
    session.containerResults[CINDY_KEY].score = { type: 'nonstandard' };
    expect(hasCode(check(session).issues, ISSUE_CODES.SCORE_TYPE_MISMATCH)).toBe(false);
  });

  test('a container result on an unscored container fails', () => {
    const session = validSession();
    session.containerResults['root/squat-sets|1'] = {
      workoutId: 'demo',
      executionPath: [{ nodeId: 'root' }, { nodeId: 'squat-sets' }],
      attempt: 1,
      status: 'completed',
      score: { type: 'cycles', completedCycles: 3 }
    };
    expect(hasCode(check(session).issues, ISSUE_CODES.SCORE_TYPE_MISMATCH)).toBe(true);
  });
});

describe('child detail', () => {
  test('a child result under a childDetail "none" container fails', () => {
    const session = validSession();
    session.exerciseResults['root/complex-block:1/complex-press|both|1'] = {
      workoutId: 'demo',
      executionPath: [
        { nodeId: 'root' },
        { nodeId: 'complex-block', iteration: 1 },
        { nodeId: 'complex-press' }
      ],
      exerciseId: 'kb-press',
      side: 'both',
      attempt: 1,
      status: 'completed',
      values: { reps: { value: 5, unit: 'reps' } }
    };
    expect(hasCode(check(session).issues, ISSUE_CODES.CHILD_DETAIL_FORBIDDEN)).toBe(true);
  });

  test('standard detail that derives a different aggregate fails', () => {
    const session = validSession();
    // Cindy really holds 2 rounds and 10 additional reps.
    session.containerResults[CINDY_KEY].score = {
      type: 'rounds_and_reps',
      completedRounds: 3,
      additionalReps: 0
    };
    expect(hasCode(check(session).issues, ISSUE_CODES.SCORE_DERIVATION_MISMATCH)).toBe(true);
  });

  test('matching standard detail passes', () => {
    expect(hasCode(check(validSession()).issues, ISSUE_CODES.SCORE_DERIVATION_MISMATCH)).toBe(false);
  });

  test('a nonstandard score skips the derivation check', () => {
    const session = validSession();
    session.containerResults[CINDY_KEY].score = { type: 'nonstandard' };
    expect(hasCode(check(session).issues, ISSUE_CODES.SCORE_DERIVATION_MISMATCH)).toBe(false);
  });

  test('an intervals total that does not match cycles times children fails', () => {
    const session = validSession();
    session.containerResults['root/emom-block|1'].score = {
      type: 'intervals',
      completedIntervals: 4,
      totalIntervals: 9
    };
    expect(hasCode(check(session).issues, ISSUE_CODES.SCORE_DERIVATION_MISMATCH)).toBe(true);
  });

  test('completed intervals with a gap fail', () => {
    const session = validSession();
    // Fill slot 0 and slot 2, leaving slot 1 empty.
    delete session.exerciseResults['root/emom-block:1/emom-jump|both|1'];
    session.exerciseResults['root/emom-block:2/emom-jump|both|1'] = {
      workoutId: 'demo',
      executionPath: [
        { nodeId: 'root' },
        { nodeId: 'emom-block', iteration: 2 },
        { nodeId: 'emom-jump' }
      ],
      exerciseId: 'jump-rope',
      side: 'both',
      attempt: 1,
      status: 'completed',
      values: { reps: { value: 20, unit: 'reps' } }
    };
    session.containerResults['root/emom-block|1'].score = {
      type: 'intervals',
      completedIntervals: 4,
      totalIntervals: 8
    };
    expect(hasCode(check(session).issues, ISSUE_CODES.SCORE_DERIVATION_MISMATCH)).toBe(true);
  });

  test('excess reps on one leaf do not cover a shortfall on another leaf', () => {
    const session = validSession();
    // Round 1 drops every push-up and moves the reps to the sit-ups. The round
    // total still adds up, but the round is not full. REQUIREMENTS 10.17, 10.18.
    session.exerciseResults['root/cindy:1/pushups|both|1'].values!.reps!.value = 0;
    session.exerciseResults['root/cindy:1/situps|both|1'].values!.reps!.value = 25;

    expect(hasCode(check(session).issues, ISSUE_CODES.SCORE_DERIVATION_MISMATCH)).toBe(true);
  });

  test('a leaf that runs over while every other leaf meets its prescription passes', () => {
    const session = validSession();
    session.exerciseResults['root/cindy:1/pushups|both|1'].values!.reps!.value = 14;

    expect(hasCode(check(session).issues, ISSUE_CODES.SCORE_DERIVATION_MISMATCH)).toBe(false);
  });

  test('an AMRAP intervals score skips the cycle-count total', () => {
    const data = staticData();
    const cindy = data.workouts[0]!.root.children.find((node) => node.id === 'cindy');
    if (cindy !== undefined && cindy.type === 'container') {
      cindy.resultCapture = { mode: 'scored', scoreType: 'intervals', childDetail: 'optional' };
    }
    const session = validSession();
    // Three Cindy rounds of two children fill six slots. An AMRAP has no cycle
    // count, so the total cannot be derived and must not fail.
    session.containerResults[CINDY_KEY].score = {
      type: 'intervals',
      completedIntervals: 6,
      totalIntervals: 6
    };

    const report = validateSession(session, data, {
      shardYearMonthUtc: SHARD_MONTH,
      sessionKey: SESSION_KEY
    });
    expect(hasCode(report.issues, ISSUE_CODES.SCORE_DERIVATION_MISMATCH)).toBe(false);
  });

  test('an AMRAP intervals score still rejects more completed intervals than the total', () => {
    const data = staticData();
    const cindy = data.workouts[0]!.root.children.find((node) => node.id === 'cindy');
    if (cindy !== undefined && cindy.type === 'container') {
      cindy.resultCapture = { mode: 'scored', scoreType: 'intervals', childDetail: 'optional' };
    }
    const session = validSession();
    session.containerResults[CINDY_KEY].score = {
      type: 'intervals',
      completedIntervals: 6,
      totalIntervals: 2
    };

    const report = validateSession(session, data, {
      shardYearMonthUtc: SHARD_MONTH,
      sessionKey: SESSION_KEY
    });
    expect(hasCode(report.issues, ISSUE_CODES.SCORE_DERIVATION_MISMATCH)).toBe(true);
  });

  test('a rounds_and_reps container holding a non-repetition leaf fails', () => {
    const data = staticData();
    // Give the sit-up leaf no reps dimension.
    const sitUp = data.exercises.find((exercise) => exercise.id === 'sit-up');
    if (sitUp !== undefined) {
      sitUp.measurements = [{ dimension: 'duration', compatibleUnits: ['second'] }];
    }

    const report = validateSession(validSession(), data, {
      shardYearMonthUtc: SHARD_MONTH,
      sessionKey: SESSION_KEY
    });
    expect(hasCode(report.issues, ISSUE_CODES.ROUNDS_AND_REPS_NOT_REPETITIVE)).toBe(true);
  });
});

describe('nested repeated containers', () => {
  const RING_ONE = 'root/outer-ring:1/inner-amrap|1';

  function checkNested(session: Session) {
    return validateSession(session, nestedStaticData(), {
      shardYearMonthUtc: SHARD_MONTH,
      sessionKey: SESSION_KEY
    });
  }

  test('each outer round derives its score from its own children', () => {
    const report = checkNested(nestedSession());
    expect(report.issues).toEqual([]);
  });

  test('a score copied from another outer round fails', () => {
    const session = nestedSession();
    // Round 2 holds one full inner round and three extra reps, not round 1's 2/7.
    session.containerResults[RING_ONE.replace(':1/', ':2/')].score = {
      type: 'rounds_and_reps',
      completedRounds: 2,
      additionalReps: 7
    };

    expect(hasCode(checkNested(session).issues, ISSUE_CODES.SCORE_DERIVATION_MISMATCH)).toBe(true);
  });

  test('children of another outer round do not fill a scored round', () => {
    const session = nestedSession();
    // Round 1 keeps one full inner round. Round 2 still holds two inner rounds,
    // so a derivation that pulled them in would read two full rounds here.
    for (const key of Object.keys(session.exerciseResults)) {
      if (key.startsWith('root/outer-ring:1/inner-amrap:2/') ||
          key.startsWith('root/outer-ring:1/inner-amrap:3/')) {
        delete session.exerciseResults[key];
      }
    }
    session.containerResults[RING_ONE].score = {
      type: 'rounds_and_reps',
      completedRounds: 1,
      additionalReps: 0
    };

    const report = checkNested(session);
    expect(hasCode(report.issues, ISSUE_CODES.SCORE_DERIVATION_MISMATCH)).toBe(false);
  });
});

describe('shard placement', () => {
  test('a shard whose yearMonthUtc disagrees with a session start fails', () => {
    const shard = validShard();
    shard.yearMonthUtc = '2026-09';
    expect(hasCode(validateShard(shard, staticData()).issues, ISSUE_CODES.SHARD_MONTH_MISMATCH)).toBe(
      true
    );
  });

  test('a file name that disagrees with yearMonthUtc fails', () => {
    const report = validateShard(validShard(), staticData(), { fileName: 'results-2026-07.json' });
    expect(hasCode(report.issues, ISSUE_CODES.SHARD_MONTH_MISMATCH)).toBe(true);
  });

  test('a matching file name passes', () => {
    const report = validateShard(validShard(), staticData(), { fileName: 'results-2026-08.json' });
    expect(report.issues).toEqual([]);
  });
});

describe('message safety', () => {
  const SENTINEL = 'SECRET_NOTE_TEXT_42';

  /** Plant user note text everywhere, then break rules that report over them. */
  function plantedSession(): Session {
    const session = validSession();
    session.notes = SENTINEL;
    for (const entry of Object.values(session.exerciseResults)) {
      entry.notes = SENTINEL;
    }
    for (const entry of Object.values(session.containerResults)) {
      entry.notes = SENTINEL;
    }
    // Break the Cindy aggregate so a derivation issue fires over noted results.
    session.containerResults[CINDY_KEY].score = {
      type: 'rounds_and_reps',
      completedRounds: 9,
      additionalReps: 9
    };
    // Break a unit too.
    session.exerciseResults[WARMUP_KEY].values.weight.unit = 'stone';
    return session;
  }

  test('no issue message carries planted note text', () => {
    const report = check(plantedSession());
    expect(report.issues.length).toBeGreaterThan(0);
    for (const candidate of report.issues) {
      expect(candidate.message.includes(SENTINEL)).toBe(false);
    }
  });

  test('no issue message carries a recorded measurement value', () => {
    const report = check(plantedSession());
    // Stored weights and rep counts must not appear in any message.
    for (const candidate of report.issues) {
      expect(candidate.message.includes('110')).toBe(false);
      expect(candidate.message.includes('225')).toBe(false);
    }
  });

  test('an unresolved entry carries no note text either', () => {
    const session = plantedSession();
    session.exerciseResults[WARMUP_KEY].exerciseId = 'gone';
    const report = check(session);
    expect(report.unresolved.length).toBeGreaterThan(0);
    for (const entry of report.unresolved) {
      expect(JSON.stringify(entry).includes(SENTINEL)).toBe(false);
    }
  });
});
