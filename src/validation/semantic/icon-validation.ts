/** Build-time validation for icon references in the static exercises directory (P7-T01).
 *
 * JSON Schema owns the icon shape. This boundary additionally checks Material Symbol names against
 * an injected reviewed manifest and checks each bundle-relative SVG through an injected file port.
 * Runtime code must use the resulting path as an <img> source; this module never returns SVG source.
 */
import * as sax from "sax";
import type { QualifiedTag } from "sax";

import { finalizeDiagnostics, joinPointer } from "./types";

export type IconValidationCode =
  | "material-symbol-unlisted"
  | "local-svg-path-unsafe"
  | "local-svg-missing"
  | "local-svg-outside-root"
  | "svg-malformed"
  | "svg-doctype-forbidden"
  | "svg-processing-instruction-forbidden"
  | "svg-forbidden-element"
  | "svg-event-attribute-forbidden"
  | "svg-external-reference-forbidden"
  | "svg-style-forbidden";

export interface IconValidationDiagnostic {
  readonly code: IconValidationCode;
  /** JSON Pointer to the icon name or path. */
  readonly path: string;
  readonly message: string;
}

export interface IconValidationResult {
  readonly valid: boolean;
  readonly diagnostics: readonly IconValidationDiagnostic[];
}

export interface IconFileAccess {
  /** Canonical path of the configured static root. */
  rootRealPath(): Promise<string>;
  /** Canonical path of an existing file, or null when it does not exist or is not a regular file. */
  fileRealPath(candidatePath: string): Promise<string | null>;
  readBytes(realPath: string): Promise<Uint8Array>;
}

export interface IconValidationOptions {
  readonly staticRoot: string;
  readonly materialSymbols: ReadonlySet<string>;
  readonly files: IconFileAccess;
}

const MESSAGES: Readonly<Record<IconValidationCode, string>> = {
  "material-symbol-unlisted": "the Material Symbol is not in the reviewed glyph manifest",
  "local-svg-path-unsafe": "the local SVG path is not a safe bundle-relative path",
  "local-svg-missing": "the local SVG file is missing or is not a regular file",
  "local-svg-outside-root": "the local SVG resolves outside the static root",
  "svg-malformed": "the local SVG is not well-formed SVG XML",
  "svg-doctype-forbidden": "SVG document type declarations are forbidden",
  "svg-processing-instruction-forbidden": "SVG processing instructions are forbidden",
  "svg-forbidden-element": "the SVG contains an active or embedded-content element",
  "svg-event-attribute-forbidden": "the SVG contains an event-handler attribute",
  "svg-external-reference-forbidden": "the SVG contains an external reference",
  "svg-style-forbidden": "the SVG contains style content"
};

