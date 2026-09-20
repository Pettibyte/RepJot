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
  import StatusLabel from '../components/StatusLabel.svelte';
  import { services } from '../../services/registry';
  import { getRouter } from '../../routing/router-registry';
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
  /** True after the user asks to delete, before the second confirmation. */
  let deleteOpen = $state(false);
  /** True while the session removal is being saved locally. */
  let deleteBusy = $state(false);
  /** Safe error text from a failed removal. */
  let deleteError = $state('');

  function openDelete(): void {
    deleteError = '';
    deleteOpen = true;
  }

  function cancelDelete(): void {
    if (deleteBusy) return;
    deleteError = '';
    deleteOpen = false;
  }

  async function confirmDelete(): Promise<void> {
    const sessionService = $services.sessionService;
    if (sessionService === null || deleteBusy) return;
    deleteBusy = true;
    deleteError = '';
    try {
      await sessionService.remove(sessionId);
      getRouter()?.navigate({ name: 'history' });
    } catch (error) {
      deleteError = error instanceof Error ? error.message : 'REP JOT could not delete this session.';
    } finally {
      deleteBusy = false;
    }
  }

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
    <header class="summary-screen__head">
      <h1 class="summary-screen__title">{model.title}</h1>
      <p class="summary-screen__meta">
        <StatusLabel class="badge" status={model.status} label={model.statusLabel} />
        {#if model.startedLabel !== ''}
          <span class="summary-screen__date">Started {model.startedLabel}</span>
        {/if}
        {#if model.completedLabel !== ''}
          <span class="summary-screen__date">Finished {model.completedLabel}</span>
        {/if}
      </p>
    </header>

    {#if model.workoutUnresolved}
      <p class="summary-screen__banner">
        This build does not have the workout this session recorded. The values
        below are what the session stored.
      </p>
    {/if}

    {#if model.isEmpty}
      <p class="summary-screen__empty">Nothing was recorded for this session.</p>
    {:else}
      <SummaryTree groups={model.groups} blocks={model.blocks} idPrefix="summary" />
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

    {#if deleteOpen}
      <section class="danger-confirm summary-screen__delete-confirm" aria-label="Delete session">
        <h2 class="danger-confirm__title">Delete this workout?</h2>
        <p class="danger-confirm__warning">
          This removes the recorded session from REP JOT on this device and in Google Drive.
        </p>
        {#if deleteError !== ''}
          <p class="danger-confirm__error" role="alert">{deleteError}</p>
        {/if}
        <div class="danger-confirm__actions">
          <Button variant="secondary" disabled={deleteBusy} onclick={cancelDelete}>Cancel</Button>
          <Button variant="danger" disabled={deleteBusy} onclick={() => void confirmDelete()}>
            {deleteBusy ? 'Deleting…' : 'Delete session'}
          </Button>
        </div>
      </section>
    {/if}

    <div class="summary-screen__actions">
      <Button
        variant="primary"
        href={formatRoute({ name: 'session-active', sessionId })}
      >Edit</Button>
      <Button variant="danger" onclick={openDelete}>Delete</Button>
      <Button variant="secondary" href={formatRoute({ name: 'history' })}>Back to History</Button>
    </div>
  {/if}
</div>
