/**
 * Deploy target guard. Run before `bun run deploy`.
 *
 * The Pages checkout lives beside this repository at `../RepJot-pages`. The
 * devcontainer does not mount that path, so `bun run deploy` cannot run inside
 * it. This guard fails early with that fact instead of letting `rsync` print a
 * raw path error. See `docs/RELEASE.md` section 7.
 *
 * The guard checks for the target directory only. It does not check whether the
 * directory is a git worktree on the `gh-pages` branch. The publish runbook
 * covers that.
 */

import { existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const target = resolve(repoRoot, '../RepJot-pages');

function main(): void {
  const present = existsSync(target) && statSync(target).isDirectory();
  if (present) {
    console.log(`Deploy target present: ${target}`);
    return;
  }

  console.error(
    `Deploy target missing: ${target}\n` +
      'The Pages checkout is not mounted here, so this container cannot publish.\n' +
      'Run this on the Docker host, see docs/RELEASE.md section 7.'
  );
  process.exit(1);
}

if (import.meta.main) {
  main();
}
