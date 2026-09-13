import 'fake-indexeddb/auto';

import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'bun:test';
import { IDBObjectStore } from 'fake-indexeddb';
import { AppError, isAppError } from '../src/domain/errors';
import { baseKey, cacheKey, pendingKey, type LocalStore } from '../src/storage/local-store';
import { createIndexedDbLocalStore } from '../src/storage/indexeddb-local-store';
import { createLocalStore } from '../src/storage/create-local-store';
import { createMemoryLocalStore } from '../src/storage/memory-local-store';

/** Unique account key per store, so one test cannot read another test's rows. */
let accountSeq = 0;
function nextAccountKey(): string {
  accountSeq += 1;
  return `acct-${accountSeq}`;
}

/** Reject helper: returns the thrown value instead of failing the test. */
async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => null,
    (cause: unknown) => cause
  );
}

/** The two engines behind the same contract. */
const engines: Array<[string, () => Promise<LocalStore>]> = [
  ['indexeddb', async () => createIndexedDbLocalStore(nextAccountKey())],
  ['memory', async () => createMemoryLocalStore()]
];

describe('key helpers', () => {
  test('each helper adds its own prefix', () => {
    expect(cacheKey('preferences.json')).toBe('doc:preferences.json');
    expect(baseKey('preferences.json')).toBe('base:preferences.json');
    expect(pendingKey('results-2026-09.json')).toBe('pending:results-2026-09.json');
  });

  test('the three keys for one logical name never collide', () => {
    const keys = new Set([cacheKey('a'), baseKey('a'), pendingKey('a')]);
    expect(keys.size).toBe(3);
  });
});

for (const [engineName, makeStore] of engines) {
  describe(`LocalStore (${engineName})`, () => {
    test('set then get round-trips a value', async () => {
      const store = await makeStore();
      const value = { logicalName: 'preferences.json', contentText: '{"format":"repjot"}' };

      await store.set(cacheKey('preferences.json'), value);
      const read = await store.get(cacheKey('preferences.json'));

      expect(read).toEqual(value);
    });

    test('get on a missing key resolves undefined', async () => {
      const store = await makeStore();

      expect(await store.get('doc:absent.json')).toBeUndefined();
    });

    test('set replaces a previous value', async () => {
      const store = await makeStore();

      await store.set('doc:x.json', { v: 1 });
      await store.set('doc:x.json', { v: 2 });

      expect(await store.get('doc:x.json')).toEqual({ v: 2 });
    });

    test('delete removes the key', async () => {
      const store = await makeStore();

      await store.set('doc:x.json', { v: 1 });
      await store.delete('doc:x.json');

      expect(await store.get('doc:x.json')).toBeUndefined();
    });

    test('delete on a missing key is not an error', async () => {
      const store = await makeStore();

      expect(await rejection(store.delete('doc:never-written.json'))).toBeNull();
    });

    test('setMany commits all entries when the transaction succeeds', async () => {
      const store = await makeStore();

      await store.setMany([
        { name: cacheKey('preferences.json'), value: { kind: 'cached' } },
        { name: baseKey('preferences.json'), value: { kind: 'base' } },
        { name: pendingKey('preferences.json'), value: { kind: 'pending' } }
      ]);

      expect(await store.get(cacheKey('preferences.json'))).toEqual({ kind: 'cached' });
      expect(await store.get(baseKey('preferences.json'))).toEqual({ kind: 'base' });
      expect(await store.get(pendingKey('preferences.json'))).toEqual({ kind: 'pending' });
    });

    test('setMany with one failing put leaves no entry from that call readable', async () => {
      const store = await makeStore();
      // A function cannot be structured-cloned, so the middle put fails.
      const badValue = (): number => 1;

      const cause = await rejection(
        store.setMany([
          { name: 'doc:first.json', value: { v: 1 } },
          { name: 'doc:second.json', value: badValue },
          { name: 'doc:third.json', value: { v: 3 } }
        ])
      );

      expect(cause).toBeInstanceOf(Error);
      expect(await store.get('doc:first.json')).toBeUndefined();
      expect(await store.get('doc:second.json')).toBeUndefined();
      expect(await store.get('doc:third.json')).toBeUndefined();
    });

    test('a failed setMany does not roll back an earlier committed write', async () => {
      const store = await makeStore();

      await store.set('doc:keep.json', { kept: true });
      await rejection(store.setMany([{ name: 'doc:drop.json', value: (): number => 0 }]));

      expect(await store.get('doc:keep.json')).toEqual({ kept: true });
    });

    test('setMany with no entries succeeds', async () => {
      const store = await makeStore();

      expect(await rejection(store.setMany([]))).toBeNull();
    });
  });
}

