// Prove the Phase 13 unit and preference modules transpile to ES2019.
// Phase 13 owns this gate. REQUIREMENTS 22.4, docs/CAPABILITIES-kindle-scribe.md.
//
// `scripts/check-browser-compat.ts` parses `dist/app.js` only. Nothing imports
// `src/units/*` or `src/preferences/*` into that bundle yet, so `check:compat`
// cannot see these files. A later edit that adds a post-2019 form to
// `conversion.ts` would pass CI until Phase 17 imports the module. Phase 09 met
// the same situation and solved it with `scripts/check-merge-compat.ts`; this
// script does the same for these modules.
//
// Each entry is built the way the app builds it, at `target: 'es2019'` and
// minified, then parsed with acorn at `ecmaVersion: 2019`.
//
// What this gate proves, and what it does not.
//
// It proves the module compiles and parses at ES2019. The Kindle Scribe browser
// reports optional chaining and nullish coalescing as `Unexpected token`, so a
// form the build cannot lower fails here instead of on a device.
//
// It does not prove the module avoids a runtime method the browser lacks.
// esbuild lowers syntax but never adds a method, so a call such as
// `Object.hasOwn` survives the build unchanged and still parses as ES2019.
// That class is covered by the capability report at
// `docs/CAPABILITIES-kindle-scribe.md` and by the polyfills in
// `src/polyfills.ts`, not by this parse.
//
// The script also prints the size figures, because the same build measures them.

import { mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { parse } from 'acorn';
import { build, type InlineConfig } from 'vite';

const repoRoot = resolve(import.meta.dirname, '..');

/**
 * The modules this gate covers.
 *
 * Each is a Phase 13 module that no app entry imports yet, so the bundle check
 * cannot reach it. Once a module lands in `dist/app.js` it stays covered here
 * and gains the bundle check as well, which is the intended overlap.
 */
const ENTRIES: ReadonlyArray<{ label: string; path: string }> = [
  { label: 'src/units/conversion.ts', path: join(repoRoot, 'src/units/conversion.ts') },
  { label: 'src/units/format.ts', path: join(repoRoot, 'src/units/format.ts') },
  {
    label: 'src/preferences/preference-service.ts',
    path: join(repoRoot, 'src/preferences/preference-service.ts')
  }
];

/** Build one entry as a minified ES2019 IIFE and return its text. */
async function buildBundle(entry: string): Promise<string> {
  const outDir = mkdtempSync(join('/tmp', 'repjot-units-compat-'));
  const config: InlineConfig = {
    root: repoRoot,
    // Skip `vite.config.ts`. That config builds the app with two inputs, which
    // conflicts with library mode here.
    configFile: false,
    logLevel: 'warn',
    build: {
      target: 'es2019',
      minify: true,
      outDir,
      emptyOutDir: true,
      lib: {
        entry,
        formats: ['iife'],
        name: 'repjotUnitsCompat',
        fileName: () => 'units.js'
      }
    }
  };

  try {
    await build(config);
    return await Bun.file(join(outDir, 'units.js')).text();
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

/** Assert one bundle parses as ES2019 and report its size. */
function report(label: string, bundle: string): void {
  if (bundle.length === 0) {
    throw new Error(`${label} built to an empty bundle. The gate proves nothing.`);
  }
  parse(bundle, { ecmaVersion: 2019, sourceType: 'script' });
  const gzipBytes = gzipSync(Buffer.from(bundle), { level: 9 }).length;
  console.log(
    `${label}: ${bundle.length} bytes minified, ${gzipBytes} bytes gzipped, parses as ES2019`
  );
}

for (const entry of ENTRIES) {
  const bundle = await buildBundle(entry.path);
  report(entry.label, bundle);
}

console.log('The Phase 13 unit and preference modules are ES2019 safe.');
