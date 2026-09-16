// Focused audit regressions for correctness checklist areas 4-6.
// These tests intentionally fail until the implementation preserves Drive read
// identity, contains a mutating migration, and compares full RFC 3339 instants.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { Session } from '../src/domain/types';
import type { DriveFileContent } from '../src/drive/drive-interface';
import { processJson } from '../src/documents/document-pipeline';
import {
  registerMigration,
  resetMigrationsForTesting
} from '../src/migrations/migration-registry';
import { createMemoryLocalStore } from '../src/storage/memory-local-store';
import {
  consolidateGroup,
  findDuplicateGroups,
  type DuplicateGroup
} from '../src/sync/consolidate-duplicates';
import { createCoordinator } from '../src/sync/sync-coordinator';
import {
  registerValidator,
  resetValidatorsForTesting
} from '../src/validation/schema-validator';
import { FakeDrive } from './fakes/fake-drive';
import {
  preferencesDoc,
  preferencesV2Schema
} from './fixtures/documents';
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

function shardWithSession(session: Session): string {
  const shard = clone(validShard());
  shard.sessions = { [session.id]: session };
  return JSON.stringify(shard);
}

beforeEach(() => {
  resetValidatorsForTesting();
  resetMigrationsForTesting();
});

afterEach(() => {
  resetValidatorsForTesting();
  resetMigrationsForTesting();
});

describe('Drive catalog and file identity', () => {
  test('a preflight read does not pair stale bytes with newer metadata and lose a remote session', async () => {
    const drive = new FakeDrive();
    const base = clone(validShard());
    const fileId = drive.addFile(SHARD_NAME, JSON.stringify(base), 'stable-file-id');
    const coordinator = createCoordinator({
      store: createMemoryLocalStore(),
      drive,
      staticData: loadedStaticData(),
      accountKey: 'audit-area-4',
      pagehideTarget: null,
      timers: frozenTimers().timers
    });

    await coordinator.ensureLoaded(SHARD_NAME);

    const remoteOnly = sessionAt(99, '2026-08-20T08:30:00Z', 'remote-only');
    const localOnly = sessionAt(30, '2026-08-18T08:30:00Z', 'local-only');
    const originalRead = drive.readFile.bind(drive);
    let readsDuringSync = 0;

    drive.readFile = async (id: string): Promise<DriveFileContent> => {
      readsDuringSync += 1;
      if (readsDuringSync !== 2) return originalRead(id);

      // The media request has returned the old bytes. Another device writes
      // before the adapter's metadata request returns, so one read reports old
      // bytes with the new version marker.
      const stale = await originalRead(id);
      const remoteShard = JSON.parse(drive.textOf(SHARD_NAME) ?? '{}') as typeof base;
      remoteShard.sessions[remoteOnly.id] = remoteOnly;
      drive.remoteWrite(SHARD_NAME, JSON.stringify(remoteShard));
      const fresh = await originalRead(id);
      return { bytes: stale.bytes, meta: fresh.meta };
    };

    const handle = await coordinator.edit(SHARD_NAME, (doc: unknown): unknown => {
      const shard = doc as typeof base;
      shard.sessions[localOnly.id] = localOnly;
      return shard;
    });
    await handle.synced;

    const stored = JSON.parse(drive.textOf(SHARD_NAME) ?? '{}') as typeof base;
    expect(drive.idsOf(SHARD_NAME)).toEqual([fileId]);
    expect(stored.sessions[localOnly.id]).toBeDefined();
    // REQUIREMENTS 4.6-4.9: the latest remote content must participate in the
    // keyed-map merge. The current adapter/coordinator pairing drops this row.
    expect(stored.sessions[remoteOnly.id]).toBeDefined();
  });
});

describe('schema and migration safety', () => {
  test('a migration cannot mutate its source object', () => {
    registerValidator('repjot/preferences', 2, preferencesV2Schema());
    registerMigration({
      family: 'repjot/preferences',
      fromVersion: 1,
      toVersion: 2,
      migrate(input: unknown): unknown {
        const source = input as Record<string, unknown>;
        // Model an accidentally impure migration. The pipeline must contain
        // the mutation so rejection or later processing cannot alter its input.
        source.schemaVersion = 2;
        source.theme = 'light';
        return { ...source };
      }
    });

    const input = preferencesDoc();
    const before = JSON.parse(JSON.stringify(input));
    const result = processJson<Record<string, unknown>>(input);

    expect(result.document.schemaVersion).toBe(2);
    expect(result.document.theme).toBe('light');
    // REQUIREMENTS 5.4 and specs/schema-versioning.md require a new output and
    // unchanged source objects for every migration.
    expect(input).toEqual(before);
  });
});

describe('UTC timestamp and shard identity', () => {
  test('duplicate cleanup orders RFC 3339 fractional instants beyond milliseconds', async () => {
    const drive = new FakeDrive();
    const newer = sessionAt(7, '2026-08-12T01:00:00.0002Z', 'newer instant');
    const older = sessionAt(7, '2026-08-12T01:00:00.0001Z', 'older instant');

    // The newer instant has the smaller ID. If timestamp precision is lost,
    // the file-ID tie-break incorrectly selects the older session.
    drive.addFile(SHARD_NAME, shardWithSession(newer), 'a-newer');
    drive.addFile(SHARD_NAME, shardWithSession(older), 'z-older');
    const group = findDuplicateGroups(await drive.listCatalog())[0] as DuplicateGroup;

    const outcome = await consolidateGroup(group, {
      drive,
      staticData: loadedStaticData()
    });
    expect(outcome.kind).toBe('consolidated');

    const stored = JSON.parse(drive.textOf(SHARD_NAME) ?? '{}') as {
      sessions: Record<string, Session>;
    };
    // REQUIREMENTS 3.5 and 4.24: both values are valid RFC 3339 UTC stamps,
    // and the greatest timestamp must win before Drive file ID breaks a tie.
    expect(stored.sessions[newer.id]?.notes).toBe('newer instant');
  });
});
