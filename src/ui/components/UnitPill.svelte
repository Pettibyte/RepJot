<!--
  The unit pill.
  Phase 17. REQUIREMENTS 12.4, 12.6, 19.6.

  A pill that names the unit a field is showing. Tapping it moves to the next
  unit the exercise lists, converts the number in the field, and saves the
  preference. The stored result is not touched, so a tap the user never
  follows up changes nothing on disk. REQUIREMENT 12.6.

  The pill is a button, not a link, because it changes state rather than
  navigating. Its accessible name says what it does, not just the unit, so a
  screen reader does not read four identical "kg" buttons on one screen.

  A pill with nowhere to go is not drawn. An exercise that lists one unit for
  a dimension has no next unit, and a control that cannot act is noise.
-->
<script lang="ts">
  import type { Dimension } from '../../units/conversion';
  import { unitLabel } from '../../units/format';

  let {
    unit = '',
    compatibleUnits = [],
    disabled = false,
    label = 'Change unit',
    onclick = undefined
  }: {
    /** The unit the field currently shows. */
    unit?: string;
    /** Every unit the exercise lists for this dimension. */
    compatibleUnits?: string[];
    disabled?: boolean;
    /** Accessible name for the control. */
    label?: string;
    /** Runs on tap. The caller converts the value and saves the preference. */
    onclick?: ((event: MouseEvent) => void) | undefined;
  } = $props();

  /** Nothing to switch to means nothing to render. */
  const canSwitch = $derived(compatibleUnits.length > 1);
</script>

{#if canSwitch}
  <button
    class="pill unit-pill"
    type="button"
    {disabled}
    {onclick}
    aria-label={`${label}. Currently ${unitLabel(unit)}. Tap to change.`}
  >
    {unitLabel(unit)}
  </button>
{/if}
