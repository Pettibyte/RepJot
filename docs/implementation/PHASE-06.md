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
| `src/storage/memory-local-store.ts` | `Map` implementation for tests and for a host with no IndexedDB. |
| `src/storage/create-local-store.ts` | Engine switch. Returns the IndexedDB engine when the host has it, the memory engine when it does not. |
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
// src/storage/create-local-store.ts
export function createLocalStore(accountKey: string): Promise<LocalStore>;
// The engine switch. IndexedDB when the host exposes it, the memory store when
// it does not. Lives inside `src/storage/` because no module outside that
// directory may reference `indexedDB`.
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

- [x] Create `src/storage/local-store.ts` with the interface and the three key
      helpers.
- [x] Create `src/storage/records.ts` with `CachedDocRecord`, `BaseRecord`, and
      `PendingRecord`.
- [x] Create `src/storage/indexeddb-local-store.ts`. Open one database per account
      key with one `docs` object store keyed by string.
- [x] Implement `setMany` inside a single `readwrite` transaction. Abort the
      transaction if any put fails, and reject with `AppError('storage')`.
- [x] Map `QuotaExceededError` to `AppError('storage')` with detail
      `reason: 'quota'`.
- [x] Add `createMemoryLocalStore()` for tests and for browsers without IndexedDB.
      It implements the same interface with a `Map`.
- [x] Create `src/diagnostics/diagnostic-log.ts` with the ring, snapshot, JSON
      export, and download.
- [x] Add a guard in `logDiagnostic` that rejects any context key matching
      `/token|authorization|header|secret/i`.
- [x] Create `src/state/app-state.ts` with Svelte readable stores and the setters.
- [x] Add a JSDoc note on `setSaveStatus` that `saved` means durable in IndexedDB,
      not synchronized.

### Tests

- [x] Add `fake-indexeddb` as a dev dependency for tests only.
- [x] `tests/local-store.test.ts`: `set` then `get` round-trips a value.
- [x] `tests/local-store.test.ts`: `get` on a missing key resolves `undefined`.
- [x] `tests/local-store.test.ts`: `delete` removes the key.
- [x] `tests/local-store.test.ts`: `setMany` commits all entries when the transaction
      succeeds.
- [x] `tests/local-store.test.ts`: when one put in a `setMany` fails, no entry from
      that call is readable afterward.
- [x] `tests/local-store.test.ts`: two account keys produce two separate namespaces.
      A value written under account A is absent under account B.
- [x] `tests/local-store.test.ts`: a stubbed `QuotaExceededError` surfaces as
      `AppError('storage')` with `reason: 'quota'`.
- [x] `tests/diagnostic-log.test.ts`: the ring keeps 200 events and drops the oldest.
- [x] `tests/diagnostic-log.test.ts`: `diagnosticSnapshot` returns oldest first.
- [x] `tests/diagnostic-log.test.ts`: a context key containing `token` is rejected
      and logged as a guard violation.
- [x] `tests/app-state.test.ts`: `saveStatus` transitions `idle -> saving -> saved`
      and `saving -> sync_failed`.

### Verification

- [x] `bun run check` passes.
- [x] `bun test` passes.
- [x] `bun run build` passes.
- [x] `bun run check:compat` passes.
- [ ] Manual in `bun run dev`: the memory store and the IndexedDB store both pass a
      smoke `setMany` from the browser console. Not done. The scripted
      `bun run smoke:store` passes for both engines, but no run in a real browser
      and no run on the Kindle Scribe has happened. See note 8.

## Exit criteria

No module outside `src/storage/` references `indexedDB`. One call makes a local edit
durable, and the status store can report it.

## Notes from implementation

1. **`createMemoryLocalStore` lives in its own file.** The plan's Files table
   lists three storage files, and the checklist asks for a `Map` store. This
   build puts it in `src/storage/memory-local-store.ts`. One engine per file
   keeps the IndexedDB file near its line target, and the façade still has one
   swap point. REQUIREMENTS 3.15.

2. **`setSaveStatus('saved')` stamps `lastSavedAtUtc`.** The plan lists no
   setter for that store, so the move to `saved` writes the current UTC instant.
   A move to `saving` or `sync_failed` leaves the earlier stamp alone, so the
   badge can still say when the last durable save happened.

