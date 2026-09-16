// F-02 companion regression: Disconnect must not revoke over a stuck edit.
//
// The flush runs first, but it swallows its own failures. When an upload
// cannot land, the delta stays in local storage. Clearing the local namespace
// and revoking the grant would then destroy the only copy of that edit. The
// flow reads the pending rows back and stops.
//
// REQUIREMENTS 4.4, 4.20.

import { expect, test } from 'bun:test';
import { createMemoryLocalStore } from '../src/storage/memory-local-store';
import { createCoordinator } from '../src/sync/sync-coordinator';
import { runDisconnect } from '../src/data/account-flows';
import { FakeDrive } from './fakes/fake-drive';
import { frozenTimers, loadedStaticData, SHARD_NAME } from './fixtures/sync';
import { clone, validSession, validShard } from './fixtures/semantic';

test('Disconnect does not revoke while a local edit is stuck pending', async () => {
  const drive = new FakeDrive();
  drive.addFile(SHARD_NAME, JSON.stringify(clone(validShard())), 'stable-file-id');
  const store = createMemoryLocalStore();

  const coordinator = createCoordinator({
    store,
    drive,
    staticData: loadedStaticData(),
    accountKey: 'audit-disconnect',
    pagehideTarget: null,
    timers: frozenTimers().timers
  });
  await coordinator.ensureLoaded(SHARD_NAME);

  // Break uploads before the edit, so the delta can never leave this device.
  const failWrite = async (): Promise<never> => {
    throw new Error('Drive refuses writes');
  };
  drive.createFile = failWrite;
  drive.updateFile = failWrite;

  const edit = clone(validSession()) as ReturnType<typeof validSession>;
  edit.id = 'session-00000000-0000-4000-8000-000000000030';
  edit.updatedAtUtc = '2026-08-18T08:30:00Z';
  try {
    await coordinator.edit(SHARD_NAME, (doc: unknown): unknown => {
      const shard = doc as ReturnType<typeof validShard>;
      shard.sessions[edit.id] = edit;
      return shard;
    });
  } catch {
    // The sync fails. The local write is durable, which is the point.
  }

  expect(await coordinator.pendingEdits()).toContain(SHARD_NAME);

  let revokeCalled = false;
  const result = await runDisconnect({
    store,
    coordinator,
    revoke: async (): Promise<boolean> => {
      revokeCalled = true;
      return true;
    },
    trashAll: async () => ({ ok: true, failedNames: [] })
  });

  expect(result.kind).toBe('revoke_failed');
  expect(result.reason).toBe('pending_sync_failed');
  expect(result.pendingNames).toContain(SHARD_NAME);
  expect(revokeCalled).toBe(false);
});

test('Disconnect still completes when nothing is pending', async () => {
  const drive = new FakeDrive();
  drive.addFile(SHARD_NAME, JSON.stringify(clone(validShard())), 'stable-file-id');
  const store = createMemoryLocalStore();

  const coordinator = createCoordinator({
    store,
    drive,
    staticData: loadedStaticData(),
    accountKey: 'audit-disconnect-clean',
    pagehideTarget: null,
    timers: frozenTimers().timers
  });
  await coordinator.ensureLoaded(SHARD_NAME);

  let revokeCalled = false;
  const result = await runDisconnect({
    store,
    coordinator,
    revoke: async (): Promise<boolean> => {
      revokeCalled = true;
      return true;
    },
    trashAll: async () => ({ ok: true, failedNames: [] })
  });

  expect(result.kind).toBe('disconnected');
  expect(result.reason).toBeUndefined();
  expect(revokeCalled).toBe(true);
});
