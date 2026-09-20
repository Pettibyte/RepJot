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
  value. Ordinary writes retain its status and workout timestamps; the
  bottom status chips can correct one terminal status to the other without
  moving those timestamps. What a finished session does not get is the
  finish bar, because it cannot be ended a second time.
-->
<script lang="ts">
  import { tick } from 'svelte';
  import Button from '../components/Button.svelte';
  import ChipGroup from '../components/ChipGroup.svelte';
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
    convertFieldDisplay,
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
    lastTimeFillText,
    scoreFromText,
    terminalActionsAllowed,
    wholeCountError
  } from './activeWorkoutActions';
  import type { ReasonCode, ResultStatus, Side, StartingSide } from '../../domain/enums';
  import { containerResultKey, defaultSideForLaterality, encodePath, exerciseResultKey, type PathSegment } from '../../domain/execution-path';
  import { formatTimeLabel, resolveLocalTimeZone } from '../viewmodels/chooserModel';

  let { sessionId = '' }: { sessionId?: string } = $props();

  /** The loaded session. Null until the first load resolves. */
  let session = $state<Session | null>(null);
  /** True while the session load is in flight. */
  let loading = $state(false);
  /** Load or save failure text. Empty means nothing to report. */
  let errorText = $state('');

  /** Draft field text, keyed by row key then by dimension. */
  let overrides = $state<Record<string, Record<string, string>>>({});
  /** Fields the user edited; unit-only display conversion does not mark these. */
  let editedFields = $state<Record<string, Record<string, boolean>>>({});
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
  /** Which rows have their **Set options** panel open. */
  let openRowPanels = $state<Record<string, boolean>>({});

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

  const startedLabel = $derived(
    session === null
      ? ''
      : formatTimeLabel(session.startedAtUtc, new Date().toISOString(), resolveLocalTimeZone())
  );

  /** What the finish bar shows right now. */
  const finish = $derived(finishPlan(missingItems, promptOpen));
  const missingRowKeys = $derived(missingItems.map((item) => item.rowKey));

  const sessionService = $derived($services.sessionService);

  const terminalStatusOptions = [
    { value: 'completed', label: 'Completed' },
    { value: 'abandoned', label: 'Abandoned' }
  ];

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
      editedFields: editedFields[row.key] ?? {},
      status: statusDrafts[row.key],
      reasonCode: reasonFor(row),
      side: sideDrafts[row.key],
      startingSide: startingSideDrafts[row.key],
      effort: effortFor(row)
    });
  }

  /**
   * Move one per-row draft entry onto a new key, dropping the old one.
   *
   * Silent when the source holds nothing, so a migration never writes an
   * `undefined` entry that later reads as a real draft.
   */
  function moveEntry(map: Record<string, unknown>, from: string, to: string): void {
    if (from === to) return;
    if (!Object.prototype.hasOwnProperty.call(map, from)) return;
    map[to] = map[from];
    delete map[from];
  }

  /**
   * Carry every per-row draft to the row's new key.
   *
   * The side is part of the row key, so picking a different side gives the
   * row a new key. Drafts left under the old key orphan: the value the user
   * just typed stops reaching the row on screen, the edited-field marks
   * vanish so the next save drops the value, and the open panel collapses.
   * That is the whole "I clicked and nothing happened" report.
   */
  function migrateRowDrafts(fromKey: string, toKey: string): void {
    if (fromKey === toKey) return;
    moveEntry(overrides, fromKey, toKey);
    moveEntry(editedFields, fromKey, toKey);
    moveEntry(fieldErrors, fromKey, toKey);
    moveEntry(statusDrafts, fromKey, toKey);
    moveEntry(sideDrafts, fromKey, toKey);
    moveEntry(startingSideDrafts, fromKey, toKey);
    moveEntry(effortDrafts, fromKey, toKey);
    moveEntry(openRowPanels, fromKey, toKey);
  }

  /** Drop every per-row draft entry for one key. */
  function dropRowDrafts(rowKey: string): void {
    delete overrides[rowKey];
    delete editedFields[rowKey];
    delete fieldErrors[rowKey];
    delete statusDrafts[rowKey];
    delete reasonDrafts[rowKey];
    delete sideDrafts[rowKey];
    delete startingSideDrafts[rowKey];
    delete effortDrafts[rowKey];
    delete openRowPanels[rowKey];
  }

  /** The row key this row takes when it records `side`. */
  function rowKeyWithSide(row: ActiveExerciseRow, side: Side): string {
    return `${row.keyBase}|${side}|${row.attempt}`;
  }

  /**
   * The key a blank row takes once the model recreates it.
   *
   * A blank row holds no result, so its side is the exercise default, not the
   * draft side. Reading the default from laterality keeps this key equal to the
   * key the row model builds; otherwise the drafts land under a key no row
   * reads and the typed value disappears.
   */
  function blankRowKey(row: ActiveExerciseRow): string {
    const exercise = $services.staticData?.exerciseById.get(row.exerciseId);
    return rowKeyWithSide(row, defaultSideForLaterality(exercise?.laterality));
  }

  /**
   * Persist one row, moving the stored result when the row's identity moved.
   *
   * The side is part of the result key. A plain save writes under the
   * draft's side and leaves the old-side result sitting there, so one
   * round reads as two recorded sets. Every path that can carry a side
   * different from the stored one has to move, not only the side control:
   * pick a side while the fields are blank, the move is skipped, the side
   * draft stays behind, and the next field blur then writes a second key.
   *
   * The queued save is flushed before the move so a queued write cannot
   * land after it and resurrect the key just cleared.
   */
  async function persistRow(
    row: ActiveExerciseRow,
    draftSnapshot?: ExerciseResultDraft
  ): Promise<void> {
    const service = sessionService;
    if (service === null || session === null || row.resultKey === null) return;
    const sessionId = session.id;
    const draft = draftSnapshot ?? draftForRow(row);
    const draftSide = draft.side ?? row.side;
    const targetKey = exerciseResultKey(row.path, draftSide, row.attempt);
    const identityMoved = row.resultKey !== targetKey;

    try {
      if (isBlankExerciseDraft(draft)) {
        service.queueClearExerciseResult(sessionId, row.resultKey, row.path);
        await service.queueFlush();
      } else if (identityMoved) {
        // A first keystroke can be queued before the model reports a saved
        // result. Flush and inspect storage, rather than trusting the stale
        // `hasSavedResult` flag and writing a second side key.
        await service.queueFlush();
        const latest = await service.load(sessionId);
        if (latest.exerciseResults[row.resultKey] !== undefined) {
          await service.moveExerciseResult(sessionId, row.resultKey, draft);
        } else {
          service.queueSaveExerciseResult(sessionId, draft);
          await service.queueFlush();
        }
      } else {
        service.queueSaveExerciseResult(sessionId, draft);
        await service.queueFlush();
      }
      // A saved result follows its side-based key. A blank row does not: the
      // model recreates it on the exercise's default side, while its side
      // remains draft data until the user records a value. The default comes
      // from laterality, so a unilateral blank row returns to `alternating`.
      const nextRowKey = isBlankExerciseDraft(draft)
        ? blankRowKey(row)
        : rowKeyWithSide(row, draftSide);
      migrateRowDrafts(row.key, nextRowKey);
      session = await service.load(sessionId);
      await tick();
    } catch (error: unknown) {
      errorText = error instanceof Error ? error.message : 'REP JOT could not save that value.';
    }
  }

  /**
   * Queue one row's save and flush it.
   *
   * The flush makes the value durable before the user can leave the screen.
   * Drive synchronization keeps its separate quiet period, so blur never
   * waits for or directly starts a network cycle.
   */
  /**
   * All mutations of an exercise row share one chain.
   *
   * A side move reloads the model. A blur or control tap that runs during
   * that reload otherwise keeps the old result key and can recreate the row
   * the move deleted. Resolve the current row by its stable path and attempt
   * after the preceding mutation completes.
   */
  let rowChangeChain: Promise<void> = Promise.resolve();

  function currentRow(anchor: ActiveExerciseRow): ActiveExerciseRow | undefined {
    return rowsByKey.get(anchor.key) ?? (model?.rows ?? []).find(
      (candidate) => candidate.keyBase === anchor.keyBase && candidate.attempt === anchor.attempt
    );
  }

  function enqueueRowChange(
    anchor: ActiveExerciseRow,
    change: (row: ActiveExerciseRow) => void | Promise<void>
  ): Promise<void> {
    rowChangeChain = rowChangeChain
      .then(async () => {
        const row = currentRow(anchor);
        if (row !== undefined) await change(row);
      })
      .catch((error: unknown) => {
        errorText = error instanceof Error ? error.message : 'REP JOT could not save that value.';
      });
    return rowChangeChain;
  }

  function queueAndFlush(row: ActiveExerciseRow): void {
    void enqueueRowChange(row, persistRow);
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
        buildRowDraft({ workoutId: session.workoutId, row, overrides: {}, editedFields: {} })
      );
    } else {
      service.queueClearExerciseResult(session.id, row.resultKey, row.path);
    }
  }

  function onFieldChange(rowKey: string, dimension: string, value: string): void {
    const forRow = overrides[rowKey] ?? {};
    forRow[dimension] = value;
    overrides[rowKey] = forRow;
    editedFields[rowKey] = { ...(editedFields[rowKey] ?? {}), [dimension]: true };

    const row = rowsByKey.get(rowKey);
    if (row === undefined) return;
    void enqueueRowChange(row, (current) => {
      const service = sessionService;
      if (service === null || session === null) return;
      if (!validateRow(current)) {
        restoreRowAfterInvalid(current);
        return;
      }
      const draft = draftForRow(current);
      if (isBlankExerciseDraft(draft)) {
        if (current.resultKey !== null) {
          service.queueClearExerciseResult(session.id, current.resultKey, current.path);
        }
        return;
      }
      service.queueSaveExerciseResult(session.id, draft);
    });
  }

  function onFieldBlur(rowKey: string): void {
    const row = rowsByKey.get(rowKey);
    if (row === undefined) return;
    void enqueueRowChange(row, async (current) => {
      if (validateRow(current)) await persistRow(current);
    });
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
   * The side is part of the result key, so this runs on the same mutation
   * chain as field, status, starting-side, and effort writes. Each operation
   * sees the row left by the operation before it.
   */
  async function onSideChange(rowKey: string, nextSide: Side): Promise<void> {
    const anchor = rowsByKey.get(rowKey);
    if (anchor === undefined || anchor.resultKey === null) return;

    // Capture what the row held at the tap. A later keystroke can happen
    // before this queued move starts; it must not turn this valid result into
    // a blank or invalid move retroactively.
    sideDrafts[rowKey] = nextSide;
    if (nextSide !== 'alternating') delete startingSideDrafts[rowKey];
    const draft = draftForRow(anchor);
    const nextKey = rowKeyWithSide(anchor, nextSide);
    if (openRowPanels[rowKey] === true) openRowPanels[nextKey] = true;

    await enqueueRowChange(anchor, (row) => persistRow(row, draft));
  }

  /** Change the side an alternating set starts on. */
  async function onStartingChange(rowKey: string, next: StartingSide): Promise<void> {
    const anchor = rowsByKey.get(rowKey);
    if (anchor === undefined) return;
    await enqueueRowChange(anchor, async (row) => {
      startingSideDrafts[row.key] = next;
      await persistRow(row);
    });
  }

  /** Record or clear the effort one row carries. */
  function onEffortChange(rowKey: string, choice: string): void {
    effortDrafts[rowKey] = choice;
    const row = rowsByKey.get(rowKey);
    if (row !== undefined) queueAndFlush(row);
  }

  /**
   * Delete one attempt and move the drafts that the renumber touches.
   *
   * The service closes the gap the delete leaves: every attempt above the
   * deleted one moves down one number. Row keys carry the attempt, so each
   * moved attempt also takes a new key, and a draft left under the old key
   * stops reaching the row on screen. Walk the moved attempts in the same
   * ascending order the service used, so each destination key is already
   * free, and drop the deleted row's drafts with it.
   *
   * The delete runs against the stored key, not the draft side, so a side
   * the user has not saved yet cannot move the target.
   * REQUIREMENT 19.9.
   */
  async function onDeleteAttempt(rowKey: string): Promise<void> {
    const anchor = rowsByKey.get(rowKey);
    if (anchor === undefined || anchor.resultKey === null || busy) return;
    busy = true;
    try {
      await enqueueRowChange(anchor, async (row) => {
        const service = sessionService;
        if (service === null || session === null || row.resultKey === null) return;
        const sessionId = session.id;
        const storedKey = row.resultKey;
        await service.queueFlush();

        // Read the stored attempt before the delete, so the renumber knows
        // which attempts sit above it.
        const before = await service.load(sessionId);
        const target = before.exerciseResults[storedKey];
        if (target === undefined) return;
        const encodedTarget = encodePath(target.executionPath);
        const side = target.side ?? 'both';
        const removedAttempt = target.attempt ?? 1;
        const above: number[] = [];
        for (const result of Object.values(before.exerciseResults)) {
          if (encodePath(result.executionPath) !== encodedTarget) continue;
          if ((result.side ?? 'both') !== side) continue;
          const attempt = result.attempt ?? 1;
          if (attempt > removedAttempt) above.push(attempt);
        }
        above.sort((a, b): number => (a < b ? -1 : 1));

        await service.deleteAttempt(sessionId, storedKey);

        // Carry the drafts down after the write succeeded, so a refused
        // delete leaves them where they were.
        dropRowDrafts(row.key);
        for (const attempt of above) {
          migrateRowDrafts(
            `${row.keyBase}|${side}|${attempt}`,
            `${row.keyBase}|${side}|${attempt - 1}`
          );
        }

        session = await service.load(sessionId);
        await tick();
      });
    } finally {
      busy = false;
    }
  }

  /**
   * Open one more attempt on a row.
   *
   * The service copies the identity of the attempt it follows and opens
   * the new one with no values, so a fresh row appears with empty fields.
   * REQUIREMENT 19.9.
   */
  async function onAddAttempt(rowKey: string): Promise<void> {
    const anchor = rowsByKey.get(rowKey);
    if (anchor === undefined || anchor.resultKey === null || busy) return;
    busy = true;
    try {
      await enqueueRowChange(anchor, async (row) => {
        const service = sessionService;
        if (service === null || session === null || row.resultKey === null) return;
        await service.queueFlush();
        await service.addAttempt(session.id, row.resultKey);
        session = await service.load(session.id);
        await tick();
      });
    } finally {
      busy = false;
    }
  }
  /**
   * Fill rows with the values the Last Time badge shows.
   *
   * One tap covers what one badge speaks for: the row it sits on, or every
   * set of the exercise when the badge sits over a grid.
   *
   * The fill saves rather than only drafting. A tap has no blur to follow
   * it, so a draft-only fill would leave the fields looking recorded while
   * Finish still reported the work as missing. Each row keeps its own
   * status, side, and starting side: the fill copies values, nothing else.
   * REQUIREMENTS 19.4, 19.11.
   */
  async function fillFromLastTime(rowKeys: string[]): Promise<void> {
    const service = sessionService;
    if (service === null || session === null || busy) return;

    /** Rows that keep their stored key go in one batch edit. */
    const batch: ExerciseResultDraft[] = [];
    /** Rows whose draft side differs from the stored one must move, not copy. */
    const moves: Array<{ row: ActiveExerciseRow; draft: ExerciseResultDraft }> = [];

    for (const rowKey of rowKeys) {
      const row = rowsByKey.get(rowKey);
      if (row === undefined || !row.recordable || row.unresolved) continue;

      const filled = lastTimeFillText(row);
      if (Object.keys(filled).length === 0) continue;

      overrides[row.key] = { ...(overrides[row.key] ?? {}), ...filled };
      const edited: Record<string, boolean> = { ...(editedFields[row.key] ?? {}) };
      for (const dimension of Object.keys(filled)) edited[dimension] = true;
      editedFields[row.key] = edited;

      // A value that will not parse stays on screen with its error and is
      // not written, so one bad field cannot block the rest of the fill.
      if (!validateRow(row)) continue;

      const draft = draftForRow(row);
      const draftKey = exerciseResultKey(row.path, draft.side ?? row.side, row.attempt);
      if (row.resultKey !== null && draftKey !== row.resultKey) moves.push({ row, draft });
      else batch.push(draft);
    }

    if (batch.length === 0 && moves.length === 0) return;

    busy = true;
    try {
      await service.queueFlush();
      if (batch.length > 0) await service.saveExerciseResults(session.id, batch);
      for (const entry of moves) {
        const fromKey = entry.row.resultKey;
        if (fromKey === null) continue;
        await service.moveExerciseResult(session.id, fromKey, entry.draft);
        migrateRowDrafts(
          entry.row.key,
          rowKeyWithSide(entry.row, entry.draft.side ?? entry.row.side)
        );
      }
      session = await service.load(session.id);
    } catch (error: unknown) {
      errorText = error instanceof Error ? error.message : 'REP JOT could not fill those sets.';
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
    const affected = (model?.rows ?? []).filter((candidate) =>
      candidate.exerciseId === row.exerciseId &&
      candidate.fields.some((candidateField) => candidateField.dimension === dimension)
    );
    for (const candidate of affected) {
      const candidateField = candidate.fields.find((item) => item.dimension === dimension);
      if (candidateField === undefined) continue;
      const candidateDisplay = fieldDisplay(candidateField, overridesFor(candidate));
      const message = fieldInputError(candidateField, candidateDisplay);
      if (message !== undefined) {
        fieldErrors[candidate.key] = { ...(fieldErrors[candidate.key] ?? {}), [dimension]: message };
        await focusById(`active-${candidate.key}-${dimension}`);
        return;
      }
    }

    const display = fieldDisplay(field, overridesFor(row));
    const result = await tapUnitPill({
      exercise,
      dimension: field.dimension,
      currentUnit: field.unit,
      display,
      preferences
    });
    if (result.nextUnit === null) return;

    for (const candidate of affected) {
      const candidateField = candidate.fields.find((item) => item.dimension === dimension);
      if (candidateField === undefined) continue;
      const current = fieldDisplay(candidateField, overridesFor(candidate));
      const converted = convertFieldDisplay(candidateField, current, result.nextUnit);
      overrides[candidate.key] = {
        ...(overrides[candidate.key] ?? {}),
        [dimension]: candidate.key === row.key ? result.display : converted
      };
    }

    // PreferenceService keeps its working document outside Svelte state. Tell
    // the registry that the existing service changed so `model` rebuilds with
    // the new unit. Without this, only the number changes and the pill keeps
    // the old label; another tap then converts the number a second time from
    // that stale unit.
    publishServices();
  }

  /** Saved score text is the fallback until the user types a draft. */
  function savedScoreText(group: GroupModel): string {
    const score = group.score;
    if (score === undefined) return '';
    if (score.type === 'cycles') return String(score.completedCycles);
    if (score.type === 'intervals') return String(score.completedIntervals);
    if (score.type === 'rounds_and_reps') return String(score.completedRounds);
    return '';
  }

  function savedPartialText(group: GroupModel): string {
    return group.score?.type === 'rounds_and_reps' ? String(group.score.additionalReps) : '';
  }

  function draftText(drafts: Record<string, string>, key: string, fallback: string): string {
    return Object.prototype.hasOwnProperty.call(drafts, key) ? (drafts[key] ?? '') : fallback;
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

  /** Correct the terminal status without changing its recorded end time. */
  async function changeTerminalStatus(nextStatus: 'completed' | 'abandoned'): Promise<void> {
    const service = sessionService;
    if (service === null || session === null || busy || session.status === nextStatus) return;
    busy = true;
    errorText = '';
    try {
      await service.queueFlush();
      await service.setTerminalStatus(session.id, nextStatus);
      session = await service.load(session.id);
    } catch (error: unknown) {
      errorText = error instanceof Error
        ? error.message
        : 'REP JOT could not update the workout status.';
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
    <header class="active-workout__header">
      <h1 class="active-workout__title">{model.workoutName}</h1>
      {#if startedLabel !== ''}
        <p class="active-workout__started">Started {startedLabel}</p>
      {/if}
    </header>

    {#snippet groupControls(group: GroupModel)}
      {#if group.scored && group.isAmrap}
        <div class="active-workout__inline-controls" aria-label="{group.title} controls">
          <AmrapControls
            {group}
            additionalReps={draftText(amrapPartialDrafts, group.key, savedPartialText(group))}
            disabled={sessionService === null}
            {busy}
            error={containerErrors[group.key]}
            onaddround={() => void addAmrapRound(group)}
            onpartialchange={(event: Event) => {
              const target = event.target as HTMLInputElement;
              amrapPartialDrafts[group.key] = target.value;
              queueAmrapPartial(group, target.value);
            }}
            onpartialblur={() => void saveAmrapPartial(group, draftText(amrapPartialDrafts, group.key, savedPartialText(group)))}
          />
        </div>
      {:else if group.scored && group.isEmom}
        <div class="active-workout__inline-controls" aria-label="{group.title} controls">
          <EmomControls
            {group}
            completed={draftText(emomDrafts, group.key, savedScoreText(group))}
            disabled={sessionService === null}
            error={containerErrors[group.key]}
            onchange={(event: Event) => {
              const target = event.target as HTMLInputElement;
              emomDrafts[group.key] = target.value;
              queueContainerScore(group, target.value);
            }}
            onblur={() => void saveContainerScore(group, draftText(emomDrafts, group.key, savedScoreText(group)))}
          />
        </div>
      {:else if group.scored && group.scoreType !== undefined}
        <div class="active-workout__inline-controls" aria-label="{group.title} score">
          <ContainerScoreEditor
            {group}
            scoreText={draftText(containerDrafts, group.key, savedScoreText(group))}
            disabled={sessionService === null}
            error={containerErrors[group.key]}
            onscorechange={(event: Event) => {
              const target = event.target as HTMLInputElement;
              containerDrafts[group.key] = target.value;
              queueContainerScore(group, target.value);
            }}
            onscoreblur={() => void saveContainerScore(group, draftText(containerDrafts, group.key, savedScoreText(group)))}
          />
        </div>
      {/if}

      {#if group.canExpand}
        <div class="active-workout__inline-controls" aria-label="{group.title} detail">
          <AggregateExpander
            {group}
            drafts={inferredDrafts[group.key] ?? []}
            expanded={expandedGroups[group.key] === true}
            disabled={sessionService === null}
            {busy}
            onexpand={() => void expandAggregate(group)}
            onsave={() => void saveInferred(group)}
          />
        </div>
      {/if}
    {/snippet}

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
      {openRowPanels}
      onpaneltoggle={(rowKey: string, open: boolean) => {
        openRowPanels[rowKey] = open;
      }}
      groupcontrols={groupControls}
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
      ondeleteattempt={(rowKey) => void onDeleteAttempt(rowKey)}
      onfilllasttime={(rowKeys: string[]) => void fillFromLastTime(rowKeys)}
    />

    {#if errorText !== ''}
      <p class="active-workout__error" role="alert">{errorText}</p>
    {/if}

    {#if isTerminal}
      <ChipGroup
        label="Workout status"
        options={terminalStatusOptions}
        value={session?.status ?? ''}
        idPrefix="active-workout-status"
        disabled={sessionService === null || busy}
        onchange={(nextStatus: string) => {
          if (nextStatus === 'completed' || nextStatus === 'abandoned') {
            void changeTerminalStatus(nextStatus);
          }
        }}
      />
      <p class="active-workout__hint" role="status">
        This workout ended as {session?.status}. You can still correct its values or status;
        the workout times stay as they are.
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
