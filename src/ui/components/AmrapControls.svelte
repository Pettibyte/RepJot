<!--
  AMRAP round controls.
  Phase 17. REQUIREMENTS 19.7, 19.8.

  Two ways to record an AMRAP:

  1. The large `+`. One tap adds one completed round of the container's
     children at their prescribed values. This is the fast path a user runs
     between rounds, so it is one control and one call.
  2. The partial-round field. The user typed the extra reps that did not fill
     a round. This writes the container score directly.

  The `+` is hidden when the container records with no child detail,
  because there is no child set to add. The partial field stays live once
  saved child detail exists: the `+` itself writes that detail, so hiding
  the field there would remove it in the middle of the normal flow. The
  save keeps the round count already on file, so the two controls do not
  fight. REQUIREMENTS 19.7, 19.8.
-->
<script lang="ts">
  import Button from './Button.svelte';
  import type { GroupModel } from '../viewmodels/activeWorkoutModel';
  import { amrapShowsPartial } from '../screens/activeWorkoutActions';

  let {
    group,
    additionalReps = '',
    disabled = false,
    busy = false,
    onaddround = undefined,
    onpartialchange = undefined,
    onpartialblur = undefined
  }: {
    /** The AMRAP container these controls act on. */
    group: GroupModel;
    /** Extra reps beyond the last full round. */
    additionalReps?: string;
    disabled?: boolean;
    /** True while an add is in flight, so a double tap cannot add two rounds. */
    busy?: boolean;
    onaddround?: (() => void) | undefined;
    onpartialchange?: ((event: Event) => void) | undefined;
    onpartialblur?: ((event: FocusEvent) => void) | undefined;
  } = $props();

  /** The `+` needs a child set to add. */
  const canAddRound = $derived(group.isAmrap && group.scored && group.childDetail !== 'none');

  /**
   * The extra-reps field stays live beside the `+`.
   *
   * The two controls are complementary. The `+` records a whole round and
   * the field records the reps that did not fill one, and the normal AMRAP
   * flow uses both: tap `+` per round, then type the leftover reps. Saved
   * child detail must not hide the field, because the `+` itself writes
   * child results, so gating on detail would remove the field after the
   * first tap. The save keeps the round count already on file, so the two
   * cannot overwrite each other. REQUIREMENTS 19.7, 19.8.
   */
  const canTypePartial = $derived(amrapShowsPartial(group));
</script>

<div class="amrap-controls">
  {#if canAddRound}
    <Button
      variant="primary"
      icon="add"
      iconLabel="Add one completed round"
      disabled={disabled || busy}
      onclick={() => onaddround?.()}
    >
      {busy ? 'Adding…' : 'Add round'}
    </Button>
  {/if}

  {#if canTypePartial}
    <div class="amrap-controls__partial">
      <label class="amrap-controls__label" for={`${group.key}-partial`}>
        Extra reps past the last full round
      </label>
      <input
        class="amrap-controls__field"
        id={`${group.key}-partial`}
        type="text"
        inputmode="numeric"
        autocomplete="off"
        {disabled}
        value={additionalReps}
        oninput={onpartialchange}
        onblur={onpartialblur}
      />
    </div>
  {/if}
</div>