describe('createIndexedDbLocalStore', () => {
  test('two account keys produce two separate namespaces', async () => {
    const accountA = nextAccountKey();
    const accountB = nextAccountKey();
    const storeA = await createIndexedDbLocalStore(accountA);
    const storeB = await createIndexedDbLocalStore(accountB);

    await storeA.set(cacheKey('preferences.json'), { owner: 'A' });

    expect(await storeA.get(cacheKey('preferences.json'))).toEqual({ owner: 'A' });
    expect(await storeB.get(cacheKey('preferences.json'))).toBeUndefined();
  });

  test('each account key opens its own database named repjot-<accountKey>', async () => {
    const accountKey = nextAccountKey();
    await createIndexedDbLocalStore(accountKey);

    const names = (await indexedDB.databases()).map((entry) => entry.name);
    expect(names).toContain(`repjot-${accountKey}`);
  });

  test('a stubbed QuotaExceededError surfaces as AppError storage with reason quota', async () => {
    const store = await createIndexedDbLocalStore(nextAccountKey());
    const original = IDBObjectStore.prototype.put;
    (IDBObjectStore.prototype as unknown as Record<string, unknown>).put = () => {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    };

    try {
      const cause = await rejection(store.set('doc:preferences.json', { v: 1 }));

      expect(isAppError(cause)).toBe(true);
      expect((cause as AppError).kind).toBe('storage');
      expect((cause as AppError).detail.reason).toBe('quota');
    } finally {
      (IDBObjectStore.prototype as unknown as Record<string, unknown>).put = original;
    }
  });

  test('a quota failure inside setMany keeps the earlier value for the untouched key', async () => {
    const store = await createIndexedDbLocalStore(nextAccountKey());
    await store.set('doc:preferences.json', { v: 'before' });

    const original = IDBObjectStore.prototype.put;
    (IDBObjectStore.prototype as unknown as Record<string, unknown>).put = function (
      this: IDBObjectStore,
      value: unknown,
      key?: IDBValidKey
    ) {
      // The pending write fails. The cached write for the same save must not land.
      if (key === 'pending:preferences.json') {
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      }
      return original.call(this, value, key);
    };

    try {
      const cause = await rejection(
        store.setMany([
          { name: 'doc:preferences.json', value: { v: 'after' } },
          { name: 'pending:preferences.json', value: { delta: 1 } }
        ])
      );

      expect(isAppError(cause)).toBe(true);
      expect((cause as AppError).detail.reason).toBe('quota');
      expect(await store.get('doc:preferences.json')).toEqual({ v: 'before' });
    } finally {
      (IDBObjectStore.prototype as unknown as Record<string, unknown>).put = original;
    }
  });
});

describe('createMemoryLocalStore', () => {
  test('a stored value is isolated from the caller object', async () => {
    const store = createMemoryLocalStore();
    const value: { v: number } = { v: 1 };

    await store.set('doc:x.json', value);
    value.v = 99;

    expect(await store.get('doc:x.json')).toEqual({ v: 1 });
  });
});

