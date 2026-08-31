# Decision D-02: Byte-order mark policy for document parsing

**Status: APPROVED — Option BOM-2.** The product owner approved the byte-order mark policy in the parent orchestrator session; no approver name or date is recorded beyond this document. The approved policy, binding on Phase 12 and contract row FF-14:

- Canonical JSON parsing supports exactly one leading UTF-8 BOM (`EF BB BF`). If and only if the source bytes begin with `EF BB BF`, remove those three bytes for the parsed/validated view, then decode UTF-8 strictly and parse. A repeated BOM, or a BOM anywhere except offset 0, is invalid at the parsing stage with a distinct diagnostic (FF-14 failure behavior).
- The strip applies only to the parsed/validated view. Cache, recovery, and export preserve the exact original bytes, BOM included.
- REP JOT never emits a BOM in any written document (RFC 8259 prohibits adding a BOM to JSON text; canonical writers already comply).

## 1. Constraint context

- Parsing entry (contract FF-14): source bytes are decoded and parsed once as exact bytes; malformed encoding or JSON fails the document with source bytes preserved, pending edits kept, and remote bytes never overwritten.
- `JSON.parse` on a string beginning with U+FEFF raises a syntax error, but the default UTF-8 `TextDecoder` silently strips a leading BOM. The two behaviors are different contracts; "exact bytes" does not by itself choose between them.
- RFC 8259 (external reference for JSON platform behavior only) prohibits implementations from *adding* a BOM to JSON text; it does not mandate reader acceptance or rejection.

## 2. Options

### Option BOM-1 — Reject documents with a leading byte-order mark

- Policy: a UTF-8 BOM (`EF BB BF`) at offset 0 makes the document invalid at the parsing stage with a distinct "byte order mark present" diagnostic; the document is treated like any other malformed input (FF-14 failure behavior). Decoding must not strip the BOM (e.g. `TextDecoder` used with explicit no-BOM handling, or a pre-check of the first three bytes).
- Rationale: canonical REP JOT writers never emit a BOM; rejection is fail-closed and matches "parse exact bytes" with no special case.
- Cost: one explicit check; a third-party file saved with a BOM must be re-saved externally (existing recovery path: raw download, external repair).

### Option BOM-2 — Strip exactly one leading UTF-8 BOM before strict decoding

- Policy: if and only if the bytes begin with `EF BB BF`, remove those three bytes, then decode UTF-8 strictly and parse; a second BOM anywhere is invalid. The stripped document still runs the full envelope, schema, migration, and semantic pipeline unchanged; source bytes (with BOM) are retained for cache and export fidelity.
- Rationale: tolerates editor-produced files without weakening any later stage.
- Cost: an explicit exception to "exact bytes"; cache must store original bytes while validating the stripped form, which the decision must state.

## 3. Binding rule

The parser implements Option BOM-2 as approved above. `docs/implementation/phase-12.md`'s "documented byte-order mark policy" is this document; Phase 12's parsing stage is unblocked. Existing Phase 0 code performs no canonical-document parsing and is unaffected.

## 4. Approval record

| Field | Value |
| --- | --- |
| Approved option | Option BOM-2 — Strip exactly one leading UTF-8 BOM before strict decoding (policy restated in the status block) |
| Approver / date / evidence link | Approval supplied by the product owner in the parent orchestrator session (no name recorded) / NOT PROVIDED / this document (`docs/decisions/document-parsing-byte-order-mark.md`) |
