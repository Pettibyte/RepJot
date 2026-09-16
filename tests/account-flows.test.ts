// The destructive Settings flows.
// Phase 19. REQUIREMENTS 21.3 through 21.7. ARCHITECTURE ADR-018, §10.
//
// These tests pin the ORDER inside each flow, which is where the damage would
// happen. A delete that runs before the queue drains re-creates the files it
// just removed. A disconnect that revokes before the flush strands a pending
// edit on the device with no grant left to send it.

import { describe, expect, test } from 'bun:test';
import { runDeleteAllUserData, runDisconnect } from '../src/data/account-flows';
import { createMemoryLocalStore } from '../src/storage/memory-local-store';
import { baseKey, cacheKey, pendingKey, type LocalStore } from '../src/storage/local-store';
import { createCoordinator, PREFERENCES_NAME } from '../src/sync/sync-coordinator';
import { FakeDrive } from './fakes/fake-drive';
import { frozenTimers, loadedStaticData } from './fixtures/sync';

/** A preferences document the schema accepts, so a merge can act on it. */
function prefsDoc(units: Record<string, Record<string, string>> = {}): string {
  return JSON.stringify({
    format: "repjot/preferences",
    schemaVersion: 1,
    revision: 0,
    updatedAtUtc: "2026-08-01T00:00:00Z",
    exerciseUnits: units
  });
}

/** A coordinator over a fresh fake Drive and memory store. */
async function makeWiring(seed: Array<{ name: string; text: string }> = []) {
  const drive = new FakeDrive();
  for (const file of seed) drive.addFile(file.name, file.text);
  const store = await createMemoryLocalStore();
  const staticData = loadedStaticData();
  const coordinator = createCoordinator({
    store,
    drive,
    staticData,
    accountKey: 'acct-1',
    pagehideTarget: null,
    timers: frozenTimers().timers
  });
  return { drive, store, coordinator };
}

/** A revoke stub that records the call and answers `confirmed`. */
function makeRevoke(confirmed: boolean): { calls: number; fn: () => Promise<boolean> } {
  const stub = { calls: 0, fn: async (): Promise<boolean> => true };
  stub.fn = async (): Promise<boolean> => {
    stub.calls += 1;
    return confirmed;
  };
  return stub;
}

/** Every key left in the store, sorted. */
async function allKeys(store: LocalStore): Promise<string[]> {
  return (await store.listKeys('')).sort();
}

describe('runDeleteAllUserData', () => {
  test('a complete run deletes the files, revokes, and clears local rows', async () => {
    const { drive, store, coordinator } = await makeWiring([
      { name: 'preferences.json', text: prefsDoc() },
      { name: 'results-2026-08.json', text: '{}' }
    ]);
    await store.set(cacheKey('preferences.json'), { formatVersion: 1 });
    await store.set(pendingKey('results-2026-08.json'), { delta: true });
    const revoke = makeRevoke(true);

    const result = await runDeleteAllUserData({
      drive,
      store,
      accountKey: 'acct-1',
      coordinator,
      revoke: revoke.fn
    });

    expect(result.kind).toBe('complete');
    expect(revoke.calls).toBe(1);
    expect(drive.textOf('preferences.json')).toBeUndefined();
    expect(await allKeys(store)).toEqual([]);
  });

  test('the queue drains before the first delete', async () => {
    const { drive, store, coordinator } = await makeWiring([{ name: 'preferences.json', text: prefsDoc() }]);
    const revoke = makeRevoke(true);

    // Queue a legal preference edit, then start the delete. The reset
    // inside the flow must flush it before any delete call goes out, so the
    // pending edit cannot follow the delete back up to Drive.
    coordinator.queueEdit(PREFERENCES_NAME, (doc: unknown): unknown => {
      const current = (doc ?? {}) as Record<string, unknown>;
      return {
        ...current,
        format: 'repjot/preferences',
        schemaVersion: 1,
        exerciseUnits: { 'back-squat': { weight: 'lb' } }
      };
    });

    const seenOrder: string[] = [];
    const originalDelete = drive.deleteFile.bind(drive);
    drive.deleteFile = async (id: string): Promise<void> => {
      seenOrder.push('delete');
      await originalDelete(id);
    };

    await runDeleteAllUserData({
      drive,
      store,
      accountKey: 'acct-1',
      coordinator,
      revoke: revoke.fn
    });

    // The queued edit reached local storage before the delete ran, so the
    // queue was empty when the delete started.
    expect(seenOrder[0]).toBe('delete');
    expect(await store.get(pendingKey(PREFERENCES_NAME))).toBeUndefined();
  });

  test('a partial delete stops before the revoke and keeps local data', async () => {
    const { drive, store, coordinator } = await makeWiring([{ name: 'preferences.json', text: prefsDoc() }]);
    await store.set(cacheKey('preferences.json'), { formatVersion: 1 });
    const revoke = makeRevoke(true);

    // Another device writes the file back after every delete, so the folder
    // never clears.
    const originalDelete = drive.deleteFile.bind(drive);
    drive.deleteFile = async (id: string): Promise<void> => {
      await originalDelete(id);
      drive.addFile('preferences.json', '{"from":"other-device"}');
    };

    const result = await runDeleteAllUserData({
      drive,
      store,
      accountKey: 'acct-1',
      coordinator,
      revoke: revoke.fn
    });

    expect(result.kind).toBe('partial');
    expect(result.remainingRecognized).toEqual(['preferences.json']);
    // The grant stays live so the user can finish the job.
    expect(revoke.calls).toBe(0);
    expect(await store.get(cacheKey('preferences.json'))).toBeDefined();
  });

  test('an unconfirmed revoke still reports the files it removed', async () => {
    const { drive, store, coordinator } = await makeWiring([{ name: 'preferences.json', text: prefsDoc() }]);
    const revoke = makeRevoke(false);

    const result = await runDeleteAllUserData({
      drive,
      store,
      accountKey: 'acct-1',
      coordinator,
      revoke: revoke.fn
    });

    expect(result.kind).toBe('revoke_failed');
    expect(result.deletedFileIds.length).toBe(1);
    expect(drive.textOf('preferences.json')).toBeUndefined();
  });

  test('a flow with no coordinator still deletes and revokes', async () => {
    const { drive, store } = await makeWiring([{ name: 'preferences.json', text: prefsDoc() }]);
    const revoke = makeRevoke(true);

    const result = await runDeleteAllUserData({
      drive,
      store,
      accountKey: 'acct-1',
      coordinator: null,
      revoke: revoke.fn
    });

    expect(result.kind).toBe('complete');
    expect(revoke.calls).toBe(1);
  });

  test('the progress callback counts each delete', async () => {
    const { drive, store, coordinator } = await makeWiring([
      { name: 'preferences.json', text: prefsDoc() },
      { name: 'results-2026-07.json', text: '{}' }
    ]);
    const seen: number[] = [];

    await runDeleteAllUserData({
      drive,
      store,
      accountKey: 'acct-1',
      coordinator,
      revoke: async (): Promise<boolean> => true,
      onProgress: (deleted: number): void => {
        seen.push(deleted);
      }
    });

    expect(seen).toEqual([1, 2]);
  });
});

