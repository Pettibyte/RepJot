<!--
  The workout overview.
  REQUIREMENTS 17.6-17.9, PHASE-16.

  The programmed tree, read-only, with one action: **Start Workout**. The user
  reads the whole session before committing to it, which is the point of the
  screen and the reason it is not merged into the active workout.

  Starting creates the session and moves to the active route. The active screen
  belongs to Phase 17, so that route renders the typed not-found state in this
  build. The session still exists and resumes from the chooser, so the action
  is never a dead end.

  An unknown workout id renders not-found rather than an empty tree, because an
  empty tree reads as a workout with nothing in it.
-->
<script lang="ts">
  import Button from '../components/Button.svelte';
  import WorkoutTreeReadOnly from '../components/WorkoutTreeReadOnly.svelte';
  import { services } from '../../services/registry';
  import { buildOverviewModel } from '../viewmodels/overviewModel';
  import { getRouter } from '../../routing/router-registry';
  import { formatRoute } from '../../routing/routes';

  let { workoutId = '' }: { workoutId?: string } = $props();

  /** True while the start call is in flight, so the button cannot fire twice. */
  let starting = $state(false);

  /** Start failure text. Empty means nothing to report. */
  let startError = $state('');

  const workout = $derived($services.lookup ? $services.lookup.getWorkout(workoutId) : undefined);

  const model = $derived(
    buildOverviewModel(workout, {
      exerciseById: $services.staticData?.exerciseById ?? new Map(),
      // The Last Time badge reads the same index the chooser reads. Absent
      // with no account, and the tree draws no badges. REQUIREMENTS 19.3.
      lookup: $services.lookup
    })
  );

  async function startWorkout(): Promise<void> {
    const { sessionService } = $services;
    if (sessionService === null || starting) return;
    starting = true;
    startError = '';
    try {
      const session = await sessionService.start(workoutId);
      getRouter()?.navigate({ name: 'session-active', sessionId: session.id });
    } catch (error) {
      // The message is the AppError's safe text. It names the failure family and
      // carries no token, note, or measurement. REQUIREMENTS 15.6.
      startError = error instanceof Error ? error.message : 'REP JOT could not start this workout.';
    } finally {
      starting = false;
    }
  }
</script>

<div class="screen screen--narrow overview">
  {#if model === null}
    <h1 class="overview__missing-title">No workout with that id</h1>
    <p class="overview__missing-detail">
      REP JOT does not have a workout called <code class="overview__id">{workoutId}</code> in this
      build.
    </p>
    <div class="overview__actions">
      <Button variant="primary" href={formatRoute({ name: 'home' })}>Back to workouts</Button>
    </div>
  {:else}
    <!--
      One start control, drawn twice. A long programmed tree pushes the foot
      copy past the fold on a Kindle screen, so the same button rides beside
      the title too. Both copies read one `starting` guard and call one
      handler, so neither can start a session twice. REQUIREMENTS 18.2.
    -->
    {#snippet startButton()}
      <Button
        variant="primary"
        block
        icon="play_arrow"
        disabled={starting || $services.sessionService === null}
        onclick={() => void startWorkout()}
      >
        {starting ? 'Starting…' : 'Start Workout'}
      </Button>
    {/snippet}

    <header class="overview__header">
      <h1 class="overview__title">{model.title}</h1>
      {#if model.notes !== undefined}
        <p class="overview__notes">{model.notes}</p>
      {/if}
    </header>

    <div class="overview__actions overview__actions--top">{@render startButton()}</div>

    <WorkoutTreeReadOnly nodes={model.nodes} blocks={model.blocks} idPrefix="overview" />

    {#if startError !== ''}
      <p class="overview__error" role="alert">{startError}</p>
    {/if}

    <div class="overview__actions">{@render startButton()}</div>

    {#if $services.sessionService === null}
      <p class="overview__hint" role="status">
        REP JOT is not connected to your Drive folder, so it cannot start a workout.
      </p>
    {/if}
  {/if}
</div>
