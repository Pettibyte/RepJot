// Parse limits for the document read path.
// REQUIREMENTS 5.1, ARCHITECTURE section 12 (JSON parse stage).

/**
 * Largest document the parser accepts, in UTF-8 bytes.
 *
 * Tied to the Kindle Scribe memory budget. The device has about 0.5 GiB total,
 * and its browser holds the whole bundle plus one parsed document in one heap.
 * A real document stays far below this cap: the full exercise directory is the
 * largest shipped file, and one monthly results shard holds one month of user
 * output. A file above this cap is not a real REP JOT document. Reject it at
 * parse time so the app never builds a huge object tree it cannot hold.
 *
 * 256 KiB leaves room for two or three parsed copies during a migration step
 * while staying small enough that a hostile file cannot exhaust the heap.
 */
export const MAX_DOCUMENT_BYTES = 256 * 1024;

/**
 * Deepest object or array nesting the parser accepts, counted in levels below the
 * root value.
 *
 * The shipped schemas nest about eight levels deep. 24 gives a wide margin for a
 * future schema and still stops the deep nesting that makes a recursive walk
 * overflow the stack on a small device.
 */
export const MAX_NESTING_DEPTH = 24;
