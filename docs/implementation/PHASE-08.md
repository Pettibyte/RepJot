# Phase 08 — Drive interface and REST adapter

Define the Drive contract the sync layer needs, then implement it against the Drive
REST API with normalized errors.

## Prerequisites

- Phase 02 for `AppError` and `AppErrorKind`.
- Phase 06 for the diagnostic log.
- Phase 07 for the access token source.

## Goals

1. Give the sync layer one interface with no Google-specific types.
2. Implement catalog listing with full pagination.
3. Implement read, create, update, read-back, and delete by stable file ID.
4. Normalize Google failures into `AppErrorKind` values.
5. Replace the prototype `src/google-drive.ts`.

## Interfaces

### Files

| Path | Purpose |
| --- | --- |
| `src/drive/drive-interface.ts` | `DriveAdapter` interface and the metadata types. |
| `src/drive/drive-rest-adapter.ts` | Authenticated REST implementation. |
| `src/drive/errors.ts` | HTTP status and Google error reason to `AppErrorKind` mapping. |
| `src/google-drive.ts` | Deleted after the port. |
| `src/auth/drive-operations.ts` | Deleted. The adapter now owns the account call, the rejection probe, and the revocation form. |

### Signatures

```ts
// src/drive/drive-interface.ts
export interface DriveFileMeta {
  id: string;
  name: string;
  modifiedTime: string;
  version: string;
  md5Checksum: string | null;
  size: number;
}
export interface DriveFileContent { text: string; meta: DriveFileMeta; }
export interface DriveAccountProfile { accountKey: string; displayName?: string; }

export interface DriveAdapter {
  getAccountKey(): Promise<string>;                  // about.get, returns user(permissionId)
  getAccountProfile(): Promise<DriveAccountProfile>; // one call returns the key and the display name
  listCatalog(): Promise<DriveFileMeta[]>;           // follows every nextPageToken
  readFile(id: string): Promise<DriveFileContent>;
  createFile(name: string, text: string): Promise<DriveFileMeta>;
  updateFile(id: string, text: string): Promise<DriveFileMeta>;
  deleteFile(id: string): Promise<void>;
  probeRejected(accessToken: string): Promise<boolean>;
  revokeToken(accessToken: string): Promise<void>;
}

// src/drive/drive-rest-adapter.ts
export type AccessTokenSource = () => string | null;
export interface DriveRestAdapterOptions {
  fetchImpl?: typeof fetch;
  revokeTimeoutMs?: number;
  requestTimeoutMs?: number;   // caps one request; a stalled call maps to 'network'
}
export function createDriveRestAdapter(
  source: AccessTokenSource,
  options?: DriveRestAdapterOptions
): DriveAdapter;
```

```ts
// src/drive/errors.ts
export function toAppError(status: number, googleReason?: string): AppError;
// 401 -> 'authentication'      403 rateLimitExceeded -> 'drive_rate_limit'
// 403 userRateLimitExceeded -> 'drive_rate_limit'
// 403 storageQuotaExceeded -> 'drive_quota'
// 429 -> 'drive_rate_limit'    404 -> 'invalid_document' with reason 'not_found'
// network rejection -> 'network'
```

### REST calls

| Operation | Call |
| --- | --- |
| Account key | `GET /drive/v3/about?fields=user(permissionId,displayName)` |
| Catalog | `GET /drive/v3/files?spaces=appDataFolder&q=trashed=false&pageSize=1000&fields=nextPageToken,files(id,name,modifiedTime,md5Checksum,size,version)` |
| Read | `GET /drive/v3/files/{id}?alt=media` then `GET /drive/v3/files/{id}?fields=id,name,modifiedTime,md5Checksum,size,version` |
| Create | `POST /upload/drive/v3/files?uploadType=multipart` with a metadata part carrying `name` and `parents: ["appDataFolder"]` |
| Update | `PATCH /upload/drive/v3/files/{id}?uploadType=media` |
| Delete | `DELETE /drive/v3/files/{id}` |
| Revoke | Hidden form `POST https://oauth2.googleapis.com/revoke`, then poll Drive until it answers `401` |

The adapter never logs a token or an `Authorization` header.

Two rows differ from the first draft of this table, for reasons verified against
the Google reference:

- **Create uses `uploadType=multipart`.** A simple upload (`uploadType=media`)
  carries no metadata, so it cannot set the file name or the `appDataFolder`
  parent. Without a name the file cannot match the recognized-name scheme that
  REQUIREMENTS 3.2 and 3.3 depend on. See
  `developers.google.com/workspace/drive/api/guides/manage-uploads`.
- **Revoke posts a hidden form, not `fetch`.** Kindle Silk blocks a cross-origin
  `POST` from `fetch`, and the content security policy permits the form and its
  hidden frame instead. The Phase 0 proof on a physical Kindle established this
  path. A `fetch` revoke would also put the token in a query string.

`getAccountProfile` was added to the interface so the account panel keeps the
Google display name from one `about` call. `getAccountKey` stays as the spec
listed it and returns the profile's key.

## Requirements traceability

