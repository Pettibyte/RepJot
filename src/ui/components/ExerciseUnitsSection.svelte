<!--
  The Exercise Units section of Settings.
  Phase 19. REQUIREMENTS 12.3, 12.4.

  One row per exercise. Every unit the exercise can switch between gets a pill
  on that row, so a person fixes all of an exercise's units in one place. An
  exercise that measures one dimension in one unit shows that unit as plain
  text: a control that cannot change anything is noise.

  The pills write through the same preference service the Active Workout pill
  uses, so the two never disagree. A change here saves immediately; the row
  shows the saved value on the next render.

  The section reads the exercise list from the bundle, not from the preference
  document. A new exercise therefore appears here before the user ever sets a
  unit for it, and a removed exercise disappears. The stored mapping for a
  removed exercise stays on Drive, untouched: this screen edits what the
  bundle lists, nothing else.
-->
<script lang="ts">
  import UnitPill from './UnitPill.svelte';
  import { unitLabel } from '../../units/format';
  import { DIMENSION_ORDER, nextCompatibleUnit, unitsFor } from '../../units/conversion';
  import type { PreferenceService } from '../../preferences/preference-service';
  import type { Exercise } from '../../domain/types';
  import type { Dimension } from '../../units/conversion';

  /** One unit control inside an exercise row. */
  interface UnitCell {
    dimension: Dimension;
    unit: string;
    compatibleUnits: string[];
  }

  /** One exercise row. */
  interface UnitRow {
    exerciseId: string;
    exerciseName: string;
    cells: UnitCell[];
  }

  let {
    preferences = null,
    exercises = [],
    disabled = false
  }: {
    /** The preference service. Null until a signed-in session builds one. */
    preferences?: PreferenceService | null;
    /** The exercise directory from the bundle. */
    exercises?: Exercise[];
    /** Blocks every control. Set while a save is in flight. */
    disabled?: boolean;
  } = $props();

  /** True when a tap has somewhere to go. */
  const canEdit = $derived(preferences !== null && !disabled);

  /** One exercise and dimension, as a display key. */
  function unitKey(exerciseId: string, dimension: Dimension): string {
    return `${exerciseId}|${dimension}`;
  }

  /**
   * The units the user tapped here, keyed by exercise and dimension.
   *
   * `preferences.getUnit()` reads the working document out of a plain `Map`
   * behind `coordinator.peek()`. A `Map` is not a Svelte signal, so a save
   * records no dependency and a derived that read it never invalidates. The
   * section therefore holds the tapped unit itself and falls back to the
   * service for every row the user has not touched. `ActiveWorkoutScreen`
   * keeps its draft fields the same way.
   *
   * The service instance rides along in the same cell so a tap made against
   * one account cannot paint another account's rows after a switch.
   *
   * `$state.raw`, not `$state`. Plain `$state` wraps nested objects in a
   * proxy, and the proxy is not identical to the object that went in, so the
   * service comparison below would never match. Every write here replaces the
   * whole cell, which is exactly what `.raw` tracks.
   */
  let tapped = $state.raw<{ service: PreferenceService | null; units: Record<string, string> }>({
    service: null,
    units: {}
  });

  /** The tapped unit for one row, or `undefined` when the row is untouched. */
  function tappedUnit(exerciseId: string, dimension: Dimension): string | undefined {
    if (tapped.service !== preferences) return undefined;
    return tapped.units[unitKey(exerciseId, dimension)];
  }

  /**
   * The rows, sorted by the name a person reads.
   *
   * The bundle order is an authoring order, not a reading order, so the list
   * sorts here. REQUIREMENTS 3.17, 3.19.
   */
  const rows = $derived.by((): UnitRow[] => {
    if (preferences === null) return [];
    const built: UnitRow[] = [];
    for (const exercise of exercises) {
      const cells: UnitCell[] = [];
      for (const dimension of DIMENSION_ORDER) {
        const compatibleUnits = unitsFor(exercise, dimension);
        if (compatibleUnits.length === 0) continue;
        const unit =
          tappedUnit(exercise.id, dimension) ??
          preferences.getUnit(exercise.id, dimension) ??
          compatibleUnits[0];
        cells.push({ dimension, unit, compatibleUnits });
      }
      built.push({ exerciseId: exercise.id, exerciseName: exercise.name, cells });
    }
    built.sort((a: UnitRow, b: UnitRow): number =>
      a.exerciseName < b.exerciseName ? -1 : a.exerciseName > b.exerciseName ? 1 : 0
    );
    return built;
  });

  /**
   * Move one exercise's unit to the next one it lists and save it.
   *
   * The save is local-first. The coordinator reports the upload through the
   * save badge in the header, so this control starts the write and lets that
   * badge carry the sync news. A rejected save is swallowed here for the
   * same reason: the badge already says `Sync failed`.
   */
  function cycleUnit(exercise: Exercise, dimension: Dimension, current: string): void {
    if (preferences === null || disabled) return;
    const next = nextCompatibleUnit(exercise, dimension, current);
    if (next === undefined || next === current) return;

    // Paint first. The service write cannot wake this component, so the tap
    // would look dead without this. The base is the current map only when it
    // belongs to this service; a stale map is dropped instead of merged.
    const base = tapped.service === preferences ? tapped.units : {};
    tapped = { service: preferences, units: { ...base, [unitKey(exercise.id, dimension)]: next } };

    void preferences.setUnit(exercise.id, dimension, next).catch((): void => {
      // The service refused the write, so the tap never landed. Drop it and
      // let the row fall back to what the service actually holds. The save
      // badge in the header still carries the sync news. REQUIREMENTS 4.1.
      if (tapped.service !== preferences) return;
      if (tapped.units[unitKey(exercise.id, dimension)] !== next) return;
      const rest = { ...tapped.units };
      delete rest[unitKey(exercise.id, dimension)];
      tapped = { service: preferences, units: rest };
    });
  }
</script>

<div class="settings-section" role="region" aria-label="Exercise Units">
  <h2 class="settings-section__title">Exercise Units</h2>

  {#if preferences === null}
    <p class="settings-section__empty">
      REP JOT could not reach your preferences. Reload the page to try again.
    </p>
  {:else if rows.length === 0}
    <p class="settings-section__empty">No exercises are in the bundle.</p>
  {:else}
    <p class="settings-section__hint">
      Tap a unit to switch it. REP JOT saves your choice and uses it for that
      exercise everywhere.
    </p>

    <ul class="unit-list">
      {#each rows as row, index (`u-${index}`)}
        {@const exercise = exercises.find((item: Exercise): boolean => item.id === row.exerciseId)}
        <li class="unit-row">
          <span class="unit-row__name">{row.exerciseName}</span>
          <span class="unit-row__cells">
            {#each row.cells as cell (`c-${cell.dimension}`)}
              {#if cell.compatibleUnits.length > 1 && exercise !== undefined}
                <UnitPill
                  unit={cell.unit}
                  compatibleUnits={cell.compatibleUnits}
                  disabled={!canEdit}
                  label={`Change ${row.exerciseName} ${cell.dimension} unit`}
                  onclick={() => cycleUnit(exercise, cell.dimension, cell.unit)}
                />
              {:else}
                <span class="unit-row__static">{unitLabel(cell.unit)}</span>
              {/if}
            {/each}
          </span>
        </li>
      {/each}
    </ul>
  {/if}
</div>
