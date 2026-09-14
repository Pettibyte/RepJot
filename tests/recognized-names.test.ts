// Phase 11: recognition of the Drive file names REP JOT owns.
// REQUIREMENTS 4.22. ARCHITECTURE section 11 "Catalog and duplicate files".

import { describe, expect, test } from 'bun:test';
import {
  PREFERENCES_FILE_NAME,
  familyForName,
  isRecognizedName,
  recognize
} from '../src/sync/recognized-names';

describe('recognize', () => {
  test('a monthly shard name recognizes with its UTC month', () => {
    expect(recognize('results-2026-09.json')).toEqual({
      kind: 'shard',
      name: 'results-2026-09.json',
      yearMonthUtc: '2026-09'
    });
  });

  test('preferences.json recognizes as the preferences file', () => {
    expect(recognize(PREFERENCES_FILE_NAME)).toEqual({
      kind: 'preferences',
      name: 'preferences.json'
    });
  });

  test('an unknown name returns null', () => {
    expect(recognize('notes.json')).toBeNull();
    expect(recognize('readme.txt')).toBeNull();
    expect(recognize('')).toBeNull();
  });

  test('a malformed shard name is unknown, not a shard', () => {
    expect(recognize('results-2026-9.json')).toBeNull();
    expect(recognize('results-2026.json')).toBeNull();
    expect(recognize('results-.json')).toBeNull();
    expect(recognize('results-2026-09.JSON')).toBeNull();
    expect(recognize('results-2026-09.json.bak')).toBeNull();
  });

  test('a month number no UTC calendar holds is unknown', () => {
    expect(recognize('results-2026-13.json')).toBeNull();
    expect(recognize('results-2026-00.json')).toBeNull();
    expect(recognize('results-2026-99.json')).toBeNull();
  });

  test('the preferences name is matched whole, not as a prefix', () => {
    expect(recognize('preferences.json.bak')).toBeNull();
    expect(recognize('my-preferences.json')).toBeNull();
  });
});

describe('isRecognizedName and familyForName', () => {
  test('both recognized names report their family', () => {
    expect(isRecognizedName('preferences.json')).toBe(true);
    expect(isRecognizedName('results-2026-01.json')).toBe(true);
    expect(familyForName('preferences.json')).toBe('repjot/preferences');
    expect(familyForName('results-2026-12.json')).toBe('repjot/results');
  });

  test('an unknown name has no family', () => {
    expect(isRecognizedName('secrets.json')).toBe(false);
    expect(familyForName('secrets.json')).toBeNull();
  });
});
