// Authenticated Drive REST adapter.
// REQUIREMENTS 2.11, 2.13, 3.2, 4.6, 4.17, 4.18, 12.10.
// ARCHITECTURE ADR-008, ADR-009, §11, §14, §15.
//
// This module is the only place in the app that names a Google URL or reads a
// Google response shape. Everything above it sees `DriveAdapter`.
//
// The access token arrives through a source function given at construction, so
// the adapter never stores a token and always reads the current one. The token
// travels only in an HTTPS `Authorization: Bearer` header. It never enters a
// URL, a log line, or an `AppError`. ARCHITECTURE §14.
//
// Create uses a multipart upload. A simple upload (`uploadType=media`) carries
// no metadata, so it cannot set the file name or the `appDataFolder` parent the
// recognized-name scheme depends on. Update keeps `uploadType=media`, because
// the file already exists and only its content changes.

import { AppError } from '../domain/errors';
import { secureUuid } from '../domain/ids';
import { logDiagnostic } from '../diagnostics/diagnostic-log';
import {
  googleErrorReason,
  invalidResponseAppError,
  networkAppError,
  toAppError
} from './errors';
import type { DriveAccountProfile, DriveAdapter, DriveFileContent, DriveFileMeta } from './drive-interface';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
const REVOCATION_ENDPOINT = 'https://oauth2.googleapis.com/revoke';

/** Metadata fields every adapter read asks Drive for. */
const META_FIELDS = 'id,name,modifiedTime,md5Checksum,size,version';

/** Largest page size Drive allows. Fewer round trips for a small catalog. */
const PAGE_SIZE = 1000;

/** Content type for a JSON body written as media. */
const JSON_MEDIA_TYPE = 'application/json; charset=utf-8';

/** Revocation confirmation polling step and deadline. REQUIREMENTS 2.13. */
const REVOKE_POLL_MS = 500;
const REVOKE_TIMEOUT_MS = 15_000;

/**
 * Default cap for one Drive request.
 *
 * A stalled connection fails as a `network` error instead of hanging the sync
 * layer. Kindle Silk lists `AbortController` as supported.
 */
const REQUEST_TIMEOUT_MS = 30_000;

/** Reads the access token the next request should use. */
export type AccessTokenSource = () => string | null;

/** Optional overrides. Tests pass a fetch stub and short timeouts. */
export interface DriveRestAdapterOptions {
  fetchImpl?: typeof fetch;
  revokeTimeoutMs?: number;
  /** Cap for one request. A stalled request aborts and maps to `network`. */
  requestTimeoutMs?: number;
}

/** Raw Drive `files` resource, narrowed to the fields this adapter reads. */
interface RawFile {
  id?: unknown;
  name?: unknown;
  modifiedTime?: unknown;
  version?: unknown;
  md5Checksum?: unknown;
  size?: unknown;
}

/** Raw `files.list` response. */
interface RawFileList {
  files?: unknown;
  nextPageToken?: unknown;
}

/** Raw `about` response. */
interface RawAbout {
  user?: unknown;
}

/**
 * Build a Drive adapter over the v3 REST API.
 *
 * @param source Returns the access token for the next call, or `null` when the
 *        user is not signed in. Every call reads it fresh, so a token the caller
 *        refreshed or cleared takes effect at once.
 */
