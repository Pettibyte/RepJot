// The preference service: read, write, and list per-exercise unit choices.
// Phase 13. REQUIREMENTS 12.2, 12.3, 12.4, 12.7, 12.8, 12.9.
//
// The service sits on the real Phase 10 coordinator over a memory store and a
// fake Drive, so a test sees the same save path a screen drives. The point of
// that wiring is the last group: a preference write must not reach a results
// shard, and a rejected write must not reach anything.

import { describe, expect, test, beforeEach } from 'bun:test';
import { resetDiagnosticLog } from '../src/diagnostics/diagnostic-log';
import { decodeUtf8 } from '../src/bytes/utf8';
import { AppError } from '../src/domain/errors';
import type { Exercise, PreferencesDoc } from '../src/domain/types';
import { createMemoryLocalStore } from '../src/storage/memory-local-store';
import { cacheKey, type LocalStore } from '../src/storage/local-store';
import { createCoordinator, PREFERENCES_NAME, type Coordinator } from '../src/sync/sync-coordinator';
import {
  createPreferenceService,
  type PreferenceService
} from '../src/preferences/preference-service';
import { FakeDrive } from './fakes/fake-drive';
import { frozenTimers, loadedStaticData, SHARD_NAME } from './fixtures/sync';
import { preferencesDoc, resultsShard } from './fixtures/merge';
import { exercises, validShard } from './fixtures/semantic';

/** Read the `AppError` kind a rejection carried, or `null` when it resolved. */
async function kindOfRejection(run: () => Promise<unknown>): Promise<string | null> {
  try {
    await run();
    return null;
  } catch (error) {
    return error instanceof AppError ? error.kind : 'non-app-error';
  }
}

/** Build a service over a fresh memory store and a fake Drive. */
function makeSetup(
  seed?: Array<{ name: string; text: string }>,
  extraExercises: Exercise[] = []
): {
  store: LocalStore;
  drive: FakeDrive;
  coordinator: Coordinator;
  service: PreferenceService;
} {
  const store = createMemoryLocalStore();
  const drive = new FakeDrive();
  for (const file of seed ?? []) drive.addFile(file.name, file.text);
  const staticData = loadedStaticData([...exercises(), ...extraExercises]);
  const coordinator = createCoordinator({
    store,
    drive,
    staticData,
    accountKey: 'acct-prefs',
    pagehideTarget: null,
    timers: frozenTimers().timers
  });
  return {
    store,
    drive,
    coordinator,
    service: createPreferenceService({ coordinator, staticData })
  };
}

/**
 * An exercise whose ID is `__proto__`.
 *
 * The preferences key pattern `^(?![0-9]+$)[^/|:]+$` permits this ID, and a
 * static exercise may legitimately carry it, so the existence check passes.
 * A plain-object write of that key sets the object's prototype instead of an
 * own key, so the mapping serializes away.
 */
function protoExercise(): Exercise {
  return {
    ...backSquatExercise(),
    id: '__proto__',
    name: 'Prototype Trick'
  };
}

/** The squat fixture exercise, reached through the shared fixture list. */
function backSquatExercise(): Exercise {
  return exercises().find((exercise) => exercise.id === 'back-squat') as Exercise;
}

/** The preferences document the coordinator holds after a write. */
function docOf(coordinator: Coordinator): PreferencesDoc {
  return coordinator.peek(PREFERENCES_NAME) as PreferencesDoc;
}

beforeEach(() => {
  resetDiagnosticLog();
});

