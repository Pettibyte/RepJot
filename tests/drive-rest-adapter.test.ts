import { afterEach, describe, expect, test } from 'bun:test';
import { decodeUtf8 } from '../src/bytes/utf8';
import { AppError, type AppErrorKind } from '../src/domain/errors';
import {
  createDriveRestAdapter,
  type AccessTokenSource
} from '../src/drive/drive-rest-adapter';
import type { DriveAdapter, DriveFileMeta } from '../src/drive/drive-interface';
import { installFakeBrowser, uninstallFakeBrowser } from './support/fake-browser';

const META_FIELDS = 'id,name,modifiedTime,md5Checksum,size,version';

/** One recorded request. */
interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}

/** A fetch stub that records every call and answers from a queue. */
function stubFetch(responses: Response[]): { calls: Call[]; fetch: typeof fetch } {
  const calls: Call[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const headersInit = (init?.headers ?? {}) as Record<string, string>;
    calls.push({
      url: String(input),
      method: (init?.method ?? 'GET').toUpperCase(),
      headers: { ...headersInit },
      body: typeof init?.body === 'string' ? init.body : ''
    });
    const next = responses.shift();
    if (next === undefined) {
      throw new Error(`No stubbed response left for ${String(input)}`);
    }
    return next;
  }) as unknown as typeof fetch;
  return { calls, fetch: fetchImpl };
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function raw(text: string, status = 200): Response {
  return new Response(text, { status });
}

function filePayload(id: string, name = 'preferences.json'): Record<string, unknown> {
  return {
    id,
    name,
    modifiedTime: '2026-09-01T00:00:00.000Z',
    version: `v-${id}`,
    md5Checksum: 'd41d8cd98f00b204e9800998ecf8427e',
    size: '1024'
  };
}

const tokenSource: AccessTokenSource = () => 'a-token';

afterEach(() => {
  uninstallFakeBrowser();
});

describe('account profile', () => {
  test('getAccountKey returns the Drive permission ID', async () => {
    const { fetch, calls } = stubFetch([
      json({ user: { permissionId: 'permission-9', displayName: 'Ada' } })
    ]);
    const adapter = createDriveRestAdapter(tokenSource, { fetchImpl: fetch });

    expect(await adapter.getAccountKey()).toBe('permission-9');
    expect(calls[0].url).toContain('/drive/v3/about?fields=user(permissionId,displayName)');
  });

  test('getAccountProfile returns the key and the display name from one request', async () => {
    const { fetch, calls } = stubFetch([
      json({ user: { permissionId: 'permission-9', displayName: 'Ada' } })
    ]);
    const adapter = createDriveRestAdapter(tokenSource, { fetchImpl: fetch });

    const profile = await adapter.getAccountProfile();
    expect(profile).toEqual({ accountKey: 'permission-9', displayName: 'Ada' });
    expect(calls).toHaveLength(1);
  });

  test('getAccountProfile omits the display name when Drive returns none', async () => {
    const { fetch } = stubFetch([json({ user: { permissionId: 'permission-9' } })]);
    const adapter = createDriveRestAdapter(tokenSource, { fetchImpl: fetch });

    expect(await adapter.getAccountProfile()).toEqual({ accountKey: 'permission-9' });
  });

  test('a missing permission ID rejects with authentication', async () => {
    const { fetch } = stubFetch([json({ user: {} })]);
    const adapter = createDriveRestAdapter(tokenSource, { fetchImpl: fetch });

    await expect(adapter.getAccountKey()).rejects.toMatchObject({ kind: 'authentication' });
  });

  test('the bearer token travels in the Authorization header', async () => {
    const { fetch, calls } = stubFetch([json({ user: { permissionId: 'permission-9' } })]);
    const adapter = createDriveRestAdapter(tokenSource, { fetchImpl: fetch });

    await adapter.getAccountKey();
    expect(calls[0].headers.Authorization).toBe('Bearer a-token');
  });

  test('a source with no token rejects before any request goes out', async () => {
    const { fetch, calls } = stubFetch([]);
    const adapter = createDriveRestAdapter(() => null, { fetchImpl: fetch });

    await expect(adapter.getAccountKey()).rejects.toMatchObject({
      kind: 'authentication',
      detail: { reason: 'no_token' }
    });
    expect(calls).toHaveLength(0);
  });
});

