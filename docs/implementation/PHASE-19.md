# Phase 19 — Settings, export, deletion, and disconnect

Build Settings: exercise unit list, raw file export, diagnostic log download, the
typed Delete All User Data action, and Disconnect Google Account.

## Prerequisites

- Phase 07 auth service for sign out and revocation.
- Phase 08 Drive adapter for catalog, read, and delete.
- Phase 13 preference service.
- Phase 15 shell with the tab header.

## Goals

1. Let the user read and change every exercise unit preference.
2. Let the user download every raw file in `appDataFolder`, unmodified.
3. Let the user download the in-memory diagnostic log.
4. Provide Delete All User Data behind a typed phrase with an honest warning.
5. Provide Disconnect as a separate action from deletion and from sign out.

## Interfaces

### Files

| Path | Purpose |
| --- | --- |
| `src/ui/screens/SettingsScreen.svelte` | Settings sections and the license line. |
| `src/ui/components/ExerciseUnitsSection.svelte` | Exercise-to-unit list with pills. |
| `src/ui/components/DataExportSection.svelte` | Raw file list with per-file download. |
| `src/ui/components/DiagnosticSection.svelte` | Diagnostic log download. |
| `src/ui/components/DeleteAllDataDialog.svelte` | Typed-phrase confirmation. |
| `src/ui/components/DisconnectSection.svelte` | Disconnect action and fallback link. |
| `src/export/raw-export.ts` | Download helpers using Blob and object URLs. |
| `src/data/delete-all-data.ts` | Recognized-file deletion loop. |

### Signatures

```ts
// src/export/raw-export.ts
export interface ExportEntry {
  driveFileId: string; name: string; size: number;
  recognized: boolean; downloadName: string;   // name plus file-ID suffix when duplicated
}
export function buildExportList(catalog: DriveFileMeta[]): ExportEntry[];
export function downloadText(name: string, text: string): void;  // Blob + object URL + download attr
export function downloadBytes(name: string, bytes: Uint8Array, mime: string): void;
```

```ts
// src/data/delete-all-data.ts
export interface DeletionResult {
  kind: 'complete' | 'partial';
  deletedFileIds: string[];
  remainingRecognized: string[];
}
export function deleteAllUserData(deps: {
  drive: DriveAdapter;
  store: LocalStore;
  accountKey: string;
  onProgress?: (deleted: number) => void;
}): Promise<DeletionResult>;
// 1 List all appDataFolder pages.
// 2 Delete every recognized file by stable Drive file ID.
// 3 List again. Repeat until no recognized file remains or a bound is hit.
// 4 On a partial result, keep local data for retry and report it.
// 5 On a complete result, clear the account namespace, pending edits, and indexes.
```

### Settings sections

| Section | Contents |
| --- | --- |
| Exercise Units | One row per exercise with a unit pill. Rows come from the exercise list, values from preferences. |
| Data Export | One row per `appDataFolder` file with size, recognized flag, and a **Download** button. |
| Diagnostics | **Download diagnostic log** as one JSON file. |
| License | The text `For non-commercial use only. For commercial licensing, Contact Pettibyte LLC.` |
| Danger Zone | **Delete All User Data** and **Disconnect Google Account**. |

### Delete dialog copy rules

- The user must type `DELETE ALL USER DATA` exactly before the button enables.
- The dialog states that another device with pending edits can re-create the files on
  its next sync, and that the user must not sync other devices afterward.
- The dialog must not use the word irreversible.
- The dialog shows the recognized file count before it proceeds.

## Requirements traceability

