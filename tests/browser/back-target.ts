/// <reference types="vite/client" />
import '../../src/polyfills';
import '../../src/ui/styles/index.css';
import { mount } from 'svelte';
import App from '../../src/App.svelte';
import { createRouter } from '../../src/routing/hash-router';
import { setRouter } from '../../src/routing/router-registry';
import { setStartupStatus } from '../../src/state/app-state';
import { getServices, setServices } from '../../src/services/registry';
import { createMemoryLocalStore } from '../../src/storage/memory-local-store';
import { createCoordinator } from '../../src/sync/sync-coordinator';
import { createPreferenceService } from '../../src/preferences/preference-service';
import { createLookupService } from '../../src/indexes/lookup-service';
import { createSessionService } from '../../src/sessions/session-service';
import { FakeDrive } from '../fakes/fake-drive';
import { SHARD_MONTH, exercises, validSession, workout } from '../fixtures/semantic';
import { SHARD_NAME, frozenTimers, loadedStaticData } from '../fixtures/sync';
import type { ResultsShard } from '../../src/domain/types';

const active = validSession();
active.status = 'in_progress';
delete active.completedAtUtc;
active.exerciseResults = {};
active.containerResults = {};
const prior = validSession();
prior.id = 'session-99999999-8888-4777-9666-555555555555';
prior.status = 'completed';
prior.completedAtUtc = '2026-08-10T15:05:00Z';
const shard: ResultsShard = {
  format: 'repjot/results', schemaVersion: 1, yearMonthUtc: SHARD_MONTH,
  sessions: { [active.id]: active, [prior.id]: prior }
};
// Real repeated groups provide enough document height for a 6000px regression.
// Do not fake element dimensions or replace the app's scroll surface.
const longWorkout = workout();
const squatGroup = longWorkout.root.children[1];
for (let index = 0; index < 10; index += 1) {
  const group = structuredClone(squatGroup);
  group.id = `browser-squats-${index}`;
  longWorkout.root.children.splice(2 + index, 0, group);
}
// Exercise History also needs real content for independent entry positions.
for (let index = 0; index < 12; index += 1) {
  const session = structuredClone(prior);
  session.id = `session-99999999-8888-4777-9666-${String(index).padStart(12, '0')}`;
  shard.sessions[session.id] = session;
}
const drive = new FakeDrive();
drive.addFile(SHARD_NAME, JSON.stringify(shard));
const store = createMemoryLocalStore();
const staticData = loadedStaticData(exercises(), [longWorkout]);
const timers = frozenTimers();
const coordinator = createCoordinator({
  store, drive, staticData, accountKey: 'acct-browser',
  pagehideTarget: null, timers: timers.timers
});
const preferences = createPreferenceService({ coordinator, staticData });
const lookup = createLookupService({ staticData, shards: [shard] });
const sessionService = createSessionService({ coordinator, staticData, preferences, lookup });
setServices({
  store, drive, staticData, coordinator, preferences, lookup, sessionService,
  accountKey: 'acct-browser'
});
await coordinator.ensureLoaded(SHARD_NAME);

// Wrap the registered, real services. Tests release these gates explicitly;
// neither the router nor the DOM/layout is mocked.
function gate() {
  let release: (() => void) | null = null;
  let waiting: Promise<void> | null = null;
  let calls = 0;
  return {
    hold(): void {
      if (waiting !== null) throw new Error('Gate already held');
      calls = 0;
      waiting = new Promise<void>((resolve) => { release = resolve; });
    },
    release(): void { release?.(); release = null; waiting = null; },
    pending(): number { return calls; },
    async wait(): Promise<void> { if (waiting !== null) { calls += 1; await waiting; } }
  };
}
const flush = gate();
const load = gate();
const registered = getServices().sessionService!;
const queueFlush = registered.queueFlush.bind(registered);
const loadSession = registered.load.bind(registered);
registered.queueFlush = async () => { await flush.wait(); await queueFlush(); };
registered.load = async (id) => { await load.wait(); return loadSession(id); };
window.backTestDelays = { flush, load };
// Match the real bootstrap hook. The origin must exist before the deferred publish.
const router = createRouter({ beforeRouteChange: () => sessionService.queueFlush() });
setRouter(router);
router.start();
setStartupStatus('ready');
mount(App, {
  target: document.getElementById('app')!,
  props: { route: router.current(), account: { accountKey: 'acct-browser' }, clientId: 'cid' }
});
declare global {
  interface Window {
    backTestRouter: typeof router;
    backTestDelays: { flush: ReturnType<typeof gate>; load: ReturnType<typeof gate> };
  }
}
window.backTestRouter = router;
