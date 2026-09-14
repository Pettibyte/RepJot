// Prove the merge module transpiles to ES2019 and record its bundle cost.
// Phase 09 owns this gate. REQUIREMENTS 22.4, docs/CAPABILITIES-kindle-scribe.md.
//
// `scripts/check-browser-compat.ts` parses `dist/app.js` only. Until the sync
// layer imports the merge, the merge sits outside that bundle, so its own gate
// lives here. The script builds the module the way the app builds it, at
// `target: 'es2019'` and minified, then parses each result with acorn at
// `ecmaVersion: 2019`. A library bump that adds optional chaining, a nullish
// coalesce, or a post-2019 runtime call fails this gate instead of failing on a
// Kindle later.
//
// The script also prints the size figures for `docs/implementation/README.md`
// "Bundle budget". Each figure is a direct build measurement. Gzip is not
// additive, so no figure here comes from subtracting another one.

import { mkdtempSync, rmSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { parse } from 'acorn';
import { build, type InlineConfig } from 'vite';

const repoRoot = resolve(import.meta.dirname, '..');
const mergeEntry = join(repoRoot, 'src/sync/merge-documents.ts');
const probeEntry = join(repoRoot, '.merge-compat-probe.ts');

/**
 * Markers from the text differ implementation.
 *
 * The plain `jsondiffpatch` entry keeps a guard that names
 * `jsondiffpatch/with-text-diffs` inside an error message, so a search for that
 * name proves nothing. These names come from the differ code itself.
 */
const TEXT_DIFF_MARKERS = ['diff_main', 'DIFF_INSERT', 'diff_cleanupSemantic'];

/** Build one entry as a minified ES2019 IIFE and return its text. */
async function buildBundle(entry: string, external: string[]): Promise<string> {
  const outDir = mkdtempSync(join('/tmp', 'repjot-merge-compat-'));
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
        name: 'repjotMergeCompat',
        fileName: () => 'merge.js'
      },
      rollupOptions: {
        external,
        output: { globals: { jsondiffpatch: 'jsondiffpatch' } }
      }
    }
  };

  try {
    await build(config);
    return await Bun.file(join(outDir, 'merge.js')).text();
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

/** Assert one bundle parses as ES2019 and report its size. */
function report(label: string, bundle: string): void {
  parse(bundle, { ecmaVersion: 2019, sourceType: 'script' });
  const gzipBytes = gzipSync(Buffer.from(bundle), { level: 9 }).length;
  console.log(
    `${label}: ${bundle.length} bytes minified, ${gzipBytes} bytes gzipped, parses as ES2019`
  );
}

// A probe entry that pulls in the library and nothing else. The file lives in the
// repository root while it builds, so module resolution matches the app build.
writeFileSync(
  probeEntry,
  "import { DiffPatcher } from 'jsondiffpatch';\nexport const probe = DiffPatcher;\n"
);

let libraryBundle: string;
let mergeBundle: string;
let mergeOnlyBundle: string;

try {
  libraryBundle = await buildBundle(join(repoRoot, '.merge-compat-probe.ts'), []);
  mergeBundle = await buildBundle(mergeEntry, []);
  mergeOnlyBundle = await buildBundle(mergeEntry, ['jsondiffpatch']);
} finally {
  unlinkSync(probeEntry);
}

report('jsondiffpatch alone', libraryBundle);
report('merge module with jsondiffpatch', mergeBundle);
report('merge module alone, jsondiffpatch external', mergeOnlyBundle);

for (const marker of TEXT_DIFF_MARKERS) {
  if (mergeBundle.includes(marker)) {
    throw new Error(
      `The merge bundle pulled in the text differ. Found "${marker}". Nothing should import it.`
    );
  }
}

console.log('The merge module is ES2019 safe and pulls in no text differ.');
