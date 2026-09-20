<!--
  A status label with the completed mark.

  `design/DESIGN.md` forbids color as the only signal for success or failure
  and asks for iconography or explicit text. This draws both. The text always
  names the status, and the glyph only reinforces `completed`, so the mark
  never carries the meaning alone and every other status stays plain.

  The caller passes its own class, so the label keeps the look of the row it
  sits in. `.status-label` owns only the space between the mark and the text.
-->
<script lang="ts">
  import Icon from './Icon.svelte';

  let {
    status = '',
    label = '',
    class: className = ''
  }: {
    /** The raw status value. Only `completed` draws the mark. */
    status?: string;
    /** The visible status text. */
    label?: string;
    /** The caller's class, so the label keeps its existing look. */
    class?: string;
  } = $props();

  const classes = $derived(['status-label', className].filter(Boolean).join(' '));

  const completed = $derived(status === 'completed');
</script>

<span class={classes}>
  {#if completed}
    <Icon name="check_circle" decorative />
  {/if}
  {label}
</span>
