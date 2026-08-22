import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig, type Plugin } from 'vite';
import { resolve } from 'node:path';

function kindleClassicEntry(): Plugin {
  return {
    name: 'kindle-classic-entry',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html, context): string {
        if (!context.filename.endsWith('/index.html')) return html;

        const moduleTag = '<script type="module" crossorigin src="./app.js"></script>';
        if (!html.includes(moduleTag)) {
          throw new Error('The expected app module tag was not found in built index.html.');
        }

        return html.replace(moduleTag, '<script defer src="./app.js"></script>');
      }
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
