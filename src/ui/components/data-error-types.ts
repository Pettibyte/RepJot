// The props contract for the one data-error card.
// ARCHITECTURE ADR-017. REQUIREMENTS 6.8, 6.9, 6.10.
//
// The type lives in a module rather than inside the component so a screen builds
// one through the same shape a test asserts against. `DataError.svelte` renders
// this shape and nothing else.
//
// Every field is safe display text. `rawJson` is the stored bytes as text, and
// the card never injects them: it hands them to the raw viewer.

/** What one data-error card reports. */
export interface DataErrorProps {
  /** The problem, in one line. Always shown. */
  title: string;
  /** The logical file family, for example `results-shard`. */
  family?: string;
  /** The schema version the document declares. */
  declaredVersion?: number;
  /** The highest version this build can read. */
  maxSupportedVersion?: number;
  /** Safe supporting text. Never a token, a note, or a measurement. */
  detail?: string;
  /** The stored bytes as text. Empty string means nothing to show. */
  rawJson: string;
}

/**
 * Identity of the reported item. Two different problems never share one.
 *
 * A host that reuses one card and swaps `props` to a new error must show the
 * new error, even when the user dismissed the old one. The host keys its hidden
 * state to this string, so a change in any reported field reads as a new item.
 */
export function dataErrorIdentity(props: DataErrorProps): string {
  return [
    props.title,
    props.family ?? '',
    props.declaredVersion ?? '',
    props.maxSupportedVersion ?? '',
    props.rawJson
  ].join('|');
}
