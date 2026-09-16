/**
 * Browser and release compatibility gate. `bun run check:compat`
 *
 * Eleven checks. Checks 1 through 3 and 9 keep the bundle loadable on the Kindle
 * Silk 80 engine. Checks 4 through 8, 10, and 11 guard the release itself: size,
 * file count, leaked secrets, remote origins, the Pages domain, the shipped
 * policy, and the Drive scope. Phase 20 owns this file.
 *
 * The script reads the built output in `dist/`, so run the production build
 * first. `bun run check:compat` builds for you.
 *
 * | #  | Check                                                    |
 * | -- | -------------------------------------------------------- |
 * | 1  | `dist/app.js` parses as ES2019 in script mode              |
 * | 2  | No optional chaining or nullish coalescing in the bundle   |
 * | 3  | No `window.open` call in the bundle                        |
 * | 4  | `dist/app.js` stays inside the gzipped budget              |
 * | 5  | `dist/` stays inside the file-count budget                 |
 * | 6  | No client secret, refresh token, or private key in `dist/` |
 * | 7  | No remote origin outside the allowlist in a network call   |
 * | 8  | `dist/CNAME` equals `repjot.com`                          |
 * | 9  | `dist/index.html` loads the classic loader after its target|
 * | 10 | The CSP meta policy matches the reviewed policy            |
 * | 11 | `dist/app.js` carries the required Drive app-data scope    |
 *
 * Check 7 works on network contexts, not on bare strings. A URL counts only when
 * it sits in a call that can reach the network: `fetch`, `XMLHttpRequest.open`,
 * `new URL`, `sendBeacon`, `importScripts`, `location.assign`,
 * `location.replace`, or a `src` or `href` assignment. Library metadata that
 * never leaves the page does not count, so the Ajv schema identifiers, the
 * Svelte error links, and the license URLs in `dist/` pass.
 *
 * The scan runs twice over each file, because a URL looks different in readable
 * source and in a minified bundle. One pass reads the text before each URL for a
 * call pattern, which catches a URL written at the call site. The other pass
 * reads each call argument and resolves the argument name through the string
 * bindings in the same file, which catches a URL stored in a name. Minification
 * keeps the value and renames the holder, so the binding pass is what follows a
 * call like `fetch(X,{method:"POST"})` back to the host behind `X`. Both passes
 * run over `dist/` and over `src/`. The helpers live in
 * `scripts/compat-scan.ts`. See "Remote origin policy" in `docs/RELEASE.md`.
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { parse } from 'acorn';

import {
  ALLOWED_ORIGINS,
  isTextFile,
  hostOf,
  metadataOnlyHosts,
  scanNetworkHosts,
  scanSecrets
} from './compat-scan';

const distDir = process.env['COMPAT_DIST_DIR'] ?? fileURLToPath(new URL('../dist/', import.meta.url));
const srcDir = process.env['COMPAT_SRC_DIR'] ?? fileURLToPath(new URL('../src/', import.meta.url));

/**
 * Reviewed budgets. Recorded with the release figures in `docs/RELEASE.md`.
 * Raise a budget only with a written note in that file.
 */
const BUDGET_APP_GZIP_BYTES = 204_800;
const BUDGET_DIST_FILES = 30;

const failures: string[] = [];
const report: string[] = [];

function fail(message: string): void {
  failures.push(message);
}

/** List every file under a directory, recursively, relative to that directory. */
function listFiles(root: string, prefix = ''): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(root, prefix))) {
    const rel = prefix === '' ? entry : `${prefix}/${entry}`;
    if (statSync(join(root, rel)).isDirectory()) {
      out.push(...listFiles(root, rel));
    } else {
      out.push(rel);
    }
  }
  return out;
}

// --- Read the build output -----------------------------------------------------

const distFiles = listFiles(distDir);
if (distFiles.length === 0) {
  throw new Error('dist/ is empty. Run the production build first.');
}

const bundlePath = join(distDir, 'app.js');
const bundle = existsSync(bundlePath) ? await Bun.file(bundlePath).text() : '';
if (bundle.length === 0) {
  throw new Error('dist/app.js is empty. Run the production build first.');
}

