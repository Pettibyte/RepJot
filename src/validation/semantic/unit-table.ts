/** Controlled dimension ordering table for static semantic validation (P4-T01). Authority: specs/rep-jot-json-schema-spec.md §2 and §4
 * ("Static data lists metric units before imperial units"); docs/contracts/static-data-contracts.md EX-08 (supporting sem) and EX-11
 * (sem-owned). The schema restricts each dimension to its unit enum; this table adds the semantic order rule. */

/** Metric units per controlled dimension; empty means no imperial counterpart exists. */
export const DIMENSION_METRIC_UNITS: Readonly<Record<string, readonly string[]>> = {
  reps: [],
  weight: ["kg"],
  addedWeight: ["kg"],
  assistedWeight: ["kg"],
  distance: ["m", "km"],
  duration: [],
  calories: []
};

/** True when the controlled table knows this dimension; unknown dimensions are schema-owned. */
export function isControlledDimension(dimension: string): boolean {
  return Object.prototype.hasOwnProperty.call(DIMENSION_METRIC_UNITS, dimension);
}

/** EX-11: a violation exists exactly when some metric unit appears after an imperial unit. */
export function hasUnitOrderViolation(dimension: string, units: readonly string[]): boolean {
  if (!isControlledDimension(dimension)) {
    return false;
  }
  const metricUnits = DIMENSION_METRIC_UNITS[dimension];
  let seenImperial = false;
  for (let i = 0; i < units.length; i += 1) {
    if (metricUnits.indexOf(units[i]) !== -1) {
      if (seenImperial) {
        return true;
      }
    } else {
      seenImperial = true;
    }
  }
  return false;
}
