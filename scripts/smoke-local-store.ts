// Scripted smoke for the local store façade. Run with `bun run smoke:store`.
//
// Both engines get the same three-call script: one `setMany` with the cached,
// base, and pending records, one read-back, and one failing `setMany` that must
// leave nothing behind. REQUIREMENTS 3.14.
//
// To repeat the same check by hand in a browser, run `bun run dev`, open the
// page, and paste this into the developer console:
//
//   const idb = await (await import('/src/storage/indexeddb-local-store.ts'))
//     .createIndexedDbLocalStore('console-smoke');
//   await idb.setMany([
//     { name: 'doc:preferences.json', value: { ok: true } },
//     { name: 'base:preferences.json', value: { ok: true } },
//     { name: 'pending:preferences.json', value: { ok: true } }
//   ]);
//   console.log('idb cached:', await idb.get('doc:preferences.json'));
//
//   const mem = (await import('/src/storage/memory-local-store.ts'))
//     .createMemoryLocalStore();
//   await mem.setMany([{ name: 'doc:preferences.json', value: { ok: true } }]);
//   console.log('memory cached:', await mem.get('doc:preferences.json'));
//
// The IndexedDB line needs a real browser because IndexedDB is a browser API.
// This script stands in for that browser with `fake-indexeddb`.

import 'fake-indexeddb/auto';

import { baseKey, cacheKey, pendingKey, type LocalStore } from '../src/storage/local-store';
import { createIndexedDbLocalStore } from '../src/storage/indexeddb-local-store';
import { createMemoryLocalStore } from '../src/storage/memory-local-store';

/** Records that failed the script. */
const failures: string[] = [];

/** Check one condition and print the result. */
function check(label: string, passed: boolean): void {
  console.log(`${passed ? 'ok  ' : 'FAIL'} ${label}`);
  if (!passed) failures.push(label);
}

/** Run the shared script against one engine. */
async function smoke(name: string, store: LocalStore): Promise<void> {
  await store.setMany([
    { name: cacheKey('preferences.json'), value: { role: 'cached' } },
    { name: baseKey('preferences.json'), value: { role: 'base' } },
    { name: pendingKey('preferences.json'), value: { role: 'pending' } }
  ]);

  const cached = (await store.get(cacheKey('preferences.json'))) as { role?: string } | undefined;
  const base = (await store.get(baseKey('preferences.json'))) as { role?: string } | undefined;
  const pending = (await store.get(pendingKey('preferences.json'))) as { role?: string } | undefined;

  check(`${name}: setMany wrote the cached record`, cached?.role === 'cached');
  check(`${name}: setMany wrote the base record`, base?.role === 'base');
  check(`${name}: setMany wrote the pending record`, pending?.role === 'pending');

  await store.delete(cacheKey('preferences.json'));
  check(`${name}: delete removed the cached record`, (await store.get(cacheKey('preferences.json'))) === undefined);

  // The middle value cannot be cloned, so this call must fail as a whole.
  let rejected = false;
  try {
    await store.setMany([
      { name: 'doc:rollback-a.json', value: { v: 1 } },
      { name: 'doc:rollback-b.json', value: () => 1 },
      { name: 'doc:rollback-c.json', value: { v: 3 } }
    ]);
  } catch {
    rejected = true;
  }
  check(`${name}: failing setMany rejected`, rejected);
  check(
    `${name}: failing setMany left no entry readable`,
    (await store.get('doc:rollback-a.json')) === undefined &&
      (await store.get('doc:rollback-b.json')) === undefined &&
      (await store.get('doc:rollback-c.json')) === undefined
  );
}

const indexedStore = await createIndexedDbLocalStore('smoke-account');
await smoke('indexeddb', indexedStore);
await smoke('memory', createMemoryLocalStore());

// Two accounts must not see each other's rows.
const otherAccount = await createIndexedDbLocalStore('smoke-other-account');
check(
  'indexeddb: a second account key sees no rows from the first',
  (await otherAccount.get(baseKey('preferences.json'))) === undefined
);

if (failures.length > 0) {
  console.error(`\nsmoke failed: ${failures.length} check(s)`);
  process.exit(1);
}
console.log('\nlocal store smoke passed.');