// --- Check 1: ES2019 parse ----------------------------------------------------

try {
  parse(bundle, { ecmaVersion: 2019, sourceType: 'script' });
  report.push('1. dist/app.js parses as ES2019 in script mode.');
} catch (error) {
  fail(`1. dist/app.js does not parse as ES2019: ${(error as Error).message}`);
}

// --- Check 2: no post-ES2019 syntax -------------------------------------------

/**
 * Walk an ESTree AST and call `visit` for every node.
 *
 * Check 2 needs the syntax tree, not a text search. A text search for `?.` hits
 * string literals and reports a false failure. The tree reports only real nodes.
 */
function walkAst(node: unknown, visit: (node: Record<string, unknown>) => void): void {
  if (Array.isArray(node)) {
    for (const child of node) {
      walkAst(child, visit);
    }
    return;
  }
  if (node !== null && typeof node === 'object') {
    const record = node as Record<string, unknown>;
    visit(record);
    for (const [key, value] of Object.entries(record)) {
      if (key === 'loc' || key === 'start' || key === 'end' || key === 'comments') {
        continue;
      }
      walkAst(value, visit);
    }
  }
}

const bannedNodeNames = new Set(['OptionalMemberExpression', 'OptionalCallExpression']);
const bannedOperators = new Set(['??', '?.']);
const bannedNodes: string[] = [];
try {
  const ast = parse(bundle, { ecmaVersion: 'latest', sourceType: 'script' });
  walkAst(ast, (node) => {
    const type = String(node.type);
    if (bannedNodeNames.has(type)) {
      bannedNodes.push(type);
    } else if (type === 'LogicalExpression' && bannedOperators.has(String(node.operator))) {
      bannedNodes.push(`LogicalExpression ${node.operator}`);
    }
  });
} catch (error) {
  fail(`2. dist/app.js does not parse for the syntax scan: ${(error as Error).message}`);
}
if (bannedNodes.length > 0) {
  fail(
    `2. dist/app.js uses post-ES2019 syntax: ${[...new Set(bannedNodes)].join(', ')} `
    + `(${bannedNodes.length} nodes).`
  );
} else {
  report.push('2. dist/app.js has no optional chaining and no nullish coalescing.');
}

// --- Check 3: no window.open --------------------------------------------------

