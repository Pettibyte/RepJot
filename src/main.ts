import './polyfills';
import { mount } from 'svelte';
import App from './App.svelte';
import { recordAuthDiagnostic } from './auth-diagnostics';
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
  recordAuthDiagnostic('bootstrap_authorization_result', {
    responseConsumed: initialAuthorization !== null
  });
} catch (error: unknown) {
  initialAuthorizationError = error instanceof Error ? error.message : String(error);
  recordAuthDiagnostic('bootstrap_authorization_error', {
    errorKind: initialAuthorizationError.includes('invalid state')
      ? 'invalid_state'
      : initialAuthorizationError.includes('denied')
        ? 'denied'
        : 'other'
  });
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
