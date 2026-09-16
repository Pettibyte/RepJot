// F-3: the export must write the bytes Drive holds, not a re-encoded guess.
//
// The audit found the export path was text-only end to end. A file whose bytes
// were not valid UTF-8 came back with every invalid byte replaced by U+FFFD, so
// 5 bytes became 11. The downloaded file was not the file in the folder.
//
// These tests drive the real DataExportSection over the real FakeDrive and
// capture the bytes that reach the Blob.
//
// REQUIREMENTS 12.10, 21.1.

import { afterEach, describe, expect, test } from 'bun:test';
import DataExportSection from '../../src/ui/components/DataExportSection.svelte';
import { buttonWithText, mountTo, signIn, tap, teardown, type Harness } from './harness';

let harness: Harness;

/** One captured download. */
interface Captured {
  name: string;
  bytes: Uint8Array;
}

let captured: Captured[] = [];

const realCreateObjectURL = URL.createObjectURL;
const realRevokeObjectURL = URL.revokeObjectURL;

/**
 * Capture the bytes handed to `createObjectURL`.
 *
 * Reading the Blob back is the only way to see what the download really
 * carries. The `size` the fake URL reports is derived from the same Blob, so a
 * lossy decode would show up as a size change.
 */
function installCapture(): void {
  captured = [];
  URL.createObjectURL = (async (blob: Blob): Promise<string> => {
    const buffer = await blob.arrayBuffer();
    captured.push({
      name: '',
      bytes: new Uint8Array(buffer)
    });
    return `blob:fake/${String(blob.byteLength)}`;
  }) as unknown as typeof URL.createObjectURL;
  URL.revokeObjectURL = (() => undefined) as typeof URL.revokeObjectURL;
}

function restoreCapture(): void {
  URL.createObjectURL = realCreateObjectURL;
  URL.revokeObjectURL = realRevokeObjectURL;
}

afterEach(() => {
  restoreCapture();
  teardown();
});

/** Refresh the list and press Download on the first row. */
async function downloadFirstRow(target: HTMLElement): Promise<void> {
  const refresh = buttonWithText(target, 'Refresh file list');
  if (refresh === undefined) throw new Error('No refresh button.');
  tap(refresh);
  await new Promise((resolve) => setTimeout(resolve, 10));

  const download = buttonWithText(target, 'Download');
  if (download === undefined) throw new Error('No download button rendered.');
  tap(download);
  await new Promise((resolve) => setTimeout(resolve, 10));
}

describe('the export preserves bytes', () => {
  test('bytes that are not valid UTF-8 download unchanged', async () => {
    installCapture();
    const source = new Uint8Array([255, 254, 65, 128, 66]);
    harness = await signIn();
    harness.drive.addBytes('hand-made.bin', source);

    const { target } = mountTo(DataExportSection, { drive: harness.drive });
    await downloadFirstRow(target);

    expect(captured.length).toBe(1);
    expect(Array.from(captured[0].bytes)).toEqual([255, 254, 65, 128, 66]);
    // The lossy path turned these 5 bytes into 11. Size is the tell.
    expect(captured[0].bytes.byteLength).toBe(5);
  });

  test('a UTF-8 JSON file still downloads whole', async () => {
    installCapture();
    const text = JSON.stringify({ format: 'repjot/preferences', exerciseUnits: {} });
    harness = await signIn([{ name: 'preferences.json', text }]);

    const { target } = mountTo(DataExportSection, { drive: harness.drive });
    await downloadFirstRow(target);

    expect(captured.length).toBe(1);
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(captured[0].bytes);
    expect(decoded).toBe(text);
    expect(captured[0].bytes.byteLength).toBe(new TextEncoder().encode(text).byteLength);
  });

  test('a multi-byte UTF-8 file survives exactly', async () => {
    installCapture();
    // Valid multi-byte UTF-8. This case passed before the fix too, so it is
    // here to prove the byte path did not break the case that already worked.
    const text = '{"note":"héllo wörld — ✓"}';
    harness = await signIn([{ name: 'note.json', text }]);

    const { target } = mountTo(DataExportSection, { drive: harness.drive });
    await downloadFirstRow(target);

    const expected = new TextEncoder().encode(text);
    expect(Array.from(captured[0].bytes)).toEqual(Array.from(expected));
  });

  test('every byte value round-trips', async () => {
    installCapture();
    const source = new Uint8Array(256);
    for (let i = 0; i < 256; i += 1) source[i] = i;
    harness = await signIn();
    harness.drive.addBytes('allbytes.bin', source);

    const { target } = mountTo(DataExportSection, { drive: harness.drive });
    await downloadFirstRow(target);

    expect(Array.from(captured[0].bytes)).toEqual(Array.from(source));
  });
});
