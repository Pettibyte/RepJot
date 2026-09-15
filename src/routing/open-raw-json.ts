// The **View Raw JSON** action.
// ARCHITECTURE ADR-017 and section 12.9. REQUIREMENTS 6.8 and 6.9.
//
// One function carries the whole action: keep the payload in memory, then route
// to the raw viewer with the key. It lives outside the component so a test
// asserts the navigation without a browser, and so every caller performs the
// action the same way.

import { putRawPayload } from '../state/raw-payload-store';
import { getRouter } from './router-registry';

/**
 * Open the raw viewer for one payload.
 *
 * Returns the payload key, or `null` when no router is installed. The payload
 * is stored only when the navigation can actually run, so a failed action
 * leaves nothing behind.
 */
export function openRawJson(rawJson: string): string | null {
  const router = getRouter();
  if (router === null) return null;

  const key = putRawPayload(rawJson);
  router.navigate({ name: 'raw-json', source: key });
  return key;
}
