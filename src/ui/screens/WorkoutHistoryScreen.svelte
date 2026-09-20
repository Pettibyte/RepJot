<!--
  The Workout History screen.
  Phase 18. REQUIREMENTS 20.1, 20.2, 20.5. ARCHITECTURE §9.

  Every session, newest first, across every workout. The tab root `#/history`
  has no workout id, so the screen reads `listAllSessions`, which pages the
  whole session set.

  No volume total appears anywhere on this page. REQUIREMENTS 20.2 forbids an
  aggregate workout-volume metric, so the screen lists sessions and stops. A
  user who wants the work inside one session opens it.

  Load older. The screen holds no paging rule of its own. `historyPager` owns
  the page offset, the two end-of-list flags, and the walk past the loaded
  index into older monthly shards. The screen only says which page to read and
  which shard to ask the coordinator for.

  The screen writes nothing. It reads through the lookup service and the
  coordinator and never touches a store or Drive directly.
-->
<script lang="ts">
  import { untrack } from 'svelte';

  import Button from '../components/Button.svelte';
  import LoadOlder from '../components/LoadOlder.svelte';
  import StatusLabel from '../components/StatusLabel.svelte';
  import { services } from '../../services/registry';
  import { formatRoute } from '../../routing/routes';
  import {
    HISTORY_PAGE_SIZE,
    buildWorkoutHistoryModel,
    type HistoryRow
  } from '../viewmodels/historyModel';
  import { resolveLocalTimeZone } from '../viewmodels/chooserModel';
  import { shardNameForMonth } from './historyShards';
  import {
    appendPage,
    emptyPager,
    hasOlder,
    loadOlder,
    type PagerPage,
    type PagerState
  } from './historyPager';
  import type { ResultsShard } from '../../domain/types';

  /** The paging state. The pager owns every rule behind it. */
  let pager = $state<PagerState<HistoryRow>>(emptyPager<HistoryRow>());
  /** True while an older page or shard is in flight. */
  let busy = $state(false);
  /** Load failure text. Empty means nothing to report. */
  let errorText = $state('');

  const localTimeZone = resolveLocalTimeZone();

  /** Rows shown so far. The list grows in place; it never re-renders from zero. */
  const rows = $derived(pager.rows);

  /** Read one page of sessions from the live index. */
  function readPage(offset: number, limit: number): PagerPage<HistoryRow> {
    const lookup = $services.lookup;
    if (lookup === null) return { items: [], total: 0, hasMore: false };
    const page = lookup.listAllSessions({ offset, limit });
    const nowValue = new Date().toISOString();
    return {
      items: buildWorkoutHistoryModel(page.items, localTimeZone, nowValue),
      total: page.total,
      hasMore: page.hasMore
    };
  }

  /**
   * Pull one older month into the index.
   *
   * A shard the coordinator cannot find ends the walk. That is the stop
   * signal: the account has no older month on file.
   */
  async function loadShard(month: string): Promise<boolean> {
    const { coordinator, lookup } = $services;
    if (coordinator === null || lookup === null) return false;
    try {
      const doc = await coordinator.ensureLoaded(shardNameForMonth(month));
      if (doc === null || doc === undefined) return false;
      lookup.extendHistory([doc as ResultsShard]);
      return true;
    } catch {
      // The coordinator reported the failure through `activeError`. Here the
      // only honest reading is that no older shard exists, so the walk stops
      // and the list keeps what it has.
      return false;
    }
  }

  async function loadOlderRows(): Promise<void> {
    if (busy) return;
    busy = true;
    errorText = '';
    try {
      pager = await loadOlder(pager, readPage, loadShard, HISTORY_PAGE_SIZE);
    } catch (error) {
      errorText = error instanceof Error ? error.message : 'REP JOT could not load older sessions.';
    } finally {
      busy = false;
    }
  }

  // Re-read on every registry publish. The warm-up folds result shards into
  // the index the registry already holds, and the store cannot see that
  // growth, so it republishes. The pager already knows how many rows it has
  // read, so a republish appends only the new rows and never resets the
  // list the user is reading. The pager is read untracked, because this
  // effect is driven by the registry and must not chase its own write.
  //
  // Reading stops at the first page. Past that the user's own `Load older`
  // presses drive the list, so a warm-up cannot scroll the page by itself.
  $effect(() => {
    const lookup = $services.lookup;
    if (lookup === null) return;
    if (busy) return;
    const current = untrack(() => pager);
    if (current.rows.length >= HISTORY_PAGE_SIZE) return;
    pager = appendPage(current, readPage, HISTORY_PAGE_SIZE);
  });
</script>

<div class="screen screen--narrow history-screen">
  <div class="history-screen__head">
    <h1 class="history-screen__title">Workout History</h1>
  </div>

  {#if errorText !== ''}
    <p class="history-screen__error" role="alert">{errorText}</p>
  {/if}

  {#if rows.length === 0 && !busy}
    <p class="history-screen__empty">
      No sessions yet. Start a workout and it will show up here.
    </p>
  {:else}
    <ul class="history-list">
      {#each rows as row, index (`h-${index}`)}
        <li class="session-row">
          <a class="session-row session-item" href={row.href}>
            <span class="session-item__name">{row.workoutName}</span>
            <span class="session-item__meta">
              <StatusLabel class="session-item__status" status={row.status} label={row.statusLabel} />
              <span class="session-item__time">{row.dateLabel}</span>
            </span>
          </a>
        </li>
      {/each}
    </ul>

    <LoadOlder
      loadedCount={rows.length}
      hasMore={hasOlder(pager)}
      {busy}
      exhaustedText="That is all the history this build can read."
      onloadolder={loadOlderRows}
    />
  {/if}

  <div class="history-screen__actions">
    <Button variant="secondary" href={formatRoute({ name: 'home' })}>Back to workouts</Button>
  </div>
</div>
