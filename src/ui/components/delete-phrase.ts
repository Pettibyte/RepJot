// The typed confirmation phrase for Delete All User Data.
// Phase 19. REQUIREMENTS 21.3. ARCHITECTURE ADR-018.
//
// This lives outside the component on purpose. A Svelte 5 component in runes
// mode cannot export a constant from its instance script, and the phrase needs
// one home that the dialog, the screen, and the tests all read. A plain module
// is that home. `src/ui/components/data-error-types.ts` is the same pattern.
//
// The value is case-sensitive and space-sensitive. The gate compares the typed
// text with `===`, so a lowercase or padded phrase does not open it.

/** The exact phrase the user must type before the delete button enables. */
export const DELETE_PHRASE = 'DELETE ALL USER DATA';

/**
 * True when `text` matches the confirmation phrase exactly.
 *
 * No trim, no case fold. The rule is exact equality, so the helper stays a
 * one-line mirror of what the dialog enforces and both read the same way.
 */
export function matchesDeletePhrase(text: string): boolean {
  return text === DELETE_PHRASE;
}
