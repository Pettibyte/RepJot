# Authentication and Offline Improvement

## Status

This document proposes a change to authentication and local use in REP JOT.
It selects local continuation after Google access expires.

This specification does not change the Google OAuth flow.
It does not add a server, a client secret, PKCE, or Google Identity Services (GIS).

This specification changes the current authentication boundary.
Where this document conflicts with current authentication requirements, this document is the proposed replacement.
The team must update `docs/REQUIREMENTS.md` and `docs/ARCHITECTURE.md` before implementation finishes.

## Conversation Summary

REP JOT uses a deprecated Google OAuth implicit flow for Kindle compatibility.
Google returns an access token with a lifetime near one hour.
The browser storage location does not change that lifetime.

The user asked whether REP JOT can extend the token lifetime without a cloud server.
The user also asked whether modern browsers can use a newer OAuth flow.
The existing Kindle flow can remain available through user-agent detection.

The research found no supported method to extend the current access token.
Google controls `expires_in`, and the application must obey that value.
A browser-only implicit or GIS Token Model flow does not receive a refresh token.

A supported Google authorization-code flow can receive a refresh token.
Google documents a backend for the code exchange and refresh-token storage.
That design conflicts with the requirement for a static application without a secret.

The discussion identified another approach.
REP JOT can separate local workout use from Google authorization.
Token expiry can stop Drive synchronization without stopping the active workout.

This document selects that approach as Option 5.

## Research Summary

### Current REP JOT flow

REP JOT sends `response_type=token` to the Google authorization endpoint.
The request uses a full-page redirect in the current window.
This behavior is in `src/auth/oauth-redirect-adapter.ts`.

The callback supplies an access token and an `expires_in` value.
REP JOT calculates `expiresAtUtc` from that response.
The application stores the token in `sessionStorage` or `localStorage`.

The storage choice controls browser persistence only.
It does not extend the token lifetime at Google.

The current expiry timer calls `expireSession()` in `src/bootstrap.ts`.
That function clears OAuth state, the selected account, raw payloads, and the bound session.
The mounted coordinator and account services remain in memory by accident, not by contract.

The current coordinator already saves each edit to IndexedDB before Drive synchronization.
It retains the working document, the synchronized base, and the pending delta.
This model provides most of the data safety that Option 5 requires.

### Google platform findings

Google describes direct implicit endpoint integration as legacy support.
Google recommends GIS for new browser integrations.

The GIS Token Model is the supported browser-only choice.
It still returns a short-lived access token and no refresh token.
A user action must request a replacement token after expiry.

The GIS Code Model supports refresh tokens through a backend flow.
The backend exchanges the authorization code and stores the refresh token.
A static GitHub Pages application cannot protect the required client secret.

Google supports PKCE in installed applications and some web code flows.
Google does not document a complete static-SPA refresh-token design for this use case.
PKCE does not make browser refresh-token storage confidential.

The recorded Kindle Scribe uses Silk 80 and reports both `Kindle` and `Silk/`.
The `Silk/` marker alone also identifies Amazon Fire tablets.
GIS supports only recent versions of common browsers and is not a safe Kindle dependency.

## Options Considered

### Option 1: Keep the current flow on all browsers

This option retains the tested Kindle behavior.
It also retains the one-hour token lifetime and the legacy security risks.
It provides no migration path for modern browsers.

### Option 2: Use GIS Token Model on modern browsers

This option keeps the current flow on Kindle.
Modern browsers use `initTokenClient()` and `requestAccessToken()`.

This option removes the token from the redirect URL on modern browsers.
It does not provide a refresh token or a longer session.
It also adds popup behavior and a remotely loaded GIS script.

This option requires changes to the REP JOT CSP and popup policy.
The application also requires a tested compatibility fallback.

### Option 3: Use GIS Authorization Code Model

This option gives the strongest supported Google web flow.
It can support refresh tokens and continued access.

The documented design requires a backend endpoint.
The backend protects the client secret and the refresh token.
This option conflicts with the serverless requirement.

### Option 4: Use browser-only authorization code with PKCE

PKCE protects an authorization code during the redirect flow.
It does not make a browser into a confidential client.

Google does not document this option as a complete static-SPA refresh-token solution.
An installed-app workaround can violate client-type and redirect rules.
REP JOT must not depend on an undocumented workaround.

