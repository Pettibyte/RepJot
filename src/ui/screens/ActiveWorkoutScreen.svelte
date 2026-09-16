<!--
  The Active Workout screen.
  Phase 17. REQUIREMENTS 11.1-11.22, 12.4-12.7, 19.1-19.10. ARCHITECTURE §9.

  This is where a workout gets recorded. The screen owns four things and no
  more: the loaded session, the draft edits made since the last save, the
  container actions, and the finish flow. Every read goes through the view
  model; every write goes through `SessionService`. The screen never touches
  a document, a store, or Drive.

  Drafts are held apart from the model on purpose. The model is saved state
  plus prescription. The drafts are what the user typed. Merging them only
  at render time means a save can rebuild the model from storage without
  wiping the field the user is still typing in.

  Saving. Input events queue the current row while the field stays focused.
  A field blur flushes those edits to local storage. Drive uses a separate
  quiet period, so field changes do not start one reconciliation each.
  `flushOnBlur` from that module is not used here because DOM `blur` does not
  bubble, so a listener on the screen root would never fire for a child
  input. The row's own blur handler is the trigger.

  A route change flushes through the router's `beforeRouteChange` hook, which
  `bootstrap` already wires to `coordinator.flush()`. Back navigation from
  this screen therefore leaves the session `in_progress` with the edits
  durable, which is REQUIREMENT 11.11.

  A finished session stays editable. REQUIREMENT 11.16 says a completed or
  abandoned session opens in this same editor so the user can correct a
  value, and the session service holds `status` and the workout timestamps
  still on every ordinary write. What a finished session does not get is the
  finish bar, because a terminal status cannot be written twice.
