// The in-memory holder for raw payload text that **View Raw JSON** opens.
// ARCHITECTURE ADR-017 and section 12.9. REQUIREMENTS 6.8 and 6.9.
//
// Why a store and not a route param. A raw document can run to hundreds of
// kilobytes. A hash carries an id, never the payload, so a bookmarked raw URL
// stays short and the address bar never holds a user document.
//
// The store is memory-only on purpose. Raw bytes are the user's private data, so
// nothing here writes to `localStorage`, IndexedDB, or the diagnostic log. A
// page reload clears it, which is why the raw screen says so instead of showing
// a stale copy.
//
// The stored text is exactly what the caller passed. No parse, no reformat, no
// interpretation. The viewer renders it through interpolation only.

/** Upper bound on retained payloads. The oldest entry leaves when the cap fills. */
const MAX_PAYLOADS = 8;

/** Random source shape. Matches the guard in `domain/ids.ts`. */
interface RandomSource {
  getRandomValues?: (bytes: Uint8Array) => unknown;
}

/** Payload text by key. Insertion order drives the eviction. */
const payloads = new Map<string, string>();

/**
 * Key prefix.
 *
 * A bare hex key can come out all digits, and an all-digit key breaks the
 * ordering rules this project applies to every map key. The prefix makes a key
 * never integer-like, whatever the random bytes return.
 */
const KEY_PREFIX = 'rp-';

/** Lowercase hex for one byte, zero-padded. */
function toHex(value: number): string {
  return (value + 0x100).toString(16).slice(1);
}

/**
 * Create a short, unguessable key for one payload.
 *
 * Four random bytes as hex, behind the `rp-` prefix. The key authorizes nothing;
 * it only names a slot in this page's memory.
 */
function createKey(): string {
  const source: RandomSource | undefined = (globalThis as { crypto?: RandomSource }).crypto;
  const bytes = new Uint8Array(4);
  if (source !== undefined && typeof source.getRandomValues === 'function') {
    source.getRandomValues(bytes);
  } else {
    // A host with no random source still needs a distinct key per payload. The
    // key is not a secret here: nothing authorizes with it, and the payload is
    // already in this page's memory.
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  return `${KEY_PREFIX}${Array.from(bytes, toHex).join('')}`;
}

/**
 * Store one raw payload and return its key.
 *
 * The caller passes the stored bytes as text. The store keeps them unchanged.
 */
export function putRawPayload(text: string): string {
  const key = createKey();
  // Evict the oldest entry first, so the newest payload a user opens always
  // survives and the cap holds.
  if (payloads.size >= MAX_PAYLOADS) {
    const oldest = payloads.keys().next();
    if (oldest.done === false) payloads.delete(oldest.value);
  }
  payloads.set(key, text);
  return key;
}

/** The stored text for one key, or `undefined` when nothing is held. */
export function getRawPayload(key: string): string | undefined {
  return payloads.get(key);
}

/** How many payloads are held. For tests and diagnostics. */
export function rawPayloadCount(): number {
  return payloads.size;
}

/**
 * Drop every payload.
 *
 * A caller invokes this when the account changes so a raw payload from the old
 * account cannot open under the new one.
 */
export function clearRawPayloads(): void {
  payloads.clear();
}
