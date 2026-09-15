<!--
  The Workout Summary screen.
  Phase 18. REQUIREMENTS 6.23, 10.13, 10.18, 20.3. ARCHITECTURE §9.

  One session, read back. The screen shows what the user recorded and offers
  two ways forward: **Edit** reopens the session in the Active Workout editor,
  which REQUIREMENTS 11.16 allows for a finished session, and each exercise
  name links to that exercise's history.

  Everything on the page comes off the stored session. The current workout is
  read only to order the rows and name a container, so a session whose workout
  the bundle no longer carries still shows all of its recorded work. The
  screen says so in a banner instead of rendering an empty page.
  REQUIREMENTS 6.23.

  No draft appears here. A draft lives in the editor's local state and never
  reaches a session document, so this screen has no path to one.

  The session loads through `SessionService.load`, which reads the local
  store first. The screen holds no document of its own and writes nothing.
-->
<script lang="ts">
  import Button from '../components/Button.svelte';
  import DataError from '../components/DataError.svelte';
  import SummaryTree from '../components/SummaryTree.svelte';
  import { services } from '../../services/registry';
  import { formatRoute } from '../../routing/routes';
  import { buildSummaryModel, type SummaryModel } from '../viewmodels/summaryModel';
  import { resolveLocalTimeZone } from '../viewmodels/chooserModel';

  let { sessionId = '' }: { sessionId?: string } = $props();

  /** True while the session load is in flight. */
  let loading = $state(false);
  /** Load failure text. Empty means nothing to report. */
  let errorText = $state('');
  /** The loaded model. Null until the first load resolves. */
  let model = $state<SummaryModel | null>(null);

  /** The local time zone, read once per render pass. */
  const localTimeZone = resolveLocalTimeZone();

  async function loadSummary(): Promise<void> {
    const { sessionService, staticData } = $services;
    if (sessionService === null || staticData === null || sessionId === '') return;
    loading = true;
    errorText = '';
    try {
      const session = await sessionService.load(sessionId);
      if (session === null) {
        model = null;
        errorText = 'REP JOT has no session with that id.';
        return;
      }
      model = buildSummaryModel({
        session,
        staticData,
        localTimeZone,
        nowUtc: new Date().toISOString()
      });
    } catch (error) {
      // The message is the AppError's safe text. It names the failure family
      // and carries no token, note, or measurement. REQUIREMENTS 15.6.
      errorText = error instanceof Error ? error.message : 'REP JOT could not open this session.';
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    void loadSummary();
  });
</script>

<div class="screen screen--narrow summary-screen">
  {#if loading && model === null}
    <p class="summary-screen__loading" role="status">Loading…</p>
  {:else if model === null}
    <h1 class="summary-screen__missing-title">No session to show</h1>
    <p class="summary-screen__missing-detail">{errorText}</p>
    <div class="summary-screen__actions">
      <Button variant="primary" href={formatRoute({ name: 'history' })}>Back to history</Button>
    </div>
  {:else}
    <div class="summary-screen__head">
      <h1 class="summary-screen__title">{model.title}</h1>
      <p class="summary-screen__meta">
        <span class="badge">{model.statusLabel}</span>
        {#if model.startedLabel !== ''}
          <span class="summary-screen__date">Started {model.startedLabel}</span>
        {/if}
        {#if model.completedLabel !== ''}
          <span class="summary-screen__date">Finished {model.completedLabel}</span>
        {/if}
      </p>
    </div>

    {#if model.workoutUnresolved}
      <p class="summary-screen__banner">
        This build does not have the workout this session recorded. The values
        below are what the session stored.
      </p>
    {/if}

    {#if model.isEmpty}
      <p class="summary-screen__empty">Nothing was recorded for this session.</p>
    {:else}
      <SummaryTree groups={model.groups} idPrefix="summary" />
    {/if}

    {#if model.notes !== undefined}
      <section class="summary-screen__notes">
        <h2 class="summary-screen__notes-title">Notes</h2>
        <p class="summary-screen__notes-body">{model.notes}</p>
      </section>
    {/if}

    {#if model.unresolved.length > 0}
      <section class="summary-screen__unresolved">
        <h2 class="summary-screen__notes-title">
          {model.unresolved.length} item{model.unresolved.length === 1 ? '' : 's'} this build cannot
          place
        </h2>
      </section>
    {/if}

    {#if errorText !== ''}
      <DataError
        props={{
          title: 'REP JOT could not open this session',
          family: 'session',
          detail: errorText,
          rawJson: ''
        }}
      />
    {/if}

    <div class="summary-screen__actions">
      <Button
        variant="primary"
        href={formatRoute({ name: 'session-active', sessionId })}
      >Edit</Button>
      <Button variant="secondary" href={formatRoute({ name: 'history' })}>Back to history</Button>
    </div>
  {/if}
</div>