describe('listCatalog', () => {
  test('follows three pages and returns the concatenated metadata', async () => {
    const { fetch, calls } = stubFetch([
      json({ files: [filePayload('f-1')], nextPageToken: 'page-2' }),
      json({ files: [filePayload('f-2', 'results-2026-08.json')], nextPageToken: 'page-3' }),
      json({ files: [filePayload('f-3', 'results-2026-09.json')] })
    ]);
    const adapter = createDriveRestAdapter(tokenSource, { fetchImpl: fetch });

    const catalog: DriveFileMeta[] = await adapter.listCatalog();

    expect(catalog.map((file) => file.id)).toEqual(['f-1', 'f-2', 'f-3']);
    expect(calls).toHaveLength(3);
    expect(calls[1].url).toContain('pageToken=page-2');
    expect(calls[2].url).toContain('pageToken=page-3');
  });

  test('the catalog request contains spaces=appDataFolder and trashed=false', async () => {
    const { fetch, calls } = stubFetch([json({ files: [] })]);
    const adapter = createDriveRestAdapter(tokenSource, { fetchImpl: fetch });

    await adapter.listCatalog();

    const url = new URL(calls[0].url);
    expect(url.searchParams.get('spaces')).toBe('appDataFolder');
    expect(url.searchParams.get('q')).toBe('trashed=false');
    expect(url.searchParams.get('pageSize')).toBe('1000');
    expect(url.searchParams.get('fields')).toBe(`nextPageToken,files(${META_FIELDS})`);
  });

  test('an empty catalog returns an empty list', async () => {
    const { fetch } = stubFetch([json({})]);
    const adapter = createDriveRestAdapter(tokenSource, { fetchImpl: fetch });

    expect(await adapter.listCatalog()).toEqual([]);
  });

  test('a repeated page token stops the walk instead of looping forever', async () => {
    const { fetch, calls } = stubFetch([
      json({ files: [filePayload('f-1')], nextPageToken: 'same' }),
      json({ files: [filePayload('f-2')], nextPageToken: 'same' })
    ]);
    const adapter = createDriveRestAdapter(tokenSource, { fetchImpl: fetch });

    await expect(adapter.listCatalog()).rejects.toMatchObject({
      kind: 'invalid_document',
      detail: { reason: 'page_token_loop' }
    });
    expect(calls).toHaveLength(2);
  });

  test('metadata fields are read into the adapter shape', async () => {
    const { fetch } = stubFetch([json({ files: [filePayload('f-1')] })]);
    const adapter = createDriveRestAdapter(tokenSource, { fetchImpl: fetch });

    const [file] = await adapter.listCatalog();
    expect(file).toEqual({
      id: 'f-1',
      name: 'preferences.json',
      modifiedTime: '2026-09-01T00:00:00.000Z',
      version: 'v-f-1',
      md5Checksum: 'd41d8cd98f00b204e9800998ecf8427e',
      size: 1024
    });
  });

  test('a file with no md5Checksum reports null', async () => {
    const payload = filePayload('f-1');
    delete payload.md5Checksum;
    const { fetch } = stubFetch([json({ files: [payload] })]);
    const adapter = createDriveRestAdapter(tokenSource, { fetchImpl: fetch });

    const [file] = await adapter.listCatalog();
    expect(file.md5Checksum).toBeNull();
  });
});

