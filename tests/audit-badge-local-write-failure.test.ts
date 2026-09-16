// F-03 gap A regression: a failed local write must not hide another file.
//
// The badge is one global value over every file the account holds. When one
// file sits in `sync_failed` with a pending delta on disk, a failed local
// write to a DIFFERENT file must not drop the badge to `idle`. It must keep
// the failure visible. When no file is failed, the same failed write must
// still show `idle`, because nothing was saved.
//
// REQUIREMENTS 4.3, 4.4, 4.20.

import { expect, test } from 'bun:test';
import { get } from 'svelte/store';
import { createMemoryLocalStore } from '../src/storage/memory-local-store';
import { createCoordinator } from '../src/sync/sync-coordinator';
import { saveStatus } from '../src/state/app-state';
import { FakeDrive } from './fakes/fake-drive';
import { frozenTimers, loadedStaticData, PREFS_NAME, SHARD_NAME } from './fixtures/sync';
import { clone, validSession, validShard } from './fixtures/semantic';

function prefsDoc(): Record<string, unknown> {
  return {
    format: 'repjot/preferences',
    schemaVersion: 1,
    revision: 0,
    updatedAtUtc: '2026-08-01T00:00:00Z',
    exerciseUnits: {}
  };
}

interface Wiring {
  drive: FakeDrive;
  store: ReturnType<typeof createMemoryLocalStore>;
  coordinator: ReturnType<typeof createCoordinator>;
}

async function wire(accountKey: string): Promise<Wiring> {
  const drive = new FakeDrive();
  drive.addFile(SHARD_NAME, JSON.stringify(clone(validShard())), 'shard-id');
  drive.addFile(PREFS_NAME, JSON.stringify(prefsDoc()), 'prefs-id');
  const store = createMemoryLocalStore();
  const coordinator = createCoordinator({
    store,
    drive,
    staticData: loadedStaticData(),
    accountKey,
    pagehideTarget: null,
    timers: frozenTimers().timers
  });
  await coordinator.ensureLoaded(SHARD_NAME);
  await coordinator.ensureLoaded(PREFS_NAME);
  return { drive, store, coordinator };
}

/** Make every local write to one logical file throw. */
function breakLocalWritesFor(
  store: ReturnType<typeof createMemoryLocalStore>,
  needle: string
): void {
  const original = store.setMany.bind(store);
  (store as { setMany: unknown }).setMany = async (
    entries: Array<{ name: string }>
  ): Promise<void> => {
    if (entries.some((entry) => entry.name.includes(needle))) {
      throw new Error('local storage refuses the write');
    }
    await original(entries);
  };
}

function addSessionToShard(coordinator: ReturnType<typeof createCoordinator>, id: string) {
  return coordinator.edit(SHARD_NAME, (doc: unknown): unknown => {
    const shard = doc as ReturnType<typeof validShard>;
    const session = clone(validSession()) as ReturnType<typeof validSession>;
    session.id = id;
    session.updatedAtUtc = '2026-08-19T08:30:00Z';
    shard.sessions[session.id] = session;
    return shard;
  });
}

test('a failed local write keeps another file sync_failed visible', async () => {
  const { drive, store, coordinator } = await wire('audit-badge-gap-a');

  // Put preferences into sync_failed with a pending delta still on disk.
  const failWrite = async (): Promise<never> => {
    throw new Error('Drive refuses writes');
  };
  const originalCreate = drive.createFile.bind(drive);
  const originalUpdate = drive.updateFile.bind(drive);
  drive.createFile = failWrite;
  drive.updateFile = failWrite;
  try {
    const handle = await coordinator.edit(PREFS_NAME, (doc: unknown): unknown => {
      const prefs = doc as Record<string, unknown>;
      prefs.revision = 7;
      return prefs;
    });
    await handle.synced;
  } catch {
    // Expected. The delta stays pending.
  }
  expect(get(saveStatus)).toBe('sync_failed');

  // Restore Drive, then break only the local write for the shard.
  drive.createFile = originalCreate;
  drive.updateFile = originalUpdate;
  breakLocalWritesFor(store, SHARD_NAME);

  let localThrew = false;
  try {
    await addSessionToShard(coordinator, 'session-00000000-0000-4000-8000-000000000041');
  } catch {
    localThrew = true;
  }

  expect(localThrew).toBe(true);
  expect(await coordinator.pendingEdits()).toContain(PREFS_NAME);
  // The preferences failure must survive the unrelated local failure.
  expect(get(saveStatus)).toBe('sync_failed');
});

test('a failed local write with no other failure shows idle, not saved', async () => {
  const { store, coordinator } = await wire('audit-badge-gap-a-clean');

  breakLocalWritesFor(store, SHARD_NAME);

  let threw = false;
  try {
    await addSessionToShard(coordinator, 'session-00000000-0000-4000-8000-000000000042');
  } catch {
    threw = true;
  }

  expect(threw).toBe(true);
  // Nothing was saved, so the badge must not claim `saved`.
  expect(get(saveStatus)).toBe('idle');
});