describe('memory store clone on a host without structuredClone (F1)', () => {
  // Run in a fresh Bun process. Module caching would hide the case these tests
  // exist to catch: the targeted Silk 80 browser has no native
  // `structuredClone` (Chrome 80 base; the API arrived in Chrome 98), so the
  // memory engine must work without it.
  const projectRoot = new URL('..', import.meta.url).pathname;

  /** Run one Bun process and return its exit code and output. */
  function runBun(script: string): { code: number; out: string; err: string } {
    const proc = Bun.spawnSync(['bun', '-e', script], { cwd: projectRoot });
    return { code: proc.exitCode ?? -1, out: proc.stdout.toString(), err: proc.stderr.toString() };
  }

  const stripNative = 'delete globalThis.structuredClone;';

  test('the store works with no native structuredClone and no polyfill', () => {
    const { code, out, err } = runBun(
      `${stripNative}
       const { createMemoryLocalStore } = await import('./src/storage/memory-local-store.ts');
       const store = createMemoryLocalStore();
       await store.set('doc:prefs.json', { nested: [1, 2] });
       await store.setMany([{ name: 'base:prefs.json', value: { a: 1 } }]);
       console.log(JSON.stringify(await store.get('doc:prefs.json')));
       console.log(JSON.stringify(await store.get('base:prefs.json')));
       console.log(String(await store.get('doc:absent.json')));`
    );

    expect(err).toBe('');
    expect(code).toBe(0);
    expect(out).toContain('{"nested":[1,2]}');
    expect(out).toContain('{"a":1}');
    expect(out).toContain('undefined');
  });

  test('a value with no JSON form is refused when there is no native structuredClone', () => {
    const { code, out } = runBun(
      `${stripNative}
       const { createMemoryLocalStore } = await import('./src/storage/memory-local-store.ts');
       const store = createMemoryLocalStore();
       try {
         await store.set('doc:prefs.json', () => 1);
         console.log('unexpected-success');
       } catch (error) {
         console.log('refused:' + error.detail.reason);
       }`
    );

    expect(code).toBe(0);
    expect(out).toContain('refused:not_cloneable');
    expect(out).not.toContain('unexpected-success');
  });

  test('the app carries no structuredClone polyfill, so the fallback stays load-bearing', () => {
    // A `core-js/actual/structured-clone` import measures at about 25 KB of the
    // bundle for a path the targeted device never takes. If someone adds it
    // back, this test says so and the fallback above can be dropped on purpose.
    const polyfills = readFileSync(new URL('../src/polyfills.ts', import.meta.url), 'utf8');
    expect(polyfills).not.toContain('structured-clone');
  });
});

describe('account key validation (F5)', () => {
  const badKeys: Array<[string, string]> = [
    ['empty', ''],
    ['whitespace', '   '],
    ['too long', 'a'.repeat(65)],
    ['path separator', 'acct/1']
  ];

  for (const [label, key] of badKeys) {
    test(`createIndexedDbLocalStore rejects the ${label} key`, async () => {
      const cause = await rejection(createIndexedDbLocalStore(key));

      expect(isAppError(cause)).toBe(true);
      expect((cause as AppError).kind).toBe('storage');
      expect((cause as AppError).detail.reason).toBe('invalid_account_key');
    });

    test(`createLocalStore rejects the ${label} key`, async () => {
      const cause = await rejection(createLocalStore(key));

      expect(isAppError(cause)).toBe(true);
      expect((cause as AppError).detail.reason).toBe('invalid_account_key');
    });
  }

  test('a valid key is accepted', async () => {
    const store = await createIndexedDbLocalStore('acct_1.2-3');

    expect(await rejection(store.set('doc:x.json', { v: 1 }))).toBeNull();
  });
});

