// Client-mode test preload. Registers the Svelte client compiler and installs a
// DOM before any test module runs.
//
// Two things the root SSR preload cannot do, and why they are here:
//
// 1. `.svelte` compiles with `generate: 'client'`, so `mount()` exists. The
//    `svelte` package entry resolves to the server build under `bun test`,
//    which throws `lifecycle_function_unavailable` on `mount`.
// 2. `happy-dom` supplies `document` and friends. It is already a tracked
//    devDependency, so this costs the project nothing new.

import { plugin } from 'bun';
import { compile } from 'svelte/compiler';
import { Window } from 'happy-dom';

plugin({
  name: 'repjot-svelte-client',
  loader: { '.svelte': 'js' } as Record<string, string>,
  require: true,
  async setup(build) {
    build.onLoad({ filter: /\.svelte$/ }, async (args: { path: string }) => {
      const source = await Bun.file(args.path).text();
      const { js } = await compile(source, {
        filename: args.path,
        generate: 'client',
        dev: false
      });
      return { contents: js.code, loader: 'js' };
    });
  }
});

const win: any = new Window({ url: 'http://localhost/' });
const g: any = globalThis;

// Svelte's client runtime reaches for a fixed set of DOM globals. Copy those and
// nothing else, so a stray `globalThis.foo` in a component fails loudly rather
// than silently reading a Node global.
const DOM_GLOBALS: string[] = [
  'window', 'document', 'navigator', 'Node', 'Element', 'Text', 'Comment',
  'Event', 'CustomEvent', 'MouseEvent', 'KeyboardEvent', 'DocumentFragment',
  'SVGElement', 'HTMLElement', 'HTMLAnchorElement', 'HTMLButtonElement',
  'HTMLInputElement', 'HTMLSelectElement', 'HTMLTextAreaElement',
  'HTMLFormElement', 'HTMLTemplateElement', 'requestAnimationFrame',
  'cancelAnimationFrame', 'getComputedStyle', 'DOMParser', 'XMLSerializer'
];
for (const key of DOM_GLOBALS) {
  if (win[key] !== undefined) g[key] = win[key];
}
g.window = win;
