const AUTH_DIAGNOSTIC_KEY = 'repjot.auth.diagnostics.v1';
const MAX_AUTH_DIAGNOSTIC_EVENTS = 120;

export type AuthDiagnosticValue = string | number | boolean | null;
export type AuthDiagnosticContext = Readonly<Record<string, AuthDiagnosticValue>>;

const ALLOWED_CONTEXT_KEYS = new Set([
  'accountBound',
  'authorizationStillCurrent',
  'busy',
  'configured',
  'duplicateResponse',
  'errorKind',
  'expired',
  'expiresInSeconds',
  'hadLocalPending',
  'hadSessionPending',
  'hasInitialAuthorization',
  'hasInitialError',
  'hasToken',
  'httpStatus',
  'lifetimeSeconds',
  'localPending',
  'localTokenValid',
  'pendingCopiesEqual',
  'previouslyBound',
  'remember',
  'responseConsumed',
  'returnedState',
  'selectAccount',
  'sessionPending',
  'sessionTokenValid',
  'stateMatched',
  'store',
  'timeoutMs',
  'tokenFound'
]);

interface StoredAuthDiagnosticEvent {
  recordedAtUtc: string;
  sequence: number;
  code: string;
  context: AuthDiagnosticContext;
}

interface StoredAuthDiagnostics {
  schemaVersion: 1;
  nextSequence: number;
  events: StoredAuthDiagnosticEvent[];
}

function emptyDiagnostics(): StoredAuthDiagnostics {
  return { schemaVersion: 1, nextSequence: 1, events: [] };
}

function safeContext(context: AuthDiagnosticContext): AuthDiagnosticContext {
  const safe: Record<string, AuthDiagnosticValue> = {};
  Object.keys(context).forEach((key: string) => {
    const value = context[key];
    if (
      ALLOWED_CONTEXT_KEYS.has(key) &&
      (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null)
    ) {
      safe[key] = value;
    }
  });
  return safe;
}

function isStoredEvent(value: unknown): value is StoredAuthDiagnosticEvent {
  if (typeof value !== 'object' || value === null) return false;
  const event = value as Partial<StoredAuthDiagnosticEvent>;
  return (
    typeof event.recordedAtUtc === 'string' &&
    Number.isFinite(Date.parse(event.recordedAtUtc)) &&
    typeof event.sequence === 'number' &&
    Number.isInteger(event.sequence) &&
    typeof event.code === 'string' &&
    /^[a-z0-9_]{1,64}$/.test(event.code) &&
    typeof event.context === 'object' &&
    event.context !== null
  );
}

function readDiagnostics(): StoredAuthDiagnostics {
  try {
    const serialized = window.localStorage.getItem(AUTH_DIAGNOSTIC_KEY);
    if (serialized === null) return emptyDiagnostics();
    const value = JSON.parse(serialized) as Partial<StoredAuthDiagnostics>;
    if (
      value.schemaVersion !== 1 ||
      typeof value.nextSequence !== 'number' ||
      !Number.isInteger(value.nextSequence) ||
      !Array.isArray(value.events)
    ) {
      return emptyDiagnostics();
    }
    return {
      schemaVersion: 1,
      nextSequence: value.nextSequence,
      events: value.events
        .filter(isStoredEvent)
        .slice(-MAX_AUTH_DIAGNOSTIC_EVENTS)
        .map((event: StoredAuthDiagnosticEvent) => ({ ...event, context: safeContext(event.context) }))
    };
  } catch {
    return emptyDiagnostics();
  }
}

export function recordAuthDiagnostic(code: string, context: AuthDiagnosticContext = {}): void {
  try {
    const diagnostics = readDiagnostics();
    diagnostics.events.push({
      recordedAtUtc: new Date().toISOString(),
      sequence: diagnostics.nextSequence,
      code: /^[a-z0-9_]{1,64}$/.test(code) ? code : 'invalid_diagnostic_code',
      context: safeContext(context)
    });
    diagnostics.nextSequence += 1;
    diagnostics.events = diagnostics.events.slice(-MAX_AUTH_DIAGNOSTIC_EVENTS);
    window.localStorage.setItem(AUTH_DIAGNOSTIC_KEY, JSON.stringify(diagnostics));
  } catch {
    // Diagnostics must never change authorization behavior.
  }
}

function coarseBrowserFamily(): string {
  const userAgent = navigator.userAgent;
  if (/Silk\//i.test(userAgent)) return 'Silk';
  if (/Firefox\//i.test(userAgent)) return 'Firefox';
  if (/Edg\//i.test(userAgent)) return 'Edge';
  if (/Chrome\//i.test(userAgent)) return 'Chrome';
  if (/Safari\//i.test(userAgent)) return 'Safari';
  return 'Other';
}

function markdownCell(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');
}

export function authorizationDiagnosticText(generatedAtUtc: string = new Date().toISOString()): string {
  const diagnostics = readDiagnostics();
  const lines = [
    '# REP JOT authorization diagnostics',
    '',
    `- Generated at UTC: ${generatedAtUtc}`,
    `- Browser family: ${coarseBrowserFamily()}`,
    `- Event count: ${diagnostics.events.length}`,
    '- Format version: 1',
    '',
    'This file contains no access tokens, OAuth state values, account names, or Google account identifiers.',
    '',
    '| Sequence | Recorded at UTC | Code | Context |',
    '| ---: | --- | --- | --- |'
  ];

  diagnostics.events.forEach((event: StoredAuthDiagnosticEvent) => {
    lines.push(
      `| ${event.sequence} | ${markdownCell(event.recordedAtUtc)} | ${markdownCell(event.code)} | ${markdownCell(JSON.stringify(event.context))} |`
    );
  });
  lines.push('');
  return lines.join('\n');
}

export function downloadAuthorizationDiagnostics(): void {
  recordAuthDiagnostic('diagnostic_download_requested');
  const text = authorizationDiagnosticText();
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `rep-jot-authorization-${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}.txt`;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => window.URL.revokeObjectURL(url), 1_000);
}

export function clearAuthorizationDiagnostics(): void {
  try {
    window.localStorage.removeItem(AUTH_DIAGNOSTIC_KEY);
  } catch {
    // The clear action is best effort.
  }
}
