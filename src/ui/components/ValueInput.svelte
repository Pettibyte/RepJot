<!--
  A dimension-aware numeric input with its unit pill.
  Phase 17. REQUIREMENTS 12.4, 12.5, 19.9, and ARCHITECTURE section 13.

  One control per measurement dimension. The dimension decides three things:
  the `inputmode` hint, the step the text rounds to, and whether the unit pill
  can switch. The input itself is a plain native `<input type="text">` with an
  `inputmode`, not `type="number"`, because a text field keeps the exact string
  the user typed. A number input drops leading zeros and rejects a partial
  entry, which would fight the blank-means-no-result rule.

  The value is `$bindable()`. The screen owns the draft text so it can flush
  on blur and on a route change, and so a unit tap can rewrite the text in the
  same place it saves the preference.

  The label is always visible. A placeholder is not a label, and the targeted
  browser does not keep a placeholder readable while the field has content.
-->
<script lang="ts">
  import UnitPill from './UnitPill.svelte';
  import type { FieldModel } from '../viewmodels/activeWorkoutModel';

  let {
    field,
    value = $bindable(''),
    id = undefined,
    disabled = false,
    pillLabel = undefined,
    error = undefined,
    oninput = undefined,
    onblur = undefined,
    onunit = undefined
  }: {
    /** The field this input edits. */
    field: FieldModel;
    /** The editable text. Bound so the screen owns the draft. */
    value?: string;
    id?: string;
    disabled?: boolean;
    /** Accessible name for the unit pill. */
    pillLabel?: string;
    /** Validation message for nonblank invalid text. */
    error?: string;
    /**
     * Runs on every keystroke. The caller stores the draft text.
     *
     * The screen owns the draft, so the typed value must leave this
     * component as it is typed. Without this event the text dies inside the
     * input and nothing is ever saved. REQUIREMENT 11.1.
     */
    oninput?: ((event: Event) => void) | undefined;
    onblur?: ((event: FocusEvent) => void) | undefined;
    /** Runs when the pill is tapped. Receives nothing; the caller advances. */
    onunit?: ((event: MouseEvent) => void) | undefined;
  } = $props();

  const pillShown = $derived(field.compatibleUnits.length > 1);
  const errorId = $derived(`${id ?? field.dimension}-error`);
  const describedBy = $derived(
    [pillShown ? `${id ?? field.dimension}-unit` : '', error ? errorId : '']
      .filter(Boolean)
      .join(' ') || undefined
  );
</script>

<div class="value-input" class:value-input--invalid={error !== undefined}>
  <label class="value-input__label" for={id}>{field.label}</label>
  <div class="value-input__row">
    <input
      class="value-input__control"
      id={id}
      type="text"
      inputmode={field.inputmode}
      autocomplete="off"
      {disabled}
      bind:value
      {oninput}
      {onblur}
      aria-invalid={error ? 'true' : undefined}
      aria-describedby={describedBy}
    />
    <span id={`${id ?? field.dimension}-unit`} class="value-input__unit-hint">
      <UnitPill
        unit={field.unit}
        compatibleUnits={field.compatibleUnits}
        {disabled}
        label={pillLabel ?? `${field.label} unit`}
        onclick={onunit}
      />
    </span>
  </div>
  {#if error}
    <p class="value-input__error" id={errorId} aria-live="polite">{error}</p>
  {/if}
</div>