3. **`clearError` is added beyond the plan's signature list.** `reportError`
   alone leaves an error stuck on screen forever. A Dismiss action needs one
   call. An error card needs a dismiss path, and the plan's list has none.

3a. **`resetDiagnosticLog` is a third addition beyond the plan's signature
   list.** It clears the ring and exists for tests only. Production code never
   calls it: the ring trims itself, and a user clears it by closing the tab.
   It was not disclosed when it was added. It is disclosed now.

3b. **`assertAccountKey` is a fourth addition beyond the plan's signature
   list.** It lives in `src/storage/local-store.ts` and rejects an account key
   that cannot name one account. See the F5 note above.

4. **The context guard drops, then warns.** A banned key is removed and the
   event is recorded with its safe keys. A second `warn` event with code
   `diagnostic_context_guard` follows, and it carries only the source code and
   the count of refused keys. The refused key name and its value never enter the
   ring, so neither can reach the downloaded file. REQUIREMENTS 12.12.

5. **`withStore` rejects with the caught cause, not with `tx.error`.**
   `fake-indexeddb` leaves `tx.error` unset after `abort()`. A rejection built
   from `tx.error` alone would report `write_failed` where the real failure was
   a quota. The synchronous throw path keeps its own cause.

6. **The memory store clones on write and on read.** IndexedDB stores a
   structured clone, so a later mutation of the caller's object cannot reach the
   stored copy. The memory store matches that, which keeps the two engines
   interchangeable in tests. `setMany` clones every value before it writes any,
   so one uncloneable value fails the whole call. REQUIREMENTS 3.14.

7. **The IndexedDB engine is split into three small files.** The plan targets
   "near 50 lines of logic" for the engine. The F3 and F4 fixes — the
   missing-IndexedDB check, the connection cache, and the `versionchange`
   release — pushed one file well past that, so the three concerns were split.
   Measured after the split, counting non-comment, non-blank lines:

   | File | Lines | Content |
   | --- | --- | --- |
   | `src/storage/indexeddb-local-store.ts` | 49 | The one-transaction rule and the four façade methods. |
   | `src/storage/idb-connection.ts` | 60 | Open, cache, and release one connection per account key. |
   | `src/storage/storage-error.ts` | 8 | Map a raw failure to `AppError('storage')`. |

   The façade file is back inside the target. The swap point is unchanged: a
   move off IndexedDB replaces the two IndexedDB files and nothing else.
   REQUIREMENTS 3.15.

8. **The browser-console smoke has not run in a browser.** The devcontainer has
   no browser automation. What was actually run is the scripted
   `bun run smoke:store`, which exercises both engines under `fake-indexeddb`
   and passes 13 of 13 checks. That is not a browser run. `fake-indexeddb` runs
   on Bun, which has a native `structuredClone`, a modern V8, and a
   spec-complete IndexedDB, so it cannot catch a missing browser global. A run
   of the console snippet in the `scripts/smoke-local-store.ts` header, in a
   real browser and on the Kindle Scribe, is still pending. Do not close this
   phase on the scripted result alone.

9. **Nothing is wired into `main.ts` yet.** This phase ships the modules, the
   stores, and the tests. The screens that read `saveStatus` and
   `startupStatus`, and the coordinator that writes them, belong to the later
   UI and sync phases.

10. **`dist/` is out of this change.** The build ran to clear the gate chain
    and the Kindle compat check, and the generated output was restored. Run
    the README deploy procedure to publish.

## Fix round notes

The findings live in `.agent-work/phase-06/audit.md`. Each note below names the
finding and the requirement it serves.

### F1 — The memory engine no longer needs `structuredClone`

The finding stands: the targeted Silk 80 browser is a Chrome 80 base and
`structuredClone` arrived in Chrome 98, so the memory engine — the engine a
browser without IndexedDB falls back to — failed every read and write there.

The fix is not the `core-js` polyfill. Measured on this build, adding
`core-js/actual/structured-clone` took `dist/app.js` from 77 KB to 102 KB, about
9 KB gzipped, and every device pays that on every load for one fallback path the
targeted device never takes, because IndexedDB is present on it.

