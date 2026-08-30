import './polyfills';
import { mount } from 'svelte';
import App from './App.svelte';
import {
  consumeDriveAuthorizationResponse,
  type DriveAuthorization
} from './google-identity';

const target: HTMLElement | null = document.getElementById('app');

if (target === null) {
  throw new Error('Missing #app element.');
}

let initialAuthorization: DriveAuthorization | null = null;
let initialAuthorizationError: string | null = null;
try {
  initialAuthorization = consumeDriveAuthorizationResponse();
} catch (error: unknown) {
  initialAuthorizationError = error instanceof Error ? error.message : String(error);
}

mount(App, {
  target,
  props: { initialAuthorization, initialAuthorizationError }
});
document.getElementById('boot-status')?.remove();
window.__repjotBooted?.();

declare global {
  interface Window {
    __repjotBooted?: () => void;
    __repjotLoadApp?: (source: string) => void;
  }
}