describe('getUnit with no saved preference', () => {
  test('returns the first compatibleUnits entry', async () => {
    const { service, coordinator } = makeSetup([
      { name: PREFERENCES_NAME, text: JSON.stringify(preferencesDoc({})) }
    ]);
    await service.ensureDoc();
    // The fixture lists lb before kg, so lb is the default.
    expect(service.getUnit('back-squat', 'weight')).toBe('lb');
    expect(service.getUnit('row', 'distance')).toBe('m');
    expect(service.getUnit('row', 'duration')).toBe('second');
    expect(service.getUnit('jump-rope', 'reps')).toBe('reps');
    // A read never wrote anything.
    expect(docOf(coordinator).exerciseUnits).toEqual({});
  });

  test('a dimension the exercise does not measure has no unit', () => {
    const { service } = makeSetup();
    expect(service.getUnit('back-squat', 'distance')).toBeUndefined();
    expect(service.getUnit('back-squat', 'calories')).toBeUndefined();
  });

  test('an unknown exercise has no unit', () => {
    const { service } = makeSetup();
    expect(service.getUnit('no-such-exercise', 'weight')).toBeUndefined();
  });

  test('a saved mapping wins over the default', async () => {
    const { service } = makeSetup([
      { name: PREFERENCES_NAME, text: JSON.stringify(preferencesDoc({ 'back-squat': { weight: 'kg' } })) }
    ]);
    await service.ensureDoc();
    expect(service.getUnit('back-squat', 'weight')).toBe('kg');
  });

  test('a saved unit the exercise no longer lists falls back to the default', async () => {
    // Static data changed under the stored preference. The pill must not offer
    // a unit the exercise cannot hold, so the read falls back.
    const { service } = makeSetup([
      { name: PREFERENCES_NAME, text: JSON.stringify(preferencesDoc({ 'kb-press': { weight: 'lb' } })) }
    ]);
    await service.ensureDoc();
    // kb-press lists kg only.
    expect(service.getUnit('kb-press', 'weight')).toBe('kg');
  });

  test('one dimension mapping does not leak into another', async () => {
    const { service } = makeSetup([
      { name: PREFERENCES_NAME, text: JSON.stringify(preferencesDoc({ row: { distance: 'km' } })) }
    ]);
    await service.ensureDoc();
    expect(service.getUnit('row', 'distance')).toBe('km');
    expect(service.getUnit('row', 'duration')).toBe('second');
  });
});

