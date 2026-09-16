// The client-mode mount surface.
//
// `mount` and `flushSync` are not reachable through the `svelte` package entry
// under `bun test`, because that entry resolves to the server build. The paths
// below point at the client runtime inside the installed package. They are
// relative to this file so the harness does not hardcode an absolute path.

// @ts-expect-error -- The client runtime is not in the package exports map.
import { mount, unmount } from '../../node_modules/svelte/src/internal/client/render.js';
// @ts-expect-error -- Same. `flushSync` lives in the batch module.
import { flushSync } from '../../node_modules/svelte/src/internal/client/reactivity/batch.js';

export { mount, unmount, flushSync };

/**
 * Let queued microtasks run.
 *
 * A save is fire-and-forget in several places, so a test that checks the world
 * right after a tap can pass while nothing has landed. Await this before
 * asserting on Drive calls. See the Phase 19 audit note on vacuous tests.
 */
export async function settle(times: number = 8): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await Promise.resolve();
  }
}
