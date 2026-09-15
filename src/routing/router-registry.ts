// The one router instance the running app publishes.
// ARCHITECTURE ADR-001.
//
// Why a registry. A component deep in the tree needs to navigate, and the plan
// gives `DataError` one prop: the error it reports. Threading a router through
// every screen and every card to reach one button adds a prop that carries no
// meaning to those screens. The registry holds the single router that
// `bootstrap` creates, and a component reads it where it needs to navigate.
//
// The registry holds one value and `bootstrap` owns its lifetime. A test installs
// a fake router, runs, and clears it.

import type { Router } from './hash-router';

let activeRouter: Router | null = null;

/** Publish the router the app uses. Pass `null` to withdraw it. */
export function setRouter(router: Router | null): void {
  activeRouter = router;
}

/** The published router, or `null` before bootstrap installs one. */
export function getRouter(): Router | null {
  return activeRouter;
}
