/**
 * P08-D005 — Exact JSON ingress parsing for the curation boundary.
 *
 * Authority: docs/implementation/GATES.md Section 2 (malformed input fails closed),
 * docs/REQUIREMENTS.md 13.1-13.5 (local source transform rejects malformed input),
 * specs/rep-jot-json-schema-spec.md Section 2 (exercise input/output contract).
 *
 * Engine `JSON.parse` after a non-fatal UTF-8 decode is lossy and ambiguous: invalid byte
 * sequences become U+FFFD replacement characters, duplicate object members resolve silently
 * to the last member, and out-of-range numeric literals can become Infinity. This module
 * parses untrusted ingress bytes (source checkout files, curation documents, approval inputs)
 * as exact input instead:
 *
 * - Bytes are validated as UTF-8 first; the first invalid byte offset is reported. Overlong
 *   encodings, surrogate code points, and truncated sequences are invalid.
 * - A leading UTF-8 byte-order mark (EF BB BF) is rejected with its own diagnostic; REP JOT
 *   never emits a BOM and no ingress format permits one here.
 * - The text is parsed by the exact RFC 8259 grammar: only space/tab/LF/CR are whitespace,
 *   strings use the exact escape set, unescaped control characters are invalid, numbers match
 *   the JSON number grammar and must stay finite, and nothing may follow the top-level value.
 * - Duplicate members inside one object fail closed at every nesting level; RFC 8259 leaves
 *   them ambiguous, so REP JOT rejects them instead of choosing last-wins.
 *
 * The parser sets no byte, nesting, or node thresholds (GATES.md Section 3). It is pure: no
 * file access, no clock, no randomness, no browser APIs.
 */

export type ExactJsonResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly detail: string };

function fail(detail: string): ExactJsonResult {
  return { ok: false, detail };
}

function isContinuationByte(byte: number): boolean {
  return byte >= 0x80 && byte <= 0xbf;
}

/**
 * Return whether a JSON decimal has the exact value of its binary64 result.
 * The decimal is reduced to r * 2^p * 5^q. A binary64 value is s * 2^b,
 * so q must be non-negative and the odd parts and total powers of two must match.
 */
function isExactlyRepresentedNumber(literal: string, value: number): boolean {
  let cursor = literal.charAt(0) === "-" ? 1 : 0;
  const integerStart = cursor;
  while (cursor < literal.length && literal.charAt(cursor) >= "0" && literal.charAt(cursor) <= "9") cursor += 1;
  let fractionDigits = 0;
  let digits = literal.slice(integerStart, cursor);
  if (literal.charAt(cursor) === ".") {
    cursor += 1;
    const fractionStart = cursor;
    while (cursor < literal.length && literal.charAt(cursor) >= "0" && literal.charAt(cursor) <= "9") cursor += 1;
    fractionDigits = cursor - fractionStart;
    digits += literal.slice(fractionStart, cursor);
  }
  let exponent = 0n;
  if (literal.charAt(cursor) === "e" || literal.charAt(cursor) === "E") {
    exponent = BigInt(literal.slice(cursor + 1));
  }

  let coefficient = BigInt(digits);
  if (coefficient === 0n) return value === 0;
  if (value === 0) return false;
  let twos = 0n;
  while (coefficient % 2n === 0n) {
    coefficient /= 2n;
    twos += 1n;
  }
  let fives = 0n;
  while (coefficient % 5n === 0n) {
    coefficient /= 5n;
    fives += 1n;
  }
  const decimalScale = exponent - BigInt(fractionDigits);
  const fivePower = fives + decimalScale;
  if (fivePower < 0n) return false;
  // The odd part of a binary64 significand is below 2^53.  5^24 is already
  // greater than that, so larger powers cannot be equal (without big work).
  if (fivePower > 23n) return false;

  const bits = new DataView(new ArrayBuffer(8));
  bits.setFloat64(0, Math.abs(value), false);
  const high = bits.getUint32(0, false);
  const low = bits.getUint32(4, false);
  const fraction = (BigInt(high & 0x000fffff) << 32n) | BigInt(low);
  const exponentBits = (high >>> 20) & 0x7ff;
  const significand = exponentBits === 0 ? fraction : (1n << 52n) | fraction;
  const binaryExponent = exponentBits === 0 ? -1074n : BigInt(exponentBits - 1023 - 52);

  let binaryTwos = 0n;
  let oddSignificand = significand;
  while (oddSignificand % 2n === 0n) {
    oddSignificand /= 2n;
    binaryTwos += 1n;
  }
  let decimalOdd = coefficient;
  for (let i = 0n; i < fivePower; i += 1n) decimalOdd *= 5n;
  return decimalOdd === oddSignificand && twos + decimalScale === binaryExponent + binaryTwos;
}

