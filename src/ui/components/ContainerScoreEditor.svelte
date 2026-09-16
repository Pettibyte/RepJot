<!--
  Container score editor.
  Phase 17. REQUIREMENTS 10.13, 10.17, 10.18.

  A scored container takes its score one of two ways.

  Aggregate-only: no child detail is saved, so the user types the score here
  and that typed number is the record.

  Detail-authoritative: child results are saved below, so the score is derived
  from them. The box is read-only in that case. Letting the user type a number
  that the next edit overwrites would tell the user the box controls something
  it does not. REQUIREMENT 10.17.

  The **Detailed** marker appears when the saved score is `nonstandard`, which
  means the recorded detail does not follow the container's own score
  progression. It is a fact about the data, not a failure, so it carries no
  color and no alert role. REQUIREMENT 10.18.
-->
<script lang="ts">
  import type { GroupModel } from '../viewmodels/activeWorkoutModel';

  let {
    group,
    scoreText = '',
    disabled = false,
    error = undefined,
    onscorechange = undefined,
    onscoreblur = undefined
  }: {
    /** The scored container this editor writes. */
    group: GroupModel;
    /** The score text. Its shape follows the container's score type. */
    scoreText?: string;
    disabled?: boolean;
    error?: string;
    onscorechange?: ((event: Event) => void) | undefined;
    onscoreblur?: ((event: FocusEvent) => void) | undefined;
  } = $props();

  /** Saved child detail decides the score, so this box cannot write it. */
  const readOnly = $derived(group.hasSavedDetail);

  /** Field label per score kind, so the user knows what number to type. */
  const FIELD_LABELS: Record<string, string> = {
    cycles: 'Cycles completed',
    rounds_and_reps: 'Rounds completed',
    intervals: 'Intervals completed'
  };

  const fieldLabel = $derived(
    FIELD_LABELS[group.scoreType ?? ''] ?? `${group.title} score`
  );
</script>

<div class="container-score">
  <label class="container-score__label" for={`${group.key}-score`}>{fieldLabel}</label>
  <input
    class="container-score__field"
    id={`${group.key}-score`}
    type="text"
    inputmode="numeric"
    autocomplete="off"
    disabled={disabled || readOnly}
    value={scoreText}
    oninput={onscorechange}
    onblur={onscoreblur}
    aria-invalid={error ? 'true' : undefined}
    aria-describedby={error ? `${group.key}-score-error` : undefined}
  />
  {#if error}
    <p class="container-score__error" id={`${group.key}-score-error`} aria-live="polite">{error}</p>
  {/if}
  {#if readOnly}
    <p class="container-score__note">Set by the recorded detail below.</p>
  {/if}
  {#if group.detailed}
    <span class="badge badge--outline container-score__detailed">Detailed</span>
  {/if}
</div>
