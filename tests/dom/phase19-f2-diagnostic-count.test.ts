// F-2: the Diagnostics event count must move while the section stays mounted.
//
// The audit found the count frozen at whatever it was when the component was
// built, because a `$derived` with no reactive input computes once and caches
// for the life of the instance. The section stated a false number for the rest
// of the page session.
//
// REQUIREMENTS 12.11, 12.12.

import { afterEach, describe, expect, test } from 'bun:test';
import DiagnosticSection from '../../src/ui/components/DiagnosticSection.svelte';
import {
  diagnosticCount,
  logDiagnostic,
  resetDiagnosticLog
} from '../../src/diagnostics/diagnostic-log';
import { flushSync, mountTo, teardown } from './harness';

afterEach(() => {
  teardown();
});

/**
 * Log one event and let the section repaint.
 *
 * The listener sets `$state`, and Svelte flushes on the next tick. Reading
 * the DOM without flushing would read the pre-update tree and report the
 * finding as still present when it is not.
 */
function log(code: string): void {
  logDiagnostic({ severity: 'info', code });
  flushSync();
}

function countText(target: HTMLElement): string {
  return (target.querySelector('.settings-section__count')?.textContent ?? '').trim();
}

describe('the diagnostic count is live', () => {
  test('an event logged after mount moves the count without a remount', async () => {
    resetDiagnosticLog();
    logDiagnostic({ severity: 'info', code: 'before_mount' });

    const { target } = mountTo(DiagnosticSection, { disabled: false });
    expect(countText(target)).toContain('1 event');

    log('after_mount');

    // The whole finding: the number must move with no remount and no prop
    // change. The audit's option (b), a plain instance-script read, fails
    // exactly this assertion.
    expect(countText(target)).toContain('2 events');
  });

  test('the count tracks a burst of events', async () => {
    resetDiagnosticLog();
    const { target } = mountTo(DiagnosticSection, { disabled: false });
    expect(countText(target)).toContain('No events');

    for (let i = 0; i < 5; i += 1) {
      log(`evt_${String(i)}`);
    }
    expect(countText(target)).toContain('5 events');
  });

  test('the count follows a reset', async () => {
    resetDiagnosticLog();
    logDiagnostic({ severity: 'info', code: 'one' });
    const { target } = mountTo(DiagnosticSection, { disabled: false });
    expect(countText(target)).toContain('1 event');

    resetDiagnosticLog();
    flushSync();
    expect(countText(target)).toContain('No events');
  });

  test('the rendered count matches the ring after each write', async () => {
    resetDiagnosticLog();
    const { target } = mountTo(DiagnosticSection, { disabled: false });

    for (let i = 0; i < 6; i += 1) {
      log(`evt_${String(i)}`);
      const shown = Number.parseInt(countText(target), 10);
      expect(shown).toBe(diagnosticCount());
    }
  });

  test('a guard event from a refused credential also moves the count', async () => {
    resetDiagnosticLog();
    const { target } = mountTo(DiagnosticSection, { disabled: false });

    // The guard writes a second ring entry, so one call moves the count by
    // two. The number the user sees must still equal the ring.
    logDiagnostic({ severity: 'info', code: 'leaky', context: { accessToken: 'ya29.x' } });
    flushSync();

    expect(diagnosticCount()).toBe(2);
    expect(Number.parseInt(countText(target), 10)).toBe(2);
  });
});
