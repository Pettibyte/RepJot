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

export interface DriveAdapter {
  getAccountKey(): Promise<string>;                  // about.get fields=user(permissionId)
  listCatalog(): Promise<DriveFileMeta[]>;           // follows every nextPageToken
  readFile(id: string): Promise<DriveFileContent>;
  createFile(name: string, text: string): Promise<DriveFileMeta>;
  updateFile(id: string, text: string): Promise<DriveFileMeta>;
  deleteFile(id: string): Promise<void>;
  revokeToken(accessToken: string): Promise<void>;
}
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
| Account key | `GET /drive/v3/about?fields=user(permissionId)` |
| Catalog | `GET /drive/v3/files?spaces=appDataFolder&q=trashed=false&pageSize=1000&fields=nextPageToken,files(id,name,modifiedTime,md5Checksum,size,version)` |
| Read | `GET /drive/v3/files/{id}?alt=media` then `GET /drive/v3/files/{id}?fields=id,name,modifiedTime,md5Checksum,size,version` |
| Create | `POST /upload/drive/v3/files?uploadType=media` with `parents: ["appDataFolder"]` |
| Update | `PATCH /upload/drive/v3/files/{id}?uploadType=media` |
| Delete | `DELETE /drive/v3/files/{id}` |
| Revoke | `POST https://oauth2.googleapis.com/revoke?token=...` |

The adapter never logs a token or an `Authorization` header.

## Requirements traceability

| Source | How this phase satisfies it |
| --- | --- |
| REQUIREMENTS 3.2, 3.3 | All user files live in `appDataFolder` under the recognized names. |
| REQUIREMENTS 4.6 | `readFile` supplies the preflight content and metadata the merge needs. |
| REQUIREMENTS 4.17 | No conditional write is used. The adapter exposes no compare-and-swap. |
| REQUIREMENTS 4.18 | Read-back after update is a first-class adapter operation. |
| REQUIREMENTS 2.13 | `revokeToken` supports disconnect. |
| REQUIREMENTS 12.10 | `listCatalog` plus `readFile` support the raw export in Phase 19. |
| ARCHITECTURE ADR-008, ADR-009 | Full catalog reconciliation and retained file IDs updated in place. |
| ARCHITECTURE §11 "Catalog and duplicate files" | The catalog query matches the spec query exactly. |
| ARCHITECTURE §14 | Tokens travel only in HTTPS `Authorization: Bearer` headers. |
| ARCHITECTURE §15 | `errors.ts` produces the typed kinds the error table expects. |

## Checklist

### Implementation

- [ ] Create `src/drive/drive-interface.ts` with no Google-specific types.
- [ ] Create `src/drive/errors.ts` with the status and reason mapping table.
- [ ] Implement `getAccountKey` with `about.get` and the `user(permissionId)` field.
- [ ] Implement `listCatalog` with a loop that follows `nextPageToken` until absent.
- [ ] Implement `readFile` returning text plus fresh metadata.
- [ ] Implement `createFile` with `parents: ["appDataFolder"]`.
- [ ] Implement `updateFile` that updates in place and never deletes and recreates.
- [ ] Implement `deleteFile` by stable file ID.
- [ ] Implement `revokeToken` with a timeout.
- [ ] Add a request helper that injects the bearer token, sets
      `Content-Type: application/json; charset=utf-8` for media writes, and funnels
      every failure through `toAppError`.
- [ ] Log one diagnostic per failed Drive call with the operation and status only.
- [ ] Delete `src/google-drive.ts` and its hello-world functions.

### Tests

- [ ] `tests/drive-rest-adapter.test.ts`: `listCatalog` follows three pages and
      returns the concatenated metadata.
- [ ] `tests/drive-rest-adapter.test.ts`: the catalog request contains
      `spaces=appDataFolder` and `trashed=false`.
- [ ] `tests/drive-rest-adapter.test.ts`: `createFile` sends `parents` containing
      `appDataFolder`.
- [ ] `tests/drive-rest-adapter.test.ts`: `updateFile` issues a `PATCH` to the
      retained ID and returns fresh metadata.
- [ ] `tests/drive-rest-adapter.test.ts`: a `401` maps to `AppError('authentication')`.
- [ ] `tests/drive-rest-adapter.test.ts`: a `403` with `rateLimitExceeded` maps to
      `drive_rate_limit`, and `storageQuotaExceeded` maps to `drive_quota`.
- [ ] `tests/drive-rest-adapter.test.ts`: a `429` maps to `drive_rate_limit`.
- [ ] `tests/drive-rest-adapter.test.ts`: a malformed JSON body maps to
      `AppError('invalid_document')` rather than a raw parse error.
- [ ] `tests/drive-rest-adapter.test.ts`: a network rejection maps to
      `AppError('network')`.
- [ ] `tests/drive-errors.test.ts`: no `AppError` produced by the adapter carries a
      token or an `Authorization` header in `detail` or `message`.

### Verification

- [ ] `bun run check` passes.
- [ ] `bun test` passes.
- [ ] `bun run build` passes.
- [ ] `bun run check:compat` passes.
- [ ] Manual in `bun run dev`: list the catalog against a live account and confirm
      only `appDataFolder` entries appear.

## Exit criteria

The sync layer can perform every Drive operation through one interface and receives
typed errors. No Google error string reaches the UI.
