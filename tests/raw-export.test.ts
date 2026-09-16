// Raw export list and download helpers.
// Phase 19. REQUIREMENTS 12.10, 21.1. ARCHITECTURE §10 "Export and untrusted data".

import { afterEach, describe, expect, test } from 'bun:test';
import type { DriveFileMeta } from '../src/drive/drive-interface';
import { buildExportList, downloadBytes, downloadText } from '../src/export/raw-export';

/** Build one catalog entry with the fields the export list reads. */
function meta(id: string, name: string, size = 128): DriveFileMeta {
  return {
    id,
    name,
    modifiedTime: '2026-08-15T00:00:00Z',
    version: '1',
    md5Checksum: `md5-${id}`,
    size
  };
}

describe('buildExportList: names', () => {
  test('a unique name keeps its Drive name as the download name', () => {
    const rows = buildExportList([meta('a1', 'preferences.json')]);

    expect(rows).toHaveLength(1);
    expect(rows[0].downloadName).toBe('preferences.json');
    expect(rows[0].driveFileId).toBe('a1');
  });

  test('every file in a duplicated name group carries the Drive file ID', () => {
    const rows = buildExportList([
      meta('id-1', 'results-2026-08.json'),
      meta('id-2', 'results-2026-08.json')
    ]);

    // Both members get the suffix. Leaving one on the bare name would still
    // tell the two apart, but it would also make one file look canonical.
    expect(rows[0].downloadName).toBe('results-2026-08-drive-id-1.json');
    expect(rows[1].downloadName).toBe('results-2026-08-drive-id-2.json');
  });

  test('a duplicated group does not touch a unique name in the same list', () => {
    const rows = buildExportList([
      meta('id-1', 'results-2026-08.json'),
      meta('id-2', 'results-2026-08.json'),
      meta('id-3', 'preferences.json')
    ]);

    expect(rows[2].downloadName).toBe('preferences.json');
  });

  test('the file ID goes before the extension', () => {
    const rows = buildExportList([meta('zz', 'a.b.json'), meta('yy', 'a.b.json')]);

    expect(rows[0].downloadName).toBe('a.b-drive-zz.json');
  });

  test('a name with no extension takes the suffix at the end', () => {
    const rows = buildExportList([meta('n1', 'NOTES'), meta('n2', 'NOTES')]);

    expect(rows[0].downloadName).toBe('NOTES-drive-n1');
    expect(rows[1].downloadName).toBe('NOTES-drive-n2');
  });

  test('a dotfile keeps its leading dot', () => {
    const rows = buildExportList([meta('d1', '.hidden'), meta('d2', '.hidden')]);

    expect(rows[0].downloadName).toBe('.hidden-drive-d1');
  });

  test('catalog order is kept', () => {
    const rows = buildExportList([
      meta('z', 'preferences.json'),
      meta('y', 'results-2026-01.json'),
      meta('x', 'notes.txt')
    ]);

    expect(rows.map((row) => row.driveFileId)).toEqual(['z', 'y', 'x']);
  });
});

describe('buildExportList: recognition', () => {
  test('a preferences file is marked recognized', () => {
    const rows = buildExportList([meta('p', 'preferences.json')]);
    expect(rows[0].recognized).toBe(true);
  });

  test('a monthly shard is marked recognized', () => {
    const rows = buildExportList([meta('s', 'results-2026-09.json')]);
    expect(rows[0].recognized).toBe(true);
  });

  test('an unknown file appears in the list marked not recognized', () => {
    const rows = buildExportList([
      meta('u', 'my-holiday-photo.jpg'),
      meta('v', 'results-2026-13.json')
    ]);

    // `results-2026-13.json` is not a shard: month 13 cannot exist. It is
    // unknown, so the export lists it and leaves it alone.
    expect(rows).toHaveLength(2);
    expect(rows[0].recognized).toBe(false);
    expect(rows[1].recognized).toBe(false);
  });

  test('a newer-version or corrupt file still appears in the list', () => {
    // The export list reads no content, so a file the current build cannot
    // parse still shows. The user gets to download it and look.
    const rows = buildExportList([
      meta('new', 'preferences.json', 4096),
      meta('junk', 'results-1999-01.json', 3)
    ]);

    expect(rows.map((row) => row.name)).toEqual(['preferences.json', 'results-1999-01.json']);
    expect(rows[1].size).toBe(3);
  });
});

