/**
 * Parse stage: one strict UTF-8 decode and exactly one `JSON.parse` over the caller's exact bytes
 * (P12-T01).
 *
 * Authority: docs/implementation/phase-12.md ("Retain the input `Uint8Array` unchanged. Apply the
 * documented byte-order mark policy. Decode UTF-8 strictly. Parse once as `unknown`. Use iterative
 * project traversals where possible. Add no byte, nesting, or node rejection threshold."),
 * docs/contracts/families-and-files.md FF-14 ("source bytes are decoded and parsed once as exact bytes
 * with no project byte, nesting, or node thresholds; malformed encoding or JSON fails the document"),
 * docs/decisions/document-parsing-byte-order-mark.md (D-02, approved Option BOM-2), docs/ARCHITECTURE.md
 * Section 12 row "JSON parsing" ("Parse source bytes as `unknown`", failure column "Report invalid JSON.
 * Keep pending edits and last valid cache. Never overwrite remote bytes."), Section 14 ("Release one
 * sets no fixed document-size or memory budget"), and Section 15 ("Drive and static JSON enter the same
 * parse, size-limit, schema, migration, and semantic pipeline").
 *
 * No project limit appears here, and none can be derived from anything in this file. There is no
 * byte-length test, no depth counter, no key-length test, no node count, and no early rejection of a
 * large or deep valid document: FF-14 states the limit as "no project byte, nesting, or node thresholds"
 * and Section 14 states that Release one sets no fixed document-size or memory budget. The only
 * byte-value tests in this file are the three bytes of one marker signature and the four RFC 8259
 * whitespace bytes; neither is a size of any kind. A document of any size or depth this engine can
 * parse is accepted here.
 *
 * One strict decode, one parse, no fallback. The decode uses `fatal: true`, so ill-formed UTF-8 throws
 * instead of yielding a U+FFFD substitution character, which is what "Decode UTF-8 strictly" requires:
 * a substitution character never reaches the parser, while a U+FFFD that the source really encodes is
 * ordinary content and stays. `JSON.parse` is called exactly once on the decoded text, its result is
 * returned as `unknown`, and there is no second parse, no alternate parser, and no project JSON grammar.
 * `src/curation/exact-json.ts` is deliberately not imported: it is a recursive-descent parser that
 * rejects valid deeply nested input with "Maximum call stack size exceeded", which would itself be a
 * project nesting threshold and would fail FF-14. Nothing in this module reads the parsed value, so no
 * shape, envelope, family, version, or migration decision happens here (Phases 13 and 14), and nothing
 * is written, so no remote byte can be touched (FF-14, FF-20).
 *
 * Byte-order mark policy, exactly D-02 Option BOM-2 and FF-14. `EF BB BF` is stripped when and only when
 * it sits at byte offset 0, and the strip reaches only the decoded view handed to the parser: this module
 * never copies, re-slices in place, writes, or replaces the caller's array, so the caller still holds the
 * exact original bytes for cache, recovery, and export. A repeated marker, or one at any offset greater
 * than 0 inside the whitespace prologue that follows, is rejected with the distinct `byte-order-mark`
 * reason. The check is a marker-position check over the prologue, never a whole-document byte scan: the
 * three bytes of a marker are legal UTF-8 content inside a JSON string, so a scan of the whole document
 * would reject valid input, which FF-14 forbids. This module never emits a marker (D-02, RFC 8259).
 *
 * Error shape, and why one engine failure cannot escape. `src/documents/pipeline-types.ts` fixes
 * `ParseFailureReason` at exactly three members (`invalid-utf8`, `malformed-json`, `byte-order-mark`)
 * and that module is accepted and closed, so a fourth reason for an engine-side resource failure cannot
 * be added here. Because of that closed set, every engine failure on this path is mapped into the set
 * instead of escaping as an exception, and the three engine operations that can fail — the decoder
 * construction, the decode, and the single `JSON.parse` call — each sit behind a catch boundary. A
 * `TypeError` thrown by the fatal decode operation is the encoding failure `invalid-utf8`, and any other
 * throw — a failure of the decoder constructor, a `SyntaxError` from the parser, or a resource failure
 * such as a `RangeError` — is the non-encoding member `malformed-json`. That mapping is
 * a consequence of the closed reason set fixed by the accepted Phase 11 module, not a new contract, and
 * such a failure stays a measurement rather than becoming a limit.
 *
 * Purity and dependencies. docs/ARCHITECTURE.md Section 7 places this path in the document pipeline,
 * whose dependency column allows "Schema, migration, semantic validation"; this module needs none of
 * them and imports one accepted Phase 11 module for the error constructor and its types. It performs no
 * I/O of any kind: no `fetch`, DOM, IndexedDB, Svelte, Drive, filesystem, clock, random, locale, or eval,
 * which is how `docs/implementation/GATES.md` Section 3 states the purity check for this workstream. It
 * holds no module state, so the exported function is a pure function of its one argument, and it uses no
 * syntax newer than ES2019 (docs/ARCHITECTURE.md Section 14: the build scans every executable output for
 * optional chaining and nullish coalescing) and no capability the Kindle Scribe report in
 * `docs/CAPABILITIES-kindle-scribe.md` does not mark Supported ("TextEncoder and TextDecoder | Supported",
 * "Typed arrays | Supported"). Nothing is frozen: deep-freezing a huge parsed document is a cost with no
 * requirement behind it, and the parsed value belongs to the caller.
 *
 * Capability claim, bounded. This module adds no capability the Kindle Scribe report does not already
 * record as Supported: "TextEncoder and TextDecoder | Supported" and "Typed arrays | Supported". Its one
 * engine parser is `JSON.parse`, core JSON behaviour already used at runtime by `src/google-identity.ts`,
 * so nothing new is introduced on this path. Per docs/ARCHITECTURE.md Section 14, "API presence in the
 * capability report does not prove complete behavior", so no device behaviour is claimed here and no
 * desktop measurement is read as a device result: physical Kindle evidence belongs to Phase 89.
 */

