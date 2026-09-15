<!--
  The workout tree, read-only.
  REQUIREMENTS section 16, section 19.2.

  The tree arrives already flattened by `resolveTree`, so a repeated container
  is several rows and each row carries the prescription that applies to it.
  This component only draws: one row per node, indented by depth.

  Indentation uses six capped depth classes built from spacing tokens. A depth
  past six reuses the last class, so a deeply nested program stays on the page
  instead of running off the edge of a Kindle screen.
-->
<script lang="ts">
  import type { OverviewNodeModel } from '../viewmodels/overviewModel';

  let {
    nodes,
    idPrefix = 'tree'
  }: {
    /** Rows in draw order. */
    nodes: OverviewNodeModel[];
    /** Prefix for the row DOM id, so two trees on one page stay addressable. */
    idPrefix?: string;
  } = $props();

  /** Deepest distinct indent before the indent stops growing. */
  const MAX_DEPTH = 6;

  function depthClass(depth: number): string {
    const level = Math.max(1, Math.min(MAX_DEPTH, Math.trunc(depth)));
    return `tree-row--d${level}`;
  }
</script>

<ul class="workout-tree" aria-label="Workout structure">
  {#each nodes as node, index (`${idPrefix}-${index}`)}
    <li class="tree-row {depthClass(node.depth)}">
      {#if node.unresolved}
        <span class="tree-row__label tree-row__label--unresolved">{node.label}</span>
        <span class="tree-row__flag">not in this build</span>
      {:else if node.exerciseHref !== undefined}
        <a class="tree-row__label tree-row__label--exercise" href={node.exerciseHref}>{node.label}</a>
      {:else}
        <span class="tree-row__label">{node.label}</span>
      {/if}
      {#if node.prescriptionText !== ''}
        <span class="tree-row__prescription">{node.prescriptionText}</span>
      {/if}
    </li>
  {/each}
</ul>
