<script lang="ts">
  import type { Component } from 'svelte';
  import type { Readable } from 'svelte/store';
  let { Screen, routeId }: {
    Screen: Component<{ sessionId?: string }>;
    routeId: Readable<string>;
  } = $props();
</script>

<Screen sessionId={$routeId} />