/** Returns the first invalid UTF-8 byte offset, or -1 when the whole buffer is valid UTF-8. */
export function firstInvalidUtf8Offset(bytes: Uint8Array): number {
  const n = bytes.length;
  let i = 0;
  while (i < n) {
    const b0 = bytes[i];
    if (b0 <= 0x7f) {
      i += 1;
      continue;
    }
    if (b0 >= 0xc2 && b0 <= 0xdf) {
      if (i + 1 >= n || !isContinuationByte(bytes[i + 1])) {
        return i;
      }
      i += 2;
      continue;
    }
    if (b0 === 0xe0) {
      // E0 must be followed by A0-BF to avoid overlong two-byte encodings.
      if (i + 2 >= n || bytes[i + 1] < 0xa0 || bytes[i + 1] > 0xbf || !isContinuationByte(bytes[i + 2])) {
        return i;
      }
      i += 3;
      continue;
    }
    if (b0 >= 0xe1 && b0 <= 0xec) {
      if (i + 2 >= n || !isContinuationByte(bytes[i + 1]) || !isContinuationByte(bytes[i + 2])) {
        return i;
      }
      i += 3;
      continue;
    }
    if (b0 === 0xed) {
      // ED must not encode UTF-16 surrogates (ED A0-BF).
      if (i + 2 >= n || bytes[i + 1] < 0x80 || bytes[i + 1] > 0x9f || !isContinuationByte(bytes[i + 2])) {
        return i;
      }
      i += 3;
      continue;
    }
    if (b0 >= 0xee && b0 <= 0xef) {
      if (i + 2 >= n || !isContinuationByte(bytes[i + 1]) || !isContinuationByte(bytes[i + 2])) {
        return i;
      }
      i += 3;
      continue;
    }
    if (b0 === 0xf0) {
      // F0 must be followed by 90-BF to avoid overlong three-byte encodings.
      if (i + 3 >= n || bytes[i + 1] < 0x90 || bytes[i + 1] > 0xbf || !isContinuationByte(bytes[i + 2]) || !isContinuationByte(bytes[i + 3])) {
        return i;
      }
      i += 4;
      continue;
    }
    if (b0 >= 0xf1 && b0 <= 0xf3) {
      if (i + 3 >= n || !isContinuationByte(bytes[i + 1]) || !isContinuationByte(bytes[i + 2]) || !isContinuationByte(bytes[i + 3])) {
        return i;
      }
      i += 4;
      continue;
    }
    if (b0 === 0xf4) {
      // F4 must not encode code points above U+10FFFF (F4 90 and up are invalid).
      if (i + 3 >= n || bytes[i + 1] < 0x80 || bytes[i + 1] > 0x8f || !isContinuationByte(bytes[i + 2]) || !isContinuationByte(bytes[i + 3])) {
        return i;
      }
      i += 4;
      continue;
    }
    // Stray continuation bytes (80-C1) and F5-FF are never valid leading bytes.
    return i;
  }
  return -1;
}

class ExactJsonParser {
  private pos = 0;

  constructor(private readonly text: string) {}

  private eof(): boolean {
    return this.pos >= this.text.length;
  }

  private peek(): string {
    return this.eof() ? "" : this.text.charAt(this.pos);
  }

  private error(message: string): Error {
    return new Error(message + " (offset " + this.pos + ")");
  }

  private skipWhitespace(): void {
    for (;;) {
      const ch = this.peek();
      if (ch !== " " && ch !== "\t" && ch !== "\n" && ch !== "\r") {
        return;
      }
      this.pos += 1;
    }
  }

  parseTopLevel(): unknown {
    this.skipWhitespace();
    if (this.eof()) {
      throw new Error("the input is empty or whitespace only");
    }
    const value = this.parseValue();
    this.skipWhitespace();
    if (!this.eof()) {
      throw this.error("unexpected content after the top-level JSON value");
    }
    return value;
  }

  private parseValue(): unknown {
    const ch = this.peek();
    switch (ch) {
      case "{":
        return this.parseObject();
      case "[":
        return this.parseArray();
      case '"':
        return this.parseString();
      case "t":
        this.expectLiteral("true");
        return true;
      case "f":
        this.expectLiteral("false");
        return false;
      case "n":
        this.expectLiteral("null");
        return null;
      default:
        if (ch === "-" || (ch >= "0" && ch <= "9")) {
          return this.parseNumber();
        }
        throw this.error('unexpected character "' + (ch === "" ? "<end of input>" : ch) + '"');
    }
  }

  private expectLiteral(literal: string): void {
    if (this.text.slice(this.pos, this.pos + literal.length) !== literal) {
      throw this.error("invalid literal; expected \"" + literal + "\"");
    }
    this.pos += literal.length;
  }

  private parseObject(): Record<string, unknown> {
    this.pos += 1; // consume "{"
    const result: Record<string, unknown> = {};
    const seen = new Set<string>();
    this.skipWhitespace();
    if (this.peek() === "}") {
      this.pos += 1;
      return result;
    }
    for (;;) {
      this.skipWhitespace();
      if (this.peek() !== '"') {
        throw this.error("expected a string member name in a JSON object");
      }
      const key = this.parseString();
      if (seen.has(key)) {
        throw new Error('duplicate member "' + key + '" in a JSON object; each member name must appear exactly once');
      }
      seen.add(key);
      this.skipWhitespace();
      if (this.peek() !== ":") {
        throw this.error("expected ':' after the member name \"" + key + "\"");
      }
      this.pos += 1;
      this.skipWhitespace();
      result[key] = this.parseValue();
      this.skipWhitespace();
      const ch = this.peek();
      if (ch === ",") {
        this.pos += 1;
        continue;
      }
      if (ch === "}") {
        this.pos += 1;
        return result;
      }
      throw this.error("expected ',' or '}' after a JSON object member");
    }
  }

