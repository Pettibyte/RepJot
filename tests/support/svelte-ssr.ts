/**
 * Bun test preload. Compiles `.svelte` files to server-renderable JavaScript so
 * `bun test` can render components without a browser.
 */

import { plugin } from 'bun';
import { compile } from 'svelte/compiler';

plugin({
  name: 'repjot-svelte-ssr',
  loader: { '.svelte': 'js' } as Record<string, string>,
  require: true,
  async setup(build) {
    build.onLoad({ filter: /\.svelte$/ }, async (args: { path: string }) => {
      const source = await Bun.file(args.path).text();
      const { js } = await compile(source, {
        filename: args.path,
        generate: 'server',
        runes: true,
        dev: false,
      });
      return { contents: js.code, loader: 'js' };
    });
  },
});
