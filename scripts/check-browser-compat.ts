import { parse } from 'acorn';

const bundlePath = new URL('../dist/app.js', import.meta.url);
const bundle = await Bun.file(bundlePath).text();

if (bundle.length === 0) {
  throw new Error('dist/app.js is empty. Run the production build first.');
}

parse(bundle, {
  ecmaVersion: 2019,
  sourceType: 'module'
});

console.log('dist/app.js parses as ES2019.');
