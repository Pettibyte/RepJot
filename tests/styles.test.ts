import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { runGuard, type Violation } from '../scripts/check-styles';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

/** Build a throwaway tree and return its root path. */
function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'repjot-style-'));
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
}

function rules(violations: Violation[]): number[] {
  return violations.map((v) => v.rule).sort();
}

describe('style guard', () => {
  test('passes on the current tree', async () => {
    const violations = await runGuard(REPO_ROOT);
    expect(violations).toEqual([]);
  });

  test('passes when tokens.css holds hex literals', async () => {
    const root = fixture({
      'src/ui/styles/tokens.css': ':root { --color-primary: #000000; --color-bg: #fbf9f9; }\n',
    });
    expect(await runGuard(root)).toEqual([]);
  });

  test('fails on a hex color in components.css', async () => {
    const root = fixture({
      'src/ui/styles/components.css': '.btn { color: #ff0000; }\n',
    });
    const violations = await runGuard(root);
    expect(rules(violations)).toContain(1);
  });

  test('fails on a named color in a color property', async () => {
    const root = fixture({
      'src/ui/styles/components.css': '.card { background-color: white; }\n',
    });
    expect(rules(await runGuard(root))).toContain(1);
  });

  test('fails on box-shadow and text-shadow', async () => {
    const root = fixture({
      'src/ui/styles/components.css': '.card { box-shadow: 0 1px 2px black; }\n.badge { text-shadow: 0 0 3px white; }\n',
    });
    const found = rules(await runGuard(root));
    expect(found.filter((r) => r === 2)).toHaveLength(2);
  });

  test('fails on a gradient and on filter blur', async () => {
    const root = fixture({
      'src/ui/styles/components.css':
        '.a { background-image: linear-gradient(#000, #fff); }\n.b { filter: blur(2px); }\n',
    });
    expect(rules(await runGuard(root)).filter((r) => r === 2)).toHaveLength(2);
  });

  test('fails on border-radius other than 0 or var(--radius)', async () => {
    const root = fixture({
      'src/ui/styles/components.css': '.card { border-radius: 8px; }\n',
    });
    expect(rules(await runGuard(root))).toContain(3);
  });

  test('allows border-radius 0 and var(--radius)', async () => {
    const root = fixture({
      'src/ui/styles/components.css': '.a { border-radius: 0; }\n.b { border-radius: var(--radius); }\n',
    });
    expect(await runGuard(root)).toEqual([]);
  });

  test('fails on display grid under src/ui', async () => {
    const root = fixture({
      'src/ui/styles/components.css': '.grid { display: grid; }\n.h { display: inline-grid; }\n',
    });
    expect(rules(await runGuard(root)).filter((r) => r === 4)).toHaveLength(2);
  });

  test('fails on sticky and fixed positioning under src/ui', async () => {
    const root = fixture({
      'src/ui/styles/components.css': '.a { position: sticky; }\n.b { position: fixed; }\n',
    });
    expect(rules(await runGuard(root)).filter((r) => r === 5)).toHaveLength(2);
  });

  test('fails on a remote url in CSS', async () => {
    const root = fixture({
      'src/ui/styles/fonts.css':
        '@font-face { src: url(https://fonts.gstatic.com/x.woff2) format("woff2"); }\n',
    });
    expect(rules(await runGuard(root))).toContain(6);
  });

  test('fails on a remote @import', async () => {
    const root = fixture({
      'src/ui/styles/index.css': "@import url('https://cdn.example.com/x.css');\n",
    });
    expect(rules(await runGuard(root))).toContain(6);
  });

  test('allows a same-origin font url', async () => {
    const root = fixture({
      'src/ui/styles/fonts.css':
        '@font-face { font-family: "Inter"; src: url("/fonts/inter-latin.woff2") format("woff2"); }\n',
    });
    expect(await runGuard(root)).toEqual([]);
  });

  test('fails on an inline style that sets color', async () => {
    const root = fixture({
      'src/ui/components/Bad.svelte': '<p style="color: red">no</p>\n',
    });
    expect(rules(await runGuard(root))).toContain(7);
  });

  test('allows an inline style that sets only width', async () => {
    const root = fixture({
      'src/ui/styles/components.css': '.bar { height: 12px; }\n',
      'src/ui/components/Bar.svelte': '<div class="bar" style="width: 40%"></div>\n',
    });
    expect(await runGuard(root)).toEqual([]);
  });

  test('flags a banned inline declaration that follows a width', async () => {
    const root = fixture({
      'src/ui/styles/components.css': '.bar { height: 12px; }\n',
      'src/ui/components/Bar.svelte': '<div class="bar" style="width: 40%; color: red"></div>\n',
    });
    expect(rules(await runGuard(root))).toContain(7);
  });

  test('flags a banned inline radius that follows a width', async () => {
    const root = fixture({
      'src/ui/styles/components.css': '.bar { height: 12px; }\n',
      'src/ui/components/Bar.svelte':
        '<div class="bar" style="width: 40%; border-radius: 6px"></div>\n',
    });
    expect(rules(await runGuard(root))).toContain(7);
  });

  test('catches banned CSS keywords written in upper case', async () => {
    // CSS keywords and function names are ASCII case-insensitive.
    const root = fixture({
      'src/ui/styles/components.css':
        '.a { display: GRID; }\n.b { position: STICKY; }\n.c { position: FIXED; }\n.d { background: LINEAR-GRADIENT(var(--color-bg), var(--color-on-bg)); }\n.e { filter: BLUR(2px); }\n',
    });
    const found = rules(await runGuard(root));
    expect(found).toContain(2);
    expect(found).toContain(4);
    expect(found).toContain(5);
    expect(found.filter((rule) => rule === 5)).toHaveLength(2);
  });

  test('fails when a component redeclares a shared class', async () => {
    const root = fixture({
      'src/ui/styles/components.css': '.btn { min-height: 56px; }\n',
      'src/ui/components/Bad.svelte': '<style>.btn { min-height: 80px; }</style>\n<button class="btn">x</button>\n',
    });
    expect(rules(await runGuard(root))).toContain(8);
  });

  test('fails on flex gap under src/ui', async () => {
    const root = fixture({
      'src/ui/styles/components.css': '.row { display: flex; gap: 8px; }\n',
    });
    expect(rules(await runGuard(root))).toContain(9);
  });

  test('exempts the capability report page', async () => {
    const root = fixture({
      'src/capabilities.html': '<html><head><style>body { color: #123456; border-radius: 3px; }</style></head></html>\n',
    });
    expect(await runGuard(root)).toEqual([]);
  });
});
