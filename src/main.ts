import './polyfills';
import './ui/styles/index.css';
import { mount } from 'svelte';
import App from './App.svelte';
import {
  consumeCallback,
  hasCallbackFragment,
  type CallbackResult
} from './auth/oauth-redirect-adapter';

const target: HTMLElement | null = document.getElementById('app');

if (target === null) {
  throw new Error('Missing #app element.');
}

// Parse the callback and remove the URL fragment before the app mounts. No
// private data is read while an access token sits in the address bar.
let initialCallback: CallbackResult | null = null;
if (hasCallbackFragment()) {
  try {
    initialCallback = consumeCallback();
  } catch {
    initialCallback = { kind: 'error', error: 'callback_failed' };
  }
}

mount(App, {
  target,
  props: { initialCallback }
});
document.getElementById('boot-status')?.remove();
window.__repjotBooted?.();

declare global {
  interface Window {
    __repjotBooted?: () => void;
    __repjotLoadApp?: (source: string) => void;
  }
}