### Option 5: Keep local use active after authorization expires

This option treats token expiry as loss of Drive access.
It does not treat token expiry as loss of the local account.

The user can continue, finish, and save a workout on the device.
REP JOT stores each edit in the account-scoped IndexedDB database.
The application synchronizes pending edits after the same Google account reconnects.

This option does not extend the token lifetime.
It reduces the effect of expiry and prevents workout data loss.
It also preserves the tested Kindle authorization flow.

### Option 6: Improve the reauthorization experience only

REP JOT can warn before expiry and provide a reconnect action.
Google can remember prior consent, so the next authorization can be short.

This option reduces friction but still interrupts an active workout.
It is useful with Option 5, but it is not sufficient by itself.

## Recommendation

Implement Option 5.
Keep Option 6 as part of the reconnect experience.
Do not change the OAuth protocol in this work.

This choice matches the existing local-first synchronization model.
It also avoids a server, a client secret, and an untested Kindle library.

The primary product rule is:

> Google authorization controls synchronization. It does not control access to durable local work on the same browser profile.

Explicit sign-out remains the action that closes local account access in the REP JOT user interface.
Confirmed disconnect remains the action that revokes the Google grant.

## Goals

The design has these goals:

- An active workout remains usable after token expiry.
- Each edit becomes durable in IndexedDB before a network request.
- Token expiry starts no new Drive request.
- Pending edits survive navigation, page reload, and browser restart.
- Reconnection synchronizes only with the same Google account.
- A different Google account never receives the pending data.
- Explicit sign-out closes local access on the browser profile.
- The design keeps the existing full-page Kindle authorization flow.

## Non-Goals

This work does not add these features:

- A longer Google access-token lifetime.
- A refresh token in browser storage.
- A backend or token broker.
- A new OAuth client type.
- GIS or a popup authorization flow.
- Local encryption or a local user password.
- Background synchronization while REP JOT is closed.
- Automatic conflict prompts.

## Security Decision

### Browser profile as the local boundary

IndexedDB already has browser-profile protection only.
This design uses the same boundary for local continuation.
It does not claim that IndexedDB data is encrypted for each REP JOT user.

A person with access to the browser profile can access browser storage.
The offline continuation feature does not create that access.
It makes the existing local data available through the REP JOT user interface.

This change relaxes the current live-bind rule.
A prior successful bind can authorize later local access on the same browser profile.
A live Google bind remains mandatory before Drive access.

### Account isolation

Google Drive `user.permissionId` remains the account namespace key.
A prior successful bind creates the local account selection.
The application never accepts an account key from a URL or user input.

A reconnect must return the same permission ID.
REP JOT must not open, merge, or upload the old account through a different account token.

The account coordinator must use an account-scoped token source.
The source returns a token only when `token.accountKey` equals the coordinator account key.
Use a separate unbound adapter only for the initial account bind.

## State Model

Authentication and local account state must be separate.
A single signed-in boolean cannot represent this design.

### Local account state

```ts
type LocalAccountState =
  | { kind: 'none' }
  | {
      kind: 'selected';
      accountKey: string;
      displayName?: string;
      lastBoundAtUtc: string;
    };
```

The selected record is credential-free.
It contains no token, scope, authorization header, workout data, or Drive file content.
Use a versioned storage envelope for the real implementation.

Store this record in `localStorage` under a new versioned key.
Do not include this key in the list that clears expired OAuth credentials.
Explicit sign-out and confirmed disconnect must clear the selection.

### Connection state

```ts
type ConnectionState =
  | { kind: 'anonymous' }
  | { kind: 'connected'; accountKey: string; expiresAtUtc: string }
  | { kind: 'local_only'; accountKey: string; reason: 'expired' | 'unauthorized' }
  | { kind: 'reconnecting'; accountKey: string };
```

A network error does not change the connection to `local_only`.
The token can remain valid during a network outage.
Normal synchronization retry rules apply to network, quota, and rate-limit errors.

A `401` changes the connection to `local_only`.
A known exact token expiry also changes it to `local_only`.

### Save and sync state

Local durability and remote synchronization are different facts.
The implementation must represent them separately.

The UI derives one short status from both facts:

