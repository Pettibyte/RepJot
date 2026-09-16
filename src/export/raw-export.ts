// Raw file export.
// REQUIREMENTS 12.10, 21.1. ARCHITECTURE §10 "Export and untrusted data".
//
// The user downloads the bytes Drive holds, unchanged. This module parses no
// document, reformats nothing, and rejects nothing. A file the app cannot read
// as a REP JOT document still exports, because the export shows the user what
// is in their own folder. REQUIREMENTS 12.10.
//
// Download names come from the Drive file name. Two files can share a name, and
// a browser writes both to one name and silently overwrites the first. A
// duplicated name therefore carries the stable Drive file ID, so both files
// survive the download and each traces back to the file it came from.
// ARCHITECTURE §10 "Export and untrusted data".
//
// The download itself is a Blob, an object URL, and an anchor with the
// `download` attribute. No navigation leaves the page, so no document ends up
// in the address bar. REQUIREMENTS 6.8.

import { AppError } from '../domain/errors';
import type { DriveFileMeta } from '../drive/drive-interface';
import { isRecognizedName } from '../sync/recognized-names';

/** One row of the Settings export list. */
export interface ExportEntry {
  /** The stable Drive file ID. It survives every rename and write. */
  driveFileId: string;
  /** The Drive file name, exactly as Drive reported it. */
  name: string;
  /** Content length in bytes, as Drive reported it. */
  size: number;
  /** True when REP JOT owns this name. False for a file the user put there. */
  recognized: boolean;
  /** The name the browser saves under. Carries the file ID when duplicated. */
  downloadName: string;
}

/**
 * Turn a Drive catalog into export rows.
 *
 * Catalog order is kept, so the list matches what the folder holds instead of
 * shuffling on every refresh.
 *
 * A name used by more than one file gets the Drive file ID inserted before the
 * extension. A unique name is untouched.
 */
export function buildExportList(catalog: DriveFileMeta[]): ExportEntry[] {
  const nameCounts = new Map<string, number>();
  for (const file of catalog) {
    nameCounts.set(file.name, (nameCounts.get(file.name) ?? 0) + 1);
  }

  return catalog.map((file: DriveFileMeta): ExportEntry => {
    const duplicated = (nameCounts.get(file.name) ?? 0) > 1;
    return {
      driveFileId: file.id,
      name: file.name,
      size: file.size,
      recognized: isRecognizedName(file.name),
      downloadName: duplicated ? withFileId(file.name, file.id) : file.name
    };
  });
}

/**
 * Insert the Drive file ID before the extension.
 *
 * `results-2026-09.json` plus id `abc` becomes
 * `results-2026-09-drive-abc.json`. A name with no extension, or a dotfile
 * whose only dot leads, takes the suffix at the end instead of producing a
 * name that starts with a dot.
 */
function withFileId(name: string, driveFileId: string): string {
  const suffix = `-drive-${driveFileId}`;
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return `${name}${suffix}`;
  return `${name.slice(0, dot)}${suffix}${name.slice(dot)}`;
}

/**
 * Offer text as a file download.
 *
 * The text is written as-is. The default type is JSON because every REP JOT
 * file in the app-data folder is JSON.
 *
 * @throws AppError `storage` with `reason: 'no_dom'` when the host has no
 *         document or no object URL support.
 */
export function downloadText(name: string, text: string, mime = 'application/json'): void {
  downloadBytes(name, new TextEncoder().encode(text), mime);
}

/**
 * Offer bytes as a file download.
 *
 * The bytes reach the Blob unchanged, so the saved file matches what the
 * source held. REQUIREMENTS 12.10.
 *
 * @throws AppError `storage` with `reason: 'no_dom'` when the host has no
 *         document or no object URL support.
 */
export function downloadBytes(name: string, bytes: Uint8Array, mime: string): void {
  if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') {
    throw new AppError('storage', { reason: 'no_dom' }, 'This host cannot download files.');
  }

  // Copy through a fresh buffer. A Blob keeps a reference to the buffer it is
  // given, so a view over a larger or later-mutated buffer would change the
  // file after the download was built.
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);

  const url = URL.createObjectURL(new Blob([copy.buffer as ArrayBuffer], { type: mime }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  // Revoke on the next tick. A synchronous revoke can cancel the download
  // before the browser reads the URL.
  setTimeout((): void => URL.revokeObjectURL(url), 0);
}
