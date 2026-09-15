import { afterEach, describe, expect, test } from 'bun:test';
import { get } from 'svelte/store';
import { restoreAndBind, signOut } from '../src/auth/auth-service';
import {
  DRIVE_SCOPE,
  clearAllAuthState,
  saveToken,
  type TokenRecord
} from '../src/auth/oauth-redirect-adapter';
import { bootstrap, type BootstrapPorts } from '../src/bootstrap';
import type { LoadedStaticData } from '../src/documents/static-loader';
import { AppError } from '../src/domain/errors';
import { openRawJson } from '../src/routing/open-raw-json';
import { getRouter, setRouter } from '../src/routing/router-registry';
import { clearServices, getServices } from '../src/services/registry';
import { clearRawPayloads, getRawPayload } from '../src/state/raw-payload-store';
import { activeError, clearError, setStartupStatus, startupStatus } from '../src/state/app-state';
import type { LocalStore, LocalStoreEntry } from '../src/storage/local-store';
import type { Coordinator } from '../src/sync/sync-coordinator';
import WorkoutOverviewScreen from '../src/ui/screens/WorkoutOverviewScreen.svelte';
import { workout } from './fixtures/semantic';
import { installFakeBrowser, uninstallFakeBrowser } from './support/fake-browser';
import { html } from './support/render';

const HOUR_MS = 3_600_000;

/** Drain the microtask and macrotask queue. */
function drain(): Promise<void> {
  return new Promise((resolve: () => void): void => {
    setTimeout(resolve, 0);
  });
}

function liveToken(accessToken: string): TokenRecord {
  return {
    accessToken,
    expiresAtUtc: new Date(Date.now() + HOUR_MS).toISOString(),
    grantedScope: DRIVE_SCOPE,
    accountKey: null
  };
}

/** A valid static bundle with no entries. Enough for every service to build on. */
function emptyStaticData(): LoadedStaticData {
  return {
    exercises: [],
    workouts: [],
    exerciseById: new Map(),
    workoutById: new Map()
  };
}

/** A mount target. The tests replace the mount port, so nothing renders into it. */
function fakeTarget(): HTMLElement {
  return {} as HTMLElement;
}

/** A local store that records each read. */
function fakeStore(events: string[]): LocalStore {
  const rows = new Map<string, unknown>();
  return {
    async get(name: string): Promise<unknown | undefined> {
      events.push(`store.get:${name}`);
      return rows.get(name);
    },
    async set(name: string, value: unknown): Promise<void> {
      events.push(`store.set:${name}`);
      rows.set(name, value);
    },
    async delete(name: string): Promise<void> {
      events.push(`store.delete:${name}`);
      rows.delete(name);
    },
    async setMany(entries: Array<LocalStoreEntry>): Promise<void> {
      entries.forEach((entry: LocalStoreEntry): void => rows.set(entry.name, entry.value));
    },
    async listKeys(prefix: string): Promise<string[]> {
      events.push(`store.listKeys:${prefix}`);
      return Array.from(rows.keys())
        .filter((key: string): boolean => key.startsWith(prefix))
        .sort();
    }
  };
}

/** A coordinator that records every load instead of talking to Drive. */
function fakeCoordinator(events: string[]): Coordinator {
  return {
    async ensureLoaded(logicalName: string): Promise<unknown> {
      events.push(`ensureLoaded:${logicalName}`);
      return { exerciseUnits: {} };
    },
    async edit(): Promise<{ localDurable: true; synced: Promise<void> }> {
      return { localDurable: true, synced: Promise.resolve() };
    },
    queueEdit(): void {},
    async syncAll(): Promise<void> {},
    async flush(): Promise<void> {},
    async reset(): Promise<void> {},
    peek(): unknown {
      return undefined;
    }
  };
}

/** Ports that record the static load and nothing else. */
function recordingPorts(events: string[]): BootstrapPorts {
  return {
    async loadStaticData(): Promise<LoadedStaticData> {
      events.push('loadStaticData');
      return emptyStaticData();
    },
    async restoreAndBind(): Promise<null> {
      events.push('restoreAndBind');
      return null;
    },
    async createLocalStore(accountKey: string): Promise<LocalStore> {
      events.push(`createLocalStore:${accountKey}`);
      return fakeStore(events);
    },
    createCoordinator(): Coordinator {
      events.push('createCoordinator');
      return fakeCoordinator(events);
    },
    mountApp(): unknown {
      events.push('mount');
      return {};
    }
  };
}

afterEach(() => {
  clearAllAuthState();
  signOut();
  clearError();
  clearServices();
  setStartupStatus('loading_static');
  setRouter(null);
  clearRawPayloads();
  uninstallFakeBrowser();
});