-->
<script lang="ts">
  import { tick } from 'svelte';
  import Button from '../components/Button.svelte';
  import WorkoutTreeEditable from '../components/WorkoutTreeEditable.svelte';
  import AmrapControls from '../components/AmrapControls.svelte';
  import EmomControls from '../components/EmomControls.svelte';
  import ContainerScoreEditor from '../components/ContainerScoreEditor.svelte';
  import AggregateExpander from '../components/AggregateExpander.svelte';
  import FinishWorkoutBar from '../components/FinishWorkoutBar.svelte';
  import { publishServices, services } from '../../services/registry';
  import { getRouter } from '../../routing/router-registry';
  import {
    buildActiveWorkoutModel,
    fieldDisplay,
    fieldInputError,
    tapUnitPill,
    type ActiveExerciseRow,
    type ActiveWorkoutModel,
    type GroupModel,
  } from '../viewmodels/activeWorkoutModel';
  import type { DraftChild } from '../../sessions/draft-expansion';
  import type { MissingWorkItem } from '../../sessions/session-service';
  import { isBlankExerciseDraft, type ExerciseResultDraft } from '../../sessions/drafts';
  import type { EffortOutcome, Session } from '../../domain/types';
  import {
    amrapPartialScore,
    buildRowDraft,
    effortFromChoice,
    finishPlan,
    scoreFromText,
    terminalActionsAllowed,
    wholeCountError
  } from './activeWorkoutActions';
  import type { ReasonCode, ResultStatus, Side, StartingSide } from '../../domain/enums';
  import { containerResultKey, type PathSegment } from '../../domain/execution-path';

  let { sessionId = '' }: { sessionId?: string } = $props();

  /** The loaded session. Null until the first load resolves. */
  let session = $state<Session | null>(null);
  /** True while the session load is in flight. */
  let loading = $state(false);
  /** Load or save failure text. Empty means nothing to report. */
  let errorText = $state('');

  /** Draft field text, keyed by row key then by dimension. */
  let overrides = $state<Record<string, Record<string, string>>>({});
  /** Inline field errors, keyed by row key then by dimension. */
  let fieldErrors = $state<Record<string, Record<string, string>>>({});
  /** Inline scored-container errors, keyed by group key. */
  let containerErrors = $state<Record<string, string>>({});
  /** Draft status keyed by row key. Absent means the model's status. */
  let statusDrafts = $state<Record<string, ResultStatus>>({});
  /** Draft reason code keyed by row key. */
  let reasonDrafts = $state<Record<string, ReasonCode>>({});
  /** Draft side keyed by row key. */
  let sideDrafts = $state<Record<string, Side>>({});
  /** Draft starting side keyed by row key. */
  let startingSideDrafts = $state<Record<string, StartingSide>>({});
  /** Draft effort choice keyed by row key. Empty string clears the effort. */
  let effortDrafts = $state<Record<string, string>>({});
  /** Draft container score text keyed by group key. */
  let containerDrafts = $state<Record<string, string>>({});
  /** Draft extra-reps text keyed by AMRAP group key. */
  let amrapPartialDrafts = $state<Record<string, string>>({});
  /** Draft completed-interval text keyed by EMOM group key. */
  let emomDrafts = $state<Record<string, string>>({});

  /** Inferred draft sets keyed by group key, loaded on demand. */
  let inferredDrafts = $state<Record<string, DraftChild[]>>({});
  /** Group keys whose inferred list is open. */
  let expandedGroups = $state<Record<string, boolean>>({});

  /** Missing-work items behind the finish prompt. */
  let missingItems = $state<MissingWorkItem[]>([]);
  /** True while the missing-work prompt is showing. */
  let promptOpen = $state(false);
  /** True while a container or terminal action is in flight. */
  let busy = $state(false);

  const model = $derived.by((): ActiveWorkoutModel | null => {
    const { lookup, staticData, preferences } = $services;
    if (session === null || lookup === null || staticData === null || preferences === null) {
      return null;
    }
    const workout = staticData.workoutById.get(session.workoutId);
    if (workout === undefined) return null;
    return buildActiveWorkoutModel({ workout, session, staticData, preferences, lookup });
  });

  /** Rows indexed by key, so a handler resolves its row in one read. */
  const rowsByKey = $derived(
    new Map<string, ActiveExerciseRow>((model?.rows ?? []).map((row) => [row.key, row]))
  );

  /** The session ended, so no terminal action may run again. */
  const isTerminal = $derived(!terminalActionsAllowed(session?.status ?? 'in_progress'));

  /** What the finish bar shows right now. */
  const finish = $derived(finishPlan(missingItems, promptOpen));
  const missingRowKeys = $derived(missingItems.map((item) => item.rowKey));

  const sessionService = $derived($services.sessionService);

  /** Draft text for one row, keyed by dimension. */
  function overridesFor(row: ActiveExerciseRow): Record<string, string> {
    return overrides[row.key] ?? {};
  }

  function reasonFor(row: ActiveExerciseRow): ReasonCode | undefined {
    if (Object.prototype.hasOwnProperty.call(reasonDrafts, row.key)) {
      return reasonDrafts[row.key];
    }
    return row.reasonCode;
  }

  /**
   * The draft effort for one row.
   *
   * An absent draft returns `undefined`, which leaves the row's own effort
   * in place. A draft of `''` returns `null`, which clears it. The two are
   * different states and must not collapse.
   */
  function effortFor(row: ActiveExerciseRow): EffortOutcome | null | undefined {
    if (!Object.prototype.hasOwnProperty.call(effortDrafts, row.key)) return undefined;
    return effortFromChoice(row.effortTarget, effortDrafts[row.key] ?? '');
  }

  /**
   * Build the exercise draft one row writes.
   *
   * The rules live in `activeWorkoutActions` so they get proved without a
   * browser. This only supplies the screen's draft state.
   */
  function draftForRow(row: ActiveExerciseRow): ExerciseResultDraft {
    return buildRowDraft({
      workoutId: session?.workoutId ?? '',
      row,
      overrides: overridesFor(row),
      status: statusDrafts[row.key],
      reasonCode: reasonFor(row),
      side: sideDrafts[row.key],
      startingSide: startingSideDrafts[row.key],
      effort: effortFor(row)
    });
  }

  /**
   * Queue one row's save and flush it.
   *
   * The flush makes the value durable before the user can leave the screen.
   * Drive synchronization keeps its separate quiet period, so blur never
   * waits for or directly starts a network cycle.
   */
  function queueAndFlush(row: ActiveExerciseRow): void {
    const service = sessionService;
    if (service === null || session === null || row.resultKey === null) return;
    const draft = draftForRow(row);
    if (isBlankExerciseDraft(draft)) {
      service.queueClearExerciseResult(session.id, row.resultKey, row.path);
      const targetId = session.id;
      void service.queueFlush().then(async () => {
        session = await service.load(targetId);
      }).catch((error: unknown) => {
        errorText = error instanceof Error ? error.message : 'REP JOT could not save that value.';
      });
      return;
    }
    service.queueSaveExerciseResult(session.id, draft);
    const targetId = session.id;
    void service
      .queueFlush()
      .then(async () => {
        session = await service.load(targetId);
      })
      .catch((error: unknown) => {
        errorText = error instanceof Error ? error.message : 'REP JOT could not save that value.';
      });
  }

  function validateRow(row: ActiveExerciseRow): boolean {
    const next: Record<string, string> = {};
    const rowOverrides = overridesFor(row);
    for (const field of row.fields) {
      if (!Object.prototype.hasOwnProperty.call(rowOverrides, field.dimension)) continue;
      const message = fieldInputError(field, rowOverrides[field.dimension] ?? '');
      if (message !== undefined) next[field.dimension] = message;
    }
    if (Object.keys(next).length === 0) delete fieldErrors[row.key];
    else fieldErrors[row.key] = next;
    return Object.keys(next).length === 0;
  }

  function restoreRowAfterInvalid(row: ActiveExerciseRow): void {
    const service = sessionService;
    if (service === null || session === null || row.resultKey === null) return;
    if (row.hasSavedResult) {
      service.queueSaveExerciseResult(
        session.id,
        buildRowDraft({ workoutId: session.workoutId, row, overrides: {} })
      );
    } else {
      service.queueClearExerciseResult(session.id, row.resultKey, row.path);
    }
  }

  function onFieldChange(rowKey: string, dimension: string, value: string): void {
    const forRow = overrides[rowKey] ?? {};
    forRow[dimension] = value;
    overrides[rowKey] = forRow;

    const service = sessionService;
    const row = rowsByKey.get(rowKey);
    if (service === null || session === null || row === undefined) return;
    if (!validateRow(row)) {
      restoreRowAfterInvalid(row);
      return;
    }
    const draft = draftForRow(row);
    if (isBlankExerciseDraft(draft)) {
      if (row.resultKey !== null) {
        service.queueClearExerciseResult(session.id, row.resultKey, row.path);
      }
      return;
    }
    service.queueSaveExerciseResult(session.id, draft);
  }

  function onFieldBlur(rowKey: string): void {
    const row = rowsByKey.get(rowKey);
    if (row === undefined || !validateRow(row)) return;
    queueAndFlush(row);
  }

  function onStatusChange(rowKey: string, status: ResultStatus): void {
    statusDrafts[rowKey] = status;
    if (status === 'completed') delete reasonDrafts[rowKey];
    const row = rowsByKey.get(rowKey);
    if (row !== undefined) queueAndFlush(row);
  }

  function onReasonChange(rowKey: string, reason: ReasonCode): void {
    reasonDrafts[rowKey] = reason;
    const row = rowsByKey.get(rowKey);
    if (row !== undefined) queueAndFlush(row);
  }

  /**
   * Change the side one row records.
   *
   * The side is part of the result key, so a side change moves the set to
   * a different key. The old key is cleared first, otherwise a `left` set
   * edited to `right` would leave the `left` result behind and read as two
   * recorded sets. REQUIREMENTS 11.5, 22.4.7.
   */
  async function onSideChange(rowKey: string, nextSide: Side): Promise<void> {
    const service = sessionService;
    const row = rowsByKey.get(rowKey);
    if (service === null || session === null || row === undefined) return;
    if (row.resultKey === null) return;

    const previousKey = row.resultKey;
    const previousSide = row.side;
    sideDrafts[rowKey] = nextSide;
    if (nextSide !== 'alternating') delete startingSideDrafts[rowKey];

    const draft = draftForRow(row);
    try {
      await service.queueFlush();
      if (isBlankExerciseDraft(draft)) {
        session = await service.load(session.id);
        return;
      }
      if (row.hasSavedResult && previousSide !== nextSide) {
        await service.moveExerciseResult(session.id, previousKey, draft);
      } else {
        await service.saveExerciseResult(session.id, draft);
      }
      session = await service.load(session.id);
    } catch (error: unknown) {
      errorText = error instanceof Error ? error.message : 'REP JOT could not save that value.';
    }
  }

  /** Change the side an alternating set starts on. */
  async function onStartingChange(rowKey: string, next: StartingSide): Promise<void> {
    startingSideDrafts[rowKey] = next;
    const row = rowsByKey.get(rowKey);
    if (row === undefined) return;
    // Re-save on the side the row already records, draft first, so a
    // starting-side change never reverts a side the user just picked.
    await onSideChange(rowKey, sideDrafts[rowKey] ?? row.side);
  }

  /** Record or clear the effort one row carries. */
  function onEffortChange(rowKey: string, choice: string): void {
    effortDrafts[rowKey] = choice;
    const row = rowsByKey.get(rowKey);
    if (row !== undefined) queueAndFlush(row);
  }

  /**
   * Open one more attempt on a row.
   *
   * The service copies the identity of the attempt it follows and opens
   * the new one with no values, so a fresh row appears with empty fields.
   * REQUIREMENT 19.9.
   */
  async function onAddAttempt(rowKey: string): Promise<void> {
    const service = sessionService;
    const row = rowsByKey.get(rowKey);
    if (service === null || session === null || busy) return;
    if (row === undefined || row.resultKey === null) return;
    busy = true;
    try {
      await service.queueFlush();
      await service.addAttempt(session.id, row.resultKey);
      session = await service.load(session.id);
    } catch (error: unknown) {
      errorText = error instanceof Error ? error.message : 'REP JOT could not add that attempt.';
    } finally {
      busy = false;
    }
  }

  /**
   * Handle a unit-pill tap.
   *
   * The preference write and the display conversion happen together through
   * `tapUnitPill`, so the field cannot end up showing a unit the service
   * refused to save.
   *
   * The stored result is deliberately not rewritten here. REQUIREMENT 12.6
   * says display rounding does not change the full-precision saved value
   * unless the user edits the displayed number, and a pill tap is not an
   * edit of the number. The converted text sits in the draft, and the next
   * blur is what records it — in the unit the user is looking at.
   */
  async function onUnitChange(rowKey: string, dimension: string): Promise<void> {
    const row = rowsByKey.get(rowKey);
    const preferences = $services.preferences;
    if (row === undefined || preferences === null) return;
    const field = row.fields.find((candidate) => candidate.dimension === dimension);
    if (field === undefined) return;

    const exercise = $services.staticData?.exerciseById.get(row.exerciseId);
    const display = fieldDisplay(field, overridesFor(row));
    const message = fieldInputError(field, display);
    if (message !== undefined) {
      fieldErrors[rowKey] = { ...(fieldErrors[rowKey] ?? {}), [dimension]: message };
      await focusById(`active-${row.key}-${dimension}`);
      return;
    }
    const result = await tapUnitPill({
      exercise,
      dimension: field.dimension,
      currentUnit: field.unit,
      display,
      preferences
    });
    if (result.nextUnit === null) return;
    const forRow = overrides[rowKey] ?? {};
    forRow[field.dimension] = result.display;
    overrides[rowKey] = forRow;

    // PreferenceService keeps its working document outside Svelte state. Tell
    // the registry that the existing service changed so `model` rebuilds with
    // the new unit. Without this, only the number changes and the pill keeps
    // the old label; another tap then converts the number a second time from
    // that stale unit.
    publishServices();
  }

  /** The container result key for one group, as the session stores it. */
  function containerKeyFor(group: GroupModel): string {
    return containerResultKey(group.storedPath);
  }

  /** Add one completed round under an AMRAP container. */
  async function addAmrapRound(group: GroupModel): Promise<void> {
    const service = sessionService;
    if (service === null || session === null || busy) return;
    busy = true;
    try {
      await service.queueFlush();
      await service.addAmrapRound(session.id, group.storedPath);
      session = await service.load(session.id);
    } catch (error: unknown) {
      errorText = error instanceof Error ? error.message : 'REP JOT could not add that round.';
    } finally {
      busy = false;
    }
  }

  /** Load the inferred draft set behind an aggregate-only container. */
  async function expandAggregate(group: GroupModel): Promise<void> {
    const service = sessionService;
    if (service === null || session === null || busy) return;
    busy = true;
    try {
      inferredDrafts[group.key] = await service.expandAggregate(session.id, containerKeyFor(group));
      expandedGroups[group.key] = true;
    } catch (error: unknown) {
      errorText = error instanceof Error ? error.message : 'REP JOT could not expand that block.';
    } finally {
      busy = false;
    }
  }

  /**
   * Save the inferred drafts.
   *
   * Each draft becomes a recorded result here, and the session service then
   * treats child detail as authoritative for the container score.
   * REQUIREMENTS 10.16, 10.17.
   */
  async function saveInferred(group: GroupModel): Promise<void> {
    const service = sessionService;
    const drafts = inferredDrafts[group.key] ?? [];
    if (service === null || session === null || busy) return;
    busy = true;
    try {
      await service.queueFlush();
      await service.saveExerciseResults(
        session.id,
        drafts.map((entry: DraftChild): ExerciseResultDraft => entry.draft)
      );
      delete inferredDrafts[group.key];
      delete expandedGroups[group.key];
      session = await service.load(session.id);
    } catch (error: unknown) {
      errorText = error instanceof Error ? error.message : 'REP JOT could not save that detail.';
    } finally {
      busy = false;
    }
  }

  function validateContainer(group: GroupModel, text: string): boolean {
    const message = wholeCountError(text);
    if (message === undefined) delete containerErrors[group.key];
    else containerErrors[group.key] = message;
    return message === undefined;
  }

  function restoreContainerAfterInvalid(group: GroupModel): void {
    const service = sessionService;
    if (service === null || session === null) return;
    if (group.score !== undefined) {
      service.queueSetContainerScore(session.id, {
        workoutId: session.workoutId,
        executionPath: group.storedPath,
        status: 'completed',
        score: group.score
      });
    } else {
      service.queueClearContainerResult(session.id, containerKeyFor(group));
    }
  }

  /** Queue a typed container score while its field is focused. */
  function queueContainerScore(group: GroupModel, text: string): void {
    const service = sessionService;
    if (
      service === null ||
      session === null ||
      group.scoreType === undefined
    ) return;
    if (!validateContainer(group, text)) {
      restoreContainerAfterInvalid(group);
      return;
    }
    const trimmed = text.trim();
    if (trimmed === '') {
      service.queueClearContainerResult(session.id, containerKeyFor(group));
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || parsed < 0) return;
    const score = scoreFromText(group.scoreType, parsed, group.totalIntervals);
    if (score === null) return;
    service.queueSetContainerScore(session.id, {
      workoutId: session.workoutId,
      executionPath: group.storedPath,
      status: 'completed',
      score
    });
  }

  /** Save a typed container score. */
  async function saveContainerScore(group: GroupModel, text: string): Promise<void> {
    const service = sessionService;
    if (
      service === null ||
      session === null ||
      group.scoreType === undefined ||
      !validateContainer(group, text)
    ) return;
    queueContainerScore(group, text);
    try {
      await service.queueFlush();
      session = await service.load(session.id);
    } catch (error: unknown) {
      errorText = error instanceof Error ? error.message : 'REP JOT could not save that score.';
    }
  }

  /** Queue AMRAP extra reps while the field is focused. */
  function queueAmrapPartial(group: GroupModel, text: string): void {
    const service = sessionService;
    if (
      service === null ||
      session === null ||
      group.scoreType !== 'rounds_and_reps'
    ) return;
    if (!validateContainer(group, text)) {
      restoreContainerAfterInvalid(group);
      return;
    }
    const trimmed = text.trim();
    if (trimmed === '') {
      service.queueClearContainerResult(session.id, containerKeyFor(group));
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || parsed < 0) return;
    service.queueSetContainerScore(session.id, {
      workoutId: session.workoutId,
      executionPath: group.storedPath,
      status: 'completed',
      score: amrapPartialScore(group.score, parsed)
    });
  }

  /** Save the AMRAP extra-reps field. */
  async function saveAmrapPartial(group: GroupModel, text: string): Promise<void> {
    const service = sessionService;
    if (
      service === null ||
      session === null ||
      group.scoreType !== 'rounds_and_reps' ||
      !validateContainer(group, text)
    ) return;
    queueAmrapPartial(group, text);
    try {
      await service.queueFlush();
      session = await service.load(session.id);
    } catch (error: unknown) {
      errorText = error instanceof Error ? error.message : 'REP JOT could not save that score.';
    }
  }

  function containerInputId(group: GroupModel): string {
    if (group.isAmrap) return `${group.key}-partial`;
    if (group.isEmom) return `${group.key}-intervals`;
    return `${group.key}-score`;
  }

  async function focusById(id: string): Promise<void> {
    await tick();
    const target = document.getElementById(id);
    target?.scrollIntoView?.({ block: 'center' });
    target?.focus();
  }

  async function focusMissingRow(rowKey: string): Promise<void> {
    await tick();
    const row = document.getElementById(`active-${rowKey}-row`);
    const target = row?.querySelector<HTMLElement>('input:not(:disabled), select:not(:disabled)') ?? row;
    target?.scrollIntoView?.({ block: 'center' });
    target?.focus();
  }

  async function validateBeforeFinish(): Promise<boolean> {
    let firstInvalidId = '';
    for (const row of model?.rows ?? []) {
      if (!validateRow(row) && firstInvalidId === '') {
        const dimension = row.fields.find(
          (field) => fieldErrors[row.key]?.[field.dimension] !== undefined
        )?.dimension;
        if (dimension !== undefined) firstInvalidId = `active-${row.key}-${dimension}`;
      }
    }
    for (const group of model?.groups ?? []) {
      let text: string | undefined;
      if (group.isAmrap && Object.prototype.hasOwnProperty.call(amrapPartialDrafts, group.key)) {
        text = amrapPartialDrafts[group.key];
      } else if (group.isEmom && Object.prototype.hasOwnProperty.call(emomDrafts, group.key)) {
        text = emomDrafts[group.key];
      } else if (Object.prototype.hasOwnProperty.call(containerDrafts, group.key)) {
        text = containerDrafts[group.key];
      }
      if (text !== undefined && !validateContainer(group, text) && firstInvalidId === '') {
        firstInvalidId = containerInputId(group);
      }
    }
    if (firstInvalidId === '') return true;
    errorText = 'Correct the highlighted value before you finish the workout.';
    await focusById(firstInvalidId);
    return false;
  }

  /**
   * Finish Workout.
   *
   * The missing-work report runs first. If anything prescribed is missing the
   * prompt opens and nothing is written, so the user sees the gaps before the
   * session becomes terminal. REQUIREMENT 11.15.
   */
  async function finishWorkout(): Promise<void> {
    const service = sessionService;
    if (service === null || session === null || busy) return;
    if (!(await validateBeforeFinish())) return;
    busy = true;
    try {
      await service.queueFlush();
      const report = await service.reportMissingWork(session.id);
      if (report.hasMissingWork) {
        missingItems = report.items;
        promptOpen = true;
        return;
      }
      await service.complete(session.id);
      getRouter()?.navigate({ name: 'session-summary', sessionId: session.id });
    } catch (error: unknown) {
      errorText = error instanceof Error ? error.message : 'REP JOT could not finish the workout.';
    } finally {
      busy = false;
    }
  }

  /** Finish with the gaps left as recorded. */
  async function finishIncomplete(): Promise<void> {
    const service = sessionService;
    if (service === null || session === null || busy) return;
    if (!(await validateBeforeFinish())) return;
    busy = true;
    promptOpen = false;
    try {
      await service.queueFlush();
      await service.complete(session.id);
      getRouter()?.navigate({ name: 'session-summary', sessionId: session.id });
    } catch (error: unknown) {
      errorText = error instanceof Error ? error.message : 'REP JOT could not finish the workout.';
    } finally {
      busy = false;
    }
  }

  /** Abandon the session and leave it in History. */
  async function abandonWorkout(): Promise<void> {
    const service = sessionService;
    if (service === null || session === null || busy) return;
    busy = true;
    try {
      await service.queueFlush();
      await service.abandon(session.id, 'user_skipped');
      getRouter()?.navigate({ name: 'home' });
    } catch (error: unknown) {
      errorText = error instanceof Error
        ? error.message
        : 'REP JOT could not abandon the workout.';
    } finally {
      busy = false;
    }
  }

  /** Load the session on mount and whenever the id changes. */
  $effect(() => {
    const service = sessionService;
    if (service === null || sessionId === '') return;
    if (session !== null && session.id === sessionId) return;
    loading = true;
    errorText = '';
    void service
      .load(sessionId)
      .then((loaded: Session) => {
        session = loaded;
      })
      .catch((error: unknown) => {
        errorText = error instanceof Error ? error.message : 'REP JOT could not open that workout.';
      })
      .finally(() => {
        loading = false;
      });
  });