| Source | How this phase satisfies it |
| --- | --- |
| REQUIREMENTS 3.2, 3.3 | All user files live in `appDataFolder` under the recognized names. |
| REQUIREMENTS 4.6 | `readFile` supplies the preflight content and metadata the merge needs. |
| REQUIREMENTS 4.17 | No conditional write is used. The adapter exposes no compare-and-swap. |
| REQUIREMENTS 4.18 | The adapter supplies both halves. The caller composes `updateFile` and `readFile` and compares the text. `updateFile` returns fresh metadata only. |
| REQUIREMENTS 2.13 | `revokeToken` supports disconnect and is the single confirmation point. It polls Drive until Drive answers `401`, so `disconnect` performs no second probe. |
| ARCHITECTURE §10 step 14 | A Drive `401` reaches `restoreAndBind` as `AppError` kind `authentication` with the status at `detail.status`. `httpStatusOf` reads that shape and erases the stored token. |
| REQUIREMENTS 12.10 | `listCatalog` plus `readFile` support the raw export in Phase 19. |
| ARCHITECTURE ADR-008, ADR-009 | Full catalog reconciliation and retained file IDs updated in place. |
| ARCHITECTURE §11 "Catalog and duplicate files" | The catalog query matches the spec query exactly. |
| ARCHITECTURE §14 | Tokens travel only in HTTPS `Authorization: Bearer` headers. |
| ARCHITECTURE §15 | `errors.ts` produces the typed kinds the error table expects. |

## Checklist

### Implementation

- [x] Create `src/drive/drive-interface.ts` with no Google-specific types.
- [x] Create `src/drive/errors.ts` with the status and reason mapping table.
- [x] Implement `getAccountKey` with `about.get` and the `user(permissionId)` field.
- [x] Implement `listCatalog` with a loop that follows `nextPageToken` until absent.
- [x] Implement `readFile` returning text plus fresh metadata.
- [x] Implement `createFile` with `parents: ["appDataFolder"]`.
- [x] Implement `updateFile` that updates in place and never deletes and recreates.
- [x] Implement `deleteFile` by stable file ID.
- [x] Implement `revokeToken` with a timeout.
- [x] Add a request helper that owns the bearer token, the request timeout, the
      failure funnel through `toAppError`, and the diagnostic. Callers set
      their own media content type: `createFile` sends `multipart/related`,
      `updateFile` sends `application/json; charset=utf-8`.
- [x] Cap every request with `requestTimeoutMs` and an `AbortController`, so a
      stalled connection fails as `network` instead of hanging.
- [x] Log one diagnostic per failed Drive call with the operation and status only.
- [x] Delete `src/google-drive.ts` and its hello-world functions.
- [x] Delete `src/auth/drive-operations.ts`. Its account call, rejection probe,
      and revocation form now live in the adapter, and
      `GOOGLE_ACCOUNT_CONNECTIONS_URL` moved to `src/auth/auth-service.ts`.
- [x] Remove the hello-world demo from `src/App.svelte`. The page keeps the
      authorization controls and binds through the adapter.

### Tests

- [x] `tests/drive-rest-adapter.test.ts`: `listCatalog` follows three pages and
      returns the concatenated metadata.
- [x] `tests/drive-rest-adapter.test.ts`: the catalog request contains
      `spaces=appDataFolder` and `trashed=false`.
- [x] `tests/drive-rest-adapter.test.ts`: `createFile` sends `parents` containing
      `appDataFolder`.
- [x] `tests/drive-rest-adapter.test.ts`: `updateFile` issues a `PATCH` to the
      retained ID and returns fresh metadata.
- [x] `tests/drive-rest-adapter.test.ts`: a `401` maps to `AppError('authentication')`.
- [x] `tests/drive-rest-adapter.test.ts`: a `403` with `rateLimitExceeded` maps to
      `drive_rate_limit`, and `storageQuotaExceeded` maps to `drive_quota`.
- [x] `tests/drive-rest-adapter.test.ts`: a `429` maps to `drive_rate_limit`.
- [x] `tests/drive-rest-adapter.test.ts`: a malformed JSON body maps to
      `AppError('invalid_document')` rather than a raw parse error.
- [x] `tests/drive-rest-adapter.test.ts`: a network rejection maps to
      `AppError('network')`.
- [x] `tests/drive-errors.test.ts`: no `AppError` produced by the adapter carries a
      token or an `Authorization` header in `detail` or `message`.
- [x] Ported the Phase 07 revocation and rejection-probe cases from
      `tests/drive-operations.test.ts` into `tests/drive-rest-adapter.test.ts`.
- [x] `tests/auth-service.test.ts`: integration cases that wire the real
      `createDriveRestAdapter` into `restoreAndBind` and `disconnect` behind a
      fetch stub, so the error shape under test is the shape the adapter throws.
- [x] `tests/auth-service.test.ts`: a real adapter `401` during bind erases the
      stored token and reports reason `unauthorized`.
- [x] `tests/drive-errors.test.ts`: a `400` carries reason `bad_request`, an
      unmapped status carries `unexpected_status`, and a known reason wins over
      an unknown first entry.
- [x] `tests/drive-rest-adapter.test.ts`: a stalled request aborts at the
      timeout and maps to `network`.
- [x] `tests/oauth-redirect-adapter.test.ts`: `peekStoredToken` reads a live
      record without writing, and leaves an expired record in place.

### Verification

- [x] `bun run check` passes.
- [x] `bun test` passes.
- [x] `bun run build` passes.
- [x] `bun run check:compat` passes.
- [ ] Manual in `bun run dev`: list the catalog against a live account and confirm
      only `appDataFolder` entries appear. Needs a Google test account.

## Exit criteria

The sync layer can perform every Drive operation through one interface and receives
typed errors. No Google error string reaches the UI.