export function createDriveRestAdapter(
  source: AccessTokenSource,
  options: DriveRestAdapterOptions = {}
): DriveAdapter {
  const fetchImpl: typeof fetch = options.fetchImpl ?? globalThis.fetch;
  const revokeTimeoutMs: number = options.revokeTimeoutMs ?? REVOKE_TIMEOUT_MS;
  const requestTimeoutMs: number = options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;

  /**
   * One authorized request.
   *
   * The helper owns the bearer token, the request timeout, the failure funnel
   * through `toAppError`, and the diagnostic. Callers own their own media
   * content type: `createFile` sends `multipart/related` and `updateFile`
   * sends `application/json; charset=utf-8`. A failed call logs one
   * diagnostic with the operation name and the HTTP status only.
   *
   * @param operation Label for the diagnostic log, for example `'listCatalog'`.
   */
  async function request(operation: string, url: string, init: RequestInit): Promise<Response> {
    const accessToken: string | null = source();
    if (accessToken === null || accessToken.length === 0) {
      throw new AppError(
        'authentication',
        { operation, reason: 'no_token' },
        'REP JOT holds no access token for this Drive call.'
      );
    }

    const headers: Record<string, string> = {
      ...((init.headers as Record<string, string> | undefined) ?? {}),
      // The bearer token is authoritative. No caller header may replace it, so a
      // token cannot be smuggled in from outside this path. ARCHITECTURE §14.
      Authorization: `Bearer ${accessToken}`
    };

    let response: Response;
    // Abort a stalled request instead of waiting forever. The abort lands as a
    // fetch rejection, so it maps to the same `network` kind as a dead
    // connection.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
    try {
      response = await fetchImpl(url, { ...init, headers, signal: controller.signal });
    } catch {
      // A rejection means the request never got an answer. Log the operation,
      // never the URL, which could carry a query value.
      logDiagnostic({ severity: 'warn', code: 'drive_request_failed', context: { operation } });
      throw networkAppError({ operation });
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      const reason: string | undefined = googleErrorReason(await readJson(response));
      logDiagnostic({
        severity: 'warn',
        code: 'drive_request_failed',
        context: { operation, status: response.status }
      });
      throw toAppError(response.status, reason);
    }

    return response;
  }

  /** Parse a body as JSON. Returns `undefined` when the body is not JSON. */
  async function readJson(response: Response): Promise<unknown> {
    try {
      return JSON.parse(await response.text()) as unknown;
    } catch {
      return undefined;
    }
  }

  /**
   * Parse a body as JSON or reject with `invalid_document`.
   *
   * A caller that needs a structured answer uses this, so a truncated body or an
   * HTML error page surfaces as a typed error rather than a raw parse error.
   */
  async function requireJson(operation: string, response: Response): Promise<unknown> {
    const parsed: unknown = await readJson(response);
    if (parsed === undefined) {
      logDiagnostic({
        severity: 'warn',
        code: 'drive_response_unparseable',
        context: { operation }
      });
      throw invalidResponseAppError({ operation });
    }
    return parsed;
  }

  /** Convert a raw Drive `files` resource to the adapter's metadata type. */
  function toMeta(raw: unknown): DriveFileMeta {
    const file: RawFile = typeof raw === 'object' && raw !== null ? (raw as RawFile) : {};
    const id: string = typeof file.id === 'string' ? file.id : '';
    const name: string = typeof file.name === 'string' ? file.name : '';
    const modifiedTime: string = typeof file.modifiedTime === 'string' ? file.modifiedTime : '';
    const version: string = typeof file.version === 'string' ? file.version : '';
    const size: number = typeof file.size === 'string' ? Number(file.size) : Number(file.size ?? 0);

    if (id.length === 0 || name.length === 0) {
      throw invalidResponseAppError({ reason: 'file_metadata_incomplete' });
    }

    return {
      id,
      name,
      modifiedTime,
      version,
      md5Checksum: typeof file.md5Checksum === 'string' ? file.md5Checksum : null,
      size: Number.isFinite(size) ? size : 0
    };
  }

  /** Ask Drive for one file's metadata. */
  async function fetchMeta(id: string, operation: string): Promise<DriveFileMeta> {
    const response = await request(
      operation,
      `${DRIVE_API}/files/${encodeURIComponent(id)}?fields=${META_FIELDS}`,
      { method: 'GET', cache: 'no-store' }
    );
    return toMeta(await requireJson(operation, response));
  }

  async function getAccountProfile(): Promise<DriveAccountProfile> {
    const operation = 'getAccountProfile';
    const response = await request(
      operation,
      `${DRIVE_API}/about?fields=user(permissionId,displayName)`,
      { method: 'GET', cache: 'no-store' }
    );
    const parsed: unknown = await requireJson(operation, response);
    const user: unknown =
      typeof parsed === 'object' && parsed !== null
        ? (parsed as RawAbout).user
        : undefined;
    const permissionId: unknown =
      typeof user === 'object' && user !== null
        ? (user as { permissionId?: unknown }).permissionId
        : undefined;

    if (typeof permissionId !== 'string' || permissionId.length === 0) {
      logDiagnostic({ severity: 'warn', code: 'drive_account_key_missing', context: { operation } });
      throw new AppError(
        'authentication',
        { operation, reason: 'no_permission_id' },
        'Google Drive returned no account key.'
      );
    }

    const displayName: unknown =
      typeof user === 'object' && user !== null
        ? (user as { displayName?: unknown }).displayName
        : undefined;

    return typeof displayName === 'string' && displayName.length > 0
      ? { accountKey: permissionId, displayName }
      : { accountKey: permissionId };
  }

  async function listCatalog(): Promise<DriveFileMeta[]> {
    const operation = 'listCatalog';
    const collected: DriveFileMeta[] = [];
    let pageToken: string | null = null;
    let pages = 0;

    // Follow `nextPageToken` until it is absent. A repeated token would loop
    // forever, so the page count bounds the walk.
    for (;;) {
      const parameters = new URLSearchParams({
        spaces: 'appDataFolder',
        q: 'trashed=false',
        pageSize: String(PAGE_SIZE),
        fields: `nextPageToken,files(${META_FIELDS})`
      });
      if (pageToken !== null) {
        parameters.set('pageToken', pageToken);
      }

      const response = await request(operation, `${DRIVE_API}/files?${parameters.toString()}`, {
        method: 'GET',
        cache: 'no-store'
      });
      const parsed: RawFileList = (await requireJson(operation, response)) as RawFileList;
      const files: unknown[] = Array.isArray(parsed.files) ? parsed.files : [];

      for (const raw of files) {
        collected.push(toMeta(raw));
      }

      pages += 1;
      const next: unknown = parsed.nextPageToken;
      if (typeof next !== 'string' || next.length === 0) {
        return collected;
      }
      if (next === pageToken || pages >= 1_000) {
        logDiagnostic({ severity: 'warn', code: 'drive_catalog_page_loop', context: { operation } });
        throw invalidResponseAppError({ operation, reason: 'page_token_loop' });
      }
      pageToken = next;
    }
  }

  async function readFile(id: string): Promise<DriveFileContent> {
    const operation = 'readFile';
    const mediaResponse = await request(
      operation,
      `${DRIVE_API}/files/${encodeURIComponent(id)}?alt=media`,
      { method: 'GET', cache: 'no-store' }
    );
    const text: string = await mediaResponse.text();
    const meta: DriveFileMeta = await fetchMeta(id, operation);
    return { text, meta };
  }

  async function createFile(name: string, text: string): Promise<DriveFileMeta> {
    const operation = 'createFile';
    const boundary = `repjot_${secureUuid()}`;
    const metadata: { name: string; parents: string[]; mimeType: string } = {
      name,
      parents: ['appDataFolder'],
      mimeType: 'application/json'
    };

    // A multipart/related body: a metadata part, then the content part. A
    // simple upload carries no metadata, so the name and the app-data parent
    // would be lost.
    const body: string = [
      `--${boundary}`,
      `Content-Type: application/json; charset=utf-8`,
      '',
      JSON.stringify(metadata),
      `--${boundary}`,
      `Content-Type: ${JSON_MEDIA_TYPE}`,
      '',
      text,
      `--${boundary}--`,
      ''
    ].join('\r\n');

    const response = await request(
      operation,
      `${DRIVE_UPLOAD_API}/files?uploadType=multipart&fields=${META_FIELDS}`,
      {
        method: 'POST',
        headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
        body
      }
    );

    return toMeta(await requireJson(operation, response));
  }

  async function updateFile(id: string, text: string): Promise<DriveFileMeta> {
    const operation = 'updateFile';
    const response = await request(
      operation,
      `${DRIVE_UPLOAD_API}/files/${encodeURIComponent(id)}?uploadType=media&fields=${META_FIELDS}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': JSON_MEDIA_TYPE },
        body: text
      }
    );

    return toMeta(await requireJson(operation, response));
  }

  async function deleteFile(id: string): Promise<void> {
    await request('deleteFile', `${DRIVE_API}/files/${encodeURIComponent(id)}`, {
      method: 'DELETE'
    });
  }

  /**
   * Ask Drive whether it rejects one token.
   *
   * Returns `true` only for a `401`. A `200` means the token still works, and
   * a network error proves nothing, so both return `false`. REQUIREMENTS 2.13.
   */
  async function probeRejected(accessToken: string): Promise<boolean> {
    try {
      const response: Response = await fetchImpl(
        `${DRIVE_API}/about?fields=user(permissionId)`,
        {
          method: 'GET',
          headers: { Authorization: `Bearer ${accessToken}` },
          cache: 'no-store'
        }
      );
      return response.status === 401;
    } catch {
      return false;
    }
  }

  /**
   * Post the token to Google's revocation endpoint through a hidden form, then
   * poll Drive until Drive rejects the token.
   *
   * The form is required, not `fetch`. Kindle Silk blocks a cross-origin `POST`
   * from `fetch`, and the content security policy permits this form and its
   * hidden frame instead. The Phase 0 proof on a physical Kindle established
   * this path.
   *
   * Resolves when Drive answers `401`. Rejects when the deadline passes with no
   * confirmation, which is not the same as a failed disconnect. The caller
   * keeps its local state and links to Google Account connections.
   * REQUIREMENTS 2.13.
   */
  function revokeToken(accessToken: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (typeof document === 'undefined' || typeof document.body === 'undefined') {
        reject(
          new AppError(
            'authentication',
            { operation: 'revokeToken', reason: 'no_dom' },
            'This host cannot post the revocation form.'
          )
        );
        return;
      }

      const frameName = `repjot_revoke_${secureUuid()}`;
      const frame = document.createElement('iframe');
      const form = document.createElement('form');
      const tokenField = document.createElement('input');
      const deadline = Date.now() + revokeTimeoutMs;
      let timer: ReturnType<typeof setTimeout> | null = null;
      let finished = false;

      frame.name = frameName;
      frame.title = 'Google authorization revocation';
      frame.style.display = 'none';
      form.method = 'post';
      form.action = REVOCATION_ENDPOINT;
      form.target = frameName;
      form.style.display = 'none';
      tokenField.type = 'hidden';
      tokenField.name = 'token';
      tokenField.value = accessToken;
      form.appendChild(tokenField);

      const cleanup = (): void => {
        if (finished) return;
        finished = true;
        if (timer !== null) clearTimeout(timer);
        form.remove();
        frame.remove();
      };
      const fail = (): void => {
        cleanup();
        reject(
          new AppError(
            'authentication',
            { operation: 'revokeToken', reason: 'unconfirmed' },
            'Google did not confirm that it revoked access.'
          )
        );
      };
      const scheduleCheck = (): void => {
        if (finished) return;
        if (Date.now() >= deadline) {
          fail();
          return;
        }
        const delay = Math.min(REVOKE_POLL_MS, deadline - Date.now());
        timer = setTimeout(check, delay);
      };
      const check = (): void => {
        void probeRejected(accessToken).then(
          (rejected: boolean): void => {
            if (finished) return;
            if (rejected) {
              cleanup();
              resolve();
              return;
            }
            scheduleCheck();
          },
          // A probe that throws must not raise an unhandled rejection or leave
          // this promise hanging. Retry on the next tick; the deadline still
          // bounds the wait.
          (): void => scheduleCheck()
        );
      };

      document.body.appendChild(frame);
      document.body.appendChild(form);
      try {
        form.submit();
        form.remove();
        scheduleCheck();
      } catch {
        fail();
      }
    });
  }

  return {
    getAccountKey: async (): Promise<string> => (await getAccountProfile()).accountKey,
    getAccountProfile,
    listCatalog,
    readFile,
    createFile,
    updateFile,
    deleteFile,
    probeRejected,
    revokeToken
  };
}
