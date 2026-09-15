// Thin entry point.
// ARCHITECTURE section 9.
//
// The entry does three things: load the polyfills and the stylesheet, read the
// client id out of the build environment, and hand control to `bootstrap`. It
// holds no startup logic, so the whole sequence lives in one testable module.
//
// The OAuth callback is not handled here. `bootstrap` consumes it, because the
// callback must be ordered against the static load and the account bind, and an
// entry point cannot prove that order.

import './polyfills';
import './ui/styles/index.css';
import { bootstrap } from './bootstrap';

const clientId: string = import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim() ?? '';

void bootstrap({ clientId }).catch((): void => {
  // `bootstrap` reports every failure it knows about. This catch covers a throw
  // it could not foresee, and says so in the element the page bootstrap already
  // shows, so the user never stares at a blank panel.
  const status = document.getElementById('boot-status');
  if (status !== null) {
    status.textContent = 'REP JOT could not start. Reload the page to try again.';
  }
});
