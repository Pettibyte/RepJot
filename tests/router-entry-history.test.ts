import { afterEach, describe, expect, test } from 'bun:test';
import { get } from 'svelte/store';
import {
  createRouter, ROUTER_HISTORY_STATE_KEY, type Router, type RouterOptions
} from '../src/routing/hash-router';
import type { Route } from '../src/routing/routes';
import {
  authorizationState, installFakeBrowser, responseFragment, uninstallFakeBrowser
} from './support/fake-browser';
import { beginAuthorization, consumeCallback } from '../src/auth/oauth-redirect-adapter';

const overview: Route = { name: 'workout-overview', workoutId: 'arms-day-a' };
const active: Route = { name: 'session-active', sessionId: 's-one' };
const summary: Route = { name: 'session-summary', sessionId: 's-one' };
const exercise: Route = { name: 'exercise-history', exerciseId: 'squat' };
const routers: Router[] = [];
function start(options: RouterOptions = {}): Router {
  const router = createRouter(options);
  routers.push(router);
  router.start();
  return router;
}
async function drain(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}
afterEach(() => {
  for (const router of routers.splice(0)) router.stop();
  uninstallFakeBrowser();
});

describe('per-entry browser history', () => {
  test('Back traverses ancestors without reversing their origins', () => {
    const browser = installFakeBrowser('#/');
    const router = start();
    router.navigate(overview);
    const overviewId = router.lastNavigation()!.entryId;
    router.navigate(active);
    const activeId = router.lastNavigation()!.entryId;
    router.navigate(exercise);
    const length = browser.history.length;

    router.back();
    expect(get(router.current())).toEqual(active);
    expect(router.originFor(active)).toEqual(overview);
    expect(router.lastNavigation()).toMatchObject({ entryId: activeId, traversed: true });
    router.back();
    expect(get(router.current())).toEqual(overview);
    expect(router.lastNavigation()!.entryId).toBe(overviewId);
    expect(router.originFor(overview)).toEqual({ name: 'home' });
    router.back();
    expect(get(router.current())).toEqual({ name: 'home' });
    expect(browser.history.length).toBe(length);
    expect(browser.history.backCalls).toBe(3);
  });

  test('origins belong to entries, including repeated screen names and hashes', () => {
    const browser = installFakeBrowser('#/history');
    const router = start();
    router.navigate(summary);
    router.navigate(exercise);
    const firstExerciseId = router.lastNavigation()!.entryId;
    router.navigate(overview);
    router.navigate(active);
    router.navigate(exercise);
    expect(router.originFor(exercise)).toEqual(active);
    expect(router.originFor(summary)).toBeNull();

    browser.history.go(-3);
    expect(get(router.current())).toEqual(exercise);
    expect(router.lastNavigation()!.entryId).toBe(firstExerciseId);
    expect(router.originFor(exercise)).toEqual(summary);
    router.back();
    expect(router.originFor(summary)).toEqual({ name: 'history' });
  });

  test('fresh deep-link Back replaces the parent and never leaves the app', () => {
    const browser = installFakeBrowser('#/settings');
    // An unknown previous entry must not authorize router.back().
    browser.history.pushState({ external: true }, '', '#/exercises/squat/history');
    const router = start();
    const id = router.lastNavigation()!.entryId;
    router.back();
    expect(browser.location.hash).toBe('#/history');
    expect(browser.history.backCalls).toBe(0);
    expect(browser.history.length).toBe(2);
    expect(router.lastNavigation()!.entryId).not.toBe(id);
    expect(router.originFor({ name: 'history' })).toBeNull();
    expect(browser.history.state).toMatchObject({ external: true });
  });

  test('replacement retains predecessor but gets a fresh route ID and scroll', () => {
    const browser = installFakeBrowser('#/workouts/arms-day-a');
    const router = start();
    router.navigate(active);
    router.saveScroll(6400);
    const id = router.lastNavigation()!.entryId;
    router.navigate(summary, { replace: true });
    expect(router.lastNavigation()).toMatchObject({ fromEntryId: id, traversed: false });
    expect(router.lastNavigation()!.entryId).not.toBe(id);
    expect(router.originFor(summary)).toEqual(overview);
    router.saveScroll(6400, id);
    expect(router.scrollForCurrent()).toBeNull();
    expect(browser.history.length).toBe(2);
    router.back();
    expect(get(router.current())).toEqual(overview);
    browser.history.forward();
    expect(get(router.current())).toEqual(summary);
    expect(router.lastNavigation()!.traversed).toBe(true);
  });

  test('Summary -> Edit -> Finish traverses to the existing summary', () => {
    const browser = installFakeBrowser('#/history');
    const router = start();
    router.navigate(summary);
    const id = router.lastNavigation()!.entryId;
    router.saveScroll(900);
    router.navigate(active);
    router.navigate(summary, { replace: true });
    expect(router.lastNavigation()).toMatchObject({ entryId: id, traversed: true });
    expect(router.originFor(summary)).toEqual({ name: 'history' });
    expect(router.scrollForCurrent()).toBe(900);
    expect(browser.history.backCalls).toBe(1);
    router.back();
    expect(get(router.current())).toEqual({ name: 'history' });
  });

  test('without replaceState, fragment popstate and hashchange do not duplicate entries', async () => {
    const browser = installFakeBrowser('#/sessions/s-one/active');
    Object.defineProperty(browser.history, 'replaceState', { configurable: true, value: undefined });
    const seen: Route[] = [];
    const router = start({ beforeRouteChange: (route) => { seen.push(route); } });
    await drain();
    seen.length = 0;
    const activeId = router.lastNavigation()!.entryId;
    browser.location.hash = '#/exercises/squat/history';
    await drain();
    expect(seen).toEqual([exercise]);
    expect(router.originFor(exercise)).toEqual(active);
    expect(router.lastNavigation()).toMatchObject({ fromEntryId: activeId, traversed: false });
    expect(router.lastNavigation()!.entryId).not.toBe(activeId);
  });

  test('raw fragment popstate is forward and its hashchange publishes only once', async () => {
    const browser = installFakeBrowser('#/sessions/s-one/active');
    const seen: Route[] = [];
    const router = start({ beforeRouteChange: (route) => { seen.push(route); } });
    await drain();
    seen.length = 0;
    browser.location.hash = '#/exercises/squat/history';
    await drain();
    expect(seen).toEqual([exercise]);
    expect(router.originFor(exercise)).toEqual(active);
    expect(router.lastNavigation()!.traversed).toBe(false);
  });

  test('same-hash traversal publishes by entry ID without poisoning the next push', async () => {
    const browser = installFakeBrowser('#/history');
    const seen: Route[] = [];
    const router = start({ beforeRouteChange: (route) => { seen.push(route); } });
    await drain();
    const originalId = router.lastNavigation()!.entryId;
    // A distinct native fragment entry canonicalizes to the same URL.
    browser.location.hash = '#/history/';
    await drain();
    const secondId = router.lastNavigation()!.entryId;
    expect(secondId).not.toBe(originalId);
    expect(browser.location.hash).toBe('#/history');
    seen.length = 0;
    browser.history.back();
    await drain();
    expect(seen).toEqual([{ name: 'history' }]);
    expect(router.lastNavigation()).toMatchObject({
      entryId: originalId, fromEntryId: secondId, traversed: true
    });
    browser.history.forward();
    await drain();
    expect(router.lastNavigation()!.entryId).toBe(secondId);
    router.navigate(exercise);
    await drain();
    expect(router.lastNavigation()!.traversed).toBe(false);
    expect(router.originFor(exercise)).toEqual({ name: 'history' });
  });

  test('rapid programmatic pushes retain every entry before events arrive', () => {
    const browser = installFakeBrowser('#/');
    const router = start();
    const pop = browser.eventListeners.popstate!;
    const hash = browser.eventListeners.hashchange!;
    browser.eventListeners.popstate = [];
    browser.eventListeners.hashchange = [];
    router.navigate(overview);
    router.navigate(active);
    expect(router.originFor(active)).toEqual(overview);
    browser.eventListeners.popstate = pop;
    browser.eventListeners.hashchange = hash;
    pop.forEach((listener) => listener());
    hash.forEach((listener) => listener());
    router.back();
    expect(get(router.current())).toEqual(overview);
    expect(router.originFor(overview)).toEqual({ name: 'home' });
    expect(router.lastNavigation()!.traversed).toBe(true);
  });

  test('restart follows an address changed while stopped', () => {
    const browser = installFakeBrowser('#/history');
    const router = start();
    router.stop();
    browser.location.hash = '#/settings';
    router.start();
    expect(get(router.current())).toEqual({ name: 'settings' });
    expect(router.originFor({ name: 'settings' })).toEqual({ name: 'history' });
  });

  test('Forward to an unknown same-hash pushState entry assigns a distinct ID', () => {
    const browser = installFakeBrowser('#/sessions/s-one/active');
    const router = start();
    const oldId = router.lastNavigation()!.entryId;
    // pushState itself emits no event, so the router first encounters this
    // entry on Forward. It intentionally carries no copied router marker.
    browser.history.pushState({ sameHashFixture: true }, '', browser.location.href);
    browser.history.back();
    expect(router.lastNavigation()!.entryId).toBe(oldId);
    browser.history.forward();
    const newId = router.lastNavigation()!.entryId;
    expect(newId).not.toBe(oldId);
    expect(router.lastNavigation()).toMatchObject({ fromEntryId: oldId, traversed: true });
    expect(browser.history.state).toMatchObject({ sameHashFixture: true });
    router.navigate(exercise);
    expect(router.lastNavigation()!.traversed).toBe(false);
    expect(router.originFor(exercise)).toEqual(active);
    router.back();
    expect(router.lastNavigation()).toMatchObject({ entryId: newId, traversed: true });
    router.back();
    expect(router.lastNavigation()).toMatchObject({ entryId: oldId, traversed: true });
  });

  test('same-entry popstate/hashchange notifications are deduplicated', async () => {
    const browser = installFakeBrowser('#/history');
    const seen: Route[] = [];
    start({ beforeRouteChange: (route) => { seen.push(route); } });
    await drain();
    seen.length = 0;
    browser.eventListeners.popstate?.forEach((listener) => listener());
    browser.eventListeners.hashchange?.forEach((listener) => listener());
    await drain();
    expect(seen).toEqual([]);
  });
});

