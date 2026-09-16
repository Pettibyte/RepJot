// The Delete All User Data confirmation.
// Phase 19. REQUIREMENTS 21.3, 21.4. ARCHITECTURE ADR-018.
//
// What this file proves automatically: the phrase rule, and the copy rules.
// The interactive gate — a real keystroke enabling a real button — is
// verified by hand. See `docs/implementation/PHASE-19-MANUAL-TESTS.md`.
// This build has no DOM test harness, and adding one for a single rule costs
// more than the rule is worth here.

import { describe, expect, test } from 'bun:test';
import DeleteAllDataDialog from '../src/ui/components/DeleteAllDataDialog.svelte';
import { DELETE_PHRASE, matchesDeletePhrase } from '../src/ui/components/delete-phrase';
import { html as renderHtml } from './support/render';

describe('the delete phrase', () => {
  test('the phrase is the exact words the requirement names', () => {
    expect(DELETE_PHRASE).toBe('DELETE ALL USER DATA');
  });

  test('the exact phrase matches', () => {
    expect(matchesDeletePhrase('DELETE ALL USER DATA')).toBe(true);
  });

  test('a case mismatch does not match', () => {
    expect(matchesDeletePhrase('delete all user data')).toBe(false);
    expect(matchesDeletePhrase('Delete All User Data')).toBe(false);
    expect(matchesDeletePhrase('dELETE ALL USER DATA')).toBe(false);
  });

  test('padded text does not match', () => {
    expect(matchesDeletePhrase(' DELETE ALL USER DATA')).toBe(false);
    expect(matchesDeletePhrase('DELETE ALL USER DATA ')).toBe(false);
    expect(matchesDeletePhrase('DELETE  ALL USER DATA')).toBe(false);
  });

  test('a near miss does not match', () => {
    expect(matchesDeletePhrase('DELETE ALL USER')).toBe(false);
    expect(matchesDeletePhrase('DELETE ALL USER DATA NOW')).toBe(false);
    expect(matchesDeletePhrase('')).toBe(false);
  });
});

describe('the delete dialog copy', () => {
  test('the copy never claims the delete is irreversible', () => {
    const out = renderHtml(DeleteAllDataDialog, { recognizedCount: 3 });

    const lower = out.toLowerCase();
    expect(lower).not.toContain('irreversible');
    expect(lower).not.toContain('irreversibly');
    expect(lower).not.toContain('cannot be undone');
    expect(lower).not.toContain("can't be undone");
    expect(lower).not.toContain('permanently');
    expect(lower).not.toContain('gone forever');
  });

  test('the copy warns that another device can restore the files', () => {
    const out = renderHtml(DeleteAllDataDialog, { recognizedCount: 3 });
    // Markup wraps its copy across lines. Compare on collapsed whitespace.
    const flat = out.replace(/\s+/g, ' ');

    expect(flat).toContain('Another device');
    expect(flat).toContain('can put these files back the next time it syncs');
    expect(flat).toContain('Do not sync your other devices after you delete');
  });

  test('the copy names the phrase the user must type', () => {
    const out = renderHtml(DeleteAllDataDialog, { recognizedCount: 1 });
    expect(out).toContain('DELETE ALL USER DATA');
  });

  test('the dialog shows the recognized file count', () => {
    const many = renderHtml(DeleteAllDataDialog, { recognizedCount: 7 });
    expect(many).toContain('7 files');

    const one = renderHtml(DeleteAllDataDialog, { recognizedCount: 1 });
    expect(one).toContain('1 file');
    expect(one).not.toContain('1 files');
  });

  test('a zero count says there is nothing to delete', () => {
    const out = renderHtml(DeleteAllDataDialog, { recognizedCount: 0 });
    expect(out).toContain('no files to delete');
  });

  test('the confirm control renders disabled before the phrase is typed', () => {
    const out = renderHtml(DeleteAllDataDialog, { recognizedCount: 2 });

    // The initial state has an empty input, so the gate is shut. Svelte
    // renders the disabled attribute on the button.
    expect(out).toContain('disabled');
  });

  test('a failure line renders when the caller reports one', () => {
    const out = renderHtml(DeleteAllDataDialog, {
      recognizedCount: 2,
      errorText: 'Some files are still there: preferences.json.'
    });

    expect(out).toContain('Some files are still there: preferences.json.');
    expect(out).toContain('role="alert"');
  });

  test('the dialog carries no inline color, shadow, or radius', () => {
    const out = renderHtml(DeleteAllDataDialog, { recognizedCount: 1 });
    expect(out).not.toMatch(/style="[^"]*(color|shadow|radius)/);
  });
});
