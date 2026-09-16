// Delete All User Data.
// Phase 19. REQUIREMENTS 21.3, 21.4, 4.22. ARCHITECTURE ADR-018.

import { describe, expect, test } from 'bun:test';
import { clearAccountNamespace, deleteAllUserData } from '../src/data/delete-all-data';
import { createMemoryLocalStore } from '../src/storage/memory-local-store';
import { baseKey, cacheKey, pendingKey, type LocalStore } from '../src/storage/local-store';
import { FakeDrive } from './fakes/fake-drive';

/** Seed a store with one row under each account prefix. */
async function seedStore(store: LocalStore): Promise<void> {
  await store.setMany([
    { name: cacheKey('preferences.json'), value: { formatVersion: 1 } },
    { name: baseKey('preferences.json'), value: { formatVersion: 1 } },
    { name: pendingKey('results-2026-08.json'), value: { delta: true } },
    { name: 'auth:remember', value: true }
  ]);
}

/** Every key left in the store, sorted. */
async function allKeys(store: LocalStore): Promise<string[]> {
  return (await store.listKeys('')).sort();
}

describe('deleteAllUserData: recognized files', () => {
  test('every recognized file is deleted by stable Drive file ID', async () => {
    const drive = new FakeDrive();
    const prefsId = drive.addFile('preferences.json', '{}');
    const shardId = drive.addFile('results-2026-08.json', '{}');
    const store = await createMemoryLocalStore();

    const result = await deleteAllUserData({ drive, store, accountKey: 'acct-1' });

    expect(result.kind).toBe('complete');
    expect(result.deletedFileIds.sort()).toEqual([prefsId, shardId].sort());

    // The delete calls name the IDs, never the names. A rename on another
    // device cannot make this run miss its target.
    const deleteCalls = drive.calls.filter((call: string): boolean => call.startsWith('deleteFile:'));
    expect(deleteCalls.sort()).toEqual([`deleteFile:${prefsId}`, `deleteFile:${shardId}`].sort());
  });

  test('an unknown file is never deleted', () => {
    const drive = new FakeDrive();
    drive.addFile('preferences.json', '{}');
    drive.addFile('my-notes.txt', 'keep me');
    drive.addFile('results-2026-13.json', 'not a shard');

    return (async (): Promise<void> => {
      const store = await createMemoryLocalStore();
      const result = await deleteAllUserData({ drive, store, accountKey: 'acct-1' });

      expect(result.kind).toBe('complete');
      expect(drive.textOf('my-notes.txt')).toBe('keep me');
      expect(drive.textOf('results-2026-13.json')).toBe('not a shard');
      expect(drive.textOf('preferences.json')).toBeUndefined();
    })();
  });

  test('an empty folder completes without a delete call', async () => {
    const drive = new FakeDrive();
    const store = await createMemoryLocalStore();

    const result = await deleteAllUserData({ drive, store, accountKey: 'acct-1' });

    expect(result.kind).toBe('complete');
    expect(result.deletedFileIds).toEqual([]);
    expect(drive.calls.filter((call: string): boolean => call.startsWith('deleteFile:'))).toEqual([]);
  });

  test('the progress callback counts each delete', async () => {
    const drive = new FakeDrive();
    drive.addFile('preferences.json', '{}');
    drive.addFile('results-2026-07.json', '{}');
    drive.addFile('results-2026-08.json', '{}');
    const store = await createMemoryLocalStore();

    const seen: number[] = [];
    await deleteAllUserData({
      drive,
      store,
      accountKey: 'acct-1',
      onProgress: (deleted: number): void => {
        seen.push(deleted);
      }
    });

    expect(seen).toEqual([1, 2, 3]);
  });
});

