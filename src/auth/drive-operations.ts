// Drive calls for the authentication service.
// REQUIREMENTS 2.11, 2.13. ARCHITECTURE section 10, steps 12 through 14.
//
// `auth-service.ts` receives these functions as injected dependencies. Keeping
// them here means the service imports no Drive module, and the revocation
// workaround stays in one place.
//
// Revocation uses a hidden form because Silk blocks a cross-origin `POST` from
// `fetch`. The form posts to Google and the service polls Drive until Drive
// rejects the token. A network error never proves a revocation.

import { secureUuid } from '../domain/ids';
import { getDriveAccount } from '../google-drive';

const REVOCATION_ENDPOINT = 'https://oauth2.googleapis.com/revoke';
const ACCOUNT_CHECK_ENDPOINT =
  'https://www.googleapis.com/drive/v3/about?fields=user(permissionId)';
/** Link the UI shows when Google does not confirm a revocation. */
export const GOOGLE_ACCOUNT_CONNECTIONS_URL = 'https://myaccount.google.com/connections';

const REVOKE_POLL_MS = 500;
const REVOKE_TIMEOUT_MS = 15_000;

/**
 * Return the Drive `user.permissionId` for one access token.
 *
 * REQUIREMENTS 2.11. This is the account binding. Rejects when Drive returns no
 * permission ID or any error, including a `401`.
 */
export async function bindAccount(accessToken: string): Promise<string> {
  const account = await getDriveAccount(accessToken);
  return account.accountKey;
}

/**
 * Bind the token and return the account key with its display name.
 *
 * The same `drive/v3/about` request answers both questions. Returning the
 * display name here means one `about` call per page load instead of two.
 * REQUIREMENTS 2.11.
 */
export async function bindAccountWithProfile(
  accessToken: string
): Promise<{ accountKey: string; displayName?: string }> {
  const account = await getDriveAccount(accessToken);
  return account.displayName === undefined
    ? { accountKey: account.accountKey }
    : { accountKey: account.accountKey, displayName: account.displayName };
}

/**
 * Ask Google to revoke one access token and wait until Drive rejects it.
 *
 * Resolves when Drive answers `401`. Rejects when the timeout passes, which
 * means REP JOT cannot confirm the revocation.
 */
export function revokeToken(accessToken: string, timeoutMs: number = REVOKE_TIMEOUT_MS): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const frameName = `repjot_revoke_${secureUuid()}`;
    const frame = document.createElement('iframe');
    const form = document.createElement('form');
    const tokenField = document.createElement('input');
    const deadline = Date.now() + timeoutMs;
    let timer: number | null = null;
    let finished = false;

    frame.name = frameName;
    frame.title = 'Google authorization revocation';
    frame.style.display = 'none';
    form.method = 'post';
    form.action = REVOCATION_ENDPOINT;
    form.target = frameName;
    form.style.display = 'none';
    tokenField.type = 'hidden';
    tokenField.name = 'token';
    tokenField.value = accessToken;
    form.appendChild(tokenField);

    const cleanup = (): void => {
      if (finished) return;
      finished = true;
      if (timer !== null) window.clearTimeout(timer);
      form.remove();
      frame.remove();
    };
    const fail = (): void => {
      cleanup();
      reject(new Error('Google did not confirm that it revoked access.'));
    };
    const scheduleCheck = (): void => {
      if (finished) return;
      if (Date.now() >= deadline) {
        fail();
        return;
      }
      const delay = Math.min(REVOKE_POLL_MS, deadline - Date.now());
      timer = window.setTimeout(check, delay);
    };
    const check = async (): Promise<void> => {
      if (finished) return;
      if (await probeRejected(accessToken)) {
        cleanup();
        resolve();
        return;
      }
      scheduleCheck();
    };

    document.body.appendChild(frame);
    document.body.appendChild(form);
    try {
      form.submit();
      form.remove();
      scheduleCheck();
    } catch {
      fail();
    }
  });
}

/**
 * Ask Drive whether it rejects one token.
 *
 * Returns `true` only for a `401`. A `200` means the token still works. A
 * network error returns `false` because it proves nothing.
 */
export async function probeRejected(accessToken: string): Promise<boolean> {
  try {
    const response: Response = await fetch(ACCOUNT_CHECK_ENDPOINT, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store'
    });
    return response.status === 401;
  } catch {
    return false;
  }
}
