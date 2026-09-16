// Correctness audit for checklist areas 1 and 14.
//
// REQUIREMENTS 4.4 says that a failed Drive synchronization must not discard
// local edits. The disconnect flow must not revoke access and clear the local
// namespace when its pre-disconnect flush could not upload a pending edit.

import { expect, test } from 'bun:test';
import { runDisconnect } from '../src/data/account-flows';
import { createMemoryLocalStore } from '../src/storage/memory-local-store';
import { pendingKey } from '../src/storage/local-store';
import { createCoordinator, PREFERENCES_NAME } from '../src/sync/sync-coordinator';
import { FakeDrive } from './fakes/fake-drive';
import { preferencesDoc } from './fixtures/merge';
import { frozenTimers, loadedStaticData } from './fixtures/sync';

test('disconnect does not discard an edit whose Drive synchronization failed', async () => {
  const store = createMemoryLocalStore();
  const drive = new FakeDrive();
  drive.addFile(
    PREFERENCES_NAME,
    JSON.stringify(preferencesDoc({ 'back-squat': { weight: 'kg' } }))
  );
  const coordinator = createCoordinator({
    store,
    drive,
    staticData: loadedStaticData(),
    accountKey: 'acct-audit-disconnect',
    pagehideTarget: null,
    timers: frozenTimers().timers
  });
  await coordinator.ensureLoaded(PREFERENCES_NAME);

  drive.rejectAlways('updateFile', 'network');
  coordinator.queueEdit(PREFERENCES_NAME, (doc: unknown): unknown => {
    const copy = structuredClone(doc) as {
      exerciseUnits: Record<string, Record<string, string>>;
    };
    copy.exerciseUnits['push-up'] = { reps: 'reps' };
    return copy;
  });

  let revokeCalls = 0;
  const result = await runDisconnect({
    drive,
    store,
    accountKey: 'acct-audit-disconnect',
    coordinator,
    revoke: async (): Promise<boolean> => {
      revokeCalls += 1;
      return true;
    }
  });

  // The failed upload must stop disconnect before revocation or local cleanup.
  expect(result.kind).toBe('revoke_failed');
  expect(revokeCalls).toBe(0);
  expect(await store.get(pendingKey(PREFERENCES_NAME))).not.toBeUndefined();
  expect(await store.get(pendingKey(PREFERENCES_NAME))).not.toBeNull();
});
