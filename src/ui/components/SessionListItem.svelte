<!--
  One session row in the chooser.
  REQUIREMENTS section 16.

  The row is a link, not a button, because it navigates. The whole row is the
  tap target, which keeps the target wide on a Kindle page and avoids a small
  icon the user must aim at.

  A row whose workout reference does not resolve renders the data-error card
  instead of the link. The row stays in the list so the sessions beside it
  remain reachable. REQUIREMENTS 6.10, 15.6.
-->
<script lang="ts">
  import DataError from './DataError.svelte';
  import StatusLabel from './StatusLabel.svelte';
  import type { SessionListItemModel } from '../viewmodels/chooserModel';

  let { item }: { item: SessionListItemModel } = $props();

  /**
   * The text behind **View Raw JSON**.
   *
   * The shard text is first choice: it is the session object the app read for
   * this row, re-serialized. `LocalStore` keeps parsed documents, so no part
   * of this app holds the stored bytes. When the shard is not in memory the
   * card falls back to the row fields the summary carries, so the action is
   * never missing and never empty. Neither text is the stored file, and the
   * card text does not claim it is. REQUIREMENTS 6.9.
   */
  const rawJson = $derived(
    item.rawJson ??
      JSON.stringify(
        {
          sessionId: item.sessionId,
          workoutName: item.workoutName,
          status: item.statusLabel,
          timeLabel: item.timeLabel,
          unresolvedWorkout: item.unresolvedWorkout
        },
        null,
        2
      )
  );
</script>

{#if item.unresolvedWorkout}
  <div class="session-row">
    <DataError
      props={{
        title: 'This session refers to a workout this build does not have',
        family: 'session',
        detail: `Session ${item.sessionId} names workout ${item.workoutName}, which is not in the bundled workout list.`,
        rawJson
      }}
    />
  </div>
{:else}
  <a class="session-row session-item" href={item.href}>
    <span class="session-item__name">{item.workoutName}</span>
    <span class="session-item__meta">
      <StatusLabel class="session-item__status" status={item.status} label={item.statusLabel} />
      <span class="session-item__time">{item.timeLabel}</span>
    </span>
  </a>
{/if}
