import { beforeEach, describe, expect, test } from 'bun:test';
import {
  MAX_DIAGNOSTIC_EVENTS,
  diagnosticJson,
  diagnosticSnapshot,
  logDiagnostic,
  resetDiagnosticLog
} from '../src/diagnostics/diagnostic-log';

beforeEach(() => {
  resetDiagnosticLog();
});

describe('ring bound', () => {
  test('keeps 200 events and drops the oldest', () => {
    for (let i = 1; i <= 250; i += 1) {
      logDiagnostic({ severity: 'info', code: `event_${i}` });
    }

    const snapshot = diagnosticSnapshot();
    expect(snapshot.length).toBe(MAX_DIAGNOSTIC_EVENTS);
    expect(snapshot[0].code).toBe('event_51');
    expect(snapshot[snapshot.length - 1].code).toBe('event_250');
  });

  test('stays under the cap when it never fills', () => {
    logDiagnostic({ severity: 'info', code: 'only_one' });

    expect(diagnosticSnapshot().length).toBe(1);
  });

  test('the cap is 200', () => {
    expect(MAX_DIAGNOSTIC_EVENTS).toBe(200);
  });
});

describe('ordering', () => {
  test('diagnosticSnapshot returns oldest first', () => {
    logDiagnostic({ severity: 'info', code: 'first' });
    logDiagnostic({ severity: 'warn', code: 'second' });
    logDiagnostic({ severity: 'error', code: 'third' });

    expect(diagnosticSnapshot().map((event) => event.code)).toEqual(['first', 'second', 'third']);
  });

  test('each event carries a UTC timestamp', () => {
    logDiagnostic({ severity: 'info', code: 'stamped' });

    expect(diagnosticSnapshot()[0].recordedAtUtc).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });

  test('the snapshot copy does not expose the ring', () => {
    logDiagnostic({ severity: 'info', code: 'first' });
    const snapshot = diagnosticSnapshot();
    snapshot.push({ recordedAtUtc: 'x', severity: 'info', code: 'injected' });

    expect(diagnosticSnapshot().length).toBe(1);
  });
});

describe('context guard', () => {
  test('a context key containing token is rejected and logged as a guard violation', () => {
    logDiagnostic({
      severity: 'info',
      code: 'sync_upload',
      context: { attempt: 1, accessToken: 'ya29.secret-value' }
    });

    const snapshot = diagnosticSnapshot();
    expect(snapshot.length).toBe(2);
    expect(snapshot[0].code).toBe('sync_upload');
    expect(snapshot[0].context).toEqual({ attempt: 1 });
    expect(snapshot[1].severity).toBe('warn');
    expect(snapshot[1].code).toBe('diagnostic_context_guard');
    expect(snapshot[1].context).toEqual({ sourceCode: 'sync_upload', refusedKeys: 1, redactedValues: 0 });
  });

  test('the refused value and key never reach the JSON export', () => {
    logDiagnostic({
      severity: 'info',
      code: 'sync_upload',
      context: { attempt: 1, authorization: 'Bearer ya29.secret-value' }
    });

    const json = diagnosticJson();
    expect(json).not.toContain('ya29.secret-value');
    expect(json).not.toContain('Bearer');
    expect(json).not.toContain('authorization');
  });

  test('the guard covers token, authorization, header, and secret', () => {
    for (const banned of ['token', 'Authorization', 'X-Header', 'client_secret']) {
      resetDiagnosticLog();
      logDiagnostic({ severity: 'info', code: 'probe', context: { [banned]: 'value', keep: 1 } });

      const snapshot = diagnosticSnapshot();
      expect(snapshot.length).toBe(2);
      expect(snapshot[0].context).toEqual({ keep: 1 });
    }
  });

  test('a safe context writes no guard event', () => {
    logDiagnostic({ severity: 'info', code: 'sync_upload', context: { attempt: 2, shard: '2026-09' } });

    expect(diagnosticSnapshot().length).toBe(1);
    expect(diagnosticSnapshot()[0].context).toEqual({ attempt: 2, shard: '2026-09' });
  });

  test('the guard counts every refused key in one event', () => {
    logDiagnostic({
      severity: 'error',
      code: 'drive_request',
      context: { token: 'a', secret: 'b', header: 'c', status: 503 }
    });

    const guard = diagnosticSnapshot()[1];
    expect(guard.context).toEqual({ sourceCode: 'drive_request', refusedKeys: 3, redactedValues: 0 });
  });
});