describe('bootstrap startup gate', () => {
  test('a static-data failure sets static_failed and never touches the account store', async () => {
    installFakeBrowser();
    const events: string[] = [];
    const ports: BootstrapPorts = {
      ...recordingPorts(events),
      async loadStaticData(): Promise<LoadedStaticData> {
        events.push('loadStaticData');
        throw new AppError(
          'invalid_document',
          { reason: 'http_status', file: 'exercises.json', status: 404 },
          'A bundled data file is missing.'
        );
      },
      async createLocalStore(accountKey: string): Promise<LocalStore> {
        events.push(`createLocalStore:${accountKey}`);
        throw new Error('the account store must not open after a static failure');
      }
    };

    const result = await bootstrap({ clientId: 'client-id', ports, target: fakeTarget() });

    expect(get(startupStatus)).toBe('static_failed');
    // The blocker mounts, so the user sees a reason instead of a blank page.
    expect(events).toEqual(['loadStaticData', 'mount']);
    expect(events).not.toContain('createLocalStore:acct-1');
    expect(result.staticData).toBeNull();
    expect(result.coordinator).toBeNull();
    expect(result.account).toBeNull();
    expect(get(activeError)?.kind).toBe('invalid_document');
    expect(result.mounted).toBe(true);
  });

  // REQUIREMENTS 6.9. The blocker offers **View Raw JSON**, so the static-
  // failure path must still install a router. The router touches the address
  // bar only, so the private-read rule above still holds.
  test('a static failure still installs a router', async () => {
    installFakeBrowser();
    const ports: BootstrapPorts = {
      ...recordingPorts([]),
      async loadStaticData(): Promise<LoadedStaticData> {
        throw new AppError('network', { reason: 'fetch_failed' }, 'The bundle did not load.');
      }
    };

    const result = await bootstrap({ clientId: 'client-id', ports, target: fakeTarget() });

    expect(getRouter()).not.toBeNull();
    expect(result.router).not.toBeNull();
  });

  test('View Raw JSON works after a static failure', async () => {
    installFakeBrowser();
    const ports: BootstrapPorts = {
      ...recordingPorts([]),
      async loadStaticData(): Promise<LoadedStaticData> {
        throw new AppError('network', { reason: 'fetch_failed' }, 'The bundle did not load.');
      }
    };

    await bootstrap({ clientId: 'client-id', ports, target: fakeTarget() });

    const key = openRawJson('{"a":1}');
    expect(key).not.toBeNull();
    expect(getRawPayload(key as string)).toBe('{"a":1}');
  });

  test('a successful static load opens the gate', async () => {
    installFakeBrowser();
    const ports = recordingPorts([]);

    const result = await bootstrap({ clientId: 'client-id', ports, target: fakeTarget() });

    expect(get(startupStatus)).toBe('ready');
    expect(result.staticData).not.toBeNull();
    expect(result.mounted).toBe(true);
  });

  test('an anonymous start creates no account store and still mounts', async () => {
    installFakeBrowser();
    const events: string[] = [];
    const ports = recordingPorts(events);

    const result = await bootstrap({ clientId: 'client-id', ports, target: fakeTarget() });

    expect(events).not.toContain('createLocalStore:acct-1');
    expect(events).toEqual(['loadStaticData', 'restoreAndBind', 'mount']);
    expect(result.account).toBeNull();
    expect(result.coordinator).toBeNull();
    // The lookup service still answers static questions for the chooser.
    expect(result.lookup).not.toBeNull();
  });
});

