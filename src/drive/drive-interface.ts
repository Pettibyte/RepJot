// The Drive contract the sync layer needs.
// REQUIREMENTS 3.2, 4.6, 4.17, 4.18, 12.10. ARCHITECTURE ADR-008, ADR-009, §14.
//
// This module holds types only. It names no Google type, no HTTP type, and no
// token type. The sync layer imports this file and never learns which storage
// service sits behind it.
//
// No compare-and-swap appears here on purpose. Drive `files.update` offers no
// conditional content write, so the adapter exposes none. The preflight read in
// `readFile` and the read-back after an update are the only safety the contract
// provides. REQUIREMENTS 4.16, 4.17.

/** Metadata for one Drive file, as the sync layer uses it. */
export interface DriveFileMeta {
  /** Stable Drive file ID. It survives every rename and content update. */
  id: string;
  /** File name, for example `preferences.json` or `results-2026-09.json`. */
  name: string;
  /** Last modification time, RFC 3339 UTC, as Drive reported it. */
  modifiedTime: string;
  /** Drive content version. It changes on every content write. */
  version: string;
  /** Content MD5, when Drive reported one. `null` when it did not. */
  md5Checksum: string | null;
  /** Content length in bytes. */
  size: number;
}

/**
 * One file read: bytes read at one moment, metadata read a moment shortly after.
 *
 * `readFile` issues two requests, because Drive offers no single call that
 * returns both. A write from another device between them makes `meta` describe
 * bytes newer than `bytes`. They are not an atomic pair. REQUIREMENTS 4.16 says
 * the preflight read narrows the race window and does not close it.
 *
 * The content is bytes, not text. A caller that must parse decodes with
 * `decodeUtf8`; a caller that hands the file back to the user writes the bytes
 * straight through. Decoding is lossy for bytes that are not valid UTF-8, so
 * the contract does not decide it for the caller. REQUIREMENTS 12.10.
 */
export interface DriveFileContent {
  /** The file content, byte for byte as Drive served it. */
  bytes: Uint8Array;
  /** Metadata read after the content. See the note above. */
  meta: DriveFileMeta;
}

/** The Drive account an access token belongs to. */
export interface DriveAccountProfile {
  /** `user.permissionId`. The account namespace key. */
  accountKey: string;
  /** Display name, when Drive returned one. */
  displayName?: string;
}

/**
 * Every Drive operation the sync layer performs.
 *
 * The adapter reads its access token from the source given at construction, so
 * no method here carries a token. `revokeToken` is the one exception: the
 * disconnect flow revokes a token the caller already holds.
 */
export interface DriveAdapter {
  /**
   * Return the `user.permissionId` for the current access token.
   *
   * This is the account binding. It rejects when Drive returns no permission ID.
   * REQUIREMENTS 2.11.
   */
  getAccountKey(): Promise<string>;

  /**
   * Return the account key and, when Drive supplied one, the display name.
   *
   * One request answers both, so the account panel costs one call.
   */
  getAccountProfile(): Promise<DriveAccountProfile>;

  /**
   * List every file in the app-data folder, following every page.
   *
   * The result holds all pages concatenated in Drive order. Trashed files are
   * excluded. REQUIREMENTS 12.10, ARCHITECTURE ADR-008.
   */
  listCatalog(): Promise<DriveFileMeta[]>;

  /**
   * Read one file's bytes with fresh metadata.
   *
   * This is the preflight read the merge needs before an upload. The two parts
   * are read in sequence, not atomically. REQUIREMENTS 4.6, 4.16.
   */
  readFile(id: string): Promise<DriveFileContent>;

  /**
   * Create one file in the app-data folder and return its metadata.
   *
   * REQUIREMENTS 3.2.
   */
  createFile(name: string, text: string): Promise<DriveFileMeta>;

  /**
   * Replace one file's content in place and return fresh metadata.
   *
   * The retained file ID never changes, and the adapter never deletes and
   * recreates a file to write it. ARCHITECTURE ADR-009.
   *
   * This does not read the content back. REQUIREMENTS 4.18 is met by the
   * caller composing `updateFile` and `readFile` and comparing the text.
   */
  updateFile(id: string, text: string): Promise<DriveFileMeta>;

  /**
   * Delete one file by its stable Drive file ID.
   *
   * REQUIREMENTS 21.3, ARCHITECTURE §10 "Delete All User Data".
   */
  deleteFile(id: string): Promise<void>;

  /**
   * Report whether Drive rejects the given token.
   *
   * Returns `true` only for a `401`. A network failure proves nothing and
   * returns `false`. REQUIREMENTS 2.13.
   */
  probeRejected(accessToken: string): Promise<boolean>;

  /**
   * Ask Google to revoke the given token and wait until Drive rejects it.
   *
   * Resolves when Drive answers `401`. Rejects when the timeout passes, which
   * means the revocation is unconfirmed. REQUIREMENTS 2.13.
   */
  revokeToken(accessToken: string): Promise<void>;
}
