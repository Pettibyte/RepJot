# Phase 06 — Local persistence, diagnostics, and status

Build the small account-scoped storage façade, the in-memory diagnostic ring, and the
Svelte state that reports save and sync status.

## Prerequisites

- Phase 02 for `AppError` and the UTC helpers.
- Phase 03 for the pipeline that consumes cached text.

## Goals

1. Give the app one key-value façade over IndexedDB with a transactional `setMany`.
2. Keep the façade near 50 lines and swappable.
3. Namespace every record by Drive account so two accounts never share data.
4. Provide the bounded in-memory diagnostic ring.
5. Provide the `Saving` / `Saved` / `Sync failed` state that every screen reads.

## Interfaces

### Files

| Path | Purpose |
| --- | --- |
| `src/storage/local-store.ts` | The `LocalStore` interface and the record-key helpers. |
| `src/storage/indexeddb-local-store.ts` | IndexedDB implementation. Target under 50 lines of logic. |
| `src/storage/records.ts` | Shapes for the cached, base, and pending records. |
| `src/diagnostics/diagnostic-log.ts` | Bounded in-memory ring and JSON export. |
| `src/state/app-state.ts` | Svelte stores for startup, save, sync, route, and error state. |

### Signatures

```ts
// src/storage/local-store.ts
export interface LocalStore {
  get(name: string): Promise<unknown | undefined>;
  set(name: string, value: unknown): Promise<void>;
  delete(name: string): Promise<void>;
  setMany(entries: Array<{ name: string; value: unknown }>): Promise<void>;
}
export function cacheKey(logicalName: string): string;    // 'doc:<name>'
export function baseKey(logicalName: string): string;     // 'base:<name>'
export function pendingKey(logicalName: string): string;  // 'pending:<name>'
```

```ts
// src/storage/indexeddb-local-store.ts
export function createIndexedDbLocalStore(accountKey: string): Promise<LocalStore>;
// One database per account: 'repjot-<accountKey>'. One object store: 'docs'.
// One 'readwrite' transaction per call. setMany puts every entry in that one
// transaction, so all writes land together or none do.
```

```ts
// src/storage/records.ts
export interface CachedDocRecord {
  logicalName: string;
  driveFileId: string | null;
  remoteEtag: string | null;        // Drive version, modifiedTime, or md5Checksum
  contentText: string;              // exact bytes as last read or written
  schemaVersion: number;
  cachedAtUtc: string;
}
export interface BaseRecord { contentText: string; driveFileId: string | null; }
export interface PendingRecord { delta: unknown; updatedAtUtc: string; }
```

```ts
// src/diagnostics/diagnostic-log.ts
export const MAX_DIAGNOSTIC_EVENTS = 200;
export interface DiagnosticEvent {
  recordedAtUtc: string;
  severity: 'info' | 'warn' | 'error';
  code: string;                     // stable code, for example 'sync_upload_retry'
  context?: Record<string, string | number>;
}
export function logDiagnostic(event: Omit<DiagnosticEvent, 'recordedAtUtc'>): void;
export function diagnosticSnapshot(): DiagnosticEvent[];      // oldest first
export function diagnosticJson(): string;
export function downloadDiagnosticLog(): void;                // Blob + object URL + download attr
```

```ts
// src/state/app-state.ts
export type SaveStatus = 'idle' | 'saving' | 'saved' | 'sync_failed';
export type StartupStatus = 'loading_static' | 'static_failed' | 'ready' | 'blocked';
export const saveStatus: Readable<SaveStatus>;
export const startupStatus: Readable<StartupStatus>;
export const lastSavedAtUtc: Readable<string | null>;
export const activeError: Readable<AppError | null>;
export function setSaveStatus(s: SaveStatus): void;
export function setStartupStatus(s: StartupStatus): void;
export function reportError(e: AppError): void;
```

### Record layout for one logical Drive file

| Key | Value | Written by |
| --- | --- | --- |
| `doc:<name>` | `CachedDocRecord` | Sync coordinator after a read or a confirmed write |
| `base:<name>` | `BaseRecord` | Sync coordinator after a confirmed sync |
| `pending:<name>` | `PendingRecord` | Session or preference save, cleared after commit |

A user save writes all three with one `setMany` call.

## Requirements traceability

