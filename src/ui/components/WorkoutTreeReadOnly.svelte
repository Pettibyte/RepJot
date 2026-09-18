<!--
  The workout tree, read-only.

  The overview uses the same semantic section and set-table language as Active
  Workout. Repeated single-exercise blocks collapse into one compact set list;
  mixed containers keep their programmed document order. No entry controls are
  rendered here.
-->
<script lang="ts">
  import type { OverviewBlock, OverviewNodeModel } from '../viewmodels/overviewModel';

  let {
    nodes = [],
    blocks = [],
    idPrefix = 'tree'
  }: {
    /** Complete resolved rows, retained for the simple fallback renderer. */
    nodes?: OverviewNodeModel[];
    /** Semantic presentation from the overview view model. */
    blocks?: OverviewBlock[];
    idPrefix?: string;
  } = $props();

  const MAX_DEPTH = 6;

  function depthClass(depth: number): string {
    const level = Math.max(1, Math.min(MAX_DEPTH, Math.trunc(depth)));
    return `tree-row--d${level}`;
  }

  const displayBlocks = $derived(
    blocks.length > 0
      ? blocks
      : nodes.map((node): OverviewBlock => ({
          kind: node.isExercise ? 'exercise' : 'group',
          node
        }))
  );
</script>

<ul class="workout-tree overview-document" aria-label="Workout structure">
  {#each displayBlocks as block, index (`${idPrefix}-${index}`)}
    {#if block.kind === 'group'}
      <li class="tree-row edit-group {depthClass(block.node.depth)}">
        {#if block.sectionTitle !== undefined}
          <p class="edit-group__section">{block.sectionTitle}</p>
        {/if}
        {#if block.sectionTitle === undefined || block.node.label !== 'Sequence'}
          <h3 class="edit-group__title">{block.node.label}</h3>
        {/if}
        {#if block.node.prescriptionText !== ''}
          <p class="edit-group__summary">{block.node.prescriptionText}</p>
        {/if}
      </li>
    {:else if block.kind === 'set-table'}
      <li class="tree-row edit-set-table {depthClass(block.table.depth)}">
        <section class="set-table" aria-labelledby={`${idPrefix}-${block.table.key}-title`}>
          <p class="set-table__section">{block.table.sectionTitle}</p>
          <div class="set-table__head">
            <h3 class="set-table__title" id={`${idPrefix}-${block.table.key}-title`}>
              {#if block.table.rows[0]?.exerciseHref !== undefined}
                <a class="tree-row__label tree-row__label--exercise" href={block.table.rows[0].exerciseHref}>
                  {block.table.title}
                </a>
              {:else}
                {block.table.title}
              {/if}
            </h3>
          </div>
          <p class="set-table__label">{block.table.label}</p>
          <div class="overview-set__rows">
            {#each block.table.rounds as round (round.key)}
              {#if round.label !== ''}
                <p class="set-table__round">{round.label}</p>
              {/if}
              {#each round.rows as row, index (`${round.key}-${index}`)}
                <div class="overview-set__row">
                  <span class="exercise-row__set-label">Set {row.setNumber}</span>
                  {#if block.table.multiExercise}
                    <span class="overview-set__name">{row.label}</span>
                  {/if}
                  {#if row.prescriptionText !== ''}
                    <span class="overview-set__prescription">{row.prescriptionText}</span>
                  {/if}
                </div>
              {/each}
            {/each}
          </div>
        </section>
      </li>
    {:else}
      <li class="tree-row overview-exercise {depthClass(block.node.depth)}">
        {#if block.node.unresolved}
          <span class="tree-row__label tree-row__label--unresolved">{block.node.label}</span>
          <span class="tree-row__flag">not in this build</span>
        {:else if block.node.exerciseHref !== undefined}
          <a class="tree-row__label tree-row__label--exercise" href={block.node.exerciseHref}>
            {block.node.label}
          </a>
        {:else}
          <span class="tree-row__label">{block.node.label}</span>
        {/if}
        {#if block.node.prescriptionText !== ''}
          <span class="tree-row__prescription">{block.node.prescriptionText}</span>
        {/if}
      </li>
    {/if}
  {/each}
</ul>