describe('setUnit', () => {
  test('writes the mapping and leaves other mappings untouched', async () => {
    const { service, coordinator } = makeSetup([
      {
        name: PREFERENCES_NAME,
        text: JSON.stringify(
          preferencesDoc({ 'back-squat': { weight: 'kg' }, row: { distance: 'm' } })
        )
      }
    ]);
    await service.ensureDoc();
    await service.setUnit('row', 'distance', 'km');

    const doc = docOf(coordinator);
    expect(doc.exerciseUnits).toEqual({
      'back-squat': { weight: 'kg' },
      row: { distance: 'km' }
    });
  });

  test('adds a second dimension to an exercise that already has one', async () => {
    const { service, coordinator } = makeSetup([
      {
        name: PREFERENCES_NAME,
        text: JSON.stringify(preferencesDoc({ 'back-squat': { weight: 'kg' } }))
      }
    ]);
    await service.ensureDoc();
    await service.setUnit('back-squat', 'weight', 'lb');
    expect(docOf(coordinator).exerciseUnits['back-squat']).toEqual({ weight: 'lb' });
  });

  test('the write is durable in the local store', async () => {
    const { service, store } = makeSetup([
      { name: PREFERENCES_NAME, text: JSON.stringify(preferencesDoc({})) }
    ]);
    await service.ensureDoc();
    await service.setUnit('back-squat', 'weight', 'lb');
    const cached = (await store.get(cacheKey(PREFERENCES_NAME))) as { contentText: string };
    expect(JSON.parse(cached.contentText).exerciseUnits).toEqual({
      'back-squat': { weight: 'lb' }
    });
  });

  test('an incompatible unit throws invalid_document and writes nothing', async () => {
    const { service, coordinator } = makeSetup([
      {
        name: PREFERENCES_NAME,
        text: JSON.stringify(preferencesDoc({ 'back-squat': { weight: 'kg' } }))
      }
    ]);
    await service.ensureDoc();
    const before = JSON.stringify(docOf(coordinator));

    // jump-rope measures reps only, so a weight unit is not writable.
    const kind = await kindOfRejection(() => service.setUnit('jump-rope', 'weight', 'kg'));
    expect(kind).toBe('invalid_document');
    expect(JSON.stringify(docOf(coordinator))).toBe(before);
  });

  test('a unit outside the exercise list for a real dimension throws', async () => {
    const { service, coordinator } = makeSetup([
      {
        name: PREFERENCES_NAME,
        text: JSON.stringify(preferencesDoc({ 'kb-press': { weight: 'kg' } }))
      }
    ]);
    await service.ensureDoc();
    const before = JSON.stringify(docOf(coordinator));
    // kb-press lists kg only.
    expect(await kindOfRejection(() => service.setUnit('kb-press', 'weight', 'lb'))).toBe(
      'invalid_document'
    );
    expect(JSON.stringify(docOf(coordinator))).toBe(before);
  });

  test('an unknown exercise throws and writes nothing', async () => {
    const { service, coordinator, drive } = makeSetup([
      { name: PREFERENCES_NAME, text: JSON.stringify(preferencesDoc({})) }
    ]);
    await service.ensureDoc();
    const before = JSON.stringify(docOf(coordinator));
    const writesBefore = drive.calls.filter((call) => call.startsWith('updateFile')).length;

    expect(await kindOfRejection(() => service.setUnit('ghost', 'weight', 'kg'))).toBe(
      'invalid_document'
    );
    expect(JSON.stringify(docOf(coordinator))).toBe(before);
    expect(drive.calls.filter((call) => call.startsWith('updateFile')).length).toBe(writesBefore);
  });

  test('the rejection names the exercise, dimension, and unit', async () => {
    const { service } = makeSetup();
    try {
      await service.setUnit('jump-rope', 'weight', 'kg');
      throw new Error('expected a rejection');
    } catch (error) {
      const detail = (error as AppError).detail;
      expect(detail.exerciseId).toBe('jump-rope');
      expect(detail.dimension).toBe('weight');
      expect(detail.unit).toBe('kg');
    }
  });

  test('a rejected write leaves the Drive copy untouched', async () => {
    const seed = preferencesDoc({ 'back-squat': { weight: 'kg' } });
    const { service, drive } = makeSetup([{ name: PREFERENCES_NAME, text: JSON.stringify(seed) }]);
    await service.ensureDoc();
    const id = drive.idsOf(PREFERENCES_NAME)[0];
    const before = decodeUtf8((await drive.readFile(id)).bytes);

    await kindOfRejection(() => service.setUnit('jump-rope', 'weight', 'kg'));
    expect(decodeUtf8((await drive.readFile(id)).bytes)).toBe(before);
  });
});

