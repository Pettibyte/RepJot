<!--
  EMOM interval controls.
  Phase 17. REQUIREMENTS 10.9, 10.11, 19.9.

  An EMOM runs one interval per cycle. The score counts completed intervals
  out of the prescribed total, so the control is a single number against that
  total, not a per-round grid. A grid would imply the user records each
  interval separately, and the session service records the count on the
  container instead.

  The word is "interval", never "round". REQUIREMENT 10.9 forbids the
  ambiguous term for EMOM programming, and the screen is where that rule is
  visible to the user.

  The control is read-only once saved child detail exists below the container,
  because saved detail decides the score. REQUIREMENT 10.17.
-->
<script lang="ts">
  import type { GroupModel } from '../viewmodels/activeWorkoutModel';

  let {
    group,
    completed = '',
    disabled = false,
    onchange = undefined,
    onblur = undefined
  }: {
    /** The EMOM container this control writes. */
    group: GroupModel;
    /** Completed interval count, as typed text. */
    completed?: string;
    disabled?: boolean;
    onchange?: ((event: Event) => void) | undefined;
    onblur?: ((event: FocusEvent) => void) | undefined;
  } = $props();

  const readOnly = $derived(group.hasSavedDetail);

  const total = $derived(group.totalIntervals);
</script>

<div class="emom-controls">
  <label class="emom-controls__label" for={`${group.key}-intervals`}>
    Intervals completed{total > 0 ? ` of ${total}` : ''}
  </label>
  <input
    class="emom-controls__field"
    id={`${group.key}-intervals`}
    type="text"
    inputmode="numeric"
    autocomplete="off"
    disabled={disabled || readOnly}
    value={completed}
    oninput={onchange}
    onblur={onblur}
  />
  {#if readOnly}
    <p class="emom-controls__note">Set by the recorded detail below.</p>
  {/if}
</div>
