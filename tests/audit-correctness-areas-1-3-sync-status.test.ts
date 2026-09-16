// Focused audit regression for correctness checklist areas 1-3.
//
// REQUIREMENTS 4.20 and ARCHITECTURE §11 require `Sync failed` after three
// failed attempts while pending local intent remains. A successful commit of a
// different logical file must not hide that unresolved failure.

import { expect, test } from 'bun:test';
import { get } from 'svelte/store';
import type { Session } from '../src/domain/types';
import { saveStatus } from '../src/state/app-state';
import { createMemoryLocalStore } from '../src/storage/memory-local-store';
import { pendingKey } from '../src/storage/local-store';
import {
  createCoordinator,
  PREFERENCES_NAME
} from '../src/sync/sync-coordinator';
import { FakeDrive } from './fakes/fake-drive';
import { clone, preferencesDoc } from './fixtures/merge';
import { frozenTimers, loadedStaticData, SHARD_NAME } from './fixtures/sync';
import { SESSION_KEY, validShard } from './fixtures/semantic';

test('a successful commit cannot hide another logical file whose sync failed', async () => {
  const store = createMemoryLocalStore();
  const drive = new FakeDrive();
  drive.addFile(
    PREFERENCES_NAME,
    JSON.stringify(preferencesDoc({ 'back-squat': { weight: 'kg' } }))
  );
  drive.addFile(SHARD_NAME, JSON.stringify(validShard()));

  const coordinator = createCoordinator({
    store,
    drive,
    staticData: loadedStaticData(),
    accountKey: 'acct-audit-areas-1-3',
    pagehideTarget: null,
    timers: frozenTimers().timers
  });

  await coordinator.ensureLoaded(PREFERENCES_NAME);
  await coordinator.ensureLoaded(SHARD_NAME);

  // Leave one preference edit durable but unsynchronized after all retries.
  drive.rejectAlways('updateFile', 'network');
  const failed = await coordinator.edit(PREFERENCES_NAME, (doc: unknown): unknown => {
    const preferences = clone(doc) as {
      exerciseUnits: Record<string, Record<string, string>>;
    };
    preferences.exerciseUnits['push-up'] = { reps: 'reps' };
    return preferences;
  });
  await failed.synced.catch((): void => undefined);
  drive.clearAlways('updateFile');

  expect(await store.get(pendingKey(PREFERENCES_NAME))).not.toBeNull();
  expect(get(saveStatus)).toBe('sync_failed');

  // A different shard can still commit. That commit does not resolve the
  // preference failure or clear its durable pending delta.
  const succeeded = await coordinator.edit(SHARD_NAME, (doc: unknown): unknown => {
    const shard = clone(doc) as { sessions: Record<string, Session> };
    shard.sessions[SESSION_KEY].notes = 'unrelated successful save';
    shard.sessions[SESSION_KEY].updatedAtUtc = '2026-08-16T10:00:00Z';
    return shard;
  });
  await succeeded.synced;

  expect(await store.get(pendingKey(PREFERENCES_NAME))).not.toBeNull();
  expect(get(saveStatus)).toBe('sync_failed');
});
