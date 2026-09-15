// The option lists the exercise row draws.
// Phase 17. REQUIREMENTS 11.4.
//
// They live in a plain module so a test asserts the vocabulary without
// rendering, and so the row holds no inline data table. The status list is
// the whole `resultStatus` enum; the reason list is the whole `reasonCode`
// enum. A schema addition must land here too, or the row silently offers a
// shorter list than the contract allows.

import type { ReasonCode, ResultStatus } from '../../domain/enums';

/** Every result status, in the order the control lists them. */
export const STATUS_OPTIONS: Array<{ value: ResultStatus; label: string }> = [
  { value: 'completed', label: 'Completed' },
  { value: 'incomplete', label: 'Incomplete' },
  { value: 'skipped', label: 'Skipped' }
];

/** Every reason code, in the order the control lists them. */
export const REASON_OPTIONS: Array<{ value: ReasonCode; label: string }> = [
  { value: 'not_completed', label: 'Not completed' },
  { value: 'user_skipped', label: 'Skipped' },
  { value: 'equipment_unavailable', label: 'Equipment unavailable' },
  { value: 'physical_limitation', label: 'Physical limitation' },
  { value: 'time_constraint', label: 'Time constraint' },
  { value: 'unsuccessful_attempt', label: 'Unsuccessful attempt' },
  { value: 'other', label: 'Other' }
];
