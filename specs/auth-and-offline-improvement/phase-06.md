# Phase 06: Public Documentation Corrections

## Purpose

This phase makes public documentation match the implemented authorization and local-storage behavior.
It documents local continuation without claiming general background or offline synchronization.

## Required Reading

- [ ] Read `AGENTS.md` and the parent specification.
- [ ] Read Phases 01 through 05.
- [ ] Read `src/public/privacy.html` completely.
- [ ] Read `src/public/terms.html` completely.
- [ ] Read `src/ui/screens/LandingScreen.svelte`.
- [ ] Read `README.md`.
- [ ] Read the final authentication sections in requirements and architecture.
- [ ] Read the implemented local account and sign-out behavior.
- [ ] Read the Drive profile fields in `drive-rest-adapter.ts`.

## Preconditions

- [ ] Complete Phases 01 through 05.
- [ ] Finalize the local account envelope.
- [ ] Finalize sign-out, disconnect, and deletion behavior.
- [ ] Finalize all reconnect messages.
- [ ] Make sure that requirements and architecture describe the new boundary.
- [ ] Obtain policy-owner approval before changing the effective date.

## Required Public Facts

Public documentation must state these facts:

- REP JOT requests only the Drive `appDataFolder` OAuth scope.
- REP JOT reads the Drive permission ID and optional display name.
- REP JOT does not request email or profile-picture access.
- Google returns a short-lived access token.
- REP JOT stores no refresh token.
- The remember choice changes browser persistence only.
- The remember choice does not extend the Google token lifetime.
- Authorization uses a full-page redirect in the current window.
- REP JOT does not use Google Identity Services.
- REP JOT stores a credential-free local account selection.
- Account-scoped IndexedDB stores cached preferences and workout results.
- Local data can remain available after Google access expires.
- Pending edits synchronize after the same account reconnects.
- Another account cannot receive those pending edits.
- Sign-out closes local access in the REP JOT interface.
- Sign-out retains the account database and pending edits.
- Disconnect and data deletion follow their implemented clear policies.
- Delete All User Data requires live Google access.
- Clearing browser data can remove unsynchronized edits.
- Browser-profile access can expose browser storage.
- Pettibyte has no workout-storage server.

## Files to Change

### Modify `src/public/privacy.html`

Review and update these sections:

- Effective date.
- Data REP JOT Reads From Google.
- Where Your Data Lives.
- Local Browser Storage.
- Export Your Data.
- Delete Your Data.
- Third-Party Services.
- Security.

Add a section named **When Google Access Expires**.
Add shared-browser-profile guidance.

### Modify `src/ui/screens/LandingScreen.svelte`

- [ ] Correct the source comment that calls the access token a refresh token.
- [ ] Review the remember-choice text.
- [ ] Do not promise a longer Google session.
- [ ] Keep the current-window authorization description.

### Review `README.md`

- [ ] Keep the full-page implicit-flow statement.
- [ ] Keep GIS, PKCE, popup, and backend exclusions.
- [ ] Add local continuation only if the README describes runtime behavior.

### Review `src/public/terms.html`

- [ ] Remove contradictions with local continuation.
- [ ] Keep accurate Drive and device-storage terms.
- [ ] Make no change when the current statement remains correct.

### Review normative documents

- [ ] Make sure that `docs/REQUIREMENTS.md` matches implementation.
- [ ] Make sure that `docs/ARCHITECTURE.md` matches implementation.
- [ ] Remove any statement that expiry acts as sign-out.
- [ ] Keep the browser-profile boundary explicit.

Do not edit `dist/privacy.html` directly.
The build copies the source policy into `dist/`.

## Required Replacement Content

### Google access

Use content equivalent to:

> REP JOT requests the Google Drive `appDataFolder` scope. This scope lets REP JOT access only its private application-data files.

> REP JOT also reads your Drive permission ID and optional display name. REP JOT uses the permission ID to separate local account data.

> REP JOT does not request your email address, profile picture, or access to other Drive files.

### Token storage

Use content equivalent to:

> Google gives REP JOT a short-lived access token. REP JOT stores no refresh token.

> The remember choice controls whether the access token uses session storage or local storage. It does not extend the token lifetime.

### Local continuation

Use content equivalent to:

> When Google access expires, REP JOT can keep your cached workout data available in the same browser profile.

> You can continue a workout and save changes on that device. REP JOT synchronizes pending changes after the same Google account reconnects.

> Local history can be incomplete while Google access is unavailable. Another device can have newer Drive data.

### Shared browser profile

Use content equivalent to:

> Browser storage is protected by the browser profile, not by a separate REP JOT password.