describe('download helpers', () => {
  /** The anchors the fake document handed out, in append order. */
  let created: Array<Record<string, unknown>> = [];
  let revoked: string[] = [];
  const realDocument = (globalThis as { document?: unknown }).document;
  const realCreateObjectURL = URL.createObjectURL;
  const realRevokeObjectURL = URL.revokeObjectURL;

  /** Install the smallest document that satisfies the download path. */
  function installFakeDom(): void {
    created = [];
    revoked = [];
    const body = {
      appendChild(node: Record<string, unknown>): void {
        created.push(node);
      },
      removeChild(_node: Record<string, unknown>): void {
        // The anchor leaves the tree. Nothing to record.
      }
    };
    Object.defineProperty(globalThis, 'document', {
      value: {
        body,
        createElement(_tag: string): Record<string, unknown> {
          const node: Record<string, unknown> = { clicked: false };
          node.click = (): void => {
            node.clicked = true;
          };
          return node;
        }
      },
      configurable: true,
      writable: true
    });
    URL.createObjectURL = ((blob: Blob): string => `blob:fake/${String(blob.size)}`) as typeof URL.createObjectURL;
    URL.revokeObjectURL = ((url: string): void => {
      revoked.push(url);
    }) as typeof URL.revokeObjectURL;
  }

  function restoreDom(): void {
    if (realDocument === undefined) {
      delete (globalThis as { document?: unknown }).document;
    } else {
      Object.defineProperty(globalThis, 'document', {
        value: realDocument,
        configurable: true,
        writable: true
      });
    }
    URL.createObjectURL = realCreateObjectURL;
    URL.revokeObjectURL = realRevokeObjectURL;
  }

  afterEach(restoreDom);

  test('downloadText attaches the name and clicks the anchor', () => {
    installFakeDom();
    const text = '{"format":"repjot/preferences"}';
    downloadText('preferences.json', text);

    expect(created).toHaveLength(1);
    const anchor = created[0];
    expect(anchor.download).toBe('preferences.json');
    // The blob size is the encoded byte length, so the download carries the
    // whole text and nothing else.
    expect(anchor.href).toBe(`blob:fake/${String(new TextEncoder().encode(text).byteLength)}`);
    expect(anchor.clicked).toBe(true);
  });

  test('downloadBytes writes the bytes unchanged', () => {
    installFakeDom();
    const bytes = new Uint8Array([123, 34, 'a'.charCodeAt(0), 34, 58, 49, 125]);
    downloadBytes('out.json', bytes, 'application/json');

    expect(created).toHaveLength(1);
    // The blob size equals the byte length, so nothing was padded or dropped.
    expect(created[0].href).toBe(`blob:fake/${String(bytes.byteLength)}`);
  });

  test('the object URL is revoked after the click', async () => {
    installFakeDom();
    downloadText('a.json', '{}');
    const issued = String(created[0].href);

    await new Promise((resolve) => setTimeout(resolve, 20));

    // The revoke is deferred one tick so the browser has time to read the
    // URL. A test run leaves other deferred revokes in flight, so the check
    // is membership, not the whole array.
    expect(revoked).toContain(issued);
  });

  test('a host with no document throws instead of failing silently', () => {
    restoreDom();
    Object.defineProperty(globalThis, 'document', {
      value: undefined,
      configurable: true,
      writable: true
    });

    let threw = false;
    try {
      downloadText('a.json', '{}');
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });
});
