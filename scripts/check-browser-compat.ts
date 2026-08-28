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
if (!index.includes('window.__repjotLoadApp("./app.js?v=')) {
  throw new Error('dist/index.html does not dynamically load the classic app.js bundle.');
}
const loaderDefinition = index.indexOf('window.__repjotLoadApp = function');
const loaderCall = index.indexOf('window.__repjotLoadApp("./app.js?v=');
const appTarget = index.indexOf('id="app"');
if (loaderDefinition === -1 || loaderCall < loaderDefinition || loaderCall < appTarget) {
  throw new Error('The dynamic app loader runs before its function or DOM target is ready.');
}
if (index.includes('type="module"')) {
  throw new Error('dist/index.html still contains a module script.');
}
if (/\bwindow\s*\.\s*open\s*\(/.test(bundle)) {
  throw new Error('dist/app.js can open a popup or secondary window.');
}
if (!bundle.includes('https://www.googleapis.com/auth/drive.appdata')) {
  throw new Error('dist/app.js does not contain the required Drive app-data scope.');
}

console.log('dist/app.js parses as ES2019, requests app-data access, and does not open a window.');