describe('persistent metadata and canonical addresses', () => {
  test('reload retains IDs, predecessors, scroll, and unrelated state', () => {
    const browser = installFakeBrowser('#/workouts/arms-day-a');
    browser.history.replaceState({ fixture: { preserved: true } }, '');
    const first = start();
    first.saveScroll(6000);
    const overviewId = first.lastNavigation()!.entryId;
    first.navigate(active);
    browser.history.replaceState({ ...window.history.state, another: 'field' }, '');
    first.saveScroll(4200);
    const activeId = first.lastNavigation()!.entryId;
    first.stop();

    const reloaded = start();
    expect(reloaded.lastNavigation()!.entryId).toBe(activeId);
    expect(reloaded.originFor(active)).toEqual(overview);
    expect(reloaded.scrollForCurrent()).toBe(4200);
    expect(browser.history.state).toMatchObject({ another: 'field' });
    reloaded.back();
    expect(reloaded.lastNavigation()).toMatchObject({ entryId: overviewId, traversed: true });
    expect(reloaded.scrollForCurrent()).toBe(6000);
    expect(browser.history.state).toMatchObject({ fixture: { preserved: true } });
  });

  test('OAuth callback cleanup preserves entry history and scroll across router reload', () => {
    const browser = installFakeBrowser('#/workouts/arms-day-a');
    const first = start();
    first.saveScroll(1234);
    const overviewId = first.lastNavigation()!.entryId;
    first.navigate(active);
    browser.history.replaceState({ ...window.history.state, fixture: { preserved: true } }, '');
    first.saveScroll(6000);
    const activeId = first.lastNavigation()!.entryId;
    const stateBefore = browser.history.state;
    first.stop();

    beginAuthorization('test-client', { remember: false, returnRoute: '#/sessions/s-one/active' });
    // Model a callback on the retained entry, with routing stopped until auth
    // removes the token fragment. This must not erase router metadata.
    browser.history.replaceState(browser.history.state, '', responseFragment({
      state: authorizationState(browser.assignedUrl)
    }));
    expect(consumeCallback().kind).toBe('accepted');
    expect(browser.history.state).toEqual(stateBefore);
    expect(browser.location.hash).toBe('#/sessions/s-one/active');

    const reloaded = start();
    expect(reloaded.lastNavigation()).toMatchObject({ entryId: activeId, scrollY: 6000 });
    expect(reloaded.originFor(active)).toEqual(overview);
    expect(reloaded.scrollForCurrent()).toBe(6000);
    expect(browser.history.state).toMatchObject({ fixture: { preserved: true } });
    reloaded.back();
    expect(reloaded.lastNavigation()).toMatchObject({ entryId: overviewId, traversed: true });
    expect(reloaded.scrollForCurrent()).toBe(1234);
  });

  test('saves for a departing ID do not overwrite the destination scroll', () => {
    const browser = installFakeBrowser('#/sessions/s-one/active');
    const router = start();
    router.saveScroll(6000);
    router.navigate(exercise);
    const exerciseId = router.lastNavigation()!.entryId;
    router.back();
    router.saveScroll(2235, exerciseId);
    expect(router.scrollForCurrent()).toBe(6000);
    browser.history.forward();
    expect(router.scrollForCurrent()).toBe(2235);
  });

  test.each([
    ['', '#/'], ['#/history/', '#/history'], ['#//history//', '#/history'],
    ['#/workouts/%61rms-day-a', '#/workouts/arms-day-a']
  ])('start canonicalizes %s through replacement', (hash, expected) => {
    const browser = installFakeBrowser(hash);
    start();
    expect(browser.location.hash).toBe(expected);
    expect(browser.history.length).toBe(1);
  });

  test('native alias links and programmatic replacement use canonical hashes', () => {
    const browser = installFakeBrowser('#/');
    const router = start();
    browser.location.hash = '#//exercises/%73quat/history/';
    expect(browser.location.hash).toBe('#/exercises/squat/history');
    expect(router.originFor(exercise)).toEqual({ name: 'home' });
    router.navigate({ name: 'not-found', attempted: '#//settings//' }, { replace: true });
    expect(browser.location.hash).toBe('#/settings');
    expect(get(router.current())).toEqual({ name: 'settings' });
  });

  test('invalid metadata is replaced without trusting a predecessor', () => {
    const browser = installFakeBrowser('#/settings');
    browser.history.replaceState({ fixture: true, [ROUTER_HISTORY_STATE_KEY]: {
      version: 1, id: 'bad', hash: '#/settings', scrollY: 0,
      predecessor: { id: 'outside', hash: 'https://outside.invalid/' }
    } }, '');
    const router = start();
    expect(router.originFor({ name: 'settings' })).toBeNull();
    router.back();
    expect(browser.history.backCalls).toBe(0);
    expect(browser.history.state).toMatchObject({ fixture: true });
  });

  test('scroll snapshots never write history state and survive router recreation', () => {
    const browser = installFakeBrowser('#/sessions/s-one/active');
    browser.history.replaceState({ fixture: 'preserved' }, '');
    let stateWrites = 0;
    const originalReplace = browser.history.replaceState;
    browser.history.replaceState = (state, title, url): void => {
      ++stateWrites;
      originalReplace(state, title, url);
    };
    const router = start();
    const id = router.lastNavigation()!.entryId;
    const writesAfterStart = stateWrites;
    for (let y = 1; y <= 180; ++y) router.saveScroll(y);
    expect(router.scrollForCurrent()).toBe(180);
    expect(stateWrites).toBe(writesAfterStart);
    expect(browser.history.state).toMatchObject({
      fixture: 'preserved', [ROUTER_HISTORY_STATE_KEY]: { scrollY: null }
    });
    router.stop();

    const reloaded = start();
    expect(reloaded.lastNavigation()).toMatchObject({ entryId: id, scrollY: 180 });
    expect(reloaded.scrollForCurrent()).toBe(180);
    expect(browser.history.state).toMatchObject({ fixture: 'preserved' });
  });

  test('denied session storage does not block scroll saves, traversal, or state fallback', () => {
    const browser = installFakeBrowser('#/sessions/s-one/active');
    browser.sessionStorage.getItem = (): never => { throw new Error('Storage denied'); };
    browser.sessionStorage.setItem = (): never => { throw new Error('Storage denied'); };
    const router = start();
    expect(() => router.saveScroll(6000)).not.toThrow();
    router.navigate(exercise);
    router.saveScroll(100);
    router.back();
    expect(router.scrollForCurrent()).toBe(6000);
    // Traversal writes the in-memory snapshot into history state. It remains a
    // reload fallback even if both sessionStorage reads and writes are denied.
    expect(browser.history.state).toMatchObject({ [ROUTER_HISTORY_STATE_KEY]: { scrollY: 6000 } });
    router.stop();
    const reloaded = start();
    expect(reloaded.scrollForCurrent()).toBe(6000);
    expect(reloaded.originFor(active)).toBeNull();
  });

  test('invalid scroll values do not replace a saved value', () => {
    installFakeBrowser('#/history');
    const router = start();
    router.saveScroll(100);
    for (const value of [NaN, Infinity, -1]) router.saveScroll(value);
    expect(router.scrollForCurrent()).toBe(100);
  });
});