| Source | How this phase satisfies it |
| --- | --- |
| REQUIREMENTS 12.3 | The Exercise Units section lists the exercise-to-unit mappings. |
| REQUIREMENTS 12.10 | Export downloads every raw `appDataFolder` file with bytes preserved. |
| REQUIREMENTS 12.11 | The diagnostic download is a separate action. |
| REQUIREMENTS 12.12 | The log stays in memory and never uploads. |
| REQUIREMENTS 21.1, 21.2 | Data Export and Exercise Units sections plus the license line. |
| REQUIREMENTS 21.3, 21.4 | Typed phrase, honest warning, no irreversibility claim. |
| REQUIREMENTS 21.5, 21.6 | Disconnect is separate, revokes, signs out, and clears the account cache. |
| REQUIREMENTS 21.7 | A failed revoke shows the Google Account connections link. |
| REQUIREMENTS 14.6, 14.7 | Export and deletion are user-requested features. No hidden storage. |
| ARCHITECTURE ADR-018 | Typed delete phrase with the other-device warning. |
| ARCHITECTURE §10 "Export and untrusted data" | Duplicate download names carry the Drive file ID. |
| ARCHITECTURE §10 "Sign out, disconnect, and deletion" | The three operations stay separate. |
| SPEC storage-and-lookup "User data deletion" | The delete loop re-lists until nothing recognized remains. |

## Checklist

### Implementation

- [ ] Implement `buildExportList` with the duplicate-name suffix rule.
- [ ] Implement `downloadText` and `downloadBytes` with Blob, object URL, and the
      `download` attribute.
- [ ] Implement `deleteAllUserData` with the five steps and a re-list bound to avoid
      an infinite loop.
- [ ] Implement `ExerciseUnitsSection.svelte` with one pill per exercise.
- [ ] Implement `DataExportSection.svelte` with per-file download and a failed-row
      state that leaves other rows usable.
- [ ] Implement `DiagnosticSection.svelte` calling `downloadDiagnosticLog`.
- [ ] Implement `DeleteAllDataDialog.svelte` with the exact-phrase gate and the
      warning copy.
- [ ] Implement `DisconnectSection.svelte` with the revoke call and the fallback link
      to Google Account connections.
- [ ] Implement `SettingsScreen.svelte` assembling the sections plus the license line.
- [ ] After a complete deletion, clear the account namespace, pending edits, and
      in-memory indexes, then route to the landing screen.
- [ ] After disconnect, clear the selected account cache and route to the landing
      screen.

### Tests

- [ ] `tests/raw-export.test.ts`: duplicate names receive the Drive file ID suffix
      while unique names stay unchanged.
- [ ] `tests/raw-export.test.ts`: unknown files appear in the export list marked
      `recognized: false`.
- [ ] `tests/raw-export.test.ts`: a newer-version or corrupt file still appears and
      downloads unchanged bytes.
- [ ] `tests/delete-all-data.test.ts`: every recognized file is deleted by stable ID.
- [ ] `tests/delete-all-data.test.ts`: an unknown file is never deleted.
- [ ] `tests/delete-all-data.test.ts`: a partial remote deletion returns `partial`
      with the remaining names and keeps local data.
- [ ] `tests/delete-all-data.test.ts`: a complete deletion clears the account
      namespace and pending records.
- [ ] `tests/delete-dialog.test.ts`: the button stays disabled until the exact phrase
      is typed. Case mismatch keeps it disabled.
- [ ] `tests/delete-dialog.test.ts`: the dialog text contains no form of the word
      "irreversible" and does contain the other-device warning.
- [ ] `tests/settings.test.ts`: the license line renders exactly as specified.
- [ ] `tests/settings.test.ts`: disconnect and delete are separate controls with
      separate confirmations.

### Verification

- [ ] `bun test` passes.
- [ ] `bun run check` passes.
- [ ] `bun run build` passes.
- [ ] `bun run check:compat` passes.
- [ ] Manual against a live account: export every file, open one, and confirm the
      bytes match what Drive holds.
- [ ] Manual against a live account: run Delete All User Data, confirm the folder holds
      no recognized file, and confirm a second device's pending edit can restore it.

## Exit criteria

The user can read their data, export it, report a problem with the diagnostic log,
remove it, and cut the Google grant.
