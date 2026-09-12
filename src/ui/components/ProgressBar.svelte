<script lang="ts">
  let {
    value = 0,
    max = 1,
    label = 'Progress',
    class: className = ''
  }: {
    /** Current amount. Values outside 0..max clamp to the range. */
    value?: number;
    max?: number;
    /** Accessible name for the bar. */
    label?: string;
    class?: string;
  } = $props();

  const percent = $derived.by(() => {
    if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) {
      return 0;
    }
    const pct = (value / max) * 100;
    return Math.round(Math.min(100, Math.max(0, pct)));
  });
</script>

<div
  class={['bar', className].filter(Boolean).join(' ')}
  role="progressbar"
  aria-valuenow={percent}
  aria-valuemin="0"
  aria-valuemax="100"
  aria-label={label}
>
  <div class="bar__fill" style="width: {percent}%"></div>
</div>