describe('readFile', () => {
  test('returns the media bytes with fresh metadata', async () => {
    const { fetch, calls } = stubFetch([
      raw('{"hello":"world"}'),
      json(filePayload('f-1'))
    ]);
    const adapter = createDriveRestAdapter(tokenSource, { fetchImpl: fetch });

    const content = await adapter.readFile('f-1');

    expect(decodeUtf8(content.bytes)).toBe('{"hello":"world"}');
    expect(content.meta.id).toBe('f-1');
    expect(calls[0].url).toContain('/drive/v3/files/f-1?alt=media');
    expect(calls[1].url).toContain(`/drive/v3/files/f-1?fields=${META_FIELDS}`);
  });

  test('bytes that are not valid UTF-8 come back unchanged', async () => {
    // The export requirement in one case. `Response.text()` would replace each
    // invalid byte with U+FFFD and grow these 5 bytes to 11, so the adapter
    // must not decode. REQUIREMENTS 12.10.
    const source = new Uint8Array([255, 254, 65, 128, 66]);
    const { fetch } = stubFetch([new Response(source, { status: 200 }), json(filePayload('f-1'))]);
    const adapter = createDriveRestAdapter(tokenSource, { fetchImpl: fetch });

    const content = await adapter.readFile('f-1');

    expect(Array.from(content.bytes)).toEqual([255, 254, 65, 128, 66]);
    expect(content.bytes.byteLength).toBe(5);
  });

  test('a 404 on the media read rejects with invalid_document and reason not_found', async () => {
    const { fetch } = stubFetch([raw('Not found', 404)]);
    const adapter = createDriveRestAdapter(tokenSource, { fetchImpl: fetch });

    await expect(adapter.readFile('missing')).rejects.toMatchObject({
      kind: 'invalid_document',
      detail: { status: 404, reason: 'not_found' }
    });
  });
});

describe('createFile', () => {
  test('sends parents containing appDataFolder', async () => {
    const { fetch, calls } = stubFetch([json(filePayload('f-new'))]);
    const adapter = createDriveRestAdapter(tokenSource, { fetchImpl: fetch });

    await adapter.createFile('preferences.json', '{"a":1}');

    const call = calls[0];
    expect(call.method).toBe('POST');
    expect(call.url).toContain('/upload/drive/v3/files');
    expect(call.url).toContain('uploadType=multipart');
    expect(call.body).toContain('"parents":["appDataFolder"]');
    expect(call.body).toContain('"name":"preferences.json"');
    expect(call.body).toContain('{"a":1}');
  });

  test('the multipart body declares a JSON metadata part and a JSON content part', async () => {
    const { fetch, calls } = stubFetch([json(filePayload('f-new'))]);
    const adapter = createDriveRestAdapter(tokenSource, { fetchImpl: fetch });

    await adapter.createFile('results-2026-09.json', '{"sessions":{}}');

    const contentType = calls[0].headers['Content-Type'];
    expect(contentType).toMatch(/^multipart\/related; boundary=repjot_/);
    const parts = calls[0].body.split('--repjot_').filter((part) => part.trim().length > 0);
    expect(parts.length).toBeGreaterThanOrEqual(2);
    expect(calls[0].body).toContain('Content-Type: application/json; charset=utf-8');
  });

  test('returns the created file metadata', async () => {
    const { fetch } = stubFetch([json(filePayload('f-new', 'preferences.json'))]);
    const adapter = createDriveRestAdapter(tokenSource, { fetchImpl: fetch });

    const meta = await adapter.createFile('preferences.json', '{}');
    expect(meta.id).toBe('f-new');
    expect(meta.name).toBe('preferences.json');
  });
});