> If you use a shared browser profile, sign out when you finish. Sign-out closes local access in REP JOT.

> Clearing browser data can remove changes that have not synchronized to Drive.

### Authorization service

Replace the GIS claim with content equivalent to:

> Google OAuth authorization. REP JOT opens Google's authorization page through a full-page redirect in the current window.

### Support and deletion

Remove claims that Pettibyte can locate or delete private Drive data from an email address.

Use content equivalent to:

> Pettibyte cannot directly open or delete your private Drive application data. Contact support for instructions if the in-app deletion process fails.

## Detailed Checklist

### Accuracy

- [ ] Remove positive claims that REP JOT stores a refresh token.
- [ ] Remove claims that GIS handles sign-in.
- [ ] Remove the “two permissions” statement.
- [ ] Remove email and profile-picture permission claims.
- [ ] Remove claims that workout programs live in Drive.
- [ ] Describe programs as static bundled data where necessary.
- [ ] Describe local continuation instead of broad offline behavior.
- [ ] Explain that local history can be stale.
- [ ] Explain same-account reconnection.
- [ ] Explain browser-profile access.
- [ ] Explain browser-data clearing risk.
- [ ] Explain sign-out behavior.
- [ ] Explain disconnect behavior.
- [ ] Explain deletion behavior.
- [ ] Remove impossible direct-deletion support promises.
- [ ] Update the effective date after approval.

### Consistency searches

- [ ] Search source and docs for `refresh token`.
- [ ] Search source and docs for `Google Identity Services`.
- [ ] Search source and docs for `GIS`.
- [ ] Search source and docs for email and profile-picture claims.
- [ ] Review each match manually.
- [ ] Keep technical non-goal text where it is accurate.
- [ ] Keep secret scans that identify actual leaked credentials.

### Build review

- [ ] Run the production build.
- [ ] Make sure that `dist/privacy.html` exists.
- [ ] Make sure that built text matches approved source text.
- [ ] Make sure that Landing and Settings links still work.
- [ ] Make sure that the policy works without JavaScript.
- [ ] Make sure that the policy loads no remote script or font.

## Tests

### Add `tests/privacy-copy.test.ts`

- [ ] The policy names an access token.
- [ ] The policy states that REP JOT stores no refresh token.
- [ ] The policy has no positive refresh-token storage claim.
- [ ] The policy does not name GIS as the sign-in handler.
- [ ] The policy names the full-page Google OAuth redirect.
- [ ] The policy names `appDataFolder`.
- [ ] The policy explains local continuation after expiry.
- [ ] The policy explains same-account reconnection.
- [ ] The policy explains the shared-profile risk.
- [ ] The policy explains browser-data clearing risk.
- [ ] The policy claims no email or profile-picture permission.
- [ ] The policy makes no direct Drive deletion promise.

### Build assertions

- [ ] Build creates `dist/privacy.html`.
- [ ] Built policy contains the approved effective date.
- [ ] Built policy contains the local-continuation section.
- [ ] Built policy contains no actual credential values.

## Manual Validation

### Conventional browser

- [ ] Open privacy from Landing.
- [ ] Open privacy from Settings.
- [ ] Navigate back to REP JOT.
- [ ] Disable JavaScript and read the policy.
- [ ] Examine a narrow viewport.
- [ ] Examine network requests for remote assets.

### Kindle Scribe

- [ ] Open `/privacy.html`.
- [ ] Read the local-continuation section.
- [ ] Scroll through the full policy.
- [ ] Make sure that text does not clip horizontally.
- [ ] Use **Back to REP JOT**.
- [ ] Make sure that the browser returns to the app.

## Acceptance and Risk Checks

- [ ] Source and built policy contain no false refresh-token claim.
- [ ] Source and built policy contain no false GIS claim.
- [ ] Policy fields match the actual Drive profile request.
- [ ] Offline wording describes local continuation only.
- [ ] Shared-device guidance names explicit sign-out.
- [ ] Browser-data clearing risk is explicit.
- [ ] Support text makes no impossible deletion promise.
- [ ] Generated policy matches approved source.

## Postconditions

- [ ] Public documentation matches implemented behavior.
- [ ] The privacy policy explains local access and pending edits.
- [ ] The privacy policy explains the browser-profile boundary.
- [ ] No public text overstates Google scopes or server capabilities.
- [ ] Generated static policy is current.

## Completion Commands

```text
bun test tests/privacy-copy.test.ts
bun run check
bun run test
bun run build
bun run check:compat
rg -n "refresh token|Google Identity Services|profile picture|email address" src/public docs README.md
git diff --check
git status --short
```
