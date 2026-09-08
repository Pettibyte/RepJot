import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig, type Plugin } from 'vite';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

function kindleClassicEntry(): Plugin {
  let outDir = '';
  return {
    name: 'kindle-classic-entry',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    writeBundle() {
      const appJsPath = join(outDir, 'app.js');
      const indexPath = join(outDir, 'index.html');

      let appJsBytes: Buffer;
      let html: string;
      try {
        appJsBytes = readFileSync(appJsPath);
        html = readFileSync(indexPath, 'utf8');
      } catch (error) {
        throw new Error(`The emitted app.js and index.html were not available in ${outDir}: ${String(error)}`);
      }

      // Cache-busting token derived from the emitted app.js bytes so equal
      // inputs produce equal output and any source change changes the token.
      const buildId = createHash('sha256').update(appJsBytes).digest('hex');

      const moduleTag = '<script type="module" crossorigin src="./app.js"></script>';
      if (!html.includes(moduleTag)) {
        throw new Error('The expected app module tag was not found in built index.html.');
      }

      const withoutModuleTag = html.replace(moduleTag, '').replace(/^[ \t]+$/gm, '');
      writeFileSync(
        indexPath,
        withoutModuleTag.replace(
          '</body>',
          `<script>window.__repjotLoadApp("./app.js?v=${buildId}");</script>\n</body>`
        )
      );
    }
  };
}

export default defineConfig({
  root: 'src',
  base: './',
  envDir: '..',
  plugins: [svelte(), kindleClassicEntry()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true
  },
  build: {
    target: 'es2019',
    outDir: '../dist',
    emptyOutDir: true,
    assetsDir: '',
    cssCodeSplit: false,
    rollupOptions: {
      input: {
        app: resolve(import.meta.dirname, 'src/index.html'),
        capabilities: resolve(import.meta.dirname, 'src/capabilities.html')
      },
      output: {
        entryFileNames: 'app.js',
        chunkFileNames: 'app.js',
        assetFileNames: '[name][extname]'
      }
    }
  }
});