| Condition | Status text |
| --- | --- |
| A local write is active | **Saving…** |
| The newest edit is local and no pending delta exists | **Saved** |
| The newest edit is local and authorization is unavailable | **Saved on this device** |
| Authorization exists but synchronization failed | **Sync failed** |

A persistent notice explains that local-only edits wait for reconnection.
The save badge must not claim that Drive received a pending edit.

## Local Account Record Lifecycle

| Event | OAuth credential | Local selection | Account database |
| --- | --- | --- | --- |
| First successful bind | Store | Create | Keep |
| Exact token expiry | Clear | Keep | Keep |
| Drive `401` | Clear | Keep | Keep |
| Same-account reconnect | Replace | Refresh | Reuse |
| Wrong-account reconnect | Clear returned token | Keep original | Do not cross-open |
| Explicit sign-out | Clear | Clear | Retain pending data |
| Confirmed disconnect | Clear | Clear | Clear per existing disconnect policy |
| Completed data deletion | Clear as required | Clear | Clear selected namespace |

Sign-out retains the account database because pending edits can require later recovery.
The cleared local selection prevents automatic access after restart.
The same account can bind later and reopen its namespace.

## Runtime Expiry Design

The expiry transition must be idempotent.
Several Drive requests can report `401` at almost the same time.
Only the first transition changes state and reports the notice.

Use an authorization generation number for network work.
Each Drive operation captures the current generation before it starts.
A transition to `local_only` increments the generation.

The transition follows this order:

1. Close the network gate and increment the authorization generation.
2. Cancel scheduled synchronization timers.
3. Prevent new Drive operations.
4. Flush queued field edits to IndexedDB only.
5. Clear the expired OAuth credential and callback state.
6. Keep the local selection, coordinator, services, route, and account database.
7. Set the connection state to `local_only`.
8. Show the persistent reconnect notice.

An in-flight upload can finish after the gate closes.
Its response must not clear pending data after the generation changes.
The next reconnect reads Drive and resolves an ambiguous prior upload.

Use `AbortController` where it can reduce unused work.
Do not depend on abort to prove that a remote write did not occur.

The expiry timer must rearm when a delay reaches the `setTimeout` limit.
A capped timer segment must not expire a token before its exact expiry.

## Coordinator Design

The coordinator must support connected and paused synchronization modes.
Do not let each local edit make a Drive request that is known to fail.

Add a network gate or equivalent coordinator control:

```ts
type SyncMode = 'connected' | 'paused_auth';

interface Coordinator {
  pauseSync(reason: 'expired' | 'unauthorized'): Promise<void>;
  resumeSync(): Promise<void>;
  ensureLocalLoaded(logicalName: string): Promise<unknown>;
  // Existing methods remain.
}
```

The exact API can differ, but these behaviors are mandatory.

### Paused behavior

In paused mode, the coordinator:

- Writes working, base, and pending rows in one local transaction.
- Creates a new monthly result shard without Drive access.
- Rebuilds documents from local rows only.
- Cancels Drive debounce timers.
- Starts no catalog, download, upload, or read-back request.
- Keeps pending deltas until a confirmed synchronization.
- Returns a settled local result to edit callers.
- Produces no repeated authentication banners.

A paused edit computes its delta against the last synchronized base.
The existing three-way merge can use that delta after reconnect.
No result or preference schema change is necessary.

### Resume behavior

`resumeSync()` opens the network gate after a same-account bind.
It flushes the local queue before it starts synchronization.
It then reconciles all logical files that have pending rows.

The existing preflight, merge, upload, and read-back rules remain in force.
A remote edit that occurred during local-only use enters the normal three-way merge.

## Durable Storage Requirement

Offline continuation across a redirect requires persistent IndexedDB storage.
The current storage factory can fall back to an in-memory store.
An in-memory store cannot survive the full-page OAuth redirect.

The storage layer must report whether the selected store is persistent.
The UI must not show **Saved on this device** for an in-memory save.

If pending edits exist only in memory, REP JOT must block the reconnect redirect.
It must explain that the browser cannot preserve the edits through sign-in.
The application must not claim durable recovery in this state.

The targeted Kindle exposes working IndexedDB, but tests must cover the fallback path.

## Startup Design

Bootstrap needs three explicit startup paths.

### Connected startup

