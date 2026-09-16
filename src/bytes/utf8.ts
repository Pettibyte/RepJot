// UTF-8 encode and decode in one place.
//
// The app moves bytes between a binary world (Drive media, Blob downloads,
// IndexedDB) and a text world (JSON documents). Every crossing between the two
// is a lossy step for bytes that are not valid UTF-8, so the crossing lives in
// one module where it can be seen, not spread across the callers that happen to
// need it.
//
// The rule this module exists to enforce: a file the user asked for comes back as
// the bytes they stored. Decoding to text is a choice a caller makes when it
// must parse, never something a read does on the caller's behalf.
// REQUIREMENTS 12.10.
//
// `TextDecoder` and `TextEncoder` are both listed as available on the targeted
// Kindle Silk build. docs/CAPABILITIES-kindle-scribe.md.

/** The one codec the app uses. */
const UTF8 = 'utf-8';

/** Encode text to UTF-8 bytes. */
export function encodeUtf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/**
 * Decode UTF-8 bytes to text.
 *
 * Bytes that are not valid UTF-8 become U+FFFD. That is fine for a file the
 * caller is about to parse, because the parse will fail and say so. It is not
 * fine for a file the caller is about to hand back to the user unchanged, so
 * such a caller must not decode at all.
 */
export function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder(UTF8).decode(bytes);
}
