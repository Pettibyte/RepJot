<!--
  The editable workout tree.
  Phase 17. REQUIREMENTS 19.1, 19.2.

  Draws the resolved tree with inputs. The model already flattened the
  container repetition and interleaved the rows, so this component walks one
  ordered list and indents by level. There is no recursion, which keeps the
  DOM shallow on the targeted browser and keeps every row key in one loop.

  Depth rule. Levels 1 through 3 get visible indentation. Past that a fourth
  indent costs more width than it tells, so a deep row shows its compact
  named path instead — `Strength / Complex / Round 2` — and stops indenting.
  The row itself carries that decision, so the tree only applies the indent
  class. REQUIREMENT 19.2.
-->
<script lang="ts">
  import ExerciseRow from './ExerciseRow.svelte';
  import type { DrawBlock } from '../viewmodels/activeWorkoutModel';
  import type { ReasonCode, ResultStatus, Side, StartingSide } from '../../domain/enums';

  let {
    blocks = [],
    idPrefix = 'tree',
    disabled = false,
    busy = false,
    rowOverrides = {},
    sideDrafts = {},
    startingSideDrafts = {},
    effortDrafts = {},
    onfieldchange = undefined,
    onfieldblur = undefined,
    onstatuschange = undefined,
    onreasonchange = undefined,
    onunitchange = undefined,
    onsidechange = undefined,
    onstartingchange = undefined,
    oneffortchange = undefined,
    onaddattempt = undefined
  }: {
    /** Groups and rows in prescriptive draw order. */
    blocks?: DrawBlock[];
    idPrefix?: string;
    disabled?: boolean;
    /** True while a row-level action is in flight. */
    busy?: boolean;
    /** Draft field text, keyed by row key then by dimension. */
    rowOverrides?: Record<string, Record<string, string>>;
    /** Draft side, keyed by row key. */
    sideDrafts?: Record<string, Side>;
    /** Draft starting side, keyed by row key. */
    startingSideDrafts?: Record<string, StartingSide>;
    /** Draft effort choice, keyed by row key. */
    effortDrafts?: Record<string, string>;
    onfieldchange?: ((rowKey: string, dimension: string, value: string) => void) | undefined;
    onfieldblur?: ((rowKey: string, dimension: string) => void) | undefined;
    onstatuschange?: ((rowKey: string, status: ResultStatus) => void) | undefined;
    onreasonchange?: ((rowKey: string, reason: ReasonCode) => void) | undefined;
    onunitchange?: ((rowKey: string, dimension: string) => void) | undefined;
    onsidechange?: ((rowKey: string, side: Side) => void) | undefined;
    onstartingchange?: ((rowKey: string, startingSide: StartingSide) => void) | undefined;
    oneffortchange?: ((rowKey: string, choice: string) => void) | undefined;
    onaddattempt?: ((rowKey: string) => void) | undefined;
  } = $props();

  /** Deepest distinct indent before the compact path takes over. */
  const MAX_INDENT = 3;

  function depthClass(level: number): string {
    const capped = Math.max(1, Math.min(MAX_INDENT, Math.trunc(level)));
    return `edit-tree--d${capped}`;
  }

  /** Draft text for one row. Empty when the user has not touched it. */
  function overridesFor(rowKey: string): Record<string, string> {
    return rowOverrides[rowKey] ?? {};
  }
</script>

<div class="edit-tree">
  {#each blocks as block (block.kind === 'group' ? `g-${block.group.key}` : `r-${block.row.key}`)}
    {#if block.kind === 'group'}
      <section
        class="edit-group {depthClass(block.group.level)}"
        aria-label={block.group.title}
      >
        <h3 class="edit-group__title">{block.group.title}</h3>
        {#if block.group.summaryText !== ''}
          <p class="edit-group__summary">{block.group.summaryText}</p>
        {/if}
      </section>
    {:else}
      <div class="edit-row {depthClass(block.row.level)}">
        <ExerciseRow
          row={block.row}
          overrides={overridesFor(block.row.key)}
          side={sideDrafts[block.row.key]}
          startingSide={startingSideDrafts[block.row.key] ?? 'left'}
          effortChoice={effortDrafts[block.row.key]}
          {idPrefix}
          {disabled}
          {busy}
          onfieldchange={(dimension, value) => onfieldchange?.(block.row.key, dimension, value)}
          onfieldblur={(dimension) => onfieldblur?.(block.row.key, dimension)}
          onstatuschange={(status) => onstatuschange?.(block.row.key, status)}
          onreasonchange={(reason) => onreasonchange?.(block.row.key, reason)}
          onunitchange={(dimension) => onunitchange?.(block.row.key, dimension)}
          onsidechange={(nextSide) => onsidechange?.(block.row.key, nextSide)}
          onstartingchange={(next) => onstartingchange?.(block.row.key, next)}
          oneffortchange={(choice) => oneffortchange?.(block.row.key, choice)}
          onaddattempt={() => onaddattempt?.(block.row.key)}
        />
      </div>
    {/if}
  {/each}
</div>