1. Load and validate the static bundle.
2. Consume an OAuth callback when one exists.
3. Restore and bind the live token.
4. Compare the bound account with the saved local selection.
5. Open only the matching account namespace.
6. Build the coordinator in connected mode.
7. Warm local and remote data through the normal path.

If no local selection exists, a successful bind creates it.

### Local-only startup

1. Load and validate the static bundle.
2. Find that no live token exists.
3. Read the credential-free local selection.
4. Open that exact account namespace.
5. Build the coordinator with synchronization paused.
6. Load preferences and result shards from local records only.
7. Rebuild lookup indexes from those local documents.
8. Mount the normal workout UI with the reconnect notice.

Bootstrap must not enumerate IndexedDB databases to guess an account.
Missing, malformed, or invalid selection data must fail closed to anonymous mode.

An active-session route requires local hydration before the screen mounts.
Bootstrap must load the cached shard that contains that session before route publication.
A durable session-to-shard locator can provide this mapping.
A local cache scan is also valid when it stays inside the selected account namespace.

Do not derive a shard from the session UUID.
The session ID contains no date information.

The local loading path must not call `warmResultShards()` as it works today.
Add a local warm path that lists known cached result-shard keys.
The document pipeline must validate each local document before publication.

### Wrong-account callback startup

A callback token must bind before REP JOT trusts its account identity.
After binding, compare the permission ID with the local selection.

If the IDs differ, REP JOT must:

1. Clear the returned token.
2. Keep the original local selection and database closed to that token.
3. Start the original account in local-only mode.
4. Show an account-mismatch message without the raw permission ID.
5. Offer another reconnect attempt or explicit sign-out.

The message can use the saved display name when one exists.
The user must explicitly sign out before a different account becomes the selected local account.

## Reconnect Design

Show **Reconnect Google Account** in the persistent notice.
The button starts the existing full-page OAuth redirect.
It does not open a popup or a second window.

Before the redirect, REP JOT must:

1. Close the network gate.
2. Ask the active screen to commit its valid field draft.
3. Flush the in-memory edit queue to IndexedDB.
4. Stop the redirect if the local save fails.
5. Retain the local selection and all pending rows.
6. Store the current hash route in the OAuth state record.
7. Start the existing authorization redirect.

The existing `pagehide` flush is not sufficient because the browser does not await it.
The reconnect action must await the explicit local flush.
An invalid field draft remains visible and blocks the redirect until the user corrects it.

After the callback, REP JOT must:

1. Validate state, scope, token type, and exact expiry.
2. Bind the token to its Drive permission ID.
3. Compare that ID with the retained local selection.
4. Clear a mismatched token without synchronizing.
5. Build connected services for a matching account.
6. Restore the saved route.
7. Reconcile all pending logical files.
8. Load remote-only result shards after pending reconciliation starts.
9. Clear the notice only after the connection becomes usable.

The UI remains local-only if binding fails because of a network error.
A retry must not remove pending local work.

## User Experience

### Persistent notice

Use a persistent, non-dismissible notice in local-only mode:

> Google connection expired. You can keep using workouts on this device. Changes are saved here and will sync after you reconnect.

The notice includes **Reconnect Google Account**.
It must remain visible after route changes.
It must not cover workout controls on the Kindle display.

### Active workout

Token expiry must not navigate away from the active workout.
The user can edit results, finish, or abandon the session.
Each action uses the normal local transaction.

The application can start another workout in local-only mode.
The new session enters the correct monthly shard and creates a pending delta.

### History and preferences

History can show the locally cached result shards.
The UI must not imply that this history is complete across all devices.

Exercise-unit preferences remain editable.
Their edits remain pending until reconnect.

### Settings restrictions

These actions require live Google access and are unavailable in local-only mode:

- Drive raw export.
- Delete All User Data.
- Disconnect Google Account.

Diagnostics export remains available.
Sign-out remains available.

If pending edits exist, sign-out shows this warning:

> Unsynced changes will stay on this device. Reconnect with the same Google account to sync them.

### Account mismatch

Use this message after a wrong-account reconnect:

> This device's local data belongs to another Google account. Reconnect with that account, or sign out to use a different account.

Do not show the Drive permission ID.

## Failure Handling