describe('updateFile', () => {
  test('issues a PATCH to the retained ID and returns fresh metadata', async () => {
    const updated = filePayload('f-1');
    updated.version = 'v-2';
    updated.modifiedTime = '2026-09-02T00:00:00.000Z';
    const { fetch, calls } = stubFetch([json(updated)]);
    const adapter = createDriveRestAdapter(tokenSource, { fetchImpl: fetch });

    const meta = await adapter.updateFile('f-1', '{"a":2}');

    expect(calls[0].method).toBe('PATCH');
    expect(calls[0].url).toContain('/upload/drive/v3/files/f-1');
    expect(calls[0].url).toContain('uploadType=media');
    expect(calls[0].body).toBe('{"a":2}');
    expect(calls[0].headers['Content-Type']).toBe('application/json; charset=utf-8');
    expect(meta.version).toBe('v-2');
    expect(meta.modifiedTime).toBe('2026-09-02T00:00:00.000Z');
  });

  test('never deletes and recreates the file', async () => {
    const { fetch, calls } = stubFetch([json(filePayload('f-1'))]);
    const adapter = createDriveRestAdapter(tokenSource, { fetchImpl: fetch });

    await adapter.updateFile('f-1', '{}');

    expect(calls.some((call) => call.method === 'DELETE')).toBe(false);
    expect(calls.some((call) => call.method === 'POST')).toBe(false);
    expect(calls).toHaveLength(1);
  });
});

describe('deleteFile', () => {
  test('deletes by stable file ID', async () => {
    const { fetch, calls } = stubFetch([raw('', 204)]);
    const adapter = createDriveRestAdapter(tokenSource, { fetchImpl: fetch });

    await adapter.deleteFile('f-1');

    expect(calls[0].method).toBe('DELETE');
    expect(calls[0].url).toBe('https://www.googleapis.com/drive/v3/files/f-1');
  });

  test('a 404 delete rejects with invalid_document', async () => {
    const { fetch } = stubFetch([raw('Not found', 404)]);
    const adapter = createDriveRestAdapter(tokenSource, { fetchImpl: fetch });

    await expect(adapter.deleteFile('gone')).rejects.toMatchObject({ kind: 'invalid_document' });
  });
});

describe('error normalization', () => {
  test('a 401 maps to AppError authentication', async () => {
    const { fetch } = stubFetch([raw('Unauthorized', 401)]);
    const adapter = createDriveRestAdapter(tokenSource, { fetchImpl: fetch });

    const error: unknown = await adapter.listCatalog().then(
      () => null,
      (thrown: unknown) => thrown
    );
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).kind).toBe('authentication');
  });

  test('a 403 rateLimitExceeded maps to drive_rate_limit and storageQuotaExceeded to drive_quota', async () => {
    const rate = stubFetch([
      json({ error: { errors: [{ reason: 'rateLimitExceeded', message: 'Slow down' }] } }, 403)
    ]);
    const quota = stubFetch([
      json({ error: { errors: [{ reason: 'storageQuotaExceeded', message: 'Full' }] } }, 403)
    ]);

    const rateError: AppError = await createDriveRestAdapter(tokenSource, {
      fetchImpl: rate.fetch
    })
      .listCatalog()
      .then(
        () => null,
        (thrown: AppError) => thrown
      );
    const quotaError: AppError = await createDriveRestAdapter(tokenSource, {
      fetchImpl: quota.fetch
    })
      .listCatalog()
      .then(
        () => null,
        (thrown: AppError) => thrown
      );

    expect(rateError.kind).toBe('drive_rate_limit');
    expect(quotaError.kind).toBe('drive_quota');
  });

  test('a 429 maps to drive_rate_limit', async () => {
    const { fetch } = stubFetch([raw('Too Many Requests', 429)]);
    const adapter = createDriveRestAdapter(tokenSource, { fetchImpl: fetch });

    await expect(adapter.listCatalog()).rejects.toMatchObject({ kind: 'drive_rate_limit' });
  });

  test('a malformed JSON body maps to invalid_document rather than a raw parse error', async () => {
    const { fetch } = stubFetch([raw('<html>gateway error</html>')]);
    const adapter = createDriveRestAdapter(tokenSource, { fetchImpl: fetch });

    const error: unknown = await adapter.listCatalog().then(
      () => null,
      (thrown: unknown) => thrown
    );
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).kind).toBe('invalid_document');
    expect((error as AppError).detail.reason).toBe('unparseable_response');
  });

  test('a network rejection maps to AppError network', async () => {
    const fetchImpl = (async (): Promise<Response> => {
      throw new TypeError('offline');
    }) as unknown as typeof fetch;
    const adapter = createDriveRestAdapter(tokenSource, { fetchImpl });

    const error: unknown = await adapter.listCatalog().then(
      () => null,
      (thrown: unknown) => thrown
    );
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).kind).toBe('network');
  });

  test('every kind the adapter can raise is a declared AppErrorKind', async () => {
    const declared: AppErrorKind[] = [
      'authentication',
      'authorization',
      'network',
      'drive_rate_limit',
      'drive_quota',
      'duplicate_drive_file',
      'unsupported_schema',
      'invalid_document',
      'migration',
      'semantic_reference',
      'storage',
      'ambiguous_upload',
      'insecure_environment'
    ];

    const cases: Response[] = [
      raw('Unauthorized', 401),
      json({ error: { errors: [{ reason: 'rateLimitExceeded' }] } }, 403),
      json({ error: { errors: [{ reason: 'storageQuotaExceeded' }] } }, 403),
      raw('Not found', 404),
      raw('Too Many Requests', 429),
      raw('Server error', 503)
    ];

    for (const response of cases) {
      const { fetch } = stubFetch([response]);
      const error: AppError = await createDriveRestAdapter(tokenSource, {
        fetchImpl: fetch
      })
        .listCatalog()
        .then(
          () => null,
          (thrown: AppError) => thrown
        );
      expect(declared).toContain(error.kind);
    }
  });
});