describe('deleteAllUserData: re-list loop', () => {
  test('a file that survives the first pass is deleted on the second', async () => {
    const drive = new FakeDrive();
    const id = drive.addFile('preferences.json', '{}');
    const store = await createMemoryLocalStore();

    // Model a delete that reported success but left the file. The loop reads
    // the next list, sees the name still there, and deletes again.
    let firstDelete = true;
    const originalDelete = drive.deleteFile.bind(drive);
    drive.deleteFile = async (fileId: string): Promise<void> => {
      if (firstDelete) {
        firstDelete = false;
        drive.calls.push(`deleteFile:${fileId}:ignored`);
        return;
      }
      await originalDelete(fileId);
    };

    const result = await deleteAllUserData({ drive, store, accountKey: 'acct-1' });

    expect(result.kind).toBe('complete');
    expect(drive.textOf('preferences.json')).toBeUndefined();
  });

  test('a second device that re-creates a file mid-run ends the run partial', async () => {
    const drive = new FakeDrive();
    drive.addFile('preferences.json', '{}');
    const store = await createMemoryLocalStore();

    // Another device writes the file back after every delete, so the folder
    // never clears. The loop must stop and say so.
    const originalDelete = drive.deleteFile.bind(drive);
    drive.deleteFile = async (fileId: string): Promise<void> => {
      await originalDelete(fileId);
      drive.addFile('preferences.json', '{"from":"other-device"}');
    };

    const result = await deleteAllUserData({ drive, store, accountKey: 'acct-1' });

    expect(result.kind).toBe('partial');
    expect(result.remainingRecognized).toEqual(['preferences.json']);
  });

  test('a partial run keeps the local data for a retry', async () => {
    const drive = new FakeDrive();
    drive.addFile('preferences.json', '{}');
    const store = await createMemoryLocalStore();
    await seedStore(store);

    const originalDelete = drive.deleteFile.bind(drive);
    drive.deleteFile = async (fileId: string): Promise<void> => {
      await originalDelete(fileId);
      drive.addFile('preferences.json', '{"from":"other-device"}');
    };

    const result = await deleteAllUserData({ drive, store, accountKey: 'acct-1' });

    expect(result.kind).toBe('partial');
    const keys = await allKeys(store);
    expect(keys).toContain(cacheKey('preferences.json'));
    expect(keys).toContain(pendingKey('results-2026-08.json'));
  });
});

describe('deleteAllUserData: complete run clears local data', () => {
  test('a complete run clears the account namespace and pending records', async () => {
    const drive = new FakeDrive();
    drive.addFile('preferences.json', '{}');
    drive.addFile('results-2026-08.json', '{}');
    const store = await createMemoryLocalStore();
    await seedStore(store);

    const result = await deleteAllUserData({ drive, store, accountKey: 'acct-1' });

    expect(result.kind).toBe('complete');
    const keys = await allKeys(store);
    expect(keys).not.toContain(cacheKey('preferences.json'));
    expect(keys).not.toContain(baseKey('preferences.json'));
    expect(keys).not.toContain(pendingKey('results-2026-08.json'));
  });

  test('the clear leaves keys outside the account namespace', async () => {
    const drive = new FakeDrive();
    drive.addFile('preferences.json', '{}');
    const store = await createMemoryLocalStore();
    await seedStore(store);

    await deleteAllUserData({ drive, store, accountKey: 'acct-1' });

    // `auth:remember` is not a document row. The delete-all flow does not
    // own auth state, and this module must not reach into it.
    const keys = await allKeys(store);
    expect(keys).toEqual(['auth:remember']);
  });
});

describe('clearAccountNamespace', () => {
  test('it removes every document, base, and pending row', async () => {
    const store = await createMemoryLocalStore();
    await seedStore(store);

    const removed = await clearAccountNamespace(store);

    expect(removed.sort()).toEqual(
      [
        cacheKey('preferences.json'),
        baseKey('preferences.json'),
        pendingKey('results-2026-08.json')
      ].sort()
    );
    expect(await allKeys(store)).toEqual(['auth:remember']);
  });

  test('an empty store clears nothing and reports nothing', async () => {
    const store = await createMemoryLocalStore();
    expect(await clearAccountNamespace(store)).toEqual([]);
  });
});
