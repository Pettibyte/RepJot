# Phase 0 authorization continuity proof

## Status

The authorization prototype is ready for a physical Kindle test. The automated tests pass, but they do not satisfy the hardware exit criteria.

Do not mark Phase 0 as complete until the results table contains one physical Kindle test run.

## Prototype behavior

The prototype has these controls:

- **Remember me on this device** selects `localStorage` instead of `sessionStorage` for the token.
- **Continue with Google** starts a full-page redirect in the current window.
- The short-lived OAuth request state uses both stores because Silk can replace `sessionStorage` during some redirects.
- **Switch Google account** clears the token and requests the Google account selector.
- **Sign out from REP JOT** clears both token stores without revoking the grant.
- **Disconnect Google Account** posts a hidden form to Google and waits for Drive to reject the revoked token.
- **Open Google Account connections** is available when Google does not confirm revocation.

REP JOT removes the OAuth fragment before it mounts the Svelte application. It then binds the token with Drive `about.get`.

The build fails if the application bundle calls `window.open`. The build also fails if the required `drive.appdata` scope is absent.

## Build the test version

1. Set `VITE_GOOGLE_CLIENT_ID` to the client ID for the OAuth test project.
2. Run `bun run check`.
3. Run `bun run test`.
4. Run `bun run check:compat`.
5. Deploy the generated `dist/` directory to the registered HTTPS test origin.
6. Record the deployed commit and URL in the results table.

## Prepare the Kindle

1. Open the deployed URL on the physical Kindle.
2. Make sure that the device clock is correct.
3. Make sure that two permitted Google test accounts are available.
4. Remove old REP JOT tokens from the browser storage before the first test.

Do not put an access token, account key, or authorization fragment in this document.

## Test cases

### P0-01 Unchecked continuity

1. Clear **Remember me on this device**.
2. Start authorization from a route other than `#/`.
3. Complete Google authorization.
4. Make sure that Google returns to the initial route.
5. Reload the page in the same browser session.
6. Make sure that REP JOT binds the same account without a new authorization request.
7. Close the browser session.
8. Open REP JOT again.
9. Record whether the Kindle restored the browser session.

Expected result: REP JOT uses `sessionStorage`. No action opens a second window.

### P0-02 Checked continuity

1. Select **Remember me on this device**.
2. Complete Google authorization.
3. Reload the page.
4. Close and open the Kindle browser.
5. Open REP JOT before the token expiry time.
6. Make sure that REP JOT binds the same account.

Expected result: REP JOT uses `localStorage` until the exact token expiry time.

### P0-03 Expiry

1. Authorize REP JOT with the remember choice selected.
2. Record the expiry time that the prototype shows.
3. Leave the token unchanged until that time.
4. Open or reload REP JOT after that time.
5. Make sure that REP JOT requests authorization again.

Expected result: REP JOT clears the expired token from both stores. It does not open private data.

### P0-04 Denial

1. Start a Google authorization request that shows the consent action.
2. Deny the request.
3. Make sure that REP JOT shows the denial message.
4. Reload REP JOT.

Expected result: REP JOT removes the fragment and stores no access token.

### P0-05 Account switch

1. Authorize REP JOT with test account A.
2. Select **Switch Google account**.
3. Select test account B.
4. Make sure that the prototype shows the name for account B.
5. Reload REP JOT.
6. Make sure that REP JOT binds account B again.

Expected result: REP JOT does not reuse the token or account binding for account A.

### P0-06 Sign out

1. Authorize REP JOT.
2. Select **Sign out from REP JOT**.
3. Reload REP JOT.

Expected result: REP JOT clears both token stores. The Google grant remains active.

### P0-07 Revocation

1. Authorize REP JOT.
2. Select **Disconnect Google Account**.
3. Wait for the Google response.
4. Reload REP JOT.
5. Start authorization again.

Expected result: Google confirms revocation. REP JOT clears the token and requires a new grant.

### P0-08 Revocation fallback

1. Authorize REP JOT.
2. Disable the network connection.
3. Select **Disconnect Google Account**.
4. Wait 15 seconds.
5. Make sure that REP JOT shows the Google Account connections link.
6. Restore the network connection.

Expected result: REP JOT does not report a successful disconnect. REP JOT keeps the local authorization state.

## Results


| Field                | Value        |
| -------------------- | ------------ |
| Commit               | Not recorded |
| Test URL             | Not recorded |
| Kindle model         | Not recorded |
| Silk version         | Not recorded |
| Test account project | Not recorded |
| Started at UTC       | Not recorded |
| Finished at UTC      | Not recorded |
| Tester               | Not recorded |


| Case                       | Result          | Observed behavior                                                                                                                                                                                                              | Evidence reference |
| -------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------ |
| P0-01 Unchecked continuity | PASS            | PASS                                                                                                                                                                                                                           |                    |
| P0-02 Checked continuity   | PASS            | PASS                                                                                                                                                                                                                           |                    |
| P0-03 Expiry               | Not run         |                                                                                                                                                                                                                                |                    |
| P0-04 Denial               | PASS with issue | On Kindle, "Error: Google authorization returned an invalid state. Try again." But then reloading the browser works. -- On PC desktop browser: PASS with "Error: Google authorization was denied. No access token was saved." |                    |
| P0-05 Account switch       | PASS with issue | On Kindle, "Error: Google authorization returned an invalid state. Try again." But then reloading the browser works. -- On PC desktop browser: works as expected.                                                            |                    |
| P0-06 Sign out             | PASS            | PASS                                                                                                                                                                                                                           |                    |
| P0-07 Revocation           | FAIL            | "Error: REP JOT could not contact the Google revocation service. Use the Google Account connections page." Same behavior on Kindle and PC desktop browser.                                                                     |                    |
| P0-08 Revocation fallback  | FAIL            | "Error: REP JOT could not contact the Google revocation service. Use the Google Account connections page."                                                                                                                     |                    |

## Retest scope

The first hardware run found two implementation problems. The next build contains these changes:

- The request state has a short-lived `localStorage` fallback for the affected Silk redirects.
- A denial without returned `state` reports denial but cannot accept a token.
- Revocation uses Google's documented form submission instead of a script request.
- REP JOT confirms revocation only after Drive rejects the token with `401`.

Run P0-03 through P0-08 again. Keep the first-run observations in the results table.

## Exit decision

Phase 0 passes only when all test cases pass on the physical Kindle.

Phase 0 fails if a flow opens a popup, tab, or second window. It also fails if token cleanup or account rebinding fails.