describe('diagnosticJson', () => {
  test('exports the ring as a JSON array, oldest first', () => {
    logDiagnostic({ severity: 'info', code: 'a' });
    logDiagnostic({ severity: 'warn', code: 'b' });

    const parsed = JSON.parse(diagnosticJson()) as Array<{ code: string }>;
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.map((event) => event.code)).toEqual(['a', 'b']);
  });

  test('an empty ring exports an empty array', () => {
    expect(JSON.parse(diagnosticJson())).toEqual([]);
  });
});

describe('downloadDiagnosticLog', () => {
  test('rejects on a host with no document instead of claiming a download', async () => {
    const { downloadDiagnosticLog } = await import('../src/diagnostics/diagnostic-log');

    expect(typeof downloadDiagnosticLog).toBe('function');
    // This test host has no DOM. The call must throw, not silently do nothing.
    expect(() => downloadDiagnosticLog()).toThrow();
  });
});

describe('value redaction (F2)', () => {
  const credentialValues: Array<[string, string]> = [
    ['Google access token', 'ya29.a0AfH6SMBxEXAMPLETOKEN'],
    ['Bearer scheme', 'Bearer abcDEF-123.456'],
    ['basic scheme', 'Basic dXNlcjpwYXNz'],
    ['Google API key', 'AIzaSyD-EXAMPLEKEYabcdefghij'],
    ['Google refresh token', '123456789012-abcdefghij_KLmnopqrst1234'],
    ['URL-encoded Bearer', 'Bearer%20abcDEF-123']
  ];

  for (const [label, value] of credentialValues) {
    test(`the ${label} carried under a neutral key is redacted`, () => {
      logDiagnostic({ severity: 'info', code: 'auth_debug', context: { value, attempt: 1 } });

      const snapshot = diagnosticSnapshot();
      expect(snapshot[0].context).toEqual({ value: '[redacted]', attempt: 1 });
      expect(snapshot[1].context).toEqual({ sourceCode: 'auth_debug', refusedKeys: 0, redactedValues: 1 });
      expect(diagnosticJson()).not.toContain(value);
    });
  }

  test('a long Drive file ID is not redacted', () => {
    const driveFileId = '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms';
    logDiagnostic({ severity: 'info', code: 'drive_read', context: { driveFileId, etag: 'ABCDEFabcdef012345' } });

    const snapshot = diagnosticSnapshot();
    expect(snapshot[0].context).toEqual({ driveFileId, etag: 'ABCDEFabcdef012345' });
    expect(diagnosticSnapshot().length).toBe(1);
  });

  test('a redaction is counted next to the refused keys', () => {
    logDiagnostic({
      severity: 'warn',
      code: 'drive_request',
      context: { token: 'x', note: 'ya29.a0AfH6SMBxEXAMPLETOKEN', keep: 1 }
    });

    const guard = diagnosticSnapshot()[1];
    expect(guard.context).toEqual({ sourceCode: 'drive_request', refusedKeys: 1, redactedValues: 1 });
    expect(diagnosticJson()).not.toContain('ya29.a0AfH6SMBxEXAMPLETOKEN');
  });
});

describe('snapshot isolation (F6)', () => {
  test('mutating a snapshot context does not change the ring', () => {
    logDiagnostic({ severity: 'info', code: 'a', context: { attempt: 1 } });

    const snapshot = diagnosticSnapshot();
    snapshot[0].context!.attempt = 999;
    snapshot[0].code = 'changed';

    expect(diagnosticSnapshot()[0].context).toEqual({ attempt: 1 });
    expect(diagnosticSnapshot()[0].code).toBe('a');
  });
});

describe('guard ring cost (F7)', () => {
  test('a burst of violations for one code costs one guard event', () => {
    for (let i = 0; i < 120; i += 1) {
      logDiagnostic({ severity: 'info', code: 'chatty', context: { token: 'x', i } });
    }

    const snapshot = diagnosticSnapshot();
    expect(snapshot.length).toBeLessThan(240);
    expect(snapshot.filter((event) => event.code === 'diagnostic_context_guard').length).toBe(1);

    const realEvents = snapshot.filter((event) => event.code !== 'diagnostic_context_guard');
    expect(realEvents.length).toBeGreaterThan(100);
    const guard = snapshot.find((event) => event.code === 'diagnostic_context_guard');
    expect(guard?.context).toEqual({ sourceCode: 'chatty', refusedKeys: 120, redactedValues: 0 });
  });

  test('a guard for another code starts its own entry', () => {
    logDiagnostic({ severity: 'info', code: 'a', context: { token: 'x' } });
    logDiagnostic({ severity: 'info', code: 'b', context: { secret: 'y' } });

    const guards = diagnosticSnapshot().filter((event) => event.code === 'diagnostic_context_guard');
    expect(guards.length).toBe(2);
    expect(guards[0].context?.sourceCode).toBe('a');
    expect(guards[1].context?.sourceCode).toBe('b');
  });
});
