/**
 * Scan helpers for the release compatibility gate.
 *
 * `scripts/check-browser-compat.ts` runs these helpers over the built bundle and
 * over `src/`. This module holds the scan logic only. It reads nothing and prints
 * nothing, so a test can call it against a bundle built into a temp directory.
 * See "Remote origin policy" and "Secret scan" in `docs/RELEASE.md`.
 *
 * Two scans live here:
 *
 * 1. The remote origin scan. A URL counts only when a network-capable call
 *    carries it. Two passes find those calls, because the same code looks
 *    different in readable source and in a minified bundle:
 *    - `contextWindowHosts` reads the text before each URL for a call pattern.
 *      This catches a URL written at the call site, such as
 *      `a.href = 'https://example.com'`.
 *    - `callArgumentHosts` reads each call argument and resolves the argument
 *      through the string bindings in the same file. This catches a URL stored
 *      in a name, such as `var X="https://example.com";fetch(X,{method:"POST"})`.
 *    The gate runs both passes over both trees.
 * 2. The secret scan. `scanSecrets` matches credential shapes against one text.
 */

/** Hosts the released app may reach. Everything else fails the origin scan. */
export const ALLOWED_ORIGINS: readonly string[] = [
  'accounts.google.com',
  'myaccount.google.com',
  'oauth2.googleapis.com',
  'www.googleapis.com'
];

/** Text file extensions the scans read. Binary files are skipped. */
export const SCANNED_EXTENSIONS: readonly string[] = [
  '.js', '.css', '.html', '.json', '.txt', '.md', '.svg', '.xml', '.map', '.cname'
];

/**
 * Credential shapes the secret scan looks for.
 *
 * `GOCSPX-` is the shipped shape of this project's own Google OAuth
 * web-application client secret: the prefix followed by 32 characters. A
 * developer can paste that value by mistake, so the scan names it directly.
 */