describe('request timeout', () => {
  test('a stalled request aborts and maps to network', async () => {
    const fetchImpl = ((_input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
      new Promise<Response>((_resolve, reject: (reason: unknown) => void) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('The operation was aborted.')));
      })) as unknown as typeof fetch;
    const adapter = createDriveRestAdapter(tokenSource, { fetchImpl, requestTimeoutMs: 10 });

    const error: unknown = await adapter.listCatalog().then(
      () => null,
      (thrown: unknown) => thrown
    );

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).kind).toBe('network');
  });

  test('a request that carries a signal answers inside the timeout normally', async () => {
    const fetchImpl = ((_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return Promise.resolve(json({ files: [] }));
    }) as unknown as typeof fetch;
    const adapter = createDriveRestAdapter(tokenSource, { fetchImpl, requestTimeoutMs: 5_000 });

    expect(await adapter.listCatalog()).toEqual([]);
  });
});

describe('credential safety', () => {
  test('no AppError raised by the adapter carries a token or an Authorization header', async () => {
    const SECRET = 'ya29.SECRETVALUEsecretvalue';
    const adapter = createDriveRestAdapter(() => SECRET, {
      fetchImpl: stubFetch([raw('Unauthorized', 401)]).fetch
    });

    const error: AppError = await adapter.listCatalog().then(
      () => null,
      (thrown: AppError) => thrown
    );

    const text = `${error.message} ${JSON.stringify(error.detail)}`;
    expect(text).not.toContain(SECRET);
    expect(text.toLowerCase()).not.toContain('authorization');
  });

  test('a token echoed back in a Google error message does not reach the AppError', async () => {
    const SECRET = 'ya29.ECHOEDtokenvalue';
    const { fetch } = stubFetch([
      json({ error: { message: `Invalid token ${SECRET}`, errors: [{ reason: 'authError' }] } }, 401)
    ]);
    const adapter = createDriveRestAdapter(() => SECRET, { fetchImpl: fetch });

    const error: AppError = await adapter.listCatalog().then(
      () => null,
      (thrown: AppError) => thrown
    );

    const text = `${error.message} ${JSON.stringify(error.detail)}`;
    expect(text).not.toContain(SECRET);
  });

  test('a failed request logs the operation and status, never the credential', async () => {
    const SECRET = 'ya29.LOGGEDtokenvalue';
    const { fetch } = stubFetch([raw('Unauthorized', 401)]);
    const adapter = createDriveRestAdapter(() => SECRET, { fetchImpl: fetch });

    await adapter.listCatalog().catch(() => undefined);

    const { diagnosticSnapshot } = await import('../src/diagnostics/diagnostic-log');
    const events = diagnosticSnapshot();
    const failure = events.filter((event) => event.code === 'drive_request_failed');
    expect(failure.length).toBeGreaterThan(0);
    for (const event of failure) {
      const text = JSON.stringify(event);
      expect(text).not.toContain(SECRET);
      expect(text.toLowerCase()).not.toContain('authorization');
    }
  });
});

