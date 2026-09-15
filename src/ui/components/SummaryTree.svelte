<!--
  The recorded-work tree, read-only.
  Phase 18. REQUIREMENTS 6.8, 6.23, 10.13, 10.18, 20.3.

  The summary arrives grouped by the view model, so this component only draws:
  one section per container, the container's own score first, then the exercise
  rows recorded under it.

  An unresolved row renders the data-error card **and** the values the session
  stored. The two are not alternatives. The card names the reference this build
  cannot place, which REQUIREMENTS 6.8 asks for, and the values are the record
  the user saved, which REQUIREMENTS 6.23 says must still show. Dropping the
  values behind a banner that promises them is the defect this shape removes.

  Indentation uses capped depth classes built from spacing tokens, the same way
  the read-only workout tree does it. A depth past the cap reuses the last
  class, so a deeply nested program stays on the page instead of running off
  the edge of a Kindle screen.
-->
<script lang="ts">
  import DataError from './DataError.svelte';
  import type {
    SummaryContainerRow,
    SummaryExerciseRow,
    SummaryGroup
  } from '../viewmodels/summaryModel';
  import { summaryRowErrorProps } from '../viewmodels/summaryModel';

  let {
    groups,
    idPrefix = 'summary'
  }: {
    /** Groups in draw order, from `buildSummaryModel`. */
    groups: SummaryGroup[];
    /** Prefix for the row DOM id, so two trees on one page stay addressable. */
    idPrefix?: string;
  } = $props();

  /** Deepest distinct indent before the indent stops growing. */
  const MAX_DEPTH = 6;

  function depthClass(depth: number): string {
    const level = Math.max(1, Math.min(MAX_DEPTH, Math.trunc(depth)));
    return `summary-row--d${level}`;
  }

  /** The indent of one row, from its own path depth. */
  function rowDepth(row: SummaryExerciseRow): number {
    return Math.max(1, row.path.length);
  }
</script>

<div class="summary-tree">
  {#each groups as group, groupIndex (`${idPrefix}-g-${groupIndex}`)}
    <section class="summary-group">
      <h2 class="summary-group__title">{group.title}</h2>

      {#each group.containers as score, scoreIndex (`${idPrefix}-c-${groupIndex}-${scoreIndex}`)}
        <div
          class="summary-row summary-row--score"
          class:summary-row--unresolved={score.unresolved}
        >
          {#if score.unresolved}
            <DataError props={summaryRowErrorProps(score)} />
          {/if}
          <span class="summary-row__label">{score.label}</span>
          <span class="summary-row__score">
            <span class="badge">{score.scoreLabel}</span>
            {#if score.scoreText !== ''}
              <span class="summary-row__score-value">{score.scoreText}</span>
            {/if}
          </span>
          {#if score.detailed}
            <span class="summary-row__note">Recorded as detailed</span>
          {/if}
          <span class="summary-row__status">{score.statusLabel}</span>
          {#if score.reasonLabel !== undefined}
            <p class="summary-row__reason">{score.reasonLabel}</p>
          {/if}
        </div>
      {/each}

      {#each group.rows as row, rowIndex (`${idPrefix}-r-${groupIndex}-${rowIndex}`)}
        <div
          class="summary-row {depthClass(rowDepth(row))}"
          class:summary-row--unresolved={row.unresolved}
        >
          {#if row.unresolved}
            <DataError props={summaryRowErrorProps(row)} />
          {/if}
          <div class="summary-row__head">
            {#if row.href !== undefined}
              <a class="summary-row__name" href={row.href}>{row.label}</a>
            {:else}
              <span class="summary-row__name">{row.label}</span>
            {/if}
            <span class="summary-row__attempt">Set {row.attempt}</span>
            <span class="summary-row__status">{row.statusLabel}</span>
          </div>
          {#if row.valuesLabel !== ''}
            <p class="summary-row__values">{row.valuesLabel}</p>
          {/if}
          {#if row.alternatingLabel !== undefined}
            <p class="summary-row__values">{row.alternatingLabel}</p>
          {/if}
          {#if row.reasonLabel !== undefined}
            <p class="summary-row__reason">{row.reasonLabel}</p>
          {/if}
        </div>
      {/each}
    </section>
  {/each}
</div>