export const SECRET_PATTERNS: ReadonlyArray<{ name: string; re: RegExp }> = [
  { name: 'OAuth client secret', re: /client[_-]?secret/i },
  { name: 'PEM private key', re: /BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY/ },
  { name: 'Google access token', re: /ya29\.[A-Za-z0-9._-]{20,}/ },
  { name: 'Google refresh token', re: /\b4\/[A-Za-z0-9_-]{25,}/ },
  { name: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}/ },
  { name: 'Google OAuth client secret', re: /\bGOCSPX-[A-Za-z0-9_-]{12,}/ },
  { name: 'AWS access key id', re: /AKIA[0-9A-Z]{16}/ },
  { name: 'long secret literal', re: /\b(?:secret|access_token|refresh_token|id_token)\s*[:=]\s*['"][A-Za-z0-9_+/=-]{32,}['"]/i }
];

/**
 * A URL counts as a network call when one of these patterns sits in the text
 * before it. Each entry names a call that can carry a URL off the page.
 */
const NETWORK_CONTEXT_PATTERNS: readonly RegExp[] = [
  /\bfetch\(/,
  /\.open\(\s*['"`]/,
  /\bnew\s+URL\(/,
  /\bsendBeacon\(/,
  /\bimportScripts\(/,
  /location\s*\.\s*(?:assign|replace)\s*\(/,
  /location\s*\.\s*href\s*=/,
  /\bsrc\s*=/,
  /\bhref\s*=/,
  // `element.setAttribute('src', url)` reaches the network through the same
  // element the `src =` assignment reaches. A scanner that reads only the
  // assignment misses the call form.
  /\.setAttribute\(\s*['"`](?:src|href|xlink:href|srcset|action|data|poster|background)['"`]\s*,/,
  // A CSS `url(...)` loads a stylesheet, a font, an image, or a mask. The
  // `@import` form and the property form both go through it.
  /\burl\s*\(/i,
  /@import\b/i
];

/** Window of text searched before each URL for a network context. */
const CONTEXT_WINDOW = 90;

/**
 * One call shape plus the capture groups that may hold the URL argument.
 *
 * Each shape carries its own group numbers on purpose. The `src` and `href`
 * shapes put the quote in group 1 and the value in group 2, so reading a fixed
 * group for every shape returns the quote character instead of the URL.
 *
 * A shape lists every group that can hold the value because a form such as CSS
 * `url(...)` accepts a single-quoted, a double-quoted, or a bare value, and
 * only one of the three alternatives matches at a time. The first defined
 * group wins.
 */
const CALL_SHAPES: ReadonlyArray<{ re: RegExp; groups: number[] }> = [
  { re: /\bfetch\(\s*([^)]{0,160})/g, groups: [1] },
  { re: /\.open\(\s*['"`][A-Za-z]+['"`]\s*,\s*([^)]{0,160})/g, groups: [1] },
  { re: /\bnew\s+URL\(\s*([^),]{0,160})/g, groups: [1] },
  { re: /\bsendBeacon\(\s*([^,)]{0,160})/g, groups: [1] },
  { re: /\bimportScripts\(\s*([^)]{0,160})/g, groups: [1] },
  { re: /location\s*\.\s*(?:assign|replace)\s*\(\s*([^)]{0,160})/g, groups: [1] },
  { re: /\bsrc\s*=\s*(['"`])([^'"`]*)/g, groups: [2] },
  { re: /\bhref\s*=\s*(['"`])([^'"`]*)/g, groups: [2] },
  // `setAttribute` carries the URL in the second argument. The attribute name
  // is the first, so the shape reads past it and captures the value.
  {
    re: /\.setAttribute\(\s*['"`](?:src|href|xlink:href|srcset|action|data|poster|background)['"`]\s*,\s*([^)]{0,160})/g,
    groups: [1]
  },
  // CSS `url(...)`. The value may be single-quoted, double-quoted, or bare.
  { re: /\burl\(\s*(?:'([^']{0,160})'|"([^"]{0,160})"|([^)\s]{0,160}))\s*\)/gi, groups: [1, 2, 3] }
];

/** True when the file holds text the scans can read. */
export function isTextFile(path: string): boolean {
  const lower = path.toLowerCase();
  if (SCANNED_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
    return true;
  }
  return !lower.includes('.');
}

/** Pull the host out of a URL string. Returns null for a relative URL. */
export function hostOf(url: string): string | null {
  const match = /^https?:\/\/([^/?#\s"'`\\]+)/.exec(url);
  if (match === null) {
    return null;
  }
  return match[1].toLowerCase().split(':')[0];
}

/** Every `https://host` string in the text, in source order. */
export function findUrls(text: string): string[] {
  return text.match(/https?:\/\/[A-Za-z0-9._-]+/g) ?? [];
}

/**
 * Names bound to a URL string in one text.
 *
 * `const DRIVE_API = 'https://www.googleapis.com/drive/v3'` binds `DRIVE_API`
 * to that URL. The minified bundle keeps the value under a short name, so this
 * map lets the scan follow a call argument back to its host.
 *
 * The declaration keyword is optional. A minifier folds several assignments into
 * one statement, which leaves later bindings with no keyword:
 * `var a=1,b="https://example.com"`.
 */
export function stringBindings(text: string): Map<string, string> {
  const map = new Map<string, string>();
  const re = /(?:^|[;,{\s(])(?:(?:var|let|const)\s+)?([A-Za-z_$][\w$]*)\s*=\s*(['"`])((?:https?:)?\/\/[^'"`\n]*)\2/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    map.set(match[1], match[3]);
  }
  return map;
}

/**
 * Resolve one call argument to the URL it carries.
 *
 * Handles a quoted literal, a template literal head, and a name that binds a URL
 * string in the same text. The name is the run of characters before the first
 * comma, because `callArguments` captures the whole argument list. Returns null
 * when the argument holds no URL, which covers relative paths and values built at
 * runtime.
 */
export function resolveArgument(arg: string, bindings: Map<string, string>): string | null {
  const literal = /^\s*(['"`])\s*(https?:\/\/[^'"`\s]*)/.exec(arg);
  if (literal !== null) {
    return literal[2];
  }
  const template = /^\s*`([^`$]*)\$\{([A-Za-z_$][\w$]*)/.exec(arg);
  if (template !== null && bindings.has(template[2])) {
    return bindings.get(template[2])!;
  }
  const identifier = /^\s*([A-Za-z_$][\w$]*)\b/.exec(arg);
  if (identifier !== null && bindings.has(identifier[1])) {
    return bindings.get(identifier[1])!;
  }
  return null;
}

/** Call sites in one text, with the argument text each one carries. */
export function callArguments(text: string): string[] {
  const args: string[] = [];
  for (const shape of CALL_SHAPES) {
    const re = new RegExp(shape.re.source, shape.re.flags);
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      const value = shape.groups
        .map((group: number): string | undefined => match?.[group])
        .find((candidate: string | undefined): boolean => candidate !== undefined);
      args.push(value ?? '');
    }
  }
  return args;
}

/**
 * Hosts that sit in a network-capable context, read from the text before them.
 *
 * Bare metadata strings do not appear here, because no network pattern sits in
 * the window before them.
 */
export function contextWindowHosts(text: string): Array<{ host: string; context: string }> {
  const hits: Array<{ host: string; context: string }> = [];
  const pattern = /https?:\/\/[A-Za-z0-9._-]+/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const host = match[0].replace(/^https?:\/\//, '').toLowerCase();
    const start = Math.max(0, match.index - CONTEXT_WINDOW);
    const before = text.slice(start, match.index);
    const ctx = NETWORK_CONTEXT_PATTERNS.find((re) => re.test(before));
    if (ctx !== undefined) {
      hits.push({ host, context: ctx.source });
    }
  }
  return hits;
}

/**
 * Hosts carried by a call argument, read through the string bindings in the
 * same text. This is the pass that survives minification.
 */
export function callArgumentHosts(text: string): Array<{ host: string; context: string }> {
  const bindings = stringBindings(text);
  const hits: Array<{ host: string; context: string }> = [];
  for (const arg of callArguments(text)) {
    const url = resolveArgument(arg, bindings);
    if (url === null) {
      continue;
    }
    const host = hostOf(url.startsWith('//') ? `https:${url}` : url);
    if (host !== null) {
      hits.push({ host, context: 'call-argument' });
    }
  }
  return hits;
}

/** Both origin passes over one text, de-duplicated by host. */
export function scanNetworkHosts(text: string): Array<{ host: string; context: string }> {
  const seen = new Set<string>();
  const hits: Array<{ host: string; context: string }> = [];
  for (const hit of [...contextWindowHosts(text), ...callArgumentHosts(text)]) {
    if (seen.has(hit.host)) {
      continue;
    }
    seen.add(hit.host);
    hits.push(hit);
  }
  return hits;
}

/** Hosts in the text that no network call carries. These are inert metadata. */
export function metadataOnlyHosts(text: string): string[] {
  const used = new Set(scanNetworkHosts(text).map((hit) => hit.host));
  const out: string[] = [];
  for (const url of findUrls(text)) {
    const host = url.replace(/^https?:\/\//, '').toLowerCase();
    if (!used.has(host) && !out.includes(host)) {
      out.push(host);
    }
  }
  return out;
}

/** One credential match: the pattern name and the text that matched it. */
export interface SecretHit {
  name: string;
  sample: string;
}

/** Credential patterns that match one text, with the matched text. */
export function scanSecrets(text: string): SecretHit[] {
  const hits: SecretHit[] = [];
  for (const { name, re } of SECRET_PATTERNS) {
    const match = new RegExp(re.source, 'i').exec(text);
    if (match !== null) {
      hits.push({ name, sample: match[0].slice(0, 48) });
    }
  }
  return hits;
}

/** Hosts in the text that sit outside the allowlist. */
export function disallowedHosts(text: string): string[] {
  return scanNetworkHosts(text)
    .map((hit) => hit.host)
    .filter((host) => !ALLOWED_ORIGINS.includes(host));
}