describe('a __proto__ exercise ID survives the write path', () => {
  test('the mapping is an own key, serializes, and reads back', async () => {
    const { service, coordinator, store } = makeSetup(
      [{ name: PREFERENCES_NAME, text: JSON.stringify(preferencesDoc({})) }],
      [protoExercise()]
    );
    await service.ensureDoc();

    await service.setUnit('__proto__', 'weight', 'kg');

    // The mapping is present in the serialized document. A plain-object write
    // put it on the prototype instead, so the text came back `{}` and the
    // preference was lost with no error raised.
    const text = JSON.stringify(docOf(coordinator).exerciseUnits);
    expect(text).toBe('{"__proto__":{"weight":"kg"}}');

    // It reads back through the same service that wrote it.
    expect(service.getUnit('__proto__', 'weight')).toBe('kg');

    // It lists, so the Settings screen can show and clean it up.
    expect(service.listMappings()).toContainEqual({
      exerciseId: '__proto__',
      exerciseName: 'Prototype Trick',
      dimension: 'weight',
      unit: 'kg'
    });

    // It is durable in the local store, not only in memory.
    const cached = (await store.get(cacheKey(PREFERENCES_NAME))) as { contentText: string };
    expect(JSON.parse(cached.contentText).exerciseUnits).toEqual({
      __proto__: { weight: 'kg' }
    });
  });

  test('a __proto__ mapping does not disturb the other mappings', async () => {
    const { service } = makeSetup(
      [
        {
          name: PREFERENCES_NAME,
          text: JSON.stringify(preferencesDoc({ 'back-squat': { weight: 'kg' } }))
        }
      ],
      [protoExercise()]
    );
    await service.ensureDoc();

    await service.setUnit('__proto__', 'weight', 'lb');

    expect(service.getUnit('back-squat', 'weight')).toBe('kg');
    expect(service.getUnit('__proto__', 'weight')).toBe('lb');
  });

  test('a stored __proto__ key is read as a mapping, not as the prototype', async () => {
    // The read path is the mirror of the write. A bracket read of
    // `exerciseUnits['__proto__']` on a plain object returns Object.prototype
    // for every document, own key or not, so the read must check own property.
    const seeded = preferencesDoc({});
    Object.defineProperty(seeded.exerciseUnits, '__proto__', {
      value: { weight: 'kg' },
      enumerable: true,
      writable: true,
      configurable: true
    });
    const { service } = makeSetup([{ name: PREFERENCES_NAME, text: JSON.stringify(seeded) }], [
      protoExercise()
    ]);
    await service.ensureDoc();

    expect(service.getUnit('__proto__', 'weight')).toBe('kg');
  });

  test('a document with no own __proto__ key does not read a unit from the prototype', async () => {
    // Guards the other direction: the read must not mistake the inherited
    // member for a stored mapping.
    const { service } = makeSetup([
      { name: PREFERENCES_NAME, text: JSON.stringify(preferencesDoc({})) }
    ]);
    await service.ensureDoc();
    expect(service.getUnit('__proto__', 'weight')).toBeUndefined();
  });
});

describe('listMappings', () => {
  test('returns one row per stored mapping with the exercise name resolved', async () => {
    const { service } = makeSetup([
      {
        name: PREFERENCES_NAME,
        text: JSON.stringify(
          preferencesDoc({
            'back-squat': { weight: 'kg' },
            row: { distance: 'km', duration: 'minute' }
          })
        )
      }
    ]);
    await service.ensureDoc();
    const rows = service.listMappings();
    expect(rows.length).toBe(3);
    expect(rows).toContainEqual({
      exerciseId: 'back-squat',
      exerciseName: 'Back Squat',
      dimension: 'weight',
      unit: 'kg'
    });
    expect(rows).toContainEqual({
      exerciseId: 'row',
      exerciseName: 'Row',
      dimension: 'distance',
      unit: 'km'
    });
    expect(rows).toContainEqual({
      exerciseId: 'row',
      exerciseName: 'Row',
      dimension: 'duration',
      unit: 'minute'
    });
  });

  test('rows sort by exercise name, then by dimension order', async () => {
    const { service } = makeSetup([
      {
        name: PREFERENCES_NAME,
        text: JSON.stringify(
          preferencesDoc({
            row: { duration: 'minute', distance: 'km' },
            'back-squat': { weight: 'kg', reps: 'reps' }
          })
        )
      }
    ]);
    await service.ensureDoc();
    const order = service.listMappings().map((row) => `${row.exerciseName}/${row.dimension}`);
    expect(order).toEqual([
      'Back Squat/reps',
      'Back Squat/weight',
      'Row/distance',
      'Row/duration'
    ]);
  });

  test('a mapping for a removed exercise still lists with the raw ID as the name', async () => {
    const { service } = makeSetup([
      {
        name: PREFERENCES_NAME,
        text: JSON.stringify(preferencesDoc({ 'gone-exercise': { weight: 'kg' } }))
      }
    ]);
    await service.ensureDoc();
    expect(service.listMappings()).toEqual([
      {
        exerciseId: 'gone-exercise',
        exerciseName: 'gone-exercise',
        dimension: 'weight',
        unit: 'kg'
      }
    ]);
  });

  test('an empty document lists no rows', async () => {
    const { service } = makeSetup([
      { name: PREFERENCES_NAME, text: JSON.stringify(preferencesDoc({})) }
    ]);
    await service.ensureDoc();
    expect(service.listMappings()).toEqual([]);
  });

  test('a new mapping shows up in the list', async () => {
    const { service } = makeSetup([
      { name: PREFERENCES_NAME, text: JSON.stringify(preferencesDoc({})) }
    ]);
    await service.ensureDoc();
    await service.setUnit('back-squat', 'weight', 'lb');
    expect(service.listMappings().map((row) => row.unit)).toEqual(['lb']);
  });
});

