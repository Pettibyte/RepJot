<!--
  The Diagnostics section of Settings.
  Phase 19. REQUIREMENTS 12.11, 12.12. ARCHITECTURE ADR-016.

  One action: download the in-memory diagnostic ring as a single JSON file the
  user can attach to a support message. The log never leaves the device any
  other way, and this section says so, because "the app keeps a log" reads like
  a telemetry claim unless the page answers where it goes.

  The event count is live. The ring is a plain array, so the log module exposes
  `onDiagnosticChange` and this section holds the count in `$state` behind it.
  A dependency-free `$derived` would compute once and cache for the life of the
  instance, which would state a false number for the rest of the page session.
-->
<script lang="ts">
  import Button from './Button.svelte';
  import {
    diagnosticCount,
    downloadDiagnosticLog,
    onDiagnosticChange
  } from '../../diagnostics/diagnostic-log';

  let { disabled = false }: { disabled?: boolean } = $props();

  /** Failure text when the host cannot produce a file. */
  let errorText = $state('');

  /**
   * Events held right now.
   *
   * Seeded from the ring at construction so a server render shows the real
   * number, then kept current by the listener. The listener is dropped on
   * unmount, so a section that is not on screen holds nothing.
   */
  let eventCount = $state(diagnosticCount());

  $effect((): (() => void) => {
    eventCount = diagnosticCount();
    return onDiagnosticChange((): void => {
      eventCount = diagnosticCount();
    });
  });

  /** Hand the ring to the browser. */
  function download(): void {
    errorText = '';
    try {
      downloadDiagnosticLog();
    } catch {
      errorText = 'This device cannot open the download. Reload the page and try again.';
    }
  }
</script>

<div class="settings-section" role="region" aria-label="Diagnostics">
  <h2 class="settings-section__title">Diagnostics</h2>

  <p class="settings-section__hint">
    REP JOT keeps a short log of what it did in this page session. The log
    stays on this device. REP JOT never uploads it, and it holds no sign-in
    information.
  </p>

  <p class="settings-section__count">
    {eventCount === 0
      ? 'No events recorded yet in this session.'
      : `${String(eventCount)} event${eventCount === 1 ? '' : 's'} recorded in this session.`}
  </p>

  <div class="settings-section__actions">
    <Button variant="secondary" {disabled} onclick={download}>
      Download diagnostic log
    </Button>
  </div>

  {#if errorText !== ''}
    <p class="settings-section__error" role="alert">{errorText}</p>
  {/if}
</div>
