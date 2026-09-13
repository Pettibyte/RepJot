// The browser storage key names for authorization state.
// REQUIREMENTS 2.5, 2.9, 2.10, 2.12. ARCHITECTURE section 10.
//
// Only `src/auth/*` reads or writes these keys. `clearAllAuthState()` in the
// adapter removes every key in `AUTH_STORAGE_KEYS` from both stores, so a new
// key added here is cleared by sign-out without any other change.

/** OAuth request state. Holds no token. Stored in both stores for Silk continuity. */
export const OAUTH_STATE_KEY = 'repjot.oauth.state.v1';

/** Credential-free callback receipt. Holds a token fingerprint, never a token. */
export const OAUTH_RECEIPT_KEY = 'repjot.oauth.receipt.v1';

/** Access-token record for the unchecked remember choice. */
export const SESSION_TOKEN_KEY = 'repjot.oauth.token.session.v1';

/** Access-token record for the checked remember choice. */
export const LOCAL_TOKEN_KEY = 'repjot.oauth.token.local.v1';

/** The Drive account key of the last bound token. */
export const SELECTED_ACCOUNT_KEY = 'repjot.auth.selected-account.v1';

/** Every key that `clearAllAuthState()` removes from both stores. */
export const AUTH_STORAGE_KEYS: readonly string[] = [
  OAUTH_STATE_KEY,
  OAUTH_RECEIPT_KEY,
  SESSION_TOKEN_KEY,
  LOCAL_TOKEN_KEY,
  SELECTED_ACCOUNT_KEY
];