describe('missing IndexedDB host (F3)', () => {
  test('createIndexedDbLocalStore rejects with AppError storage no_indexeddb', async () => {
    const native = globalThis.indexedDB;
    delete (globalThis as { indexedDB?: unknown }).indexedDB;

    try {
      const cause = await rejection(createIndexedDbLocalStore(nextAccountKey()));

      expect(isAppError(cause)).toBe(true);
      expect((cause as AppError).kind).toBe('storage');
      expect((cause as AppError).detail.reason).toBe('no_indexeddb');
    } finally {
      (globalThis as { indexedDB?: unknown }).indexedDB = native;
    }
  });

  test('createLocalStore returns the IndexedDB engine when IndexedDB is present', async () => {
    const accountKey = nextAccountKey();
    const store = await createLocalStore(accountKey);
    await store.set('doc:prefs.json', { engine: 'indexeddb' });

    const names = (await indexedDB.databases()).map((entry) => entry.name);
    expect(names).toContain(`repjot-${accountKey}`);
    expect(await store.get('doc:prefs.json')).toEqual({ engine: 'indexeddb' });
  });

  test('createLocalStore returns the memory engine when IndexedDB is absent', async () => {
    const native = globalThis.indexedDB;
    delete (globalThis as { indexedDB?: unknown }).indexedDB;
    const accountKey = nextAccountKey();

    try {
      const store = await createLocalStore(accountKey);
      await store.set('doc:prefs.json', { engine: 'memory' });

      expect(await store.get('doc:prefs.json')).toEqual({ engine: 'memory' });
      const names = (await native.databases()).map((entry) => entry.name);
      expect(names).not.toContain(`repjot-${accountKey}`);
    } finally {
      (globalThis as { indexedDB?: unknown }).indexedDB = native;
    }
  });
});

describe('connection reuse (F4)', () => {
  test('two factory calls with one account key open one connection', async () => {
    const accountKey = nextAccountKey();
    const open = indexedDB.open.bind(indexedDB);
    let openCalls = 0;
    (indexedDB as unknown as { open: IDBFactory['open'] }).open = (...args: Parameters<IDBFactory['open']>) => {
      openCalls += 1;
      return open(...args);
    };

    try {
      const first = await createIndexedDbLocalStore(accountKey);
      const second = await createIndexedDbLocalStore(accountKey);

      expect(openCalls).toBe(1);
      await first.set('doc:x.json', { v: 1 });
      expect(await second.get('doc:x.json')).toEqual({ v: 1 });
    } finally {
      (indexedDB as unknown as { open: IDBFactory['open'] }).open = open;
    }
  });

  test('a version change releases the held connection so the next call opens fresh', async () => {
    const accountKey = nextAccountKey();
    const open = indexedDB.open.bind(indexedDB);
    const opened: IDBDatabase[] = [];
    (indexedDB as unknown as { open: IDBFactory['open'] }).open = (...args: Parameters<IDBFactory['open']>) => {
      const request = open(...args);
      request.addEventListener('success', () => opened.push(request.result));
      return request;
    };

    try {
      const first = await createIndexedDbLocalStore(accountKey);
      await first.set('doc:x.json', { v: 1 });
      expect(opened.length).toBe(1);

      // Fire the handler the engine fires on a `DB_VERSION` bump.
      opened[0].onversionchange?.(new Event('versionchange'));

      const second = await createIndexedDbLocalStore(accountKey);
      expect(opened.length).toBe(2);
      await second.set('doc:y.json', { v: 2 });
      expect(await second.get('doc:y.json')).toEqual({ v: 2 });
      expect(await second.get('doc:x.json')).toEqual({ v: 1 });
    } finally {
      (indexedDB as unknown as { open: IDBFactory['open'] }).open = open;
    }
  });

  test('two different account keys still open two databases', async () => {
    const keyA = nextAccountKey();
    const keyB = nextAccountKey();
    const open = indexedDB.open.bind(indexedDB);
    let openCalls = 0;
    (indexedDB as unknown as { open: IDBFactory['open'] }).open = (...args: Parameters<IDBFactory['open']>) => {
      openCalls += 1;
      return open(...args);
    };

    try {
      const storeA = await createIndexedDbLocalStore(keyA);
      const storeB = await createIndexedDbLocalStore(keyB);
      await storeA.set('doc:x.json', { owner: 'A' });

      expect(openCalls).toBe(2);
      expect(await storeB.get('doc:x.json')).toBeUndefined();
    } finally {
      (indexedDB as unknown as { open: IDBFactory['open'] }).open = open;
    }
  });
});
