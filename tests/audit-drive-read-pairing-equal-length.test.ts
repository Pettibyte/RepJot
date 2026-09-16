// F-01 companion regression: the equal-length concurrent write.
//
// The planted F-01 failure changed the file size, so a size check alone would
// clear it. This test writes a remote session of exactly the same byte length,
// so the bytes and the metadata are each internally consistent and only the
// catalog marker read before the file reveals the torn pair.
//
// REQUIREMENTS 4.6, 4.8, 4.16. `specs/storage-and-lookup.md`, synchronization
// preflight: the content and the metadata the merge uses must describe the same
// remote state.

import { expect, test } from 'bun:test';
import type { Session } from '../src/domain/types';
import type { DriveFileContent } from '../src/drive/drive-interface';
import { createMemoryLocalStore } from '../src/storage/memory-local-store';
import { createCoordinator } from '../src/sync/sync-coordinator';
import { FakeDrive } from './fakes/fake-drive';
import { frozenTimers, loadedStaticData, SHARD_NAME } from './fixtures/sync';
import { clone, validSession, validShard } from './fixtures/semantic';

function sid(n: number): string {
  return `session-00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

function sessionAt(n: number, updatedAtUtc: string, notes: string): Session {
  const session = clone(validSession()) as Session;
  session.id = sid(n);
  session.updatedAtUtc = updatedAtUtc;
  session.notes = notes;
  return session;
}

test('a same-length concurrent write cannot pass as the preflight read', async () => {
  const drive = new FakeDrive();
  const base = clone(validShard());
  const seed = sessionAt(50, '2026-08-10T08:30:00Z', 'seed');
  base.sessions[seed.id] = seed;
  drive.addFile(SHARD_NAME, JSON.stringify(base), 'stable-file-id');

  const coordinator = createCoordinator({
    store: createMemoryLocalStore(),
    drive,
    staticData: loadedStaticData(),
    accountKey: 'audit-read-pairing',
    pagehideTarget: null,
    timers: frozenTimers().timers
  });
  await coordinator.ensureLoaded(SHARD_NAME);

  // Same notes, same timestamp, same shape. Only the session ID differs, so the
  // serialized file keeps its exact byte length across the concurrent write.
  const remoteOnly = sessionAt(99, '2026-08-10T08:30:00Z', 'seed');
  const localOnly = sessionAt(30, '2026-08-18T08:30:00Z', 'local-only');

  const originalRead = drive.readFile.bind(drive);
  let reads = 0;
  let lengthBeforeWrite = 0;
  let lengthAfterWrite = 0;

  drive.readFile = async (id: string): Promise<DriveFileContent> => {
    reads += 1;
    if (reads !== 2) return originalRead(id);

    const stale = await originalRead(id);
    const remoteShard = JSON.parse(drive.textOf(SHARD_NAME) ?? '{}') as typeof base;
    delete remoteShard.sessions[seed.id];
    remoteShard.sessions[remoteOnly.id] = remoteOnly;
    lengthBeforeWrite = drive.bytesOf(SHARD_NAME)?.byteLength ?? 0;
    drive.remoteWrite(SHARD_NAME, JSON.stringify(remoteShard));
    lengthAfterWrite = drive.bytesOf(SHARD_NAME)?.byteLength ?? 0;
    const fresh = await originalRead(id);
    return { bytes: stale.bytes, meta: fresh.meta };
  };

  const handle = await coordinator.edit(SHARD_NAME, (doc: unknown): unknown => {
    const shard = doc as typeof base;
    shard.sessions[localOnly.id] = localOnly;
    return shard;
  });
  await handle.synced;

  // The premise of the test: the size check has nothing to see.
  expect(lengthAfterWrite).toBe(lengthBeforeWrite);

  const stored = JSON.parse(drive.textOf(SHARD_NAME) ?? '{}') as typeof base;
  expect(stored.sessions[localOnly.id]).toBeDefined();
  expect(stored.sessions[remoteOnly.id]).toBeDefined();
});