import { makePipelineError } from "./pipeline-types";
import type { ParseFailureReason, PipelineErrorFor } from "./pipeline-types";

// ---------------------------------------------------------------------------
// Byte signatures. These are value tests, never size tests.
// ---------------------------------------------------------------------------

/** The three bytes of the UTF-8 encoding of U+FEFF, the byte-order mark (D-02). */
const MARK_BYTE_FIRST = 0xef;
const MARK_BYTE_SECOND = 0xbb;
const MARK_BYTE_THIRD = 0xbf;

/** How many bytes one marker signature occupies, used only to start the decoded view past offset 0. */
const MARK_BYTE_COUNT = 3;

/** The four whitespace bytes of RFC 8259 Section 2; they are the only bytes a prologue may contain. */
const WHITESPACE_SPACE = 0x20;
const WHITESPACE_TAB = 0x09;
const WHITESPACE_LINE_FEED = 0x0a;
const WHITESPACE_CARRIAGE_RETURN = 0x0d;

/** The one encoding label this stage accepts (FF-14 "decoded ... as exact bytes", strict UTF-8). */
const UTF8_LABEL = "utf-8";

// ---------------------------------------------------------------------------
// Result shape
// ---------------------------------------------------------------------------

/**
 * What the parse stage needs from its caller: the canonical logical filename the eventual error names
 * (FF-06, Section 16 `logicalName`), and the exact source bytes. The bytes stay the caller's. Phase 16
 * owns provenance and the digest over those bytes and Phase 11 fixed their place in
 * `DocumentProvenance.sourceBytes`, so this stage copies nothing and returns no byte reference.
 */
export interface SafeJsonParseInput {
  readonly logicalName: string;
  readonly bytes: Uint8Array;
}

/**
 * A parse-stage outcome: the one parsed `unknown` value, or the one typed rejection this stage can
 * produce. It is not the accepted `PipelineResult`, because that type carries a
 * `DocumentProvenance` (Phase 16) and names the stage the whole load reached (Phase 15); this stage
 * answers only "what do these bytes parse to". A success is not a model: envelope recognition (Phase 13)
 * decides whether the root is an acceptable document, so a primitive, array, or `null` root is a
 * success here and a rejection there.
 */
export type SafeJsonParseResult =
  | { readonly status: "parsed"; readonly value: unknown }
  | { readonly status: "rejected"; readonly error: PipelineErrorFor<"parse-failed"> };

// ---------------------------------------------------------------------------
// Byte-order mark position (D-02 Option BOM-2, FF-14)
// ---------------------------------------------------------------------------

/**
 * Whether the three marker bytes start at `offset`. A read past the end of a `Uint8Array` yields
 * `undefined`, which compares unequal to every byte value, so a short tail is simply not a marker and no
 * length comparison is needed.
 */
function hasMarkAt(bytes: Uint8Array, offset: number): boolean {
  return (
    bytes[offset] === MARK_BYTE_FIRST &&
    bytes[offset + 1] === MARK_BYTE_SECOND &&
    bytes[offset + 2] === MARK_BYTE_THIRD
  );
}

/** Whether one byte is JSON whitespace. Only these bytes may stand between a marker and a document. */
function isJsonWhitespace(byte: number): boolean {
  return byte === WHITESPACE_SPACE || byte === WHITESPACE_TAB || byte === WHITESPACE_LINE_FEED || byte === WHITESPACE_CARRIAGE_RETURN;
}

