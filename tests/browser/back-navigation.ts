import { chromium, type Page } from 'playwright';
import { createServer } from 'vite';
import { strict as assert } from 'node:assert';
import { SESSION_KEY } from '../fixtures/semantic';

// No external pages: Chromium's sandbox is disabled only for this local fixture.
const server = await createServer({
  root: '.',
  server: { host: '127.0.0.1', port: 0, hmr: false, watch: null }
});
await server.listen();
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const base = `${server.resolvedUrls!.local[0]}tests/browser/back-target.html`;
const home = '#/';
const active = `#/sessions/${SESSION_KEY}/active`;
const summary = `#/sessions/${SESSION_KEY}/summary`;
const exercise = '#/exercises/back-squat/history';
const errors: string[] = [];

async function frames(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  }));
}
async function at(page: Page, hash: string): Promise<void> {
  await page.waitForURL((url) => url.hash === hash);
  // Header alone is insufficient: it changes before asynchronous screen loads.
  if (hash === active) {
    await page.locator('.back-header__title').filter({ hasText: 'Active Workout' }).waitFor();
    await page.locator('a.last-time--link').first().waitFor();
  } else if (hash === exercise) {
    await page.locator('.back-header__title').filter({ hasText: 'Exercise History' }).waitFor();
    await page.locator('.history-list a').first().waitFor();
  } else if (hash === '#/history') {
    await page.getByRole('heading', { name: 'Workout History', exact: true }).waitFor();
  } else {
    await page.locator(hash === summary ? '.summary-screen__actions' : '.chooser').first().waitFor();
  }
  await frames(page);
}
async function yIs(page: Page, y: number): Promise<void> {
  await page.waitForFunction((expected) => Math.abs(window.scrollY - expected) <= 1, y);
  await frames(page);
  assert.ok(Math.abs(await page.evaluate(() => window.scrollY) - y) <= 1, `Expected stable scrollY=${y}`);
}
async function scroll(page: Page, y: number): Promise<void> {
  await page.evaluate((value) => window.scrollTo(0, value), y);
  await yIs(page, y); // A short document must fail, not silently clamp the test.
}
async function fixture(start = home, withoutScrollRestoration = false): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 1100, height: 1000 } });
  page.setDefaultTimeout(12_000);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript((unsupported) => {
    history.replaceState({ ...history.state, fixture: 'preserved' }, '');
    if (unsupported) {
      // Capability injection only: retain Chromium's real scrolling/history.
      let owner: object | null = history;
      while (owner !== null) {
        if (Object.prototype.hasOwnProperty.call(owner, 'scrollRestoration')) {
          if (!Reflect.deleteProperty(owner, 'scrollRestoration')) throw new Error('Cannot remove scrollRestoration capability');
        }
        owner = Object.getPrototypeOf(owner);
      }
    }
  }, withoutScrollRestoration);
  await page.goto(`${base}${start}`);
  await at(page, start);
  return page;
}
async function enterActive(page: Page): Promise<void> {
  // Actual Resume anchor gives the active entry an actual app predecessor.
  await page.locator(`a.session-row[href="${active}"]`).click();
  await at(page, active);
  await yIs(page, 0);
}
async function badgeAt6000(page: Page): Promise<void> {
  await scroll(page, 6000);
  const badges = page.locator(`a.last-time--link[href="${exercise}"]`);
  const index = await badges.evaluateAll((anchors) => anchors.findIndex((anchor) => {
    const rect = anchor.getBoundingClientRect();
    return rect.top >= 0 && rect.bottom <= innerHeight;
  }));
  assert.ok(index >= 0, 'Real Back Squat View history badge must be visible at Y6000');
  // Playwright performs a real pointer click, not a synthetic router call.
  await badges.nth(index).click();
  await at(page, exercise);
  await yIs(page, 0);
  assert.equal(await page.locator('.back-header__back').getAttribute('href'), active);
  assert.equal(await page.evaluate(() => window.backTestRouter.lastNavigation()?.traversed), false);
}
async function topBack(page: Page, target: string): Promise<void> {
  await page.locator('.back-header__back').click();
  await at(page, target);
}
async function nativeBack(page: Page, target: string, y: number): Promise<void> {
  await page.goBack();
  await at(page, target);
  await yIs(page, y);
  assert.equal(await page.evaluate(() => window.backTestRouter.lastNavigation()?.traversed), true);
}
async function nativeForward(page: Page, target: string, y: number): Promise<void> {
  await page.goForward();
  await at(page, target);
  await yIs(page, y);
  assert.equal(await page.evaluate(() => window.backTestRouter.lastNavigation()?.traversed), true);
}

