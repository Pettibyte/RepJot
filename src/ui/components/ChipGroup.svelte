<!--
  A choice from a short list, drawn as a row of chips.
  REQUIREMENTS 11.4, 11.5, 19.6, 19.9.

  This replaces the native `<select>` for every short-choice control on the
  workout screens. A `<select>` opens its list in a popup the browser draws
  outside the page. The targeted e-ink browser renders that popup as a blank
  white rectangle: the list flashes, then shows nothing to pick from. Chips
  are ordinary buttons painted in the page, so they cannot fail that way.

  Chips carry two things a select only gives you after opening it:

  1. The chosen value is visibly filled, so the state reads at a glance.
  2. Every choice is on screen at once, so the user sees what is available
     before committing.

  The group is a `role="group"` with an `aria-labelledby` label, and each
  chip carries `aria-pressed`. That reads as one labelled set of options
  rather than a pile of unrelated buttons.

  The list must stay short. Chips that wrap past two rows on the narrow
  target become a wall, so a caller with a long list should keep a select
  or pick a shorter vocabulary. The reason list, at seven entries, is the
  practical ceiling.
-->
<script lang="ts">
  let {
    label,
    options,
    value = '',
    disabled = false,
    idPrefix = 'chips',
    onchange = undefined
  }: {
    /** The visible label above the chips. */
    label: string;
    /** The choices, in the order shown. */
    options: Array<{ value: string; label: string }>;
    /** The chosen value. Nothing selected reads as the empty string. */
    value?: string;
    disabled?: boolean;
    /** Prefix for element ids, so two groups on one page stay addressable. */
    idPrefix?: string;
    /** Runs on pick with the chosen value. */
    onchange?: ((value: string) => void) | undefined;
  } = $props();

  const labelId = $derived(`${idPrefix}-label`);
</script>

<div class="chip-group">
  <span class="chip-group__label" id={labelId}>{label}</span>
  <div class="chip-group__chips" role="group" aria-labelledby={labelId}>
    {#each options as option (option.value)}
      <button
        class="pill chip"
        class:chip--on={value === option.value}
        type="button"
        {disabled}
        aria-pressed={value === option.value}
        onclick={() => onchange?.(option.value)}
      >
        {option.label}
      </button>
    {/each}
  </div>
</div>
