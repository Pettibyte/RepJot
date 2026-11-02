import { afterEach, expect, test } from 'bun:test';
import { writable } from 'svelte/store';
import ActiveWorkoutScreen from '../../src/ui/screens/ActiveWorkoutScreen.svelte';
import WorkoutSummaryScreen from '../../src/ui/screens/WorkoutSummaryScreen.svelte';
import WorkoutHistoryScreen from '../../src/ui/screens/WorkoutHistoryScreen.svelte';
import ExerciseHistoryScreen from '../../src/ui/screens/ExerciseHistoryScreen.svelte';
import { setRouter } from '../../src/routing/router-registry';
import type { NavigationInfo, Router } from '../../src/routing/hash-router';
import type { Route } from '../../src/routing/routes';
import ReadinessScreenHost from './fixtures/ReadinessScreenHost.svelte';
import NavigationReadinessHost from './fixtures/NavigationReadinessHost.svelte';
import { SCREEN_READINESS_CONTEXT } from '../../src/routing/screen-ready';
import { setServices } from '../../src/services/registry';
import { createSessionService } from '../../src/sessions/session-service';
import type { Session } from '../../src/domain/types';
import { workout } from '../fixtures/semantic';
import { signIn, teardown } from './harness';
import { mount, unmount, flushSync, settle } from './runtime';