`src/storage/memory-local-store.ts` now clones with the native
`structuredClone` when the host has one, and with a JSON round trip when it does
not. The fallback is exact for the values this façade carries, which are whole
JSON documents. REQUIREMENTS 3.13. A value with no JSON form, such as a
function, is still refused with `reason: 'not_cloneable'`, so the transactional
rule in REQUIREMENTS 3.14 keeps its teeth on both paths.

`src/capabilities.html` gained two Storage probes, `structuredClone (native)`
and `structuredClone round trip (native)`, so a device report can see what the
browser gives us. Tests run in a fresh Bun process with the native global
deleted, because module caching inside one test run would hide the failure this
guards. One test also fails if a `structured-clone` polyfill is added back to
`src/polyfills.ts`, so the size decision stays visible.

Serves `AGENTS.md` (bundle must respect the capability report) and
REQUIREMENTS 3.15.

### F2 — The guard redacts values, not only keys

`sanitizeContext` now replaces a string value that matches a credential shape
with the literal `'[redacted]'`, keeps the key, and counts the replacement in
the guard event as `redactedValues` next to `refusedKeys`. The shapes are the
Google access token, a `Bearer` or `Basic` scheme prefix, a Google API key, a
Google refresh token, and a URL-encoded `Bearer`. There is deliberately no
generic long-base64 rule: Drive file IDs and ETags are long, legitimate, and
needed in a support log, and a test pins that a real-shaped file ID survives.
Serves REQUIREMENTS 12.12, "the log never contains an OAuth token or an
authorization header".

### F3 — Typed failure on a host with no IndexedDB, plus the engine switch

`openDatabase` now checks `typeof indexedDB` and rejects with
`AppError('storage', { reason: 'no_indexeddb' })` instead of letting a raw
`ReferenceError` escape the promise. A new file,
`src/storage/create-local-store.ts`, exports
`createLocalStore(accountKey): Promise<LocalStore>`: the IndexedDB engine when
the host has it, the memory engine when it does not. The phase exit criterion
forbids a reference to `indexedDB` outside `src/storage/`, so the bootstrap
module could not make this choice itself. Now it makes one call. Serves
REQUIREMENTS 3.12, 3.15.

### F4 — Connections are cached and released

`createIndexedDbLocalStore` no longer opens a fresh connection per call. The
cache lives in `src/storage/idb-connection.ts`. One
connection per account key is cached in a module-level `Map`, a closed cached
connection is replaced rather than handed back, and `onversionchange` and
`onclose` close the connection and drop it from the cache. A failed open is
also dropped, so one failure does not poison the key forever. This bounds
memory on a 0.5 GiB device and stops a held connection from blocking a later
`DB_VERSION` bump. The `LocalStore` interface is unchanged: no `close()` was
added, because ARCHITECTURE section 7 fixes the interface shape. Serves
REQUIREMENTS 3.11, 3.15.

### F5 — A blank account key is refused

`assertAccountKey` in `src/storage/local-store.ts` rejects a key that fails
`/^[A-Za-z0-9_.-]{1,64}$/` with
`AppError('storage', { reason: 'invalid_account_key' })`. Both
`createIndexedDbLocalStore` and `createLocalStore` call it. A blank or
whitespace key used to produce the shared database name `repjot-`, which let
two callers whose account binding failed read each other's records. Serves the
Phase 06 Goal 3 namespace rule and REQUIREMENTS 3.11.

### F6 — Snapshots are copied, not shared

`diagnosticSnapshot` now returns a new array of new event objects with new
`context` objects. A screen that annotates a snapshot for display can no
longer corrupt the log the user then downloads. The two-level copy is
sufficient because context values are `string | number`. The JSDoc now says
what is copied. Serves REQUIREMENTS 12.12.

### F7 — Guard events coalesce

When the newest ring entry is already the guard event for the same source code,
the new violation adds to that entry's `refusedKeys` and `redactedValues`
instead of appending a second guard event. The guard entry moves behind the
source event it describes, so the ring still reads source event then guard
event. A chatty code now costs one ring slot, not one per call, so a burst of
violations no longer halves the retained window of the events a support case
needs. Serves REQUIREMENTS 12.12, "keeps at most 200 events and drops the
oldest".

### F8, F9 — Notes corrected

Note 7 now carries the measured line counts. Note 8 now says plainly that no
browser run happened. `resetDiagnosticLog` is disclosed below as a third
addition beyond the plan's signature list.
