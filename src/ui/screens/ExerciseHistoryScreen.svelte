<!--
  The Exercise History screen.
  Phase 18. REQUIREMENTS 20.4, 20.5. ARCHITECTURE §9.

  One exercise, every recorded occurrence, newest first, grouped by session.
  Each group has a local date-and-time heading linked to the session summary.

  Load older. The screen holds no paging rule of its own. `historyPager`
  owns the page offset, the two end-of-list flags, and the walk past the
  loaded index into older monthly shards. The screen only says which page to
  read and which shard to ask the coordinator for.

  An unknown exercise id renders the not-found state rather than an empty
  list, because an empty list reads as an exercise with no history.
-->
<script lang="ts">
  import { onDestroy, untrack } from 'svelte';

  import Button from '../components/Button.svelte';
  import LoadOlder from '../components/LoadOlder.svelte';
  import StatusLabel from '../components/StatusLabel.svelte';
  import { services } from '../../services/registry';
  import { formatRoute } from '../../routing/routes';
  import { createScreenReadyReporter } from '../../routing/screen-ready';
  import {
    HISTORY_PAGE_SIZE,
    buildExerciseHistoryModel,
    groupExerciseHistory,
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
  const reportScreenReady = createScreenReadyReporter();
  let pagerGeneration = 0;
  onDestroy(() => { pagerGeneration += 1; });

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
  const groups = $derived(groupExerciseHistory(
    rows, $services.lookup?.index.sessionsById ?? new Map(), localTimeZone
  ));

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
    const generation = pagerGeneration;
    busy = true;
    errorText = '';
    try {
      const loaded = await loadOlder(
        pager, readPage,
        (month) => generation === pagerGeneration ? loadShard(month) : Promise.resolve(false),
        HISTORY_PAGE_SIZE
      );
      if (generation === pagerGeneration) pager = loaded;
    } catch (error) {
      if (generation === pagerGeneration) {
        errorText = error instanceof Error ? error.message : 'REP JOT could not load older results.';
      }
    } finally {
      if (generation === pagerGeneration) busy = false;
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
    let current = untrack(() => pager);
    if (untrack(() => pagedExerciseId) !== exerciseId) {
      pagerGeneration += 1;
      pagedExerciseId = exerciseId;
      current = emptyPager<HistoryRow>();
      pager = current;
      busy = false;
      errorText = '';
    }
    if (lookup === null || busy) return;
    if (current.rows.length >= HISTORY_PAGE_SIZE) return;
    pager = appendPage(current, readPage, HISTORY_PAGE_SIZE);
  });

  $effect(() => {
    void rows;
    void exercise;
    if (busy || pagedExerciseId !== exerciseId) return;
    return reportScreenReady(
      formatRoute({ name: 'exercise-history', exerciseId }),
      hasOlder(pager) && errorText === '' ? () => { void loadOlderRows(); } : undefined
    );
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
      {#each groups as group (group.sessionId)}
        <section class="exercise-history-group">
          <h2 class="exercise-history-group__title">
            <a href={group.href}><time datetime={group.startedAtUtc}>{group.dateLabel}</time></a>
          </h2>
          <ul class="history-list">
        {#each group.rows as row, index (`eh-${index}`)}
          <li class="session-row">
            <a class="session-row session-item" href={row.href}>
              <span class="session-item__meta">
                <StatusLabel class="session-item__status" status={row.status} label={row.statusLabel} />
                {#if row.detailLabel !== undefined && row.detailLabel !== ''}
                  <span class="session-item__time">{row.detailLabel}</span>
                {/if}
                {#if row.alternatingLabel !== undefined && row.alternatingLabel !== ''}
                  <span class="session-item__time">{row.alternatingLabel}</span>
                {/if}
                {#if row.notes !== undefined}<span class="session-item__note">{row.notes}</span>{/if}
              </span>
            </a>
          </li>
        {/each}
          </ul>
        </section>
      {/each}

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
