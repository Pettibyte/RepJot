/**
 * Style guard. `bun run check:styles`
 *
 * The design system has one token file, one component class layer, and one entry
 * point. This script fails the build when a screen styles itself outside them.
 *
 * Rules. Each rule fails the build for the listed scope.
 *
 * 1. A hex color literal, `rgb(`, `rgba(`, `hsl(`, or a named color in a color
 *    property. Allowed only in `src/ui/styles/tokens.css`.
 * 2. `box-shadow`, `text-shadow`, `linear-gradient`, `radial-gradient`, or
 *    `filter: blur`.
 * 3. `border-radius` with a value other than `0` or `var(--radius)`.
 * 4. `display: grid` or `display: inline-grid` under `src/ui/`.
 * 5. `position: sticky` or `position: fixed` under `src/ui/`.
 * 6. `url(http`, a remote `@import`, or a CDN reference in CSS.
 * 7. A `.svelte` file with a `style="..."` attribute that sets color, shadow, or
 *    radius.
 * 8. A component `<style>` block that redeclares a class already defined in
 *    `src/ui/styles/components.css`.
 * 9. `gap`, `row-gap`, or `column-gap` under `src/ui/`. Kindle Silk 80 reports as
 *    Chrome 80, which has no flexbox `gap`. Use margins.
 */

import { existsSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Violation {
  file: string;
  line: number;
  rule: number;
  message: string;
}

interface ScanOptions {
  /** Path of the scanned file, relative to the repository root. */
  file: string;
  /** True when the file sits under `src/ui/`. */
  inUi: boolean;
  /** True for the one file that may hold hex color literals. */
  isTokenFile: boolean;
  /** Class names owned by components.css. Passed in for rule 8. */
  sharedClasses?: Set<string>;
}

/** Files and directories the guard does not scan. */
export const EXEMPT: string[] = [
  // Diagnostic page. It renders a standalone report with its own generated CSS
  // and is not part of the design system.
  'src/capabilities.html',
  // Static assets: fonts, images, and copied files carry no application styling.
  'src/public/',
];

const TOKEN_FILE = 'src/ui/styles/tokens.css';

const NAMED_COLORS: string[] = [
  'aliceblue', 'antiquewhite', 'aqua', 'aquamarine', 'azure', 'beige', 'bisque',
  'black', 'blanchedalmond', 'blue', 'blueviolet', 'brown', 'burlywood',
  'cadetblue', 'chartreuse', 'chocolate', 'coral', 'cornflowerblue', 'cornsilk',
  'crimson', 'cyan', 'darkblue', 'darkcyan', 'darkgoldenrod', 'darkgray',
  'darkgreen', 'darkgrey', 'darkkhaki', 'darkmagenta', 'darkolivegreen',
  'darkorange', 'darkorchid', 'darkred', 'darksalmon', 'darkseagreen',
  'darkslateblue', 'darkslategray', 'darkslategrey', 'darkturquoise',
  'darkviolet', 'deeppink', 'deepskyblue', 'dimgray', 'dimgrey', 'dodgerblue',
  'firebrick', 'floralwhite', 'forestgreen', 'fuchsia', 'gainsboro', 'ghostwhite',
  'gold', 'goldenrod', 'gray', 'green', 'greenyellow', 'grey', 'honeydew',
  'hotpink', 'indianred', 'indigo', 'ivory', 'khaki', 'lavender',
  'lavenderblush', 'lawngreen', 'lemonchiffon', 'lightblue', 'lightcoral',
  'lightcyan', 'lightgoldenrodyellow', 'lightgray', 'lightgreen', 'lightgrey',
  'lightpink', 'lightsalmon', 'lightseagreen', 'lightskyblue', 'lightslategray',
  'lightslategrey', 'lightsteelblue', 'lightyellow', 'lime', 'limegreen', 'linen',
  'magenta', 'maroon', 'mediumaquamarine', 'mediumblue', 'mediumorchid',
  'mediumpurple', 'mediumseagreen', 'mediumslateblue', 'mediumspringgreen',
  'mediumturquoise', 'mediumvioletred', 'midnightblue', 'mintcream', 'mistyrose',
  'moccasin', 'navajowhite', 'navy', 'oldlace', 'olive', 'olivedrab', 'orange',
  'orangered', 'orchid', 'palegoldenrod', 'palegreen', 'paleturquoise',
  'palevioletred', 'papayawhip', 'peachpuff', 'peru', 'pink', 'plum',
  'powderblue', 'purple', 'rebeccapurple', 'red', 'rosybrown', 'royalblue',
  'saddlebrown', 'salmon', 'sandybrown', 'seagreen', 'seashell', 'sienna',
  'silver', 'skyblue', 'slateblue', 'slategray', 'slategrey', 'snow',
  'springgreen', 'steelblue', 'tan', 'teal', 'thistle', 'tomato', 'turquoise',
  'violet', 'wheat', 'white', 'whitesmoke', 'yellow', 'yellowgreen',
];

/** Properties that take a color value. */
const COLOR_PROPS: Set<string> = new Set([
  'accent-color',
  'background',
  'background-color',
  'border',
  'border-bottom',
  'border-bottom-color',
  'border-color',
  'border-left',
  'border-left-color',
  'border-right',
  'border-right-color',
  'border-top',
  'border-top-color',
  'caret-color',
  'color',
  'column-rule',
  'column-rule-color',
  'fill',
  'outline',
  'outline-color',
  'stroke',
  'text-decoration-color',
  'text-emphasis-color',
  '-webkit-tap-highlight-color',
]);

const RADIUS_PROPS: Set<string> = new Set([
  'border-radius',
  'border-top-left-radius',
  'border-top-right-radius',
  'border-bottom-left-radius',
  'border-bottom-right-radius',
]);

/** Values that never count as a palette violation in a color property. */
const ALLOWED_KEYWORDS: Set<string> = new Set([
  'auto',
  'currentcolor',
  'inherit',
  'initial',
  'none',
  'revert',
  'transparent',
  'unset',
]);

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, (match) => ' '.repeat(match.length));
}

