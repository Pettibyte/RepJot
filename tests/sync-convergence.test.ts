// Two clients, one Drive, one month. Both edit, both synchronize, and the
// final state on Drive holds both edits. This is the property the whole
// Phase 10 exists to deliver: REQUIREMENTS 4.7, 4.9, 4.11.
//
// Each client gets its own memory store, so neither can see the other's
// records. The fake Drive is the only shared state, which is exactly the
// production shape.

import { describe, expect, test } from 'bun:test';
import type { Session } from '../src/domain/types';
import type { LocalStore } from '../src/storage/local-store';
import { pendingKey } from '../src/storage/local-store';
import { createMemoryLocalStore } from '../src/storage/memory-local-store';
import { createCoordinator, type Coordinator } from '../src/sync/sync-coordinator';
import { FakeDrive } from './fakes/fake-drive';
import { frozenTimers, loadedStaticData, SHARD_NAME } from './fixtures/sync';
import { clone, validSession, validShard, SHARD_MONTH } from './fixtures/semantic';

/** A valid session ID for slot `n`. */
function sid(n: number): string {
  return `session-00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

/** One client: its own store, its own coordinator, the shared Drive. */
interface Client {
  store: LocalStore;
  coordinator: Coordinator;
}

/** Build one client over the shared fake Drive. */
function makeClient(drive: FakeDrive, tag: string): Client {
  const store = createMemoryLocalStore();
  const coordinator = createCoordinator({
    store,
    drive,
    staticData: loadedStaticData(),
    accountKey: `acct-${tag}`,
    pagehideTarget: null,
    timers: frozenTimers().timers
  });
  return { store, coordinator };
}

/** Add one session to a shard document. */
function addSession(doc: unknown, n: number, day: number): unknown {
  const shard = clone(doc) as { sessions: Record<string, Session> };
  const candidate = clone(validSession()) as Session & Record<string, unknown>;
  candidate.id = sid(n);
  const stamp = `${SHARD_MONTH}-${String(day).padStart(2, '0')}T08:00:00Z`;
  const end = `${SHARD_MONTH}-${String(day).padStart(2, '0')}T08:30:00Z`;
  candidate.startedAtUtc = stamp;
  candidate.completedAtUtc = end;
  candidate.updatedAtUtc = end;
  shard.sessions[sid(n)] = candidate;
  return shard;
}

/** The sessions present on Drive for the shared shard. */
function remoteSessionIds(drive: FakeDrive): string[] {
  const text = drive.textOf(SHARD_NAME);
  if (text === undefined) return [];
  return Object.keys((JSON.parse(text) as { sessions: Record<string, unknown> }).sessions);
}

describe('two clients converge', () => {
  test('both edits survive after both synchronize', async () => {
    const drive = new FakeDrive();
    drive.addFile(SHARD_NAME, JSON.stringify(validShard()));
    const base = drive.textOf(SHARD_NAME) as string;

    const a = makeClient(drive, 'a');
    const b = makeClient(drive, 'b');

    await a.coordinator.ensureLoaded(SHARD_NAME);
    await b.coordinator.ensureLoaded(SHARD_NAME);

    // Each client adds a different session. Different conflict units, so the
    // merge keeps both. REQUIREMENTS 4.8.
    const ha = await a.coordinator.edit(SHARD_NAME, (doc: unknown) => addSession(doc, 101, 11));
    const hb = await b.coordinator.edit(SHARD_NAME, (doc: unknown) => addSession(doc, 102, 12));

    await ha.synced;
    await hb.synced;

    const ids = remoteSessionIds(drive);
    expect(ids).toContain(sid(101));
    expect(ids).toContain(sid(102));
    // The session both clients started from is still there.
    expect(ids).toContain(Object.keys((JSON.parse(base) as { sessions: Record<string, unknown> }).sessions)[0]);

    // Neither client still owes a write.
    expect(await a.store.get(pendingKey(SHARD_NAME))).toBeNull();
    expect(await b.store.get(pendingKey(SHARD_NAME))).toBeNull();
  });

  test('a same-session conflict takes the later synchronizer in full', async () => {
    const drive = new FakeDrive();
    const shard = validShard();
    const sharedKey = Object.keys(shard.sessions)[0];
    drive.addFile(SHARD_NAME, JSON.stringify(shard));

    const a = makeClient(drive, 'c');
    const b = makeClient(drive, 'd');
    await a.coordinator.ensureLoaded(SHARD_NAME);
    await b.coordinator.ensureLoaded(SHARD_NAME);

    // Both edit the SAME session. One conflict unit.
    const ha = await a.coordinator.edit(SHARD_NAME, (doc: unknown) => {
      const copy = clone(doc) as { sessions: Record<string, Session & Record<string, unknown>> };
      copy.sessions[sharedKey].updatedAtUtc = `${SHARD_MONTH}-13T09:00:00Z`;
      copy.sessions[sharedKey].notes = 'from-a';
      return copy;
    });
    await ha.synced;

    const hb = await b.coordinator.edit(SHARD_NAME, (doc: unknown) => {
      const copy = clone(doc) as { sessions: Record<string, Session & Record<string, unknown>> };
      copy.sessions[sharedKey].updatedAtUtc = `${SHARD_MONTH}-13T10:00:00Z`;
      copy.sessions[sharedKey].notes = 'from-b';
      return copy;
    });
    await hb.synced;

    const final = JSON.parse(drive.textOf(SHARD_NAME) ?? '{}') as {
      sessions: Record<string, Record<string, unknown>>;
    };
    // The later synchronizer wins the unit in full. REQUIREMENTS 4.11.
    expect(final.sessions[sharedKey].notes).toBe('from-b');
  });

  test('a local edit restores a session the remote deleted', async () => {
    const drive = new FakeDrive();
    const shard = validShard();
    const keepKey = Object.keys(shard.sessions)[0];
    drive.addFile(SHARD_NAME, JSON.stringify(shard));

    const a = makeClient(drive, 'e');
    await a.coordinator.ensureLoaded(SHARD_NAME);

    // Another device deletes the session.
    const emptied = JSON.parse(JSON.stringify(shard)) as { sessions: Record<string, unknown> };
    delete emptied.sessions[keepKey];
    drive.remoteWrite(SHARD_NAME, JSON.stringify(emptied));

    // The local client edits that session anyway. An edit beats a delete.
    const ha = await a.coordinator.edit(SHARD_NAME, (doc: unknown) => {
      const copy = clone(doc) as { sessions: Record<string, Session & Record<string, unknown>> };
      copy.sessions[keepKey].updatedAtUtc = `${SHARD_MONTH}-14T09:00:00Z`;
      return copy;
    });
    await ha.synced;

    expect(remoteSessionIds(drive)).toContain(keepKey);
  });
});