const mounted: unknown[] = [];
const restoreMetrics: Array<() => void> = [];
afterEach(async () => {
  for (const app of mounted.splice(0)) await unmount(app);
  for (const restore of restoreMetrics.splice(0)) restore();
  setRouter(null);
  teardown();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

for (const [name, Screen, title] of [
  ['session-active', ActiveWorkoutScreen, '.active-workout__title'],
  ['session-summary', WorkoutSummaryScreen, '.summary-screen__title']
] as const) {
  test(`${name} reports committed content, not pending or stale loads`, async () => {
    const harness = await signIn();
    const service = createSessionService({
      coordinator: harness.coordinator,
      staticData: harness.staticData,
      preferences: harness.preferences,
      lookup: harness.lookup
    });
    const session = await service.start(workout().id);
    const first = deferred<Session>();
    const second = deferred<Session>();
    const third = deferred<Session>();
    service.load = (id) => id === 'first' ? first.promise : id === 'second' ? second.promise : third.promise;
    setServices({ sessionService: service });
    const routeId = writable('first');
    const target = document.createElement('div');
    document.body.appendChild(target);
    const reports: string[] = [];
    const app = mount(ReadinessScreenHost, {
      target,
      props: { Screen, routeId },
      context: new Map([[SCREEN_READINESS_CONTEXT, (key: string) => {
        // This assertion runs inside the callback, not after a later flush.
        expect(target.querySelector(title)).not.toBeNull();
        reports.push(key);
      }]])
    });
    mounted.push(app);
    flushSync();
    await settle(20);
    expect(reports).toEqual([]);

    routeId.set('second');
    flushSync();
    first.resolve({ ...session, id: 'first' });
    await settle(20);
    expect(reports).toEqual([]);
    second.resolve({ ...session, id: 'second' });
    await settle(30);
    expect(reports).toEqual([`#/sessions/second/${name === 'session-active' ? 'active' : 'summary'}`]);

    routeId.set('third');
    flushSync();
    await unmount(app);
    mounted.splice(mounted.indexOf(app), 1);
    third.resolve({ ...session, id: 'third' });
    await settle(30);
    expect(reports).toHaveLength(1);
  });
}

test('a failed summary load reports its committed error state', async () => {
  const harness = await signIn();
  const service = createSessionService({
    coordinator: harness.coordinator,
    staticData: harness.staticData,
    preferences: harness.preferences,
    lookup: harness.lookup
  });
  const pending = deferred<Session>();
  service.load = () => pending.promise;
  setServices({ sessionService: service });
  const target = document.createElement('div');
  document.body.appendChild(target);
  const reports: string[] = [];
  mounted.push(mount(WorkoutSummaryScreen, {
    target,
    props: { sessionId: 'missing' },
    context: new Map([[SCREEN_READINESS_CONTEXT, (key: string) => {
      expect(target.textContent).toContain('The session could not load.');
      reports.push(key);
    }]])
  }));
  flushSync();
  await settle(20);
  expect(reports).toEqual([]);
  pending.reject(new Error('The session could not load.'));
  await settle(30);
  expect(reports).toEqual(['#/sessions/missing/summary']);
});

test('an unavailable active screen reports its committed empty state', async () => {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const reports: string[] = [];
  mounted.push(mount(ActiveWorkoutScreen, {
    target,
    props: { sessionId: 'unknown' },
    context: new Map([[SCREEN_READINESS_CONTEXT, (key: string) => {
      expect(target.textContent).toContain('This workout is not available');
      reports.push(key);
    }]])
  }));
  flushSync();
  await settle(20);
  expect(reports).toEqual(['#/sessions/unknown/active']);
});

for (const kind of ['workout', 'exercise'] as const) {
  for (const mode of ['restore', 'forward', 'exhausted', 'same-key'] as const) {
    test(`${kind} history ${mode}: page before ready only for a saved entry`, async () => {
      const harness = await signIn();
      const summaries = Array.from({ length: 65 }, (_, index) => ({
        id: `session-${index}`, workoutId: 'demo', workoutName: 'Demo',
        status: 'completed' as const, startedAtUtc: '2026-08-01T12:00:00Z',
        updatedAtUtc: '2026-08-01T12:00:00Z', shardName: 'results-2026-08.json'
      }));
      const occurrences = summaries.map((summary) => ({
        sessionId: summary.id, exerciseId: 'back-squat', resultKey: 'set',
        encodedPath: 'set', attempt: 1, status: 'completed' as const,
        completedAtUtc: summary.startedAtUtc
      }));
      harness.lookup.listAllSessions = ({ offset, limit }) => ({
        items: summaries.slice(offset, offset + limit), total: summaries.length,
        hasMore: offset + limit < summaries.length
      });
      harness.lookup.getExerciseHistory = (_id, { offset, limit }) => ({
        items: occurrences.slice(offset, offset + limit), total: occurrences.length,
        hasMore: offset + limit < occurrences.length
      });
      harness.coordinator.ensureLoaded = async () => null;
      const route: Route = kind === 'workout'
        ? { name: 'history' } : { name: 'exercise-history', exerciseId: 'back-squat' };
      let navigation: NavigationInfo = {
        to: route, from: { name: 'home' }, traversed: mode !== 'forward' && mode !== 'same-key',
        entryId: 'history-entry', fromEntryId: 'home-entry',
        scrollY: mode === 'exhausted' ? 100000 : 3500
      };
      const navigationStore = writable<NavigationInfo | null>(navigation);
      setRouter({
        lastNavigation: () => navigation,
        scrollForCurrent: () => navigation.scrollY
      } as unknown as Router);
      const target = document.createElement('div');
      document.body.appendChild(target);
      const root = document.documentElement;
      const heightDescriptor = Object.getOwnPropertyDescriptor(root, 'scrollHeight');
      const viewportDescriptor = Object.getOwnPropertyDescriptor(window, 'innerHeight');
      Object.defineProperty(root, 'scrollHeight', {
        configurable: true, get: () => target.querySelectorAll('.history-list > li').length * 100
      });
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: 1000 });
      restoreMetrics.push(() => {
        if (heightDescriptor) Object.defineProperty(root, 'scrollHeight', heightDescriptor);
        else Reflect.deleteProperty(root, 'scrollHeight');
        if (viewportDescriptor) Object.defineProperty(window, 'innerHeight', viewportDescriptor);
        else Reflect.deleteProperty(window, 'innerHeight');
      });
      const counts: number[] = [];
      const Screen = mode === 'same-key' ? NavigationReadinessHost
        : kind === 'workout' ? WorkoutHistoryScreen : ExerciseHistoryScreen;
      mounted.push(mount(Screen, {
        target, props: mode === 'same-key'
          ? { kind, navigation: navigationStore } : { exerciseId: 'back-squat' },
        context: new Map([[SCREEN_READINESS_CONTEXT, () => {
          counts.push(target.querySelectorAll('.history-list > li').length);
        }]])
      }));
      flushSync();
      await settle(150);
      if (mode === 'same-key') {
        expect(counts).toEqual([20]);
        navigation = {
          ...navigation, from: route, traversed: true, entryId: 'deeper-history-entry',
          fromEntryId: navigation.entryId
        };
        navigationStore.set(navigation);
        flushSync();
        // Supersede before tick: the obsolete navigation must not report ready.
        navigation = { ...navigation, entryId: 'latest-history-entry' };
        navigationStore.set(navigation);
        flushSync();
        await settle(150);
        expect(counts).toEqual([20, 60]);
      } else {
        expect(counts).toEqual([mode === 'forward' ? 20 : mode === 'restore' ? 60 : 65]);
      }
    });
  }
}
