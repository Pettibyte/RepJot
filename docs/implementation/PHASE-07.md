# Phase 07 — Authentication service and redirect adapter

Move the proven Phase 0 authorization prototype into the production module layout and
add the account binding, sign-out, and disconnect behavior on top of it.

## Prerequisites

- Phase 02 for `AppError` and the UTC helpers.
- Phase 06 for the state stores and the diagnostic log.
- `docs/PHASE-0-AUTHORIZATION-PROOF.md` records the behavior this phase must
  preserve. Do not change the wire flow.
- `VITE_GOOGLE_CLIENT_ID` set in `.env.local`.

## Goals

1. Split the prototype `src/google-identity.ts` into the adapter and the service.
2. Keep the full-page implicit redirect, the 30-minute state, and the 60-second
   credential-free receipt exactly as proven.
3. Bind every token to its Drive permission ID before any private cache access.
4. Implement sign out, disconnect with revocation, and expiry handling.

## Interfaces

### Files

| Path | Purpose |
| --- | --- |
| `src/auth/oauth-redirect-adapter.ts` | Redirect construction, state records, callback parsing, receipts, fragment cleanup, token persistence. |
| `src/auth/auth-service.ts` | Token lifecycle, account binding, remember choice, sign out, disconnect. |
| `src/auth/storage-keys.ts` | The `sessionStorage` and `localStorage` key names. |
| `src/google-identity.ts` | Deleted after the port. |

### Signatures

```ts
// src/auth/oauth-redirect-adapter.ts
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
export const STATE_TTL_MS = 30 * 60 * 1000;
export const RECEIPT_TTL_MS = 60 * 1000;

export interface TokenRecord {
  accessToken: string;
  expiresAtUtc: string;
  grantedScope: string;
  accountKey: string | null;   // filled after binding
}
export interface CallbackResult {
  kind: 'accepted' | 'duplicate' | 'invalid_state' | 'error';
  token?: TokenRecord;
  error?: string;              // safe code only, for example 'access_denied'
}
export function beginAuthorization(clientId: string, opts: { remember: boolean }): void;
export function consumeCallback(nowMs?: number): CallbackResult;
export function restoreToken(nowMs?: number): TokenRecord | null;  // drops records it cannot use
export function peekStoredToken(nowMs?: number): TokenRecord | null; // read-only, safe in a getter
export function saveToken(token: TokenRecord, remember: boolean): void;
export function clearAllAuthState(): void;   // tokens, state records, receipts, account selection
```

```ts
// src/auth/auth-service.ts
export interface AuthSession { accessToken: string; accountKey: string; expiresAtUtc: string; }
export function isSignedIn(): boolean;
export function getSession(): AuthSession | null;
export function restoreAndBind(deps: { bind: (t: string) => Promise<string> }): Promise<AuthSession | null>;
export function signOut(): void;
export function disconnect(deps: {
  revoke: (t: string) => Promise<void>;   // resolves only once the token is dead
}): Promise<{ kind: 'revoked' | 'revoke_failed' }>;
export function millisecondsUntilExpiry(nowMs?: number): number;
```

### Storage rules

| Choice | Store | Lifetime |
| --- | --- | --- |
| Remember unchecked | `sessionStorage` | Browser session. Cleared on tab close. |
| Remember checked | `localStorage` | Until `expiresAtUtc`, then treated as absent. |

The temporary OAuth state record lives in both stores for Kindle redirect
continuity. It holds no token. The receipt holds a token fingerprint only, never the
token itself.

## Requirements traceability

| Source | How this phase satisfies it |
| --- | --- |
| REQUIREMENTS 2.1, 2.2, 2.14 | Full-page redirect only. No popup, GIS, PKCE, code flow, or backend exchange. |
| REQUIREMENTS 2.3 | The adapter requests `drive.appdata` and nothing else. |
| REQUIREMENTS 2.4, 2.5 | 30-minute state in both storages. |
| REQUIREMENTS 2.6 | `consumeCallback` accepts only a matching unexpired state. |
| REQUIREMENTS 2.7, 2.8 | 60-second receipt. A duplicate is valid only with the exact accepted token. |
| REQUIREMENTS 2.9, 2.10 | The remember choice selects the store and the exact expiry. |
| REQUIREMENTS 2.11 | `restoreAndBind` binds before any private cache access. |
| REQUIREMENTS 2.12 | `clearAllAuthState` clears token, state, receipt, and account selection. |
| REQUIREMENTS 2.13 | `disconnect` revokes and confirms Drive rejects the token. |
| REQUIREMENTS 14.2, 14.3, 14.4 | One OAuth client, HTTPS origins, non-sensitive scope only. |
| ARCHITECTURE ADR-002, ADR-003, ADR-004 | Proven redirect flow, remember default off, permission-ID account binding. |
| ARCHITECTURE §10 | The 14-step lifecycle maps to the adapter and service functions above. |