function diagnostic(code: IconValidationCode, path: string): IconValidationDiagnostic {
  return { code, path, message: MESSAGES[code] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A deliberately narrow portable path grammar. Backslashes, escapes, query strings, and dot segments are rejected. */
export function isSafeLocalSvgPath(value: string): boolean {
  if (value.length === 0 || value.charAt(0) === "/" || value.indexOf("\\") !== -1 || value.indexOf(":") !== -1) {
    return false;
  }
  if (value.indexOf("?") !== -1 || value.indexOf("#") !== -1 || value.indexOf("%") !== -1 || !/\.svg$/.test(value)) {
    return false;
  }
  const parts = value.split("/");
  for (const part of parts) {
    if (part.length === 0 || part === "." || part === ".." || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(part)) {
      return false;
    }
  }
  return true;
}

function isWithinRoot(root: string, candidate: string): boolean {
  const normalizedRoot = root.replace(/[\\/]+$/, "");
  if (candidate === normalizedRoot) {
    return true;
  }
  const separator = normalizedRoot.indexOf("\\") !== -1 ? "\\" : "/";
  return candidate.indexOf(normalizedRoot + separator) === 0;
}

const FORBIDDEN_ELEMENTS = new Set([
  "script", "handler", "listener", "style", "foreignobject", "iframe", "object", "embed", "audio", "video", "canvas",
  // Links can navigate or send `ping` requests and are unnecessary in a static icon.
  "a",
  // SMIL can rewrite a safe fragment href to a remote href after load. Static exercise icons do not need animation.
  "animate", "animatemotion", "animatetransform", "set", "discard"
]);
const REFERENCE_ATTRIBUTES = new Set(["href", "src"]);

function hasUnsafeUrl(value: string): boolean {
  // CSS escapes and comments can spell `url` without containing those literal characters. Static icon
  // attributes do not need either syntax, so reject them before looking for a URL token.
  if (value.indexOf("\\") !== -1 || value.indexOf("/*") !== -1 || value.indexOf("*/") !== -1) {
    return true;
  }
  if (value.toLowerCase().indexOf("url") === -1) {
    return false;
  }
  // Permit only one simple same-document paint-server reference. Reject fallbacks and obfuscation.
  return !/^url\(\s*(['"]?)#[A-Za-z_][A-Za-z0-9_.:-]*\1\s*\)$/i.test(value);
}

function isQualifiedTag(tag: sax.Tag | QualifiedTag): tag is QualifiedTag {
  return "local" in tag;
}

function hasIllegalXmlCharacter(source: string): boolean {
  for (let i = 0; i < source.length; i += 1) {
    const unit = source.charCodeAt(i);
    if ((unit < 0x20 && unit !== 0x09 && unit !== 0x0a && unit !== 0x0d) || unit === 0xfffe || unit === 0xffff) {
      return true;
    }
    if (unit >= 0xd800 && unit <= 0xdbff) {
      if (i + 1 >= source.length) {
        return true;
      }
      const next = source.charCodeAt(i + 1);
      if (next < 0xdc00 || next > 0xdfff) {
        return true;
      }
      i += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return true;
    }
  }
  return false;
}

/** Parse one SVG and report active content. The source is validated only; it is never returned for runtime insertion. */
export function validateSvgSource(source: string, path: string): IconValidationDiagnostic[] {
  const found: IconValidationDiagnostic[] = [];
  let rootSeen = false;
  let parseFailed = hasIllegalXmlCharacter(source);
  let depth = 0;
  let attributeNames = new Set<string>();
  const parser = sax.parser(true, { xmlns: true, position: false });

  parser.ondoctype = () => found.push(diagnostic("svg-doctype-forbidden", path));
  parser.onprocessinginstruction = () => found.push(diagnostic("svg-processing-instruction-forbidden", path));
  parser.onerror = () => {
    parseFailed = true;
    parser.resume();
  };
  parser.onopentagstart = () => {
    attributeNames = new Set<string>();
  };
  parser.onattribute = (attribute) => {
    if (attributeNames.has(attribute.name)) {
      parseFailed = true;
    }
    attributeNames.add(attribute.name);
  };
  parser.onopentag = (rawTag) => {
    if (depth === 0 && rootSeen) {
      parseFailed = true;
    }
    depth += 1;
    if (!isQualifiedTag(rawTag)) {
      parseFailed = true;
      return;
    }
    const tag = rawTag;
    const local = tag.local.toLowerCase();
    if (!rootSeen) {
      rootSeen = true;
      if (local !== "svg" || tag.uri !== "http://www.w3.org/2000/svg") {
        parseFailed = true;
      }
    } else if (tag.uri !== "http://www.w3.org/2000/svg") {
      // Foreign XML vocabularies bring their own active elements and URL-valued attributes.
      found.push(diagnostic("svg-forbidden-element", path));
    }
    if (FORBIDDEN_ELEMENTS.has(local)) {
      found.push(diagnostic(local === "style" ? "svg-style-forbidden" : "svg-forbidden-element", path));
    }
    const expandedAttributeNames = new Set<string>();
    for (const key of Object.keys(tag.attributes)) {
      const attribute = tag.attributes[key];
      const attributeLocal = attribute.local.toLowerCase();
      const expandedName = attribute.uri + "\u0000" + attributeLocal;
      if (expandedAttributeNames.has(expandedName)) {
        parseFailed = true;
      }
      expandedAttributeNames.add(expandedName);
      const value = attribute.value.trim();
      if (/^on/i.test(attributeLocal)) {
        found.push(diagnostic("svg-event-attribute-forbidden", path));
      }
      if (attributeLocal === "style") {
        found.push(diagnostic("svg-style-forbidden", path));
      }
      const attributeNamespace = attribute.uri;
      const xmlNamespace = "http://www.w3.org/XML/1998/namespace";
      const xmlnsNamespace = "http://www.w3.org/2000/xmlns/";
      const xlinkNamespace = "http://www.w3.org/1999/xlink";
      // xml:base changes every fragment reference into a potentially remote reference. Check its
      // namespace URI too, because permissive parsers can expose an illegally aliased XML prefix.
      if ((attribute.prefix.toLowerCase() === "xml" || attributeNamespace === xmlNamespace) && attributeLocal === "base") {
        found.push(diagnostic("svg-external-reference-forbidden", path));
      }
      if (
        attributeNamespace !== "" &&
        attributeNamespace !== xmlnsNamespace &&
        !(attributeNamespace === xmlNamespace && (attributeLocal === "lang" || attributeLocal === "space")) &&
        !(attributeNamespace === xlinkNamespace && attributeLocal === "href")
      ) {
        found.push(diagnostic("svg-forbidden-element", path));
      }
      if (REFERENCE_ATTRIBUTES.has(attributeLocal) && value.charAt(0) !== "#") {
        found.push(diagnostic("svg-external-reference-forbidden", path));
      }
      if (hasUnsafeUrl(value)) {
        found.push(diagnostic("svg-external-reference-forbidden", path));
      }
    }
  };
  parser.onclosetag = () => {
    depth -= 1;
    if (depth < 0) {
      parseFailed = true;
    }
  };

  try {
    parser.write(source).close();
  } catch (_error) {
    parseFailed = true;
  }
  if (!rootSeen || parseFailed) {
    found.push(diagnostic("svg-malformed", path));
  }
  return finalizeDiagnostics(found);
}

interface IconLocation {
  readonly icon: Record<string, unknown>;
  readonly basePath: string;
}

function iconLocations(document: unknown): IconLocation[] {
  if (!isRecord(document)) {
    return [];
  }
  const result: IconLocation[] = [];
  const groups: Array<{ value: unknown; path: string }> = [
    { value: document["equipment"], path: "/equipment" },
    { value: document["exercises"], path: "/exercises" }
  ];
  for (const group of groups) {
    if (!Array.isArray(group.value)) {
      continue;
    }
    for (let i = 0; i < group.value.length; i += 1) {
      const entry = group.value[i];
      if (isRecord(entry) && isRecord(entry["icon"])) {
        result.push({ icon: entry["icon"], basePath: joinPointer(group.path, i, "icon") });
      }
    }
  }
  return result;
}

/** Validate all schema-shaped icon references. Callers run schema validation first. */
export async function validateTrustedLocalIcons(
  exercisesDocument: unknown,
  options: IconValidationOptions
): Promise<IconValidationResult> {
  const found: IconValidationDiagnostic[] = [];
  const root = await options.files.rootRealPath();
  for (const location of iconLocations(exercisesDocument)) {
    if (location.icon["type"] === "material_symbol" && typeof location.icon["name"] === "string") {
      if (!options.materialSymbols.has(location.icon["name"])) {
        found.push(diagnostic("material-symbol-unlisted", joinPointer(location.basePath, "name")));
      }
      continue;
    }
    if (location.icon["type"] !== "local_svg" || typeof location.icon["path"] !== "string") {
      continue; // shape belongs to JSON Schema
    }
    const iconPath = location.icon["path"];
    const pointer = joinPointer(location.basePath, "path");
    if (!isSafeLocalSvgPath(iconPath)) {
      found.push(diagnostic("local-svg-path-unsafe", pointer));
      continue;
    }
    const candidate = options.staticRoot.replace(/[\\/]+$/, "") + "/" + iconPath;
    const realPath = await options.files.fileRealPath(candidate);
    if (realPath === null) {
      found.push(diagnostic("local-svg-missing", pointer));
      continue;
    }
    if (!isWithinRoot(root, realPath)) {
      found.push(diagnostic("local-svg-outside-root", pointer));
      continue;
    }
    let bytes: Uint8Array;
    try {
      bytes = await options.files.readBytes(realPath);
    } catch (_error) {
      found.push(diagnostic("local-svg-missing", pointer));
      continue;
    }
    let source: string;
    try {
      source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch (_error) {
      found.push(diagnostic("svg-malformed", pointer));
      continue;
    }
    found.push(...validateSvgSource(source, pointer));
  }
  const diagnostics = finalizeDiagnostics(found);
  return { valid: diagnostics.length === 0, diagnostics };
}
