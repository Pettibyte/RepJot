<!--
  Aggregate expander.
  Phase 17. REQUIREMENTS 10.14, 10.15, 10.16.

  An aggregate-only container holds one number for a whole block of work.
  **Expand detail** asks for the child rows behind it. The service derives
  each draft from the container score plus the current prescription, and every
  draft is labelled `Inferred`.

  The label is the whole point. A derived value is not recorded actual work:
  a rounds-and-reps score cannot establish actual load, side, or deviation
  from prescription. Nothing here saves. The drafts become recorded only when
  the user saves them, and only then does child detail become authoritative.

  The drafts render as read-only text, not inputs. An editable draft would
  read as a saved row, and the user could believe the work was already
  recorded. The **Save inferred detail** button is the one action that
  carries them into the session.
-->
<script lang="ts">
  import Button from './Button.svelte';
  import type { DraftChild } from '../../sessions/draft-expansion';
  import type { GroupModel } from '../viewmodels/activeWorkoutModel';
  import { formatMinuteValue, formatStep, unitLabel } from '../../units/format';

  /** Show one derived quantity on a read-only line. */
  function showQuantity(quantity: { value: number; unit: string }): string {
    // Reps read as whole numbers. Every other dimension reads to 0.1.
    const step = quantity.unit === 'reps' ? 1 : 0.1;
    const value = quantity.unit === 'minute'
      ? formatMinuteValue(quantity.value)
      : formatStep(quantity.value, step);
    return `${value} ${unitLabel(quantity.unit)}`;
  }

  let {
    group,
    drafts = [],
    disabled = false,
    busy = false,
    expanded = false,
    onexpand = undefined,
    onsave = undefined
  }: {
    /** The aggregate-only container being expanded. */
    group: GroupModel;
    /** The inferred draft children. Empty until the caller loads them. */
    drafts?: DraftChild[];
    disabled?: boolean;
    busy?: boolean;
    expanded?: boolean;
    onexpand?: (() => void) | undefined;
    onsave?: (() => void) | undefined;
  } = $props();
</script>

<div class="aggregate-expander">
  {#if !expanded}
    <Button
      variant="secondary"
      disabled={disabled || busy}
      onclick={() => onexpand?.()}
    >
      {busy ? 'Expanding…' : 'Expand detail'}
    </Button>
  {:else}
    <p class="aggregate-expander__note">
      These values are derived from the recorded score and the programmed
      prescription. They are not recorded work until you save them.
    </p>
    <ul class="aggregate-expander__list" aria-label="Inferred detail">
      {#each drafts as draft, index (`${group.key}-draft-${index}`)}
        <li class="aggregate-draft">
          <span class="badge badge--outline aggregate-draft__label">Inferred</span>
          <span class="aggregate-draft__name">{draft.draft.exerciseId}</span>
          <span class="aggregate-draft__values">
            {#each Object.entries(draft.draft.values ?? {}) as entry, entryIndex (`${group.key}-v-${entryIndex}`)}
              <span class="aggregate-draft__quantity">{showQuantity(entry[1])}</span>
            {/each}
          </span>
        </li>
      {:else}
        <li class="aggregate-expander__empty">No detail could be derived.</li>
      {/each}
    </ul>
    {#if drafts.length > 0}
      <div class="aggregate-expander__actions">
        <Button variant="primary" disabled={disabled || busy} onclick={() => onsave?.()}>
          Save inferred detail
        </Button>
      </div>
    {/if}
  {/if}
</div>