describe('a preference change does not touch stored results', () => {
  test('the results shard keeps its exact text after a unit toggle', async () => {
    const shard = validShard();
    const shardText = JSON.stringify(shard);
    const { service, drive } = makeSetup([
      { name: SHARD_NAME, text: shardText },
      { name: PREFERENCES_NAME, text: JSON.stringify(preferencesDoc({})) }
    ]);
    await service.ensureDoc();
    const shardId = drive.idsOf(SHARD_NAME)[0];

    await service.setUnit('back-squat', 'weight', 'lb');

    // The shard on Drive is byte-identical. The preference write touched only
    // preferences.json, so a recorded set keeps its value and unit.
    // REQUIREMENTS 12.7.
    expect(decodeUtf8((await drive.readFile(shardId)).bytes)).toBe(shardText);
  });

  test('a stored 100 lb result still reads 100 lb after the default flips to kg', async () => {
    const shard = validShard();
    const { service, drive } = makeSetup([
      { name: SHARD_NAME, text: JSON.stringify(shard) },
      { name: PREFERENCES_NAME, text: JSON.stringify(preferencesDoc({})) }
    ]);
    await service.ensureDoc();
    const shardId = drive.idsOf(SHARD_NAME)[0];
    const before = decodeUtf8((await drive.readFile(shardId)).bytes);

    // Flip the preference, then read the stored result back out of the shard.
    await service.setUnit('back-squat', 'weight', 'kg');
    const after = JSON.parse(decodeUtf8((await drive.readFile(shardId)).bytes)) as typeof shard;

    // Find the recorded 100 lb squat set. The preference now says kg, which
    // changes what the pill shows next time, not what this result holds.
    const results = Object.values(after.sessions)
      .flatMap((session) => Object.values(session.exerciseResults))
      .filter((result) => result.values?.weight?.value === 100);
    expect(results.length).toBeGreaterThan(0);
    for (const result of results) {
      expect(result.values?.weight).toEqual({ value: 100, unit: 'lb' });
    }
    expect(service.getUnit('back-squat', 'weight')).toBe('kg');
    expect(JSON.stringify(after)).toBe(before);
  });

  test('the service never opens the shard logical file', async () => {
    const { service, drive } = makeSetup([
      { name: SHARD_NAME, text: JSON.stringify(resultsShard({})) },
      { name: PREFERENCES_NAME, text: JSON.stringify(preferencesDoc({})) }
    ]);
    await service.ensureDoc();
    const shardId = drive.idsOf(SHARD_NAME)[0];
    await service.setUnit('back-squat', 'weight', 'lb');
    // No read or write of the shard name or ID came from this service call
    // beyond the setup load.
    const shardTouches = drive.calls.filter(
      (call) => call.includes(SHARD_NAME) || call.includes(shardId)
    );
    expect(shardTouches).toEqual([]);
  });
});

describe('ensureDoc', () => {
  test('returns the loaded preferences document', async () => {
    const { service } = makeSetup([
      { name: PREFERENCES_NAME, text: JSON.stringify(preferencesDoc({ 'back-squat': { weight: 'kg' } })) }
    ]);
    const doc = await service.ensureDoc();
    expect(doc.format).toBe('repjot/preferences');
    expect(doc.exerciseUnits['back-squat'].weight).toBe('kg');
  });

  test('is safe to call twice', async () => {
    const { service } = makeSetup([
      { name: PREFERENCES_NAME, text: JSON.stringify(preferencesDoc({})) }
    ]);
    const first = await service.ensureDoc();
    const second = await service.ensureDoc();
    expect(second.exerciseUnits).toEqual(first.exerciseUnits);
  });
});