function lineOf(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (text[i] === '\n') line += 1;
  }
  return line;
}

/** Every `selector { declarations }` block in a stylesheet. */
function ruleBlocks(css: string): Array<{ selector: string; body: string; bodyStart: number }> {
  const blocks: Array<{ selector: string; body: string; bodyStart: number }> = [];
  const pattern = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null = pattern.exec(css);
  while (match !== null) {
    blocks.push({
      selector: match[1].trim(),
      body: match[2],
      bodyStart: match.index + match[1].length + 1,
    });
    match = pattern.exec(css);
  }
  return blocks;
}

function declarations(body: string, bodyStart: number): Array<{ prop: string; value: string; index: number }> {
  const out: Array<{ prop: string; value: string; index: number }> = [];
  const pattern = /([-a-zA-Z]+)\s*:\s*([^;]+)/g;
  let match: RegExpExecArray | null = pattern.exec(body);
  while (match !== null) {
    out.push({
      prop: match[1].toLowerCase(),
      value: match[2].trim(),
      index: bodyStart + match.index,
    });
    match = pattern.exec(body);
  }
  return out;
}

function namedColorInValue(value: string): string | null {
  const withoutVars = value.replace(/var\([^)]*\)/gi, ' ');
  for (const token of withoutVars.split(/[^a-zA-Z-]+/)) {
    const lower = token.toLowerCase();
    if (lower === '' || ALLOWED_KEYWORDS.has(lower)) continue;
    if (NAMED_COLORS.includes(lower)) return lower;
  }
  return null;
}