</script>

<div class="screen screen--narrow active-workout">
  {#if loading && session === null}
    <p class="active-workout__loading" role="status">Loading your workout…</p>
  {:else if model === null}
    <h1 class="active-workout__missing-title">This workout is not available</h1>
    <p class="active-workout__missing-detail">
      {errorText === ''
        ? 'REP JOT could not resolve this session against its current data.'
        : errorText}
    </p>
    <div class="active-workout__actions">
      <Button variant="primary" href="#/">Back to workouts</Button>
    </div>
  {:else}
    <WorkoutTreeEditable
      blocks={model.blocks}
      idPrefix="active"
      rowOverrides={overrides}
      rowFieldErrors={fieldErrors}
      {missingRowKeys}
      {statusDrafts}
      {sideDrafts}
      {startingSideDrafts}
      {effortDrafts}
      {busy}
      disabled={sessionService === null}
      onfieldchange={onFieldChange}
      onfieldblur={onFieldBlur}
      onstatuschange={onStatusChange}
      onreasonchange={onReasonChange}
      onunitchange={(rowKey, dimension) => void onUnitChange(rowKey, dimension)}
      onsidechange={(rowKey, nextSide) => void onSideChange(rowKey, nextSide)}
      onstartingchange={(rowKey, next) => void onStartingChange(rowKey, next)}
      oneffortchange={onEffortChange}
      onaddattempt={(rowKey) => void onAddAttempt(rowKey)}
    />

    <div class="active-workout__containers">
      {#each model.groups as group (group.key)}
        {#if group.scored && group.isAmrap}
          <section class="active-workout__block" aria-label="{group.title} controls">
            <h3 class="active-workout__block-title">{group.title}</h3>
            <AmrapControls
              {group}
              additionalReps={amrapPartialDrafts[group.key] ?? ''}
              disabled={sessionService === null}
              {busy}
              error={containerErrors[group.key]}
              onaddround={() => void addAmrapRound(group)}
              onpartialchange={(event: Event) => {
                const target = event.target as HTMLInputElement;
                amrapPartialDrafts[group.key] = target.value;
                queueAmrapPartial(group, target.value);
              }}
              onpartialblur={() => void saveAmrapPartial(group, amrapPartialDrafts[group.key] ?? '')}
            />
          </section>
        {:else if group.scored && group.isEmom}
          <section class="active-workout__block" aria-label="{group.title} controls">
            <h3 class="active-workout__block-title">{group.title}</h3>
            <EmomControls
              {group}
              completed={emomDrafts[group.key] ?? ''}
              disabled={sessionService === null}
              error={containerErrors[group.key]}
              onchange={(event: Event) => {
                const target = event.target as HTMLInputElement;
                emomDrafts[group.key] = target.value;
                queueContainerScore(group, target.value);
              }}
              onblur={() => void saveContainerScore(group, emomDrafts[group.key] ?? '')}
            />
          </section>
        {:else if group.scored && group.scoreType !== undefined}
          <section class="active-workout__block" aria-label="{group.title} score">
            <h3 class="active-workout__block-title">{group.title}</h3>
            <ContainerScoreEditor
              {group}
              scoreText={containerDrafts[group.key] ?? ''}
              disabled={sessionService === null}
              error={containerErrors[group.key]}
              onscorechange={(event: Event) => {
                const target = event.target as HTMLInputElement;
                containerDrafts[group.key] = target.value;
                queueContainerScore(group, target.value);
              }}
              onscoreblur={() => void saveContainerScore(group, containerDrafts[group.key] ?? '')}
            />
          </section>
        {/if}

        {#if group.canExpand}
          <section class="active-workout__block" aria-label="{group.title} detail">
            <AggregateExpander
              {group}
              drafts={inferredDrafts[group.key] ?? []}
              expanded={expandedGroups[group.key] === true}
              disabled={sessionService === null}
              {busy}
              onexpand={() => void expandAggregate(group)}
              onsave={() => void saveInferred(group)}
            />
          </section>
        {/if}
      {/each}
    </div>

    {#if errorText !== ''}
      <p class="active-workout__error" role="alert">{errorText}</p>
    {/if}

    {#if isTerminal}
      <p class="active-workout__hint" role="status">
        This workout ended as {session?.status}. You can still correct a value
        here; the status and the workout times stay as they are.
      </p>
    {:else}
      <FinishWorkoutBar
        missing={finish.items}
        promptOpen={finish.showPrompt}
        disabled={sessionService === null}
        {busy}
        onFinish={() => void finishWorkout()}
        onReturn={() => {
          promptOpen = false;
          const first = missingItems[0];
          if (first !== undefined) void focusMissingRow(first.rowKey);
        }}
        onFinishIncomplete={() => void finishIncomplete()}
        onAbandon={() => void abandonWorkout()}
      />
    {/if}

    {#if sessionService === null}
      <p class="active-workout__hint" role="status">
        REP JOT is not connected to your Drive folder, so it cannot record this
        workout.
      </p>
    {/if}
  {/if}
</div>