if (/\bwindow\s*\.\s*open\s*\(/.test(bundle)) {
  fail('3. dist/app.js can open a popup or secondary window.');
} else {
  report.push('3. dist/app.js opens no popup and no secondary window.');
}

// --- Check 4: gzipped size budget ---------------------------------------------

const bundleBytes = await Bun.file(bundlePath).bytes();
const bundleGzip = gzipSync(bundleBytes, { level: 9 }).length;
if (bundleGzip > BUDGET_APP_GZIP_BYTES) {
  fail(
    `4. dist/app.js gzips to ${bundleGzip.toLocaleString()} bytes, over the ` +
    `${BUDGET_APP_GZIP_BYTES.toLocaleString()} byte budget.`
  );
} else {
  report.push(
    `4. dist/app.js: ${bundleBytes.length.toLocaleString()} bytes, ` +
    `${bundleGzip.toLocaleString()} bytes gzipped (budget ` +
    `${BUDGET_APP_GZIP_BYTES.toLocaleString()}).`
  );
}

// --- Check 5: file count budget -----------------------------------------------

if (distFiles.length > BUDGET_DIST_FILES) {
  fail(
    `5. dist/ holds ${distFiles.length} files, over the ${BUDGET_DIST_FILES} file budget. ` +
    `Files: ${distFiles.join(', ')}`
  );
} else {
  report.push(`5. dist/ holds ${distFiles.length} files (budget ${BUDGET_DIST_FILES}).`);
}

// --- Check 6: no leaked secrets -----------------------------------------------

const secretHits: string[] = [];
for (const file of distFiles) {
  if (!isTextFile(join(distDir, file))) {
    continue;
  }
  const text = await Bun.file(join(distDir, file)).text();
  for (const hit of scanSecrets(text)) {
    secretHits.push(`${file}: ${hit.name} (${hit.sample})`);
  }
}
if (secretHits.length > 0) {
  fail(`6. dist/ may hold a credential:\n   ${secretHits.join('\n   ')}`);
} else {
  report.push('6. No client secret, refresh token, API key, or private key in dist/.');
}

// --- Check 7: remote origins in network contexts -------------------------------

const originHits: string[] = [];

for (const file of distFiles) {
  if (!isTextFile(join(distDir, file))) {
    continue;
  }
  const text = await Bun.file(join(distDir, file)).text();
  for (const hit of scanNetworkHosts(text)) {
    if (!ALLOWED_ORIGINS.includes(hit.host)) {
      originHits.push(`dist/${file}: ${hit.host}`);
    }
  }
}

const srcFiles = listFiles(srcDir).filter(
  (file) => file.endsWith('.ts') || file.endsWith('.svelte') || file.endsWith('.html')
);
for (const file of srcFiles) {
  const text = await Bun.file(join(srcDir, file)).text();
  for (const hit of scanNetworkHosts(text)) {
    if (!ALLOWED_ORIGINS.includes(hit.host)) {
      originHits.push(`src/${file}: ${hit.host}`);
    }
  }
}

if (originHits.length > 0) {
  fail(
    `7. A network call targets a host outside the allowlist:\n   ` +
    [...new Set(originHits)].join('\n   ') +
    `\n   Allowlist: ${ALLOWED_ORIGINS.join(', ')}`
  );
} else {
  report.push(`7. Every network call targets an allowed host: ${ALLOWED_ORIGINS.join(', ')}.`);
}

// --- Check 8: CNAME -----------------------------------------------------------

const cnamePath = join(distDir, 'CNAME');
if (!existsSync(cnamePath)) {
  fail('8. dist/CNAME is missing. GitHub Pages needs it for repjot.com.');
} else {
  const cname = (await Bun.file(cnamePath).text()).trim();
  if (cname !== 'repjot.com') {
    fail(`8. dist/CNAME is "${cname}", not "repjot.com".`);
  } else {
    report.push('8. dist/CNAME equals repjot.com.');
  }
}

// --- Check 9: classic loader order --------------------------------------------

const index = await Bun.file(join(distDir, 'index.html')).text();
if (!index.includes('window.__repjotLoadApp("./app.js?v=')) {
  fail('9. dist/index.html does not dynamically load the classic app.js bundle.');
} else {
  const loaderDefinition = index.indexOf('window.__repjotLoadApp = function');
  const loaderCall = index.indexOf('window.__repjotLoadApp("./app.js?v=');
  const appTarget = index.indexOf('id="app"');
  if (loaderDefinition === -1 || loaderCall < loaderDefinition || loaderCall < appTarget) {
    fail('9. The dynamic app loader runs before its function or DOM target is ready.');
  } else if (index.includes('type="module"')) {
    fail('9. dist/index.html still contains a module script.');
  } else {
    report.push('9. dist/index.html loads the classic loader after its function and DOM target.');
  }
}

// --- Check 10: CSP meta policy ------------------------------------------------

/**
 * The shipped policy, directive by directive.
 *
 * `'unsafe-eval'` stands in `script-src` because Ajv compiles the four document
 * schemas in the browser with the `Function` constructor. `'unsafe-inline'`
 * stands in `script-src` for the bootstrap loader and in `style-src` for the
 * inline width the progress bar sets. The tag itself reaches the built page from
 * the `kindle-classic-entry` plugin in `vite.config.ts`, not from
 * `src/index.html`, so development keeps Vite hot reload. See "CSP decision" in
 * `docs/RELEASE.md`.
 */
const REQUIRED_POLICY: Readonly<Record<string, readonly string[]>> = {
  'default-src': ["'self'"],
  'script-src': ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
  'style-src': ["'self'", "'unsafe-inline'"],
  'font-src': ["'self'"],
  'img-src': ["'self'", 'data:'],
  // `'self'` carries the same-origin fetch of the exercise and workout
  // bundles. An explicit `connect-src` replaces `default-src` for that
  // directive, so `'self'` must be named here or the app cannot load its own
  // data. See "CSP decision" in `docs/RELEASE.md`.
  'connect-src': ["'self'", 'https://www.googleapis.com', 'https://oauth2.googleapis.com'],
  'form-action': ['https://oauth2.googleapis.com'],
  'frame-src': ['https://accounts.google.com'],
  'base-uri': ["'self'"],
  'object-src': ["'none'"]
};

const cspTag = /<meta\b[^>]*http-equiv=(['"])Content-Security-Policy\1[^>]*>/i.exec(index);
const cspMatch = cspTag === null ? null : /\bcontent=(['"])([\s\S]*?)\1/i.exec(cspTag[0]);
if (cspMatch === null) {
  fail('10. dist/index.html carries no Content-Security-Policy meta tag.');
} else {
  const policy: Record<string, string[]> = {};
  for (const part of cspMatch[2].split(';')) {
    const tokens = part.trim().split(/\s+/).filter((token) => token.length > 0);
    if (tokens.length === 0) {
      continue;
    }
    policy[tokens[0].toLowerCase()] = tokens.slice(1);
  }

  const policyProblems: string[] = [];
  for (const [directive, expected] of Object.entries(REQUIRED_POLICY)) {
    const actual = policy[directive];
    if (actual === undefined) {
      policyProblems.push(`${directive} is missing`);
      continue;
    }
    const missing = expected.filter((source) => !actual.includes(source));
    if (missing.length > 0) {
      policyProblems.push(`${directive} lacks ${missing.join(' ')}`);
    }
    const extra = actual.filter((source) => !expected.includes(source));
    if (extra.length > 0) {
      policyProblems.push(`${directive} adds ${extra.join(' ')}`);
    }
  }
  for (const directive of Object.keys(policy)) {
    if (REQUIRED_POLICY[directive] === undefined) {
      policyProblems.push(`${directive} is not part of the reviewed policy`);
    }
  }
  for (const source of Object.values(policy).flat()) {
    const host = hostOf(source);
    if (host !== null && !ALLOWED_ORIGINS.includes(host)) {
      policyProblems.push(`a source names a host outside the allowlist: ${source}`);
    }
  }

  if (policyProblems.length > 0) {
    fail(`10. The CSP policy drifted from the reviewed policy: ${policyProblems.join('; ')}.`);
  } else {
    report.push('10. The CSP meta policy matches the reviewed policy and names no extra origin.');
  }
}

// --- Check 11: Drive app-data scope -------------------------------------------

/**
 * The app reads and writes only inside the Drive appDataFolder, which the
 * `drive.appdata` scope grants. A bundle that lost the string would ask for a
 * wider scope or fail at runtime, so the shipped bundle must carry it.
 */
const DRIVE_APPDATA_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';

if (!bundle.includes(DRIVE_APPDATA_SCOPE)) {
  fail(`11. dist/app.js does not contain the required Drive app-data scope ${DRIVE_APPDATA_SCOPE}.`);
} else {
  report.push(`11. dist/app.js carries the Drive app-data scope ${DRIVE_APPDATA_SCOPE}.`);
}

// --- Report -------------------------------------------------------------------

console.log(report.join('\n'));

if (failures.length > 0) {
  throw new Error(`Compatibility gate failed:\n${failures.map((f) => `  ${f}`).join('\n')}`);
}

// Informational. Hosts that appear in `dist/` but never in a network call.
// These are library metadata strings: Ajv schema identifiers, Svelte error
// links, and license URLs. Check 7 ignores them on purpose. Record the list in
// `docs/RELEASE.md` when a dependency change adds a new one.
const metadataHosts = new Set<string>();
for (const file of distFiles) {
  if (!isTextFile(join(distDir, file))) {
    continue;
  }
  const text = await Bun.file(join(distDir, file)).text();
  for (const host of metadataOnlyHosts(text)) {
    metadataHosts.add(host);
  }
}
if (metadataHosts.size > 0) {
  console.log(`\nMetadata-only hosts in dist/ (no network call): ${[...metadataHosts].sort().join(', ')}`);
}

console.log(`\nAll ${report.length} compatibility and release checks passed.`);
