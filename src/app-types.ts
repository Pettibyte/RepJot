// The prop shapes the shell and `bootstrap` share.
// ARCHITECTURE section 9.
//
// They live in their own module so `bootstrap.ts` and `App.svelte` both import
// them without importing each other.

import type { Readable } from 'svelte/store';
import type { Route } from './routing/routes';

/** The signed-in account, as far as the shell needs to know it. */
export interface ShellAccount {
  /** The Drive account namespace key. */
  accountKey: string;
  /** Display name, when Drive supplied one. */
  displayName?: string;
}

/** What `bootstrap` passes to the shell. */
export interface ShellProps {
  /** The live route. The router publishes it; the shell only reads. */
  route: Readable<Route>;
  /** The bound account, or `null` while anonymous. */
  account: ShellAccount | null;
  /** The OAuth client id. Empty means the build has none. */
  clientId: string;
  /** Start the Google redirect. The remember choice comes from the screen. */
  onSignIn: (options: { remember: boolean }) => void;
}
