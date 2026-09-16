import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig, type Plugin } from 'vite';
import { resolve } from 'node:path';

/**
 * Content Security Policy shipped in the built page.
 *
 * The app loads nothing from a CDN. `'unsafe-inline'` is required for the
 * bootstrap loader in `index.html` and for the inline style the progress bar
 * sets at runtime. `'unsafe-eval'` is required because Ajv compiles the four
 * document schemas in the browser with the `Function` constructor.
 * `scripts/check-browser-compat.ts` check 10 enforces this exact set, and
 * `docs/RELEASE.md` section 6 records the decision and the follow-up that
 * removes the need for `'unsafe-eval'`.
 *
 * The tag reaches the page only through this plugin, which runs with
 * `apply: 'build'`. It is absent from `src/index.html` on purpose: the policy
 * blocks the `ws://` socket that Vite hot reload opens, so shipping it in
 * development breaks reload without changing what users get.
 */
const CSP_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data:",
  // `'self'` is required. The app loads its exercise and workout bundles from
  // the same origin, for example `./data/exercises.json`. An explicit
  // `connect-src` replaces `default-src` for that directive instead of
  // adding to it, so without `'self'` the browser refuses the same-origin
  // fetch and the app cannot start. Production reported:
  //   Refused to load .../data/exercises.json because it violates the
  //   directive "connect-src https://www.googleapis.com https://oauth2.googleapis.com"
  "connect-src 'self' https://www.googleapis.com https://oauth2.googleapis.com",
  'form-action https://oauth2.googleapis.com',
  'frame-src https://accounts.google.com',
  "base-uri 'self'",
  "object-src 'none'"
].join('; ');

const CSP_META_TAG = `  <meta http-equiv="Content-Security-Policy" content="${CSP_POLICY}" />`;

function kindleClassicEntry(): Plugin {
  const buildId = Date.now().toString(36);
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

        if (!html.includes('</head>')) {
          throw new Error('The built index.html has no head element to carry the CSP meta tag.');
        }

        const withoutModuleTag = html.replace(moduleTag, '').replace(/^[ \t]+$/gm, '');
        return withoutModuleTag
          .replace('</head>', `${CSP_META_TAG}\n</head>`)
          .replace(
            '</body>',
            `<script>window.__repjotLoadApp("./app.js?v=${buildId}");</script>\n</body>`
          );
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
