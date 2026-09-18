<!--
  The editable workout tree.
  Phase 17. REQUIREMENTS 19.1, 19.2.

  Draws the resolved tree with inputs. The model keeps mixed circuits in one
  ordered list and collapses repeated single-exercise blocks into shared set
  editors. There is no recursion, which keeps the DOM shallow on the targeted
  browser and keeps every row key in one loop.

  Depth rule. Levels 1 through 3 get visible indentation. Past that a fourth
  indent costs more width than it tells, so a deep row shows its compact
  named path instead — `Strength / Complex / Round 2` — and stops indenting.
  The row itself carries that decision, so the tree only applies the indent
  class. Scored-container controls arrive as a snippet so they stay beside the
  group they edit instead of collecting at the page end. REQUIREMENT 19.2.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import ExerciseRow from './ExerciseRow.svelte';
  import ExerciseSetTable from './ExerciseSetTable.svelte';
  import type { DrawBlock, GroupModel } from '../viewmodels/activeWorkoutModel';
  import type { ReasonCode, ResultStatus, Side, StartingSide } from '../../domain/enums';

  let {
    blocks = [],
    idPrefix = 'tree',
    disabled = false,
    busy = false,
    rowOverrides = {},
    rowFieldErrors = {},
    missingRowKeys = [],
    statusDrafts = {},
    sideDrafts = {},
    startingSideDrafts = {},
    effortDrafts = {},
    openRowPanels = {},
    onpaneltoggle = undefined,
    groupcontrols = undefined,
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
    /** Validation messages, keyed by row key then by dimension. */
    rowFieldErrors?: Record<string, Record<string, string>>;
    /** Rows that the last Finish check found not recorded. */
    missingRowKeys?: string[];
    /** Draft status, keyed by row key. */
    statusDrafts?: Record<string, ResultStatus>;
    /** Draft side, keyed by row key. */
    sideDrafts?: Record<string, Side>;
    /** Draft starting side, keyed by row key. */
    startingSideDrafts?: Record<string, StartingSide>;
    /** Draft effort choice, keyed by row key. */
    effortDrafts?: Record<string, string>;
    /** Which rows have their **Set options** panel open, keyed by row key. */
    openRowPanels?: Record<string, boolean>;
    /** Reports a panel opening or closing, so the state survives a rebuild. */
    onpaneltoggle?: ((rowKey: string, open: boolean) => void) | undefined;
    /** Scored-container controls, kept beside their group heading. */
    groupcontrols?: Snippet<[GroupModel]>;
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
  {#each blocks as block (block.kind === 'group' ? `g-${block.group.key}` : block.kind === 'set-table' ? `t-${block.table.key}` : `r-${block.row.key}`)}
    {#if block.kind === 'group'}
      <section
        class="edit-group {depthClass(block.group.level)}"
        aria-label={block.group.title}
      >
        {#if block.group.sectionTitle !== undefined}
          <p class="edit-group__section">{block.group.sectionTitle}</p>
        {/if}
        <h3 class="edit-group__title">{block.group.title}</h3>
        {#if block.group.summaryText !== ''}
          <p class="edit-group__summary">{block.group.summaryText}</p>
        {/if}
        {#if block.group.showControls && groupcontrols !== undefined}
          {@render groupcontrols(block.group)}
        {/if}
      </section>
    {:else if block.kind === 'set-table'}
      <div class="edit-set-table {depthClass(block.table.level)}">
        <ExerciseSetTable
          table={block.table}
          {idPrefix}
          {disabled}
          {busy}
          {rowOverrides}
          {rowFieldErrors}
          {missingRowKeys}
          {statusDrafts}
          {sideDrafts}
          {startingSideDrafts}
          {effortDrafts}
          {openRowPanels}
          {onpaneltoggle}
          {onfieldchange}
          {onfieldblur}
          {onstatuschange}
          {onreasonchange}
          {onunitchange}
          {onsidechange}
          {onstartingchange}
          {oneffortchange}
          {onaddattempt}
        />
      </div>
    {:else}
      <div class="edit-row {depthClass(block.row.level)}">
        <ExerciseRow
          row={block.row}
          overrides={overridesFor(block.row.key)}
          fieldErrors={rowFieldErrors[block.row.key] ?? {}}
          missing={missingRowKeys.includes(block.row.key)}
          status={statusDrafts[block.row.key]}
          side={sideDrafts[block.row.key]}
          startingSide={startingSideDrafts[block.row.key] ?? 'left'}
          effortChoice={effortDrafts[block.row.key]}
          panelOpen={openRowPanels[block.row.key] === true}
          onpaneltoggle={onpaneltoggle}
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
