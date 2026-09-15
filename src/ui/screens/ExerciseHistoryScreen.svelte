<!--
  The Exercise History screen.
  Phase 18. REQUIREMENTS 20.4, 20.5. ARCHITECTURE §9.

  One exercise, every recorded occurrence, newest first. Each row links back
  to the session summary, so the user reads the whole workout around the one
  set they came to look at.

  The row shows the exercise name, not the workout name. The screen is
  already scoped to one exercise, so repeating the exercise name in the
  heading and the row keeps the row honest: it names the thing the user is
  tracking.

  Load older. The screen holds no paging rule of its own. `historyPager`
  owns the page offset, the two end-of-list flags, and the walk past the
  loaded index into older monthly shards. The screen only says which page to
  read and which shard to ask the coordinator for.

  An unknown exercise id renders the not-found state rather than an empty
  list, because an empty list reads as an exercise with no history.
-->
<script lang="ts">
  import { untrack } from 'svelte';

  import Button from '../components/Button.svelte';
  import LoadOlder from '../components/LoadOlder.svelte';
  import { services } from '../../services/registry';
  import { formatRoute } from '../../routing/routes';
  import {
    HISTORY_PAGE_SIZE,
    buildExerciseHistoryModel,
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

  let { exerciseId = '' }: { exerciseId?: string } = $props();

  /** The paging state. The pager owns every rule behind it. */
  let pager = $state<PagerState<HistoryRow>>(emptyPager<HistoryRow>());
  /** True while an older page or shard is in flight. */
  let busy = $state(false);
  /** Load failure text. Empty means nothing to report. */
  let errorText = $state('');
  /** The exercise the current pager belongs to. */
  let pagedExerciseId = $state('');

  const localTimeZone = resolveLocalTimeZone();

  /** Rows shown so far. The list grows in place. */
  const rows = $derived(pager.rows);

  /** The exercise name, or `undefined` when the bundle lacks the exercise. */
  const exercise = $derived($services.lookup?.getExercise(exerciseId) ?? undefined);
  const exerciseName = $derived(exercise?.name ?? exerciseId);

  /** Read one page of occurrences from the live index. */
  function readPage(offset: number, limit: number): PagerPage<HistoryRow> {
    const lookup = $services.lookup;
    if (lookup === null) return { items: [], total: 0, hasMore: false };
    const page = lookup.getExerciseHistory(exerciseId, { offset, limit });
    const nowValue = new Date().toISOString();
    return {
      items: buildExerciseHistoryModel(page.items, localTimeZone, nowValue, exerciseName),
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
      // The coordinator reported the failure through `activeError`. The only
      // honest reading here is that no older shard exists.
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
      errorText = error instanceof Error ? error.message : 'REP JOT could not load older results.';
    } finally {
      busy = false;
    }
  }

  // Re-read on every registry publish, and start over when the exercise
  // changes. The warm-up folds result shards into the index the registry
  // already holds, and the store cannot see that growth, so it republishes.
  // The pager already knows how many rows it has read, so a republish
  // appends only the new rows and never resets the list the user is
  // reading. A different exercise is a different list, so that one does
  // reset. The pager is read untracked, because this effect is driven by
  // the registry and must not chase its own write.
  //
  // Reading stops at the first page. Past that the user's own `Load older`
  // presses drive the list, so a warm-up cannot scroll the page by itself.
  $effect(() => {
    const lookup = $services.lookup;
    if (lookup === null) return;
    if (busy) return;
    let current = untrack(() => pager);
    if (untrack(() => pagedExerciseId) !== exerciseId) {
      pagedExerciseId = exerciseId;
      current = emptyPager<HistoryRow>();
    }
    if (current.rows.length >= HISTORY_PAGE_SIZE) return;
    pager = appendPage(current, readPage, HISTORY_PAGE_SIZE);
  });
</script>

<div class="screen screen--narrow history-screen">
  {#if exercise === undefined}
    <h1 class="history-screen__missing-title">No exercise with that id</h1>
    <p class="history-screen__missing-detail">
      REP JOT does not have an exercise called <code class="overview__id">{exerciseId}</code> in
      this build.
    </p>
    <div class="history-screen__actions">
      <Button variant="primary" href={formatRoute({ name: 'history' })}>Back to history</Button>
    </div>
  {:else}
    <div class="history-screen__head">
      <h1 class="history-screen__title">{exerciseName}</h1>
      <p class="history-screen__subtitle">Every recorded set of this exercise.</p>
    </div>

    {#if errorText !== ''}
      <p class="history-screen__error" role="alert">{errorText}</p>
    {/if}

    {#if rows.length === 0 && !busy}
      <p class="history-screen__empty">No recorded sets yet for this exercise.</p>
    {:else}
      <ul class="history-list">
        {#each rows as row, index (`eh-${index}`)}
          <li class="session-row">
            <a class="session-row session-item" href={row.href}>
              <span class="session-item__name">{row.workoutName}</span>
              <span class="session-item__meta">
                <span class="session-item__status">{row.statusLabel}</span>
                {#if row.detailLabel !== undefined && row.detailLabel !== ''}
                  <span class="session-item__time">{row.detailLabel}</span>
                {/if}
                {#if row.alternatingLabel !== undefined && row.alternatingLabel !== ''}
                  <span class="session-item__time">{row.alternatingLabel}</span>
                {/if}
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
        exhaustedText="That is every recorded set this build can read."
        onloadolder={loadOlderRows}
      />
    {/if}

    <div class="history-screen__actions">
      <Button variant="secondary" href={formatRoute({ name: 'history' })}>Back to history</Button>
    </div>
  {/if}
</div>