/** Lint one stylesheet. Returns every violation found. */
export function lintCss(css: string, options: ScanOptions): Violation[] {
  const found: Violation[] = [];
  const push = (index: number, rule: number, message: string): void => {
    found.push({ file: options.file, line: lineOf(css, index), rule, message });
  };

  const bare = stripComments(css);

  // Rule 1: raw color literals anywhere in the file.
  if (!options.isTokenFile) {
    const literal = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/g;
    let match: RegExpExecArray | null = literal.exec(bare);
    while (match !== null) {
      push(match.index, 1, `Raw color literal "${match[0]}" is allowed only in ${TOKEN_FILE}.`);
      match = literal.exec(bare);
    }
  }

  const blocks = ruleBlocks(bare);

  for (const block of blocks) {
    for (const decl of declarations(block.body, block.bodyStart)) {
      // Rule 1: named color in a color property.
      if (COLOR_PROPS.has(decl.prop) && !options.isTokenFile) {
        const named = namedColorInValue(decl.value);
        if (named !== null) {
          push(decl.index, 1, `Named color "${named}" in "${decl.prop}" is allowed only in ${TOKEN_FILE}.`);
        }
      }

      // Rule 2: shadows, gradients, and blur.
      if (/\bbox-shadow\b|\btext-shadow\b/.test(decl.prop)) {
        push(decl.index, 2, `"${decl.prop}" is banned. Build hierarchy with scale, weight, inversion, and borders.`);
      }
      if (/linear-gradient|radial-gradient/.test(decl.value)) {
        push(decl.index, 2, 'Gradients are banned.');
      }
      if (decl.prop === 'filter' && /\bblur\(/.test(decl.value)) {
        push(decl.index, 2, 'filter: blur() is banned.');
      }

      // Rule 3: radius.
      if (RADIUS_PROPS.has(decl.prop)) {
        const ok = /^0(px|rem)?$/i.test(decl.value) || decl.value.includes('var(--radius)');
        if (!ok) {
          push(decl.index, 3, `"${decl.prop}: ${decl.value}" must be 0 or var(--radius).`);
        }
      }

      if (options.inUi) {
        // Rule 4: grid.
        if (decl.prop === 'display' && /\b(inline-)?grid\b/.test(decl.value)) {
          push(decl.index, 4, 'display: grid is banned under src/ui/. Use flex.');
        }

        // Rule 5: sticky and fixed.
        if (decl.prop === 'position' && /\b(sticky|fixed)\b/.test(decl.value)) {
          push(decl.index, 5, `position: ${decl.value.trim()} is banned under src/ui/.`);
        }

        // Rule 9: flex gap.
        if (decl.prop === 'gap' || decl.prop === 'row-gap' || decl.prop === 'column-gap') {
          push(decl.index, 9, 'gap is unsupported in Kindle Silk 80 (Chrome 80). Use margins.');
        }
      }
    }
  }

  // Rule 6: remote assets.
  const remote = /url\(\s*['"]?(https?:|\/\/)/gi;
  let remoteMatch: RegExpExecArray | null = remote.exec(bare);
  while (remoteMatch !== null) {
    push(remoteMatch.index, 6, 'Remote url() is banned. Bundle the asset under src/public/.');
    remoteMatch = remote.exec(bare);
  }

  const importRemote = /@import\s+(?:url\(\s*)?['"]?[^'"\s]*/gi;
  let importMatch: RegExpExecArray | null = importRemote.exec(bare);
  while (importMatch !== null) {
    const target = importMatch[0];
    if (/https?:|\/\/|cdn\./i.test(target)) {
      push(importMatch.index, 6, `Remote @import "${target.trim()}" is banned.`);
    }
    importMatch = importRemote.exec(bare);
  }

  if (/cdn\.|unpkg\.com|jsdelivr|cdnjs/i.test(bare)) {
    push(0, 6, 'CDN reference is banned. Bundle the asset under src/public/.');
  }

  return found;
}

/** Class names defined in a stylesheet's selectors. */
export function definedClasses(css: string): Set<string> {
  const names = new Set<string>();
  for (const block of ruleBlocks(stripComments(css))) {
    for (const match of block.selector.matchAll(/\.([A-Za-z_][\w-]*)/g)) {
      names.add(match[1]);
    }
  }
  return names;
}

/** Lint one Svelte component or HTML file. */
export function lintMarkup(markup: string, options: ScanOptions): Violation[] {
  const found: Violation[] = [];
  const push = (index: number, rule: number, message: string): void => {
    found.push({ file: options.file, line: lineOf(markup, index), rule, message });
  };

  // Rule 7: inline style attributes that set color, shadow, or radius.
  const styleAttr = /\sstyle\s*=\s*"([^"]*)"|\sstyle\s*=\s*'([^']*)'/gi;
  let match: RegExpExecArray | null = styleAttr.exec(markup);
  while (match !== null) {
    const value = (match[1] ?? match[2] ?? '').toLowerCase();
    const bad =
      /color|shadow|radius|gradient|background|fill|stroke|blur/.test(value) &&
      !/^width:/.test(value);
    if (bad) {
      push(match.index, 7, `Inline style "${value.trim()}" may not set color, shadow, or radius.`);
    }
    match = styleAttr.exec(markup);
  }

  // Rule 8: component style blocks that redeclare shared classes.
  const styleBlocks = markup.match(/<style[^>]*>[\s\S]*?<\/style>/gi) ?? [];
  if (styleBlocks.length > 0 && options.sharedClasses !== undefined) {
    for (const block of styleBlocks) {
      const inner = block.replace(/<style[^>]*>/i, '').replace(/<\/style>/i, '');
      const open = markup.indexOf(block);
      for (const name of definedClasses(inner)) {
        if (options.sharedClasses.has(name)) {
          push(open, 8, `Component style redeclares ".${name}", which belongs to components.css.`);
        }
      }
    }
  }

  // Rules 1, 2, 3, 4, 5, 6 inside component style blocks.
  for (const block of styleBlocks) {
    const inner = block.replace(/<style[^>]*>/i, '').replace(/<\/style>/i, '');
    const offset = markup.indexOf(block);
    for (const violation of lintCss(inner, { ...options, isTokenFile: false })) {
      found.push({ ...violation, line: lineOf(markup, offset) + violation.line - 1 });
    }
  }

  return found;
}

function isExempt(file: string): boolean {
  return EXEMPT.some((prefix) => file === prefix || file.startsWith(prefix));
}

/** Scan a tree and return every violation. */
export async function runGuard(root: string): Promise<Violation[]> {
  const violations: Violation[] = [];

  const componentsPath = join(root, 'src/ui/styles/components.css');
  let sharedClasses: Set<string> | undefined;
  if (existsSync(componentsPath)) {
    sharedClasses = definedClasses(await Bun.file(componentsPath).text());
  }

  const files = new Set<string>();
  for (const pattern of ['src/**/*.css', 'src/**/*.svelte', 'src/**/*.html']) {
    for await (const entry of new Bun.Glob(pattern).scan({ cwd: root, onlyFiles: true })) {
      files.add(entry);
    }
  }

  for (const file of [...files].sort()) {
    if (isExempt(file)) continue;
    const text = await Bun.file(join(root, file)).text();
    const options: ScanOptions = {
      file,
      inUi: file.startsWith(`src${sep}ui${sep}`) || file.startsWith('src/ui/'),
      isTokenFile: file === TOKEN_FILE,
      sharedClasses,
    };

    if (file.endsWith('.css')) {
      violations.push(...lintCss(text, options));
    } else {
      violations.push(...lintMarkup(text, options));
    }
  }

  return violations;
}

export function formatViolations(violations: Violation[], root: string): string {
  return violations
    .map((v) => `${relative(root, join(root, v.file))}:${v.line}: [rule ${v.rule}] ${v.message}`)
    .join('\n');
}

async function main(): Promise<void> {
  const root = resolveRepoRoot();
  const violations = await runGuard(root);
  if (violations.length > 0) {
    console.error(`Style guard found ${violations.length} problem(s):\n`);
    console.error(formatViolations(violations, root));
    console.error('\nFix: use tokens from src/ui/styles/tokens.css and classes from src/ui/styles/components.css.');
    process.exit(1);
  }
  console.log('Style guard passed.');
}

function resolveRepoRoot(): string {
  return dirname(dirname(fileURLToPath(import.meta.url)));
}

if (import.meta.main) {
  await main();
}
