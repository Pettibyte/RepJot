<!--
  The Data Export section of Settings.
  Phase 19. REQUIREMENTS 12.10, 21.1. ARCHITECTURE §10 "Export and untrusted data".

  One row per file in the app-data folder, with its size, whether REP JOT owns
  the name, and a **Download** button. The bytes come from Drive and reach the
  disk unchanged. This section parses nothing, so a file from a newer build, a
  half-written file, and a file the user dropped in by hand all export the same
  way: as what they are.

  A row that fails to read marks itself and leaves the other rows live. One bad
  file must not cost the user the rest of their folder, because the export is
  how they get their data off the app in the first place.

  The list is loaded on request, not on mount. Opening Settings should not
  spend a Drive round trip when the user only came to change a unit.
-->
<script lang="ts">
  import Button from './Button.svelte';
  import { buildExportList, downloadBytes, type ExportEntry } from '../../export/raw-export';
  import type { DriveAdapter } from '../../drive/drive-interface';

  let { drive = null }: { drive?: DriveAdapter | null } = $props();

  /** The rows. Empty until the first refresh. */
  let entries = $state<ExportEntry[]>([]);
  /** True while the catalog list is in flight. */
  let listing = $state(false);
  /** Catalog-level failure text. Empty means nothing to report. */
  let listError = $state('');
  /** True once a list has landed, so the empty state reads correctly. */
  let loaded = $state(false);
  /** Per-row failure text by Drive file ID. Other rows stay usable. */
  let rowErrors = $state<Record<string, string>>({});
  /** File IDs whose download is in flight. */
  let pendingIds = $state<Record<string, boolean>>({});

  /** Load the folder listing. */
  async function refresh(): Promise<void> {
    if (drive === null || listing) return;
    listing = true;
    listError = '';
    try {
      const catalog = await drive.listCatalog();
      entries = buildExportList(catalog);
      loaded = true;
    } catch {
      listError = 'REP JOT could not read the file list. Try again.';
    } finally {
      listing = false;
    }
  }

  /**
   * Read one file and hand it to the browser.
   *
   * The bytes go straight from the read into the download. Nothing decodes
   * them, so a file that is not valid UTF-8 saves as the bytes Drive holds
   * instead of coming back full of replacement characters. A failure marks
   * only this row.
   */
  async function downloadOne(entry: ExportEntry): Promise<void> {
    if (drive === null || pendingIds[entry.driveFileId] === true) return;
    pendingIds = { ...pendingIds, [entry.driveFileId]: true };
    const nextErrors = { ...rowErrors };
    delete nextErrors[entry.driveFileId];
    rowErrors = nextErrors;
    try {
      const content = await drive.readFile(entry.driveFileId);
      downloadBytes(entry.downloadName, content.bytes, 'application/json');
    } catch {
      rowErrors = {
        ...rowErrors,
        [entry.driveFileId]: 'REP JOT could not read this file. Try again.'
      };
    } finally {
      const done = { ...pendingIds };
      delete done[entry.driveFileId];
      pendingIds = done;
    }
  }

  /** A short, readable byte count. No locale call, so it renders the same everywhere. */
  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${String(bytes)} B`;
    const kb = bytes / 1024;
    if (kb < 1024) return `${kb.toFixed(1)} KB`;
    return `${(kb / 1024).toFixed(1)} MB`;
  }
</script>

<div class="settings-section" role="region" aria-label="Data Export">
  <h2 class="settings-section__title">Data Export</h2>

  {#if drive === null}
    <p class="settings-section__empty">
      REP JOT has no Drive folder to read on this device.
    </p>
  {:else}
    <p class="settings-section__hint">
      Download the files REP JOT keeps in your private Google Drive folder.
      Each file saves exactly as Drive holds it.
    </p>

    <div class="settings-section__actions">
      <Button variant="secondary" disabled={listing} onclick={() => void refresh()}>
        {listing ? 'Reading…' : 'Refresh file list'}
      </Button>
    </div>

    {#if listError !== ''}
      <p class="settings-section__error" role="alert">{listError}</p>
    {/if}

    {#if loaded && entries.length === 0}
      <p class="settings-section__empty">The folder is empty.</p>
    {:else if entries.length > 0}
      <ul class="export-list">
        {#each entries as entry (entry.driveFileId)}
          <li class="export-row">
            <span class="export-row__name">{entry.downloadName}</span>
            <span class="export-row__meta">
              <span class="export-row__size">{formatSize(entry.size)}</span>
              {#if entry.recognized}
                <span class="badge badge--outline export-row__flag">REP JOT file</span>
              {:else}
                <span class="badge badge--outline export-row__flag">Not a REP JOT file</span>
              {/if}
            </span>
            <div class="export-row__actions">
              <Button
                variant="secondary"
                disabled={pendingIds[entry.driveFileId] === true}
                onclick={() => void downloadOne(entry)}
              >
                {pendingIds[entry.driveFileId] === true ? 'Preparing…' : 'Download'}
              </Button>
            </div>
            {#if rowErrors[entry.driveFileId] !== undefined}
              <p class="export-row__error" role="alert">{rowErrors[entry.driveFileId]}</p>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</div>
