import { parse } from 'acorn';

const bundlePath = new URL('../dist/app.js', import.meta.url);
const bundle = await Bun.file(bundlePath).text();

if (bundle.length === 0) {
  throw new Error('dist/app.js is empty. Run the production build first.');
}

parse(bundle, {
  ecmaVersion: 2019,
  sourceType: 'script'
});

const index = await Bun.file(new URL('../dist/index.html', import.meta.url)).text();
if (!index.includes('<script defer src="./app.js"></script>')) {
  throw new Error('dist/index.html does not load app.js as a deferred classic script.');
}
if (index.includes('type="module"')) {
  throw new Error('dist/index.html still contains a module script.');
}

console.log('dist/app.js parses as an ES2019 classic script.');