describe('runDisconnect', () => {
  test('a confirmed revoke clears the local namespace', async () => {
    const { drive, store, coordinator } = await makeWiring([
      { name: 'preferences.json', text: prefsDoc() },
      { name: 'results-2026-08.json', text: '{}' }
    ]);
    await store.setMany([
      { name: cacheKey('preferences.json'), value: { formatVersion: 1 } },
      { name: baseKey('preferences.json'), value: { formatVersion: 1 } },
      { name: 'auth:remember', value: true }
    ]);
    const revoke = makeRevoke(true);

    const result = await runDisconnect({
      drive,
      store,
      accountKey: 'acct-1',
      coordinator,
      revoke: revoke.fn
    });

    expect(result.kind).toBe('disconnected');
    // The remote files stay exactly as they were. Disconnect cuts the grant,
    // not the data.
    expect(drive.textOf('preferences.json')).toBe(prefsDoc());
    expect(await allKeys(store)).toEqual(['auth:remember']);
  });

  test('a failed revoke keeps the local namespace', async () => {
    const { drive, store, coordinator } = await makeWiring([{ name: 'preferences.json', text: prefsDoc() }]);
    await store.set(cacheKey('preferences.json'), { formatVersion: 1 });
    const revoke = makeRevoke(false);

    const result = await runDisconnect({
      drive,
      store,
      accountKey: 'acct-1',
      coordinator,
      revoke: revoke.fn
    });

    expect(result.kind).toBe('revoke_failed');
    expect(await store.get(cacheKey('preferences.json'))).toBeDefined();
  });

  test('a pending edit reaches Drive before the revoke', async () => {
    const { drive, store, coordinator } = await makeWiring([
      { name: 'preferences.json', text: prefsDoc() }
    ]);
    // One log shared by the write path and the revoke, so the order is read
    // from a single timeline rather than inferred from two arrays.
    const timeline: string[] = [];

    const originalUpdate = drive.updateFile.bind(drive);
    drive.updateFile = async (id: string, text: string) => {
      timeline.push('write');
      return originalUpdate(id, text);
    };
    const originalCreate = drive.createFile.bind(drive);
    drive.createFile = async (name: string, text: string) => {
      timeline.push('write');
      return originalCreate(name, text);
    };

    coordinator.queueEdit(PREFERENCES_NAME, (doc: unknown): unknown => {
      const current = (doc ?? {}) as Record<string, unknown>;
      return {
        ...current,
        format: 'repjot/preferences',
        schemaVersion: 1,
        exerciseUnits: { 'back-squat': { weight: 'kg' } }
      };
    });

    const result = await runDisconnect({
      drive,
      store,
      accountKey: 'acct-1',
      coordinator,
      revoke: async (): Promise<boolean> => {
        timeline.push('revoke');
        return true;
      }
    });

    expect(result.kind).toBe('disconnected');
    // The edit landed before the grant went away, so nothing was stranded on
    // the device with no way to send it.
    expect(timeline[0]).toBe('write');
    expect(timeline[timeline.length - 1]).toBe('revoke');
    expect(timeline.filter((entry: string): boolean => entry === 'write').length).toBeGreaterThan(0);
    // The remote file carries the queued change.
    expect(drive.textOf('preferences.json')).toContain('"kg"');
  });

  test('a flow with no coordinator still revokes and clears', async () => {
    const { drive, store } = await makeWiring([{ name: 'preferences.json', text: prefsDoc() }]);
    await store.set(cacheKey('preferences.json'), { formatVersion: 1 });
    const revoke = makeRevoke(true);

    const result = await runDisconnect({
      drive,
      store,
      accountKey: 'acct-1',
      coordinator: null,
      revoke: revoke.fn
    });

    expect(result.kind).toBe('disconnected');
    expect(revoke.calls).toBe(1);
    expect(await allKeys(store)).toEqual([]);
  });
});