| Failure | Behavior |
| --- | --- |
| Exact token expiry | Enter local-only mode and keep local services. |
| Drive `401` | Enter local-only mode once. |
| Drive `403` | Keep the current authorization classification unless Google reports an invalid grant. |
| Network unavailable | Keep the token and use normal local-first failure behavior. |
| Local storage write fails | Keep the field draft and show a local storage error. |
| Reconnect bind fails | Keep local-only mode and pending edits. |
| Reconnect returns another account | Clear that token and block synchronization. |
| Prior upload result is unknown | Keep the pending delta and reconcile after reconnect. |
| Local selection is corrupt | Open no private namespace and show the anonymous screen. |

Authorization loss must not overwrite another active error repeatedly.
The persistent connection notice carries the normal expiry condition.
The error banner remains available for storage and document errors.

## Privacy and Documentation Corrections

The current privacy page says that REP JOT stores a refresh token.
The current implementation stores no refresh token.
The privacy page also says that GIS handles sign-in, but the application does not use GIS.

The implementation work must correct these statements.
The landing-screen source comment also describes the access token as a refresh token.

The privacy page must explain local continuation.
It must state that workout data remains available in the same browser profile after Google access expires.

## Migration

No user-document schema migration is necessary.
The result, preference, base, and pending formats remain unchanged.

Add a versioned local account record.
On a successful bind, always create or refresh that record.

A one-time migration can use a legacy bound token record.
The migration accepts its account key only when the old record has the valid stored shape.
An expired token can still contain an account key from an earlier successful bind.
The migration must not treat the expired token as authorization for Drive.

Some older installations have already cleared the old account key.
Do not enumerate browser databases or guess the orphaned account.
A later successful bind will recreate the selection and reopen the correct database.

## Detailed Phase Plans

The implementation uses seven ordered phases.
Each phase document is a standalone checklist for its implementer.

| Phase | Scope | Document |
| --- | --- | --- |
| 01 | Requirements, architecture, local account record, and state contracts | [`auth-and-offline-improvement/phase-01.md`](auth-and-offline-improvement/phase-01.md) |
| 02 | Authorization loss, account-scoped credentials, and generation fencing | [`auth-and-offline-improvement/phase-02.md`](auth-and-offline-improvement/phase-02.md) |
| 03 | Paused coordinator, local loading, persistence, and resume | [`auth-and-offline-improvement/phase-03.md`](auth-and-offline-improvement/phase-03.md) |
| 04 | Connected, local-only, and mismatch startup paths | [`auth-and-offline-improvement/phase-04.md`](auth-and-offline-improvement/phase-04.md) |
| 05 | Reconnect notice, active-draft flush, Settings restrictions, and save labels | [`auth-and-offline-improvement/phase-05.md`](auth-and-offline-improvement/phase-05.md) |
| 06 | Privacy policy and public documentation corrections | [`auth-and-offline-improvement/phase-06.md`](auth-and-offline-improvement/phase-06.md) |
| 07 | Integration, browser, Kindle, compatibility, and release validation | [`auth-and-offline-improvement/phase-07.md`](auth-and-offline-improvement/phase-07.md) |

The phase checklists contain all implementation tasks and required reading.
They also assign unit, integration, DOM, browser, and physical-device tests.

The original acceptance criteria now appear as checked release criteria in Phase 07.
Each identified risk has a required proof and a release-blocking rule there.
Phase-specific risks also have test criteria in their owning phase.

## Sources

- [Google OAuth 2.0 for Client-side Web Applications](https://developers.google.com/identity/protocols/oauth2/javascript-implicit-flow)
- [Google: Choose a User Authorization Model](https://developers.google.com/identity/oauth2/web/guides/choose-authorization-model)
- [Google Identity Services Token Model](https://developers.google.com/identity/oauth2/web/guides/use-token-model)
- [Google Identity Services Code Model](https://developers.google.com/identity/oauth2/web/guides/use-code-model)
- [Google Account Authorization JavaScript API Reference](https://developers.google.com/identity/oauth2/web/reference/js-reference)
- [Google OAuth Best Practices](https://developers.google.com/identity/protocols/oauth2/resources/best-practices)
- [Google Identity Services Supported Browsers](https://developers.google.com/identity/gsi/web/guides/supported-browsers)