describe('deferred route publication', () => {
  test('default scroll saves stay with the rendered entry and survive reload elsewhere', async () => {
    const browser = installFakeBrowser('#/sessions/s-one/active');
    let finish: (() => void) | undefined;
    const router = start({ beforeRouteChange: (route) => route.name === 'exercise-history'
      ? new Promise<void>((resolve) => { finish = resolve; }) : undefined });
    await drain();
    router.saveScroll(6000);
    router.navigate(exercise);
    await drain();
    router.saveScroll(6100);
    expect(get(router.current())).toEqual(active);
    expect(router.scrollForCurrent()).toBe(6100);
    expect(router.lastNavigation()).toMatchObject({ to: exercise, scrollY: null });
    expect(browser.history.state).toMatchObject({ [ROUTER_HISTORY_STATE_KEY]: { scrollY: null } });
    finish!();
    await drain();
    expect(router.scrollForCurrent()).toBeNull();
    router.saveScroll(100);
    router.stop();

    // The departed active entry's history.state still holds 6000. Its newer
    // 6100 snapshot was saved while Exercise History owned the address bar.
    const reloaded = start();
    expect(reloaded.scrollForCurrent()).toBe(100);
    reloaded.back();
    expect(get(reloaded.current())).toEqual(active);
    expect(reloaded.scrollForCurrent()).toBe(6100);
    expect(reloaded.lastNavigation()!.scrollY).toBe(6100);
  });

  test('pending Back never saves the outgoing short-screen scroll onto its destination', async () => {
    installFakeBrowser('#/sessions/s-one/active');
    let delayActive = false;
    let finish: (() => void) | undefined;
    const router = start({ beforeRouteChange: (route) => delayActive && route.name === 'session-active'
      ? new Promise<void>((resolve) => { finish = resolve; }) : undefined });
    await drain();
    router.saveScroll(6000);
    router.navigate(exercise);
    await drain();
    router.saveScroll(2235);
    delayActive = true;
    router.back();
    await drain();
    router.saveScroll(1000);
    expect(get(router.current())).toEqual(exercise);
    expect(router.scrollForCurrent()).toBe(1000);
    expect(router.lastNavigation()).toMatchObject({ to: active, traversed: true, scrollY: 6000 });
    finish!();
    await drain();
    expect(get(router.current())).toEqual(active);
    expect(router.scrollForCurrent()).toBe(6000);
  });

  test('an older successful hook cannot publish over a newer navigation', async () => {
    installFakeBrowser('#/');
    let finishSlow: (() => void) | undefined;
    const router = start({ beforeRouteChange: (route) => route.name === 'settings'
      ? new Promise<void>((resolve) => { finishSlow = resolve; }) : undefined });
    await drain();
    router.navigate({ name: 'settings' });
    await drain();
    router.navigate({ name: 'history' });
    await drain();
    expect(get(router.current())).toEqual({ name: 'history' });
    finishSlow!();
    await drain();
    expect(get(router.current())).toEqual({ name: 'history' });
    expect(router.lastNavigation()!.to).toEqual({ name: 'history' });
  });

  test('an older rejected hook cannot publish over a newer navigation', async () => {
    installFakeBrowser('#/');
    let rejectSlow: ((reason: Error) => void) | undefined;
    const router = start({ beforeRouteChange: (route) => route.name === 'settings'
      ? new Promise<void>((_resolve, reject) => { rejectSlow = reject; }) : undefined });
    await drain();
    router.navigate({ name: 'settings' });
    await drain();
    router.navigate({ name: 'history' });
    await drain();
    rejectSlow!(new Error('save failed'));
    await drain();
    expect(get(router.current())).toEqual({ name: 'history' });
  });

  test('stop invalidates outstanding publications', async () => {
    installFakeBrowser('#/');
    let finish: (() => void) | undefined;
    const router = start({ beforeRouteChange: () => new Promise<void>((resolve) => { finish = resolve; }) });
    await drain();
    router.stop();
    finish!();
    await drain();
    expect(get(router.current())).toEqual({ name: 'home' });
  });
});
