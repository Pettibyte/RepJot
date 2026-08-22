import './polyfills';
import { mount } from 'svelte';
import App from './App.svelte';

const target: HTMLElement | null = document.getElementById('app');

if (target === null) {
  throw new Error('Missing #app element.');
}

mount(App, { target });
document.getElementById('boot-status')?.remove();
window.__repjotBooted?.();

declare global {
  interface Window {
    __repjotBooted?: () => void;
    __repjotLoadApp?: (source: string) => void;
  }
}
