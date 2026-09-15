<!--
  The authenticated workout chooser.
  REQUIREMENTS 17.1-17.5, PHASE-16.

  Three lists, top to bottom:
    In progress  sessions the user has not finished. Resume is the first thing
                 a returning user wants, so this list sits above everything.
    Workouts     every workout in the bundle. This is the path for a user with
                 no history, and the path to a workout other than the last one.
    Recent       finished sessions, newest first, with **Load older** past the cap.

  The screen reads the services from the registry rather than taking them as
  props, so the shell stays out of the wiring. It holds only its own pagination
  state.

  The lists render from the merged index, which the warm-up fills after the
  first paint. Until a shard lands, the workout list shows and the session
  lists read empty, which is the truth rather than a spinner over content the
  user could already read.
-->
<script lang="ts">
  import SessionListItem from '../components/SessionListItem.svelte';
  import { services } from '../../services/registry';
  import type { SessionSummary } from '../../indexes/types';
  import {
    buildChooserModel,
    resolveLocalTimeZone,
    RECENT_PAGE_SIZE,
    WORKOUT_PAGE_SIZE
  } from '../viewmodels/chooserModel';
  import { nowUtc } from '../../domain/time';

  /** Extra recent sessions each **Load older** reveals. */
  const RECENT_STEP = RECENT_PAGE_SIZE;

  /** Extra workouts each **Show more workouts** reveals. */
  const WORKOUT_STEP = WORKOUT_PAGE_SIZE;

  let recentLimit = $state(RECENT_PAGE_SIZE);
  let workoutOffset = $state(0);

  /**
   * The raw text behind one row, read from the shard the warm already loaded.
   *
   * `coordinator.peek` is synchronous and never touches the network, so the
   * model build stays cheap. The app holds no stored bytes: `LocalStore` keeps
   * parsed documents, so the raw view is the parsed session re-serialized.
   * The card text does not claim otherwise. An unloaded shard or a missing
   * session returns empty, and the row falls back to its own facts.
   * REQUIREMENTS 6.9.
   */
  function rawJsonFor(summary: SessionSummary): string {
    const { coordinator } = $services;
    if (coordinator === null) return '';
    const doc = coordinator.peek(summary.shardName) as
      { sessions?: Record<string, unknown> }
      | undefined;
    const session = doc?.sessions?.[summary.id];
    return session === undefined ? '' : JSON.stringify(session, null, 2);
  }

  const model = $derived.by(() => {
    const { lookup, staticData } = $services;
    if (lookup === null) return null;

    const active = lookup.listActiveSessions();
    const terminal = lookup.index.terminalSessions;

    // The most recent terminal session per workout, for the 'Last:' line. The
    // index is newest first, so the first hit for an id is the latest one.
    const lastPerformed = new Map<string, string>();
    for (const summary of terminal) {
      if (!lastPerformed.has(summary.workoutId)) {
        lastPerformed.set(summary.workoutId, summary.startedAtUtc);
      }
    }

    const workouts = staticData ? [...staticData.workoutById.values()] : [];

    return buildChooserModel({
      active,
      recent: terminal,
      nowUtc: nowUtc(),
      localTimeZone: resolveLocalTimeZone(),
      knownWorkoutIds: staticData
        ? new Set(staticData.workoutById.keys())
        : undefined,
      workouts,
      workoutOffset,
      workoutLimit: WORKOUT_STEP,
      lastPerformedUtcByWorkoutId: lastPerformed,
      recentLimit,
      rawJsonFor
    });
  });

  function loadOlder(): void {
    recentLimit += RECENT_STEP;
  }

  function showMoreWorkouts(): void {
    workoutOffset += WORKOUT_STEP;
  }
</script>

<div class="screen chooser">
  {#if model === null}
    <p class="chooser__loading" role="status">Loading your workouts…</p>
  {:else}
    {#if model.active.length > 0}
      <section class="chooser__section" aria-labelledby="chooser-in-progress">
        <h2 class="chooser__heading" id="chooser-in-progress">In progress</h2>
        <div class="chooser__list">
          {#each model.active as item (item.sessionId)}
            <SessionListItem {item} />
          {/each}
        </div>
      </section>
    {/if}

    <section class="chooser__section" aria-labelledby="chooser-workouts">
      <h2 class="chooser__heading" id="chooser-workouts">Workouts</h2>
      {#if model.workouts.length === 0}
        <p class="chooser__empty" role="status">
          This build has no workouts. REP JOT loads them from its bundled data.
        </p>
      {:else}
        <div class="chooser__list">
          {#each model.workouts as workout (workout.workoutId)}
            <a class="workout-row" href={workout.href}>
              <span class="workout-row__name">{workout.name}</span>
              {#if workout.lastPerformedLabel !== undefined}
                <span class="workout-row__last">{workout.lastPerformedLabel}</span>
              {/if}
            </a>
          {/each}
        </div>
        {#if model.workoutsHasMore}
          <div class="chooser__more">
            <button class="btn btn--secondary" type="button" onclick={showMoreWorkouts}>
              Show more workouts
            </button>
          </div>
        {/if}
      {/if}
    </section>

    <section class="chooser__section" aria-labelledby="chooser-recent">
      <h2 class="chooser__heading" id="chooser-recent">Recent</h2>
      {#if model.recent.length === 0}
        <p class="chooser__empty" role="status">
          No finished workouts yet. Pick a workout above to start your first one.
        </p>
      {:else}
        <div class="chooser__list">
          {#each model.recent as item (item.sessionId)}
            <SessionListItem {item} />
          {/each}
        </div>
        {#if model.hasMore}
          <div class="chooser__more">
            <button class="btn btn--secondary" type="button" onclick={loadOlder}>
              Load older
            </button>
          </div>
        {/if}
      {/if}
    </section>
  {/if}
</div>
