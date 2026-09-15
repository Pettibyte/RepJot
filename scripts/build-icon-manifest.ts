/**
 * Regenerate `src/ui/icons/manifest.json` from the reviewed glyph list.
 *
 * The reviewed list lives in this file. Add a name here, run `bun run icons:build`,
 * then commit both this file and the generated manifest.
 *
 * Source glyphs come from `@iconify-json/material-symbols`, a mirror of the
 * Material Symbols Outlined set (Apache 2.0). The manifest stores SVG path data,
 * so the application ships no icon font.
 */

interface IconifyIcon {
  body: string;
  width?: number;
  height?: number;
}

interface IconifyJson {
  prefix: string;
  icons: Record<string, IconifyIcon>;
  aliases?: Record<string, { parent: string }>;
  width?: number;
  height?: number;
}

export interface ManifestIcon {
  /** Glyph name used by screens. Matches the Material Symbols codepoint name. */
  name: string;
  /** Key inside the upstream Iconify icon set. */
  sourceKey: string;
  /** SVG viewBox for the path. */
  viewBox: string;
  /** Single SVG path `d` value. */
  path: string;
}

export interface IconManifest {
  version: number;
  source: {
    family: string;
    extractedFrom: string;
    license: string;
    licenseUrl: string;
    regenerate: string;
  };
  icons: ManifestIcon[];
}

/** Reviewed glyphs. Each entry is a Material Symbols codepoint name. */
export const REVIEWED_GLYPHS: string[] = [
  'check_circle', // completed item marks
  'chevron_right', // rows that open a detail view
  'fitness_center', // exercise and workout markers
  'play_arrow', // start an action
  'receipt_long', // session and history records
  'settings', // settings navigation
  'timer', // rest timers and durations
  'weight', // load and reps metrics
  'arrow_back', // BackHeader back control
  'add', // AMRAP quick round control
];

const PACKAGE_NAME = '@iconify-json/material-symbols';
const PACKAGE_VERSION = '1.2.92';

/** Convert a Material codepoint name such as `check_circle` to `check-circle`. */
export function toSourceKey(glyph: string): string {
  return glyph.replace(/_/g, '-');
}

/** Strip fill attributes and wrappers down to one path `d` value. */
export function extractPath(body: string): string {
  const fills = [...body.matchAll(/d="([^"]+)"/g)].map((m) => m[1]);
  if (fills.length !== 1) {
    throw new Error(`Expected exactly one path in icon body, found ${fills.length}.`);
  }
  return fills[0];
}

export function buildManifest(iconset: IconifyJson, glyphs: string[]): IconManifest {
  const width = iconset.width ?? 24;
  const height = iconset.height ?? 24;
  const icons: ManifestIcon[] = glyphs.map((glyph) => {
    const sourceKey = toSourceKey(glyph);
    const icon = iconset.icons[sourceKey];
    if (!icon) {
      throw new Error(`Glyph "${glyph}" (key "${sourceKey}") is missing from ${PACKAGE_NAME}.`);
    }
    return {
      name: glyph,
      sourceKey,
      viewBox: `0 0 ${width} ${height}`,
      path: extractPath(icon.body),
    };
  });

  return {
    version: 1,
    source: {
      family: 'Material Symbols Outlined',
      extractedFrom: `${PACKAGE_NAME}@${PACKAGE_VERSION}`,
      license: 'Apache-2.0',
      licenseUrl: 'https://github.com/google/material-design-icons/blob/master/LICENSE',
      regenerate: 'bun run icons:build',
    },
    icons,
  };
}

async function main(): Promise<void> {
  const modPath = await import.meta.resolve(PACKAGE_NAME);
  const pkgDir = new URL('.', modPath);
  const iconset = (await Bun.file(new URL('icons.json', pkgDir)).json()) as IconifyJson;
  const manifest = buildManifest(iconset, REVIEWED_GLYPHS);
  const outPath = new URL('../src/ui/icons/manifest.json', import.meta.url);
  await Bun.write(outPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Wrote ${manifest.icons.length} glyphs to ${outPath.pathname}`);
}

if (import.meta.main) {
  await main();
}
