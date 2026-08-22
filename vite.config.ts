import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  root: 'src',
  base: './',
  envDir: '..',
  plugins: [svelte()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true
  },
  build: {
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