  private parseArray(): unknown[] {
    this.pos += 1; // consume "["
    const result: unknown[] = [];
    this.skipWhitespace();
    if (this.peek() === "]") {
      this.pos += 1;
      return result;
    }
    for (;;) {
      this.skipWhitespace();
      result.push(this.parseValue());
      this.skipWhitespace();
      const ch = this.peek();
      if (ch === ",") {
        this.pos += 1;
        continue;
      }
      if (ch === "]") {
        this.pos += 1;
        return result;
      }
      throw this.error("expected ',' or ']' after a JSON array item");
    }
  }

  private parseString(): string {
    this.pos += 1; // consume the opening quote
    let out = "";
    for (;;) {
      if (this.eof()) {
        throw this.error("unterminated string");
      }
      const ch = this.text.charAt(this.pos);
      if (ch === '"') {
        this.pos += 1;
        return out;
      }
      if (ch === "\\") {
        this.pos += 1;
        if (this.eof()) {
          throw this.error("unterminated escape sequence");
        }
        const esc = this.text.charAt(this.pos);
        switch (esc) {
          case '"':
            out += '"';
            break;
          case "\\":
            out += "\\";
            break;
          case "/":
            out += "/";
            break;
          case "b":
            out += "\b";
            break;
          case "f":
            out += "\f";
            break;
          case "n":
            out += "\n";
            break;
          case "r":
            out += "\r";
            break;
          case "t":
            out += "\t";
            break;
          case "u": {
            const hex = this.text.slice(this.pos + 1, this.pos + 5);
            if (hex.length !== 4 || !/^[0-9a-fA-F]{4}$/.test(hex)) {
              throw this.error("invalid \\u escape; expected exactly four hexadecimal digits");
            }
            out += String.fromCharCode(parseInt(hex, 16));
            this.pos += 4;
            break;
          }
          default:
            throw this.error("invalid escape sequence '\\" + esc + "'");
        }
        this.pos += 1;
        continue;
      }
      if (ch.charCodeAt(0) < 0x20) {
        throw this.error("unescaped control character in a string");
      }
      out += ch;
      this.pos += 1;
    }
  }

  private parseNumber(): number {
    const start = this.pos;
    if (this.peek() === "-") {
      this.pos += 1;
    }
    const first = this.peek();
    if (first === "0") {
      this.pos += 1;
    } else if (first >= "1" && first <= "9") {
      while (!this.eof() && this.peek() >= "0" && this.peek() <= "9") {
        this.pos += 1;
      }
    } else {
      throw this.error("invalid number");
    }
    if (this.peek() === ".") {
      this.pos += 1;
      let digits = 0;
      while (!this.eof() && this.peek() >= "0" && this.peek() <= "9") {
        this.pos += 1;
        digits += 1;
      }
      if (digits === 0) {
        throw this.error("invalid number fraction");
      }
    }
    const exponent = this.peek();
    if (exponent === "e" || exponent === "E") {
      this.pos += 1;
      const sign = this.peek();
      if (sign === "+" || sign === "-") {
        this.pos += 1;
      }
      let digits = 0;
      while (!this.eof() && this.peek() >= "0" && this.peek() <= "9") {
        this.pos += 1;
        digits += 1;
      }
      if (digits === 0) {
        throw this.error("invalid number exponent");
      }
    }
    const literal = this.text.slice(start, this.pos);
    const value = Number(literal);
    if (!Number.isFinite(value)) {
      throw this.error("number " + literal + " is outside the finite range and would be parsed lossily");
    }
    if (!isExactlyRepresentedNumber(literal, value)) {
      throw this.error("number " + literal + " is not exactly representable as a JavaScript number");
    }
    return value;
  }
}

/**
 * Parse exact ingress bytes into a JavaScript value, or fail with an actionable detail.
 *
 * Failures distinguish: leading byte-order mark, invalid UTF-8 (with byte offset), and JSON
 * grammar violations including duplicate members (with the member name). No partial value is
 * ever returned; callers must not fall back to engine `JSON.parse`.
 */
export function parseExactJson(bytes: Uint8Array): ExactJsonResult {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return fail("the input begins with a UTF-8 byte-order mark (EF BB BF); remove the BOM");
  }
  const badOffset = firstInvalidUtf8Offset(bytes);
  if (badOffset !== -1) {
    return fail("invalid UTF-8 at byte offset " + badOffset + "; the input must be valid UTF-8");
  }
  // The buffer is validated UTF-8, so this decode cannot substitute replacement characters.
  const text = new TextDecoder("utf-8").decode(bytes);
  let value: unknown;
  try {
    value = new ExactJsonParser(text).parseTopLevel();
  } catch (error) {
    return fail(error instanceof Error ? error.message : "the input is not valid JSON");
  }
  return { ok: true, value };
}
