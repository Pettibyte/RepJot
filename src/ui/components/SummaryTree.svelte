<!--
  The recorded-work document, read-only.

  It shares the semantic sections and compact set-table layout used by Workout
  Overview and Active Workout. Stored results remain authoritative, including
  unresolved values and container scores.
-->
<script lang="ts">
  import DataError from './DataError.svelte';
  import type {
    SummaryContainerRow,
    SummaryDisplayBlock,
    SummaryExerciseRow,
    SummaryGroup
  } from '../viewmodels/summaryModel';
  import { summaryRowErrorProps } from '../viewmodels/summaryModel';

  let {
    groups = [],
    blocks = [],
    idPrefix = 'summary'
  }: {
    groups?: SummaryGroup[];
    blocks?: SummaryDisplayBlock[];
    idPrefix?: string;
  } = $props();

  const MAX_DEPTH = 6;

  function depthClass(depth: number): string {
    const level = Math.max(1, Math.min(MAX_DEPTH, Math.trunc(depth)));
    return `summary-row--d${level}`;
  }

  function rowDepth(row: SummaryExerciseRow): number {
    return Math.max(1, row.path.length);
  }

  const displayBlocks = $derived(
    blocks.length > 0
      ? blocks
      : groups.map((group): SummaryDisplayBlock => ({ kind: 'group', group }))
  );
</script>

{#snippet scoreRow(score: SummaryContainerRow)}
  <div
    class="summary-row summary-row--score"
    class:summary-row--unresolved={score.unresolved}
  >
    {#if score.unresolved}<DataError props={summaryRowErrorProps(score)} />{/if}
    <span class="summary-row__label">{score.label}</span>
    <span class="summary-row__score">
      <span class="badge">{score.scoreLabel}</span>
      {#if score.scoreText !== ''}
        <span class="summary-row__score-value">{score.scoreText}</span>
      {/if}
    </span>
    {#if score.detailed}<span class="summary-row__note">Recorded as detailed</span>{/if}
    <span class="summary-row__status">{score.statusLabel}</span>
    {#if score.reasonLabel !== undefined}
      <p class="summary-row__reason">{score.reasonLabel}</p>
    {/if}
  </div>
{/snippet}

{#snippet exerciseResult(row: SummaryExerciseRow, setLabel: string = '', showName = false)}
  <div
    class="summary-row {depthClass(rowDepth(row))}"
    class:summary-row--compact={setLabel !== ''}
    class:summary-row--unresolved={row.unresolved}
  >
    {#if row.unresolved}<DataError props={summaryRowErrorProps(row)} />{/if}
    <div class="summary-row__head">
      {#if setLabel !== ''}
        <span class="exercise-row__set-label">{setLabel}</span>
      {/if}
      {#if showName || setLabel === ''}
        {#if row.href !== undefined}
          <a class="summary-row__name" href={row.href}>{row.label}</a>
        {:else}
          <span class="summary-row__name">{row.label}</span>
        {/if}
      {/if}
      {#if row.attempt > 1}<span class="summary-row__attempt">Attempt {row.attempt}</span>{/if}
      <span class="summary-row__status">{row.statusLabel}</span>
    </div>
    {#if row.valuesLabel !== ''}<p class="summary-row__values">{row.valuesLabel}</p>{/if}
    {#if row.alternatingLabel !== undefined}
      <p class="summary-row__values">{row.alternatingLabel}</p>
    {/if}
    {#if row.reasonLabel !== undefined}<p class="summary-row__reason">{row.reasonLabel}</p>{/if}
  </div>
{/snippet}

<div class="summary-tree">
  {#each displayBlocks as block, blockIndex (`${idPrefix}-b-${blockIndex}`)}
    {#if block.kind === 'set-table'}
      <section class="summary-group edit-set-table set-table" aria-labelledby={`${idPrefix}-${block.table.key}-title`}>
        <p class="set-table__section">{block.table.sectionTitle}</p>
        <div class="set-table__head">
          <h2 class="set-table__title" id={`${idPrefix}-${block.table.key}-title`}>
            {#if block.table.rows[0]?.href !== undefined}
              <a class="summary-row__name" href={block.table.rows[0].href}>{block.table.title}</a>
            {:else}
              {block.table.title}
            {/if}
          </h2>
        </div>
        <p class="set-table__label">{block.table.label}</p>
        <div class="set-table__rows summary-set__rows">
          {#each block.table.rounds as round (round.key)}
            {#if round.label !== ''}
              <p class="set-table__round">{round.label}</p>
            {/if}
            {#each round.rows as row (`${row.key}-${row.attempt}`)}
              {@render exerciseResult(row, `Set ${row.setNumber}`, block.table.multiExercise)}
            {/each}
          {/each}
        </div>
      </section>
    {:else}
      <section class="summary-group edit-group">
        {#if block.sectionTitle !== undefined}
          <p class="edit-group__section">{block.sectionTitle}</p>
        {/if}
        <h2 class="summary-group__title edit-group__title">{block.group.title}</h2>

        {#each block.group.containers as score, scoreIndex (`${idPrefix}-c-${blockIndex}-${scoreIndex}`)}
          {@render scoreRow(score)}
        {/each}
        {#each block.group.rows as row, rowIndex (`${idPrefix}-r-${blockIndex}-${rowIndex}`)}
          {@render exerciseResult(row)}
        {/each}
      </section>
    {/if}
  {/each}
</div>
