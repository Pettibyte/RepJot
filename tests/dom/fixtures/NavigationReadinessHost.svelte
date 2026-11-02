<script lang="ts">
  import { setContext } from 'svelte';
  import type { Readable } from 'svelte/store';
  import type { NavigationInfo } from '../../../src/routing/hash-router';
  import { SCREEN_NAVIGATION_CONTEXT } from '../../../src/routing/screen-ready';
  import WorkoutHistoryScreen from '../../../src/ui/screens/WorkoutHistoryScreen.svelte';
  import ExerciseHistoryScreen from '../../../src/ui/screens/ExerciseHistoryScreen.svelte';

  let { kind, navigation }: {
    kind: 'workout' | 'exercise';
    navigation: Readable<NavigationInfo | null>;
  } = $props();
  setContext(SCREEN_NAVIGATION_CONTEXT, () => $navigation);
</script>

{#if kind === 'workout'}
  <WorkoutHistoryScreen />
{:else}
  <ExerciseHistoryScreen exerciseId="back-squat" />
{/if}