describe('bootstrap degraded start publishes the bundle', () => {
  // REQUIREMENTS 18.1. A signed-in start that cannot open the account store
  // still holds the static bundle, so the registry must publish the static
  // half. Otherwise the overview denies a workout the app is holding.
  function bundleWithWorkout(): LoadedStaticData {
    const w = workout();
    return {
      exercises: [],
      workouts: [w],
      exerciseById: new Map(),
      workoutById: new Map([[w.id, w]])
    };
  }

  /** Ports for a signed-in start whose later step throws. */
  function signedInThrowingPorts(throwAt: 'local_store' | 'coordinator'): BootstrapPorts {
    const boom = new Error('this step fails');
    return {
      async loadStaticData(): Promise<LoadedStaticData> {
        return bundleWithWorkout();
      },
      async restoreAndBind(): Promise<null> {
        return {
          accountKey: 'acct-1',
          accessToken: 'a-token',
          expiresAtUtc: new Date(Date.now() + HOUR_MS).toISOString()
        } as never;
      },
      async createLocalStore(): Promise<LocalStore> {
        if (throwAt === 'local_store') throw boom;
        return fakeStore([]);
      },
      createCoordinator(): Coordinator {
        throw boom;
      },
      mountApp(): unknown {
        return {};
      }
    };
  }

  function assertStaticHalfPublished(result: Awaited<ReturnType<typeof bootstrap>>): void {
    const services = getServices();
    expect(services.staticData).not.toBeNull();
    expect(services.lookup).not.toBeNull();
    // Every write path reads as unavailable, which is the truth.
    expect(services.sessionService).toBeNull();
    expect(services.coordinator).toBeNull();
    expect(result.mounted).toBe(true);

    // The overview renders the programmed tree, not the not-found state.
    const out = html(WorkoutOverviewScreen, { workoutId: 'demo' });
    expect(out).not.toContain('No workout with that id');
    expect(out).toContain('Demo Workout');
    // Starting stays blocked until a session service exists.
    expect(out).toContain('not connected to your Drive folder');
  }

  test('a local-store failure still publishes the static bundle and lookup', async () => {
    clearServices();
    installFakeBrowser();

    const result = await bootstrap({
      clientId: 'client-id',
      ports: signedInThrowingPorts('local_store'),
      target: fakeTarget()
    });

    assertStaticHalfPublished(result);
  });

  test('a coordinator failure still publishes the static bundle and lookup', async () => {
    clearServices();
    installFakeBrowser();

    const result = await bootstrap({
      clientId: 'client-id',
      ports: signedInThrowingPorts('coordinator'),
      target: fakeTarget()
    });

    assertStaticHalfPublished(result);
  });
});

describe('bootstrap private-read ordering', () => {
  test('no private cache read happens before restoreAndBind resolves', async () => {
    installFakeBrowser();
    saveToken(liveToken('a-token'), false);

    const events: string[] = [];
    let releaseBind: () => void = (): void => {};
    const bindGate = new Promise<void>((resolve: () => void): void => {
      releaseBind = resolve;
    });

    const ports: BootstrapPorts = {
      async loadStaticData(): Promise<LoadedStaticData> {
        events.push('loadStaticData');
        return emptyStaticData();
      },
      async restoreAndBind(deps): Promise<null> {
        events.push('bind:start');
        await bindGate;
        const session = await restoreAndBind({
          bind: async () => ({ accountKey: 'acct-1', displayName: 'Test User' })
        });
        events.push('bind:end');
        return session as null;
      },
      async createLocalStore(accountKey: string): Promise<LocalStore> {
        events.push(`createLocalStore:${accountKey}`);
        return fakeStore(events);
      },
      createCoordinator(): Coordinator {
        events.push('createCoordinator');
        return fakeCoordinator(events);
      },
      mountApp(): unknown {
        events.push('mount');
        return {};
      }
    };

    const running = bootstrap({ clientId: 'client-id', ports, target: fakeTarget() });
    await drain();
    releaseBind();
    const result = await running;
    await drain();

    const bindEnd = events.indexOf('bind:end');
    expect(bindEnd).toBeGreaterThan(-1);

    const privateSteps = events.filter(
      (event: string): boolean =>
        event.startsWith('createLocalStore') ||
        event.startsWith('createCoordinator') ||
        event.startsWith('store.') ||
        event.startsWith('ensureLoaded')
    );
    expect(privateSteps.length).toBeGreaterThan(0);
    for (const step of privateSteps) {
      expect(events.indexOf(step)).toBeGreaterThan(bindEnd);
    }

    expect(result.account?.accountKey).toBe('acct-1');
    expect(events.indexOf('mount')).toBeGreaterThan(bindEnd);
  });

  test('the warm load runs behind the mount and asks for preferences only', async () => {
    installFakeBrowser();
    saveToken(liveToken('a-token'), false);

    const events: string[] = [];
    const ports: BootstrapPorts = {
      async loadStaticData(): Promise<LoadedStaticData> {
        return emptyStaticData();
      },
      async restoreAndBind(): Promise<null> {
        return restoreAndBind({ bind: async () => ({ accountKey: 'acct-1' }) }) as Promise<null>;
      },
      async createLocalStore(): Promise<LocalStore> {
        return fakeStore(events);
      },
      createCoordinator(): Coordinator {
        return fakeCoordinator(events);
      },
      mountApp(): unknown {
        events.push('mount');
        return {};
      }
    };

    await bootstrap({ clientId: 'client-id', ports, target: fakeTarget() });
    await drain();

    const mountAt = events.indexOf('mount');
    const warmed = events.filter((event: string): boolean => event.startsWith('ensureLoaded:'));

    expect(warmed).toEqual(['ensureLoaded:preferences.json']);
    expect(events.indexOf(warmed[0])).toBeGreaterThan(mountAt);
  });
});