/**
 * Whether a marker sits at an offset greater than `from` inside the whitespace prologue that follows the
 * accepted offset-0 marker. `from` is 3 when offset 0 held the accepted marker and 0 when it did not, so
 * the one legal marker is never reported and a second one always is. The loop is flat — no recursion —
 * and stops at the first byte that is neither a marker nor JSON whitespace, so the scan never enters the
 * document body and a U+FEFF inside a JSON string is never inspected (FF-14 "Valid UTF-8 JSON parses to
 * `unknown`").
 */
function hasMarkAfterOffsetZero(bytes: Uint8Array, from: number): boolean {
  let offset = from;
  while (offset < bytes.length) {
    if (offset > 0 && hasMarkAt(bytes, offset)) {
      return true;
    }
    if (!isJsonWhitespace(bytes[offset])) {
      return false;
    }
    offset += 1;
  }
  return false;
}

// ---------------------------------------------------------------------------
// The stage
// ---------------------------------------------------------------------------

/**
 * The one rejection this stage can produce. `stage`, `userCategory`, `retryable`, and `safeMessage` come
 * from the accepted Phase 11 descriptor for `parse-failed`, and the safe context carries only the closed
 * reason: no engine message, no document text, no byte, and no value read from the document ever reaches
 * a caller (docs/ARCHITECTURE.md Section 15). The caller's bytes are untouched on this path, which is
 * what FF-14 states as "input bytes preserved, no overwrite" and FF-20 as the corrupt source staying
 * available for raw download and external repair.
 */
function rejectParse(logicalName: string, reason: ParseFailureReason): SafeJsonParseResult {
  return {
    status: "rejected",
    error: makePipelineError({ kind: "parse-failed", logicalName: logicalName, safeContext: { reason: reason } })
  };
}

/**
 * Parse the exact bytes of one logical document.
 *
 * The sequence is fixed: locate the offset-0 marker, reject a marker at any later offset in the
 * whitespace prologue, decode the remaining bytes once with a fatal UTF-8 decoder, and call
 * `JSON.parse` once. Every input of every status keeps the caller's `Uint8Array` byte for byte as it
 * arrived, because this function has no write path to it: the fatal decoder and `JSON.parse` both take
 * their input read-only, and the only derived value is a decoded string.
 */
export function parseDocumentBytes(input: SafeJsonParseInput): SafeJsonParseResult {
  const bytes = input.bytes;
  const markLength = hasMarkAt(bytes, 0) ? MARK_BYTE_COUNT : 0;

  if (hasMarkAfterOffsetZero(bytes, markLength)) {
    return rejectParse(input.logicalName, "byte-order-mark");
  }

  // Without a marker the decoder gets the caller's own array. With one it gets a read-only view that
  // starts after those three bytes: a view shares the same buffer, so nothing is copied, written, or
  // replaced, and the caller keeps the exact original bytes that cache, recovery, and export must retain
  // with the marker included (D-02, FF-14).
  const bytesForDecoding = markLength === 0 ? bytes : bytes.subarray(markLength);

  // Constructed per call so the module holds no state and the function stays a pure function of its
  // argument. `fatal` is the strictness requirement: it makes ill-formed UTF-8 throw instead of
  // substituting U+FFFD. `ignoreBOM` keeps the marker decision in this module rather than inside the
  // decoder; the view above can never begin with a marker, because the offset-0 marker was consumed and a
  // second one was rejected above.
  //
  // The construction sits behind a catch boundary of its own, ahead of the decode, because a platform
  // resource failure can strike there too (phase-12.md edge case "platform resource failure") and no
  // engine failure may escape this stage. A constructor failure says nothing about how these bytes are
  // encoded, so it takes the closed set's non-encoding member, per the closed-set note in the header.
  let strictUtf8: TextDecoder;
  try {
    strictUtf8 = new TextDecoder(UTF8_LABEL, { fatal: true, ignoreBOM: true });
  } catch {
    return rejectParse(input.logicalName, "malformed-json");
  }

  let text: string;
  try {
    text = strictUtf8.decode(bytesForDecoding);
  } catch (decodeFailure) {
    // A fatal decode reports ill-formed UTF-8 as a TypeError, which is the encoding member of the closed
    // reason set. Any other throw is not an encoding decision and takes `malformed-json`, per the
    // closed-set note in the header: the reason set belongs to the accepted Phase 11 module, so no
    // fourth reason exists to name a platform failure with, and nothing escapes as an exception.
    return rejectParse(input.logicalName, decodeFailure instanceof TypeError ? "invalid-utf8" : "malformed-json");
  }

  let value: unknown;
  try {
    // The one parse. The result is handed back as `unknown` and is never read here.
    value = JSON.parse(text);
  } catch {
    // A `SyntaxError` for text that is not one JSON value — empty input included — and any engine
    // resource failure are the malformed-JSON member of the closed reason set, never an exception.
    return rejectParse(input.logicalName, "malformed-json");
  }

  return { status: "parsed", value: value };
}