describe('rejection probe', () => {
  test('a 401 answer means the token is rejected', async () => {
    const { fetch } = stubFetch([raw(null, 401)]);
    const adapter = createDriveRestAdapter(tokenSource, { fetchImpl: fetch });

    expect(await adapter.probeRejected('a-token')).toBe(true);
  });

  test('a 200 answer means the token still works', async () => {
    const { fetch } = stubFetch([json({ user: { permissionId: 'permission-9' } })]);
    const adapter = createDriveRestAdapter(tokenSource, { fetchImpl: fetch });

    expect(await adapter.probeRejected('a-token')).toBe(false);
  });

  test('a network error proves nothing', async () => {
    const fetchImpl = (async (): Promise<Response> => {
      throw new TypeError('offline');
    }) as unknown as typeof fetch;
    const adapter = createDriveRestAdapter(tokenSource, { fetchImpl });

    expect(await adapter.probeRejected('a-token')).toBe(false);
  });
});

describe('revocation', () => {
  test('revocation posts a hidden form and resolves when Drive rejects the token', async () => {
    const browser = installFakeBrowser();
    const { fetch } = stubFetch([raw(null, 401)]);
    const adapter = createDriveRestAdapter(tokenSource, {
      fetchImpl: fetch,
      revokeTimeoutMs: 50
    });

    const revocation = adapter.revokeToken('a-token');

    expect(browser.submittedForm?.method).toBe('post');
    expect(browser.submittedForm?.action).toBe('https://oauth2.googleapis.com/revoke');
    expect(browser.submittedForm?.target.startsWith('repjot_revoke_')).toBe(true);
    expect(browser.submittedForm?.children[0]?.name).toBe('token');
    expect(browser.submittedForm?.children[0]?.value).toBe('a-token');
    await expect(revocation).resolves.toBeUndefined();
    expect(browser.removedElementCount).toBeGreaterThanOrEqual(2);
  });

  test('an unconfirmed revocation rejects with authentication', async () => {
    installFakeBrowser();
    const { fetch } = stubFetch([raw('{}', 200), raw('{}', 200), raw('{}', 200)]);
    const adapter = createDriveRestAdapter(tokenSource, {
      fetchImpl: fetch,
      revokeTimeoutMs: 10
    });

    await expect(adapter.revokeToken('a-token')).rejects.toMatchObject({
      kind: 'authentication',
      detail: { reason: 'unconfirmed' }
    });
  });

  test('revocation on a host with no document rejects rather than throwing a TypeError', async () => {
    uninstallFakeBrowser();
    const { fetch } = stubFetch([]);
    const adapter = createDriveRestAdapter(tokenSource, {
      fetchImpl: fetch,
      revokeTimeoutMs: 10
    });

    await expect(adapter.revokeToken('a-token')).rejects.toMatchObject({
      kind: 'authentication',
      detail: { reason: 'no_dom' }
    });
  });
});
