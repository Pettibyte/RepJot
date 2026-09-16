<!--
  The Delete All User Data confirmation.
  Phase 19. REQUIREMENTS 21.3, 21.4. ARCHITECTURE ADR-018.

  The gate is a typed phrase. Typing `DELETE ALL USER DATA` is a deliberate
  speed bump on an action that removes a person's whole workout history, and
  the exact-match rule means a fast tap cannot clear it.

  The copy is honest about what the delete does and does not do. Another
  device that still holds a signed-in session and pending edits writes these
  files back on its next sync, so the page says that, and says not to sync
  other devices afterward. The word "irreversible" does not appear here in
  any form: it would claim a guarantee the app cannot keep. REQUIREMENTS 21.4.

  The dialog is a panel inside the Danger Zone, not a modal overlay. The
  design system bans `position: fixed` under `src/ui/`, and a Kindle page
  that cannot scroll a modal is a page the user cannot finish.

  The typed gate is component state and is verified by hand. See
  `docs/implementation/PHASE-19-MANUAL-TESTS.md`. This build has no DOM test
  harness, so an automated typing test would need one added for a single rule.
-->
<script lang="ts">
  import Button from './Button.svelte';
  import Field from './Field.svelte';
  import { DELETE_PHRASE, matchesDeletePhrase } from './delete-phrase';

  let {
    recognizedCount = 0,
    deletedCount = 0,
    busy = false,
    errorText = '',
    helpHref = '',
    onconfirm = (): void => {},
    oncancel = (): void => {}
  }: {
    /** How many recognized files the delete will target. */
    recognizedCount?: number;
    /** How many the running delete has already removed. */
    deletedCount?: number;
    /** True while the delete runs. Locks both buttons. */
    busy?: boolean;
    /** Failure text from the last attempt. Empty means nothing to report. */
    errorText?: string;
    /** Link the user can finish the job from, when one exists. */
    helpHref?: string;
    /** Run the delete. Called only with the phrase typed. */
    onconfirm?: () => void;
    /** Close the dialog without deleting. */
    oncancel?: () => void;
  } = $props();

  /** What the user has typed. The gate reads this. */
  let typed = $state('');

  /**
   * The gate. True only when the typed text matches the phrase exactly.
   *
   * The comparison is strict and case-sensitive. `delete all user data` and
   * `DELETE ALL USER DATA ` with a stray trailing space both fail, so the
   * user types the phrase on purpose rather than near it.
   */
  const phraseMatches = $derived(matchesDeletePhrase(typed));

  /** Submit the delete when, and only when, the gate is open. */
  function submit(): void {
    if (!phraseMatches || busy) return;
    onconfirm();
  }

  /** Count text. One file reads differently from several. */
  const countText = $derived(
    recognizedCount === 0
      ? 'REP JOT found no files to delete.'
      : `This deletes ${String(recognizedCount)} ${
          recognizedCount === 1 ? 'file' : 'files'
        } from your Google Drive folder.`
  );

  /** Progress line. Empty until a delete is under way. */
  const progressText = $derived(
    busy && deletedCount > 0
      ? `Removed ${String(deletedCount)} of ${String(recognizedCount)}.`
      : ''
  );
</script>

<div class="danger-confirm" role="region" aria-label="Delete All User Data">
  <h3 class="danger-confirm__title">Delete All User Data</h3>

  <p class="danger-confirm__count">{countText}</p>

  <p class="danger-confirm__warning">
    Another device that still has REP JOT open, or that still holds edits it
    has not sent yet, can put these files back the next time it syncs. Do not
    sync your other devices after you delete. To be sure the data is gone,
    disconnect every other device first.
  </p>

  <Field
    id="delete-phrase"
    label={`Type ${DELETE_PHRASE} to confirm`}
    bind:value={typed}
    autocomplete="off"
    disabled={busy}
    hint="Capital letters and spaces must match."
  />

  {#if progressText !== ''}
    <p class="danger-confirm__count" role="status">{progressText}</p>
  {/if}

  {#if errorText !== ''}
    <p class="danger-confirm__error" role="alert">{errorText}</p>
  {/if}

  {#if helpHref !== ''}
    <div class="danger-confirm__actions">
      <Button variant="secondary" href={helpHref}>Open Google Account connections</Button>
    </div>
  {/if}

  <div class="danger-confirm__actions">
    <Button variant="secondary" disabled={busy} onclick={oncancel}>Cancel</Button>
    <Button
      variant="danger"
      disabled={!phraseMatches || busy}
      onclick={submit}
    >
      {busy ? 'Deleting…' : 'Delete all user data'}
    </Button>
  </div>
</div>