try {
  {
    const page = await fixture();
    await enterActive(page);
    await badgeAt6000(page);
    await topBack(page, active);
    await yIs(page, 6000);
    assert.equal(await page.evaluate(() => window.backTestRouter.lastNavigation()?.traversed), true);
    assert.equal(await page.locator('.back-header__back').getAttribute('href'), home);
    await topBack(page, home);
    await yIs(page, 0);
    assert.equal(await page.evaluate(() => history.state.fixture), 'preserved');
    console.log('PASS: real View history and top-nav Back restore Y6000; next Back exits without a loop');
    await page.close();
  }
  {
    const page = await fixture();
    await enterActive(page);
    await badgeAt6000(page);
    await scroll(page, 400);
    await nativeBack(page, active, 6000);
    await nativeForward(page, exercise, 400);
    const metadata = await page.evaluate(() => history.state.__repjotRouter);
    assert.ok(metadata.id && metadata.predecessor);
    await page.reload();
    await at(page, exercise);
    await yIs(page, 400);
    const reloaded = await page.evaluate(() => history.state.__repjotRouter);
    assert.equal(reloaded.id, metadata.id);
    assert.deepEqual(reloaded.predecessor, metadata.predecessor);
    assert.equal(await page.evaluate(() => history.state.fixture), 'preserved');
    assert.equal(await page.locator('.back-header__back').getAttribute('href'), active);
    await nativeBack(page, active, 6000);
    await nativeForward(page, exercise, 400);
    console.log('PASS: native Back/Forward restore both entry positions; reload preserves entry and origin');
    await page.close();
  }
  {
    const page = await fixture();
    await enterActive(page);
    await badgeAt6000(page);
    await page.evaluate(() => {
      window.backTestDelays.flush.hold();
      window.backTestDelays.load.hold();
    });
    await page.locator('.back-header__back').click();
    await page.waitForFunction(() => window.backTestDelays.flush.pending() > 0);
    assert.equal(await page.locator('.back-header__title').textContent(), 'Exercise History');
    await frames(page);
    assert.equal(await page.evaluate(() => window.backTestDelays.load.pending()), 0);
    await page.evaluate(() => window.backTestDelays.flush.release());
    await page.waitForFunction(() => window.backTestDelays.load.pending() > 0);
    await page.locator('a.last-time--link').first().waitFor({ state: 'detached' });
    await frames(page);
    assert.ok(await page.evaluate(() => document.documentElement.scrollHeight < 6000), 'Loading DOM must be too short to restore Y6000');
    await page.evaluate(() => window.backTestDelays.load.release());
    await at(page, active);
    await yIs(page, 6000);
    console.log('PASS: restoration survives delayed queueFlush and delayed registered sessionService.load');
    await page.close();
  }
  {
    const page = await fixture();
    await enterActive(page);
    await badgeAt6000(page);
    await page.evaluate(() => window.backTestDelays.load.hold());
    await page.locator('.back-header__back').click();
    await page.waitForFunction(() => window.backTestDelays.load.pending() > 0);
    await page.locator('a.last-time--link').first().waitFor({ state: 'detached' });
    await page.evaluate(() => {
      window.addEventListener('wheel', () => {
        document.documentElement.dataset.backTestWheeled = 'yes';
      }, { once: true });
    });
    await page.mouse.wheel(0, 240);
    await page.waitForFunction(() => document.documentElement.dataset.backTestWheeled === 'yes');
    await frames(page);
    await page.evaluate(() => window.backTestDelays.load.release());
    await at(page, active);
    await yIs(page, 0);
    assert.equal(await page.evaluate(() => window.backTestRouter.scrollForCurrent()), 0);
    console.log('PASS: real wheel input during delayed load cancels pending Y6000 restoration');
    await page.close();
  }
  {
    const page = await fixture(home, true);
    assert.equal(await page.evaluate(() => 'scrollRestoration' in history), false);
    await enterActive(page);
    await badgeAt6000(page);
    await topBack(page, active);
    await yIs(page, 6000);
    await topBack(page, home);
    await yIs(page, 0);
    assert.equal(await page.evaluate(() => 'scrollRestoration' in history), false, 'App must not create an unsupported browser property');
    console.log('PASS: missing history.scrollRestoration still restores after DOM readiness');
    await page.close();
  }
  {
    const page = await fixture();
    await enterActive(page);
    const firstId = await page.evaluate(() => window.backTestRouter.lastNavigation()!.entryId);
    await badgeAt6000(page);
    await scroll(page, 400);
    // Exercise -> History -> Resume makes a second entry for the same session.
    // Programmatic setup is allowed here; original regression paths above use anchors.
    await page.evaluate(() => window.backTestRouter.navigate({ name: 'history' }));
    await at(page, '#/history');
    await page.evaluate((sessionId) => window.backTestRouter.navigate({ name: 'session-active', sessionId }), SESSION_KEY);
    await at(page, active);
    await yIs(page, 0);
    assert.notEqual(await page.evaluate(() => window.backTestRouter.lastNavigation()!.entryId), firstId);
    await scroll(page, 3000);
    await page.evaluate(() => window.backTestRouter.navigate({ name: 'exercise-history', exerciseId: 'back-squat' }));
    await at(page, exercise);
    await yIs(page, 0);
    await nativeBack(page, active, 3000);
    await nativeBack(page, '#/history', 0);
    await nativeBack(page, exercise, 400);
    await nativeBack(page, active, 6000);
    await nativeForward(page, exercise, 400);
    await nativeForward(page, '#/history', 0);
    await nativeForward(page, active, 3000);
    console.log('PASS: repeated route visits retain separate entry scroll positions');
    await page.close();
  }
  for (const foreignState of [false, true]) {
    const page = await fixture();
    await enterActive(page);
    // A same-hash history entry emits only popstate, not hashchange.
    await page.evaluate((foreign) => history.pushState(
      foreign ? { sameHashFixture: true } : { ...history.state, sameHashFixture: true }, '', location.href
    ), foreignState);
    const oldId = await page.evaluate(() => window.backTestRouter.lastNavigation()!.entryId);
    await page.goBack();
    await frames(page);
    assert.equal(await page.evaluate(() => window.backTestRouter.lastNavigation()!.entryId), oldId);
    await page.goForward();
    await page.waitForFunction(() => history.state.sameHashFixture === true);
    await frames(page);
    assert.equal(new URL(page.url()).hash, active);
    if (foreignState) {
      await page.waitForFunction((id) => window.backTestRouter.lastNavigation()?.entryId !== id, oldId);
      // Native Forward is a traversal even when this entry's state is first encountered.
      assert.equal(await page.evaluate(() => window.backTestRouter.lastNavigation()?.traversed), true);
    }
    await badgeAt6000(page);
    await nativeBack(page, active, 6000);
    await nativeForward(page, exercise, 0);
    console.log(`PASS: ${foreignState ? 'unknown' : 'marked'} same-hash popstate then Forward does not poison subsequent anchor detection`);
    await page.close();
  }
  {
    const page = await fixture();
    // Summary of the in-progress session exposes the real Edit -> Finish flow.
    await page.evaluate((sessionId) => window.backTestRouter.navigate({ name: 'session-summary', sessionId }), SESSION_KEY);
    await at(page, summary);
    await page.getByRole('link', { name: 'Edit', exact: true }).click();
    await at(page, active);
    await page.getByRole('button', { name: 'Finish Workout', exact: true }).click();
    await page.getByRole('button', { name: 'Finish as incomplete', exact: true }).click();
    await at(page, summary);
    assert.notEqual(await page.locator('.back-header__back').getAttribute('href'), summary);
    assert.notEqual(await page.locator('.back-header__back').getAttribute('href'), active);
    await topBack(page, home);
    console.log('PASS: Summary -> real Edit -> Finish has no self-Back or editor origin');
    await page.close();
  }
  for (const action of ['finish', 'abandon'] as const) {
    const page = await fixture();
    // Keep an older entry before Home so immediate native Back remains in-app.
    await page.evaluate(() => window.backTestRouter.navigate({ name: 'history' }));
    await at(page, '#/history');
    await page.evaluate(() => window.backTestRouter.navigate({ name: 'home' }));
    await at(page, home);
    await enterActive(page);
    if (action === 'finish') {
      await page.getByRole('button', { name: 'Finish Workout', exact: true }).click();
      await page.getByRole('button', { name: 'Finish as incomplete', exact: true }).click();
      await at(page, summary);
      await nativeBack(page, home, 0);
    } else {
      await page.getByRole('button', { name: 'Abandon workout', exact: true }).click();
      await at(page, home);
      await nativeBack(page, '#/history', 0);
    }
    assert.notEqual(new URL(page.url()).hash, active);
    console.log(`PASS: ${action} followed by immediate browser Back does not reopen editor`);
    await page.close();
  }
  {
    const page = await fixture();
    await page.evaluate(() => window.backTestRouter.navigate({ name: 'history' }));
    await at(page, '#/history');
    await page.evaluate((sessionId) => window.backTestRouter.navigate({ name: 'session-summary', sessionId }), SESSION_KEY);
    await at(page, summary);
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await page.getByRole('button', { name: 'Delete session', exact: true }).click();
    await at(page, '#/history');
    await nativeBack(page, home, 0);
    console.log('PASS: deletion followed by immediate Back does not reopen the deleted summary');
    await page.close();
  }
  {
    const page = await fixture();
    await enterActive(page);
    await page.evaluate((sessionId) => window.backTestRouter.navigate(
      { name: 'session-summary', sessionId }, { replace: true }
    ), SESSION_KEY);
    await at(page, summary);
    assert.equal(await page.locator('.back-header__back').getAttribute('href'), home);
    await nativeBack(page, home, 0);
    await nativeForward(page, summary, 0);
    assert.equal(await page.locator('.back-header__back').getAttribute('href'), home);
    console.log('PASS: browser traversal to a replaced entry retains its marker and predecessor');
    await page.close();
  }
  {
    const page = await fixture(exercise);
    await page.reload();
    await at(page, exercise);
    await yIs(page, 0);
    assert.equal(await page.locator('.back-header__back').getAttribute('href'), '#/history');
    console.log('PASS: fresh canonical exercise deep link retains its static parent');
    await page.close();
  }
  {
    const page = await fixture();
    await enterActive(page);
    await badgeAt6000(page);
    const initialRows = await page.locator('.history-list > li').count();
    assert.equal(initialRows, 20);
    const firstPageMax = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
    await page.getByRole('button', { name: 'Load older', exact: true }).click();
    await page.waitForFunction((count) => document.querySelectorAll('.history-list > li').length > count, initialRows);
    const expandedY = firstPageMax + 300;
    await scroll(page, expandedY);
    await page.evaluate(() => window.backTestRouter.navigate({ name: 'home' }));
    await at(page, home);
    await yIs(page, 0);
    await nativeBack(page, exercise, expandedY);
    assert.ok(await page.locator('.history-list > li').count() > initialRows, 'Restoration must load enough history rows before applying the offset');
    console.log('PASS: expanded Load older history grows again before restoring beyond the first page');
    await page.close();
  }
  {
    const page = await fixture();
    await enterActive(page);
    await badgeAt6000(page);
    const initialRows = await page.locator('.history-list > li').count();
    assert.equal(initialRows, 20);
    const firstPageMax = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
    const targetY = firstPageMax + 300;
    const entry = await page.evaluate((scrollY) => {
      const previous = history.state.__repjotRouter;
      const id = `browser-samehash-${crypto.randomUUID()}`;
      history.pushState({
        ...history.state,
        __repjotRouter: {
          ...previous, id,
          predecessor: { id: previous.id, hash: previous.hash },
          scrollY
        }
      }, '', location.href);
      return { oldId: previous.id, newId: id };
    }, targetY);
    // pushState emits no route event. Back reaches the already-rendered entry;
    // Forward must rerun readiness even though the route key never changes.
    await page.goBack();
    await page.waitForFunction((id) => history.state.__repjotRouter.id === id, entry.oldId);
    await frames(page);
    assert.equal(await page.evaluate(() => window.backTestRouter.lastNavigation()?.entryId), entry.oldId);
    assert.equal(await page.locator('.history-list > li').count(), initialRows);
    await nativeForward(page, exercise, targetY);
    assert.equal(await page.evaluate(() => window.backTestRouter.lastNavigation()?.entryId), entry.newId);
    assert.ok(await page.locator('.history-list > li').count() > initialRows, 'Same-key traversal must rerun readiness and grow history before restoration');
    console.log('PASS: same-key marked Forward reruns readiness and restores beyond the initial history page');
    await page.close();
  }
  assert.deepEqual(errors, [], 'No uncaught browser errors');
} finally {
  await browser.close();
  await server.close();
}