| Source | How this phase satisfies it |
| --- | --- |
| REQUIREMENTS 3.7 | Local cache plus in-memory maps. No query engine. |
| REQUIREMENTS 3.8 | No SQLite and no WebAssembly. IndexedDB only. |
| REQUIREMENTS 3.11–3.13 | The four-method façade, whole JSON documents, no query, index, or partial update. |
| REQUIREMENTS 3.14 | `setMany` is one IndexedDB transaction covering cached, base, and pending. |
| REQUIREMENTS 3.15 | Only the façade knows IndexedDB. A swap changes one file. |
| REQUIREMENTS 3.16 | Nothing here persists a derived index. |
| REQUIREMENTS 3.21 | OAuth state stays outside this façade. |
| REQUIREMENTS 4.1–4.3 | `SaveStatus` carries `saving`, `saved`, and `sync_failed`. |
| REQUIREMENTS 12.11, 12.12 | Ring capped at 200, oldest dropped, never persisted, never uploaded, download action present. |
| ARCHITECTURE ADR-006, ADR-007 | Small façade over IndexedDB with whole-value records. |
| ARCHITECTURE ADR-016 | Bounded in-memory diagnostics with no persistence or salting. |
| ARCHITECTURE §7 "Local storage façade" | The interface matches the architecture block exactly. |
| ARCHITECTURE "State layers" | The UI shows **Saved** only after the IndexedDB transaction resolves. |

## Checklist

### Implementation

- [ ] Create `src/storage/local-store.ts` with the interface and the three key
      helpers.
- [ ] Create `src/storage/records.ts` with `CachedDocRecord`, `BaseRecord`, and
      `PendingRecord`.
- [ ] Create `src/storage/indexeddb-local-store.ts`. Open one database per account
      key with one `docs` object store keyed by string.
- [ ] Implement `setMany` inside a single `readwrite` transaction. Abort the
      transaction if any put fails, and reject with `AppError('storage')`.
- [ ] Map `QuotaExceededError` to `AppError('storage')` with detail
      `reason: 'quota'`.
- [ ] Add `createMemoryLocalStore()` for tests and for browsers without IndexedDB.
      It implements the same interface with a `Map`.
- [ ] Create `src/diagnostics/diagnostic-log.ts` with the ring, snapshot, JSON
      export, and download.
- [ ] Add a guard in `logDiagnostic` that rejects any context key matching
      `/token|authorization|header|secret/i`.
- [ ] Create `src/state/app-state.ts` with Svelte readable stores and the setters.
- [ ] Add a JSDoc note on `setSaveStatus` that `saved` means durable in IndexedDB,
      not synchronized.

### Tests

- [ ] Add `fake-indexeddb` as a dev dependency for tests only.
- [ ] `tests/local-store.test.ts`: `set` then `get` round-trips a value.
- [ ] `tests/local-store.test.ts`: `get` on a missing key resolves `undefined`.
- [ ] `tests/local-store.test.ts`: `delete` removes the key.
- [ ] `tests/local-store.test.ts`: `setMany` commits all entries when the transaction
      succeeds.
- [ ] `tests/local-store.test.ts`: when one put in a `setMany` fails, no entry from
      that call is readable afterward.
- [ ] `tests/local-store.test.ts`: two account keys produce two separate namespaces.
      A value written under account A is absent under account B.
- [ ] `tests/local-store.test.ts`: a stubbed `QuotaExceededError` surfaces as
      `AppError('storage')` with `reason: 'quota'`.
- [ ] `tests/diagnostic-log.test.ts`: the ring keeps 200 events and drops the oldest.
- [ ] `tests/diagnostic-log.test.ts`: `diagnosticSnapshot` returns oldest first.
- [ ] `tests/diagnostic-log.test.ts`: a context key containing `token` is rejected
      and logged as a guard violation.
- [ ] `tests/app-state.test.ts`: `saveStatus` transitions `idle -> saving -> saved`
      and `saving -> sync_failed`.

### Verification

- [ ] `bun run check` passes.
- [ ] `bun test` passes.
- [ ] `bun run build` passes.
- [ ] `bun run check:compat` passes.
- [ ] Manual in `bun run dev`: the memory store and the IndexedDB store both pass a
      smoke `setMany` from the browser console.

## Exit criteria

No module outside `src/storage/` references `indexedDB`. One call makes a local edit
durable, and the status store can report it.