## Checklist

### Implementation

- [x] Create `src/auth/storage-keys.ts` with the key names for state, receipt,
      session token, stored token, and selected account.
- [x] Port the redirect builder into `oauth-redirect-adapter.ts`. Keep
      `response_type=token` and the single scope.
- [x] Port state creation, storage in both storages, TTL check, and matching.
- [x] Port the receipt logic. Store a fingerprint of the accepted token, not the token.
- [x] Port `consumeCallback`. Return the typed `CallbackResult` instead of throwing.
- [x] Port token persistence for the remember choice and the exact expiry check.
- [x] Add `clearAllAuthState()` covering every key in `storage-keys.ts`.
- [x] Create `auth-service.ts` with `restoreAndBind`, `signOut`, `disconnect`, and
      `millisecondsUntilExpiry`. Inject the Drive calls so the service imports no
      Drive module.
- [x] On expiry or a `401` signal, erase token state and set `activeError` with kind
      `authentication`.
- [x] Delete `src/google-identity.ts` and update `src/main.ts` to the new imports.
- [x] Keep the URL fragment removal through `history.replaceState` before any private
      data access.

### Tests

- [x] `tests/oauth-redirect-adapter.test.ts`: a callback with an unknown or expired
      `state` returns `kind: 'invalid_state'` and stores no token.
- [x] `tests/oauth-redirect-adapter.test.ts`: a valid callback returns `accepted`
      with `expiresAtUtc` computed from `expires_in`.
- [x] `tests/oauth-redirect-adapter.test.ts`: a repeated callback with the same token
      inside the receipt window returns `duplicate` and reuses the stored token.
- [x] `tests/oauth-redirect-adapter.test.ts`: a repeated callback with a different
      token is not accepted as a duplicate.
- [x] `tests/oauth-redirect-adapter.test.ts`: remember unchecked writes
      `sessionStorage` only. Remember checked writes `localStorage`.
- [x] `tests/oauth-redirect-adapter.test.ts`: `restoreToken` returns `null` past
      `expiresAtUtc` and erases the stored record.
- [x] `tests/oauth-redirect-adapter.test.ts`: `clearAllAuthState` leaves no key from
      `storage-keys.ts` in either storage.
- [x] `tests/auth-service.test.ts`: `restoreAndBind` calls `bind` and stores the
      returned account key before reporting a session.
- [x] `tests/auth-service.test.ts`: `disconnect` returns `revoked` when the revoke
      confirms, and `revoke_failed` when it does not. Phase 08 dropped the second
      rejection probe because the adapter's `revokeToken` already polls Drive until
      Drive answers `401`. A probe after a confirmed revocation reported failure
      for a revocation that worked.
- [x] `tests/auth-service.test.ts`: a failed revoke returns `revoke_failed` and the UI
      path links to Google Account connections.
- [x] Port the existing `tests/google-identity.test.ts` cases into the two new files.
      Do not lose coverage of callback replay or account switching.

### Verification

- [x] `bun run check` passes.
- [x] `bun test` passes with the ported Phase 0 cases included.
- [x] `bun run build` passes.
- [x] `bun run check:compat` passes and still finds the `drive.appdata` scope string.
- [ ] Manual in `bun run dev`: sign in, reload, sign out, sign in with remember
      checked, and confirm the storage location changes.
- [ ] Physical Kindle smoke: redirect, callback replay, restore, and sign out still
      work. This is risk R-02.

The last two checks need a Google test account and a physical Kindle, so they stay
open until the next device pass. The automated gates above cover the same
behavior against an in-memory browser.

## Exit criteria

The app can sign in, restore, bind, expire, sign out, and disconnect through two
modules. No other module touches `sessionStorage` or `localStorage` for auth.
