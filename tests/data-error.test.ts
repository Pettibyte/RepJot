import { afterEach, describe, expect, test } from 'bun:test';
import DataError from '../src/ui/components/DataError.svelte';
import {
  dataErrorIdentity,
  type DataErrorProps
} from '../src/ui/components/data-error-types';
import { openRawJson } from '../src/routing/open-raw-json';
import type { Router } from '../src/routing/hash-router';
import { setRouter } from '../src/routing/router-registry';
import type { Route } from '../src/routing/routes';
import {
  clearRawPayloads,
  getRawPayload,
  putRawPayload,
  rawPayloadCount
} from '../src/state/raw-payload-store';
import { html } from './support/render';

/** A router that records navigations instead of touching a browser. */
function recordingRouter(): { router: Router; calls: Route[] } {
  const calls: Route[] = [];
  const router = {
    current: () => ({ subscribe: () => () => {} }),
    navigate: (route: Route): void => {
      calls.push(route);
    },
    start: (): void => {},
    stop: (): void => {}
  };
  return { router: router as unknown as Router, calls };
}

afterEach(() => {
  setRouter(null);
  clearRawPayloads();
});

describe('DataError card', () => {
  test('renders the title always', () => {
    const out = html(DataError, { props: { title: 'This file will not open.', rawJson: '{}' } });
    expect(out).toContain('This file will not open.');
  });

  test('renders family, declared version, and max supported version when present', () => {
    const props: DataErrorProps = {
      title: 'This file uses a newer schema.',
      family: 'results-shard',
      declaredVersion: 9,
      maxSupportedVersion: 4,
      rawJson: '{"format":"repjot/results","schemaVersion":9}'
    };
    const out = html(DataError, { props });

    expect(out).toContain('Family');
    expect(out).toContain('results-shard');
    expect(out).toContain('Declared version');
    expect(out).toContain('9');
    expect(out).toContain('Max supported version');
    expect(out).toContain('4');
  });

  test('omits the version rows when the card carries no versions', () => {
    const out = html(DataError, {
      props: { title: 'A stored result points at data that no longer exists.', rawJson: '{}' }
    });
    expect(out).not.toContain('Declared version');
    expect(out).not.toContain('Max supported version');
  });

  test('shows the safe detail text', () => {
    const out = html(DataError, {
      props: { title: 'Broken file.', detail: 'The body is not valid JSON.', rawJson: 'x' }
    });
    expect(out).toContain('The body is not valid JSON.');
  });

  test('both actions carry visible text', () => {
    const out = html(DataError, { props: { title: 'Broken file.', rawJson: '{"a":1}' } });
    expect(out).toContain('View Raw JSON');
    expect(out).toContain('Dismiss');
  });

  test('hides the raw action when there are no bytes to show', () => {
    const out = html(DataError, { props: { title: 'No raw text here.', rawJson: '' } });
    expect(out).not.toContain('View Raw JSON');
    expect(out).toContain('Dismiss');
  });

  test('the card is a live alert region', () => {
    const out = html(DataError, { props: { title: 'Broken file.', rawJson: '{}' } });
    expect(out).toContain('role="alert"');
  });
});

// A host that reuses one card and swaps `props` must show the new problem. The
// identity string is what the card keys its hidden state to, so it has to change
// whenever the reported item changes. REQUIREMENTS 6.10, ADR-017.
describe('dataErrorIdentity', () => {
  const BASE: DataErrorProps = {
    title: 'This file will not open.',
    family: 'results-shard',
    declaredVersion: 4,
    maxSupportedVersion: 4,
    rawJson: '{"a":1}'
  };

  test('equal props produce the same identity', () => {
    expect(dataErrorIdentity(BASE)).toBe(dataErrorIdentity({ ...BASE }));
  });

  test('a changed title produces a different identity', () => {
    expect(dataErrorIdentity({ ...BASE, title: 'Another file.' })).not.toBe(
      dataErrorIdentity(BASE)
    );
  });

  test('a changed family produces a different identity', () => {
    expect(dataErrorIdentity({ ...BASE, family: 'preferences' })).not.toBe(
      dataErrorIdentity(BASE)
    );
  });

  test('a changed version produces a different identity', () => {
    expect(dataErrorIdentity({ ...BASE, declaredVersion: 9 })).not.toBe(
      dataErrorIdentity(BASE)
    );
    expect(dataErrorIdentity({ ...BASE, maxSupportedVersion: 5 })).not.toBe(
      dataErrorIdentity(BASE)
    );
  });

  test('a changed raw payload produces a different identity', () => {
    expect(dataErrorIdentity({ ...BASE, rawJson: '{"b":2}' })).not.toBe(
      dataErrorIdentity(BASE)
    );
  });

  test('an omitted optional field reads as absent, not as empty text', () => {
    // Guards the `?? ''` collapse: a missing family and an empty family are the
    // same reported item, so a re-render cannot look like a new problem.
    expect(dataErrorIdentity({ title: 't', rawJson: 'r' })).toBe(
      dataErrorIdentity({ title: 't', family: '', rawJson: 'r' })
    );
  });

  test('the component keys its hidden state to the identity', async () => {
    const source = await Bun.file(
      new URL('../src/ui/components/DataError.svelte', import.meta.url)
    ).text();
    expect(source).toContain('dataErrorIdentity(props)');
    expect(source).toContain('dismissedKey');
    expect(source).not.toContain('let dismissed = $state(false)');
  });
});

describe('View Raw JSON action', () => {
  test('stores the payload and navigates to the raw route with the key', () => {
    const { router, calls } = recordingRouter();
    setRouter(router);

    const raw = '{"format":"repjot/results","schemaVersion":9}';
    const key = openRawJson(raw);

    expect(key).not.toBeNull();
    expect(getRawPayload(key as string)).toBe(raw);
    expect(calls).toEqual([{ name: 'raw-json', source: key }]);
  });

  test('a second call keeps both payloads under distinct keys', () => {
    const { router } = recordingRouter();
    setRouter(router);

    const first = openRawJson('{"a":1}');
    const second = openRawJson('{"b":2}');

    expect(first).not.toBe(second);
    expect(getRawPayload(first as string)).toBe('{"a":1}');
    expect(getRawPayload(second as string)).toBe('{"b":2}');
  });

  test('with no router installed the action stores nothing', () => {
    setRouter(null);
    expect(openRawJson('{"a":1}')).toBeNull();
    expect(rawPayloadCount()).toBe(0);
  });

  test('the payload key is route-safe and never integer-like', () => {
    const { router } = recordingRouter();
    setRouter(router);

    const key = openRawJson('{"a":1}') as string;
    expect(/^[A-Za-z][A-Za-z0-9._-]*$/.test(key)).toBe(true);
    expect(/^[0-9]+$/.test(key)).toBe(false);
  });
});

describe('raw payload store', () => {
  test('an unknown key reads as undefined', () => {
    expect(getRawPayload('rp-nope')).toBeUndefined();
  });

  test('the store keeps a bounded number of payloads and drops the oldest', () => {
    const keys: string[] = [];
    for (let index = 0; index < 12; index += 1) {
      keys.push(putRawPayload(`payload-${index}`));
    }
    expect(rawPayloadCount()).toBeLessThanOrEqual(8);
    expect(getRawPayload(keys[0])).toBeUndefined();
    expect(getRawPayload(keys[keys.length - 1])).toBe('payload-11');
  });

  test('clear removes every payload', () => {
    putRawPayload('one');
    clearRawPayloads();
    expect(rawPayloadCount()).toBe(0);
  });
});

describe('raw text never reaches the page as markup', () => {
  const FILES = [
    'src/ui/components/DataError.svelte',
    'src/ui/screens/RawJsonScreen.svelte',
    'src/App.svelte'
  ];

  test('no source file sets innerHTML', async () => {
    for (const path of FILES) {
      const source = await Bun.file(new URL(`../${path}`, import.meta.url)).text();
      expect(source).not.toContain('innerHTML');
    }
  });

  test('no source file uses the Svelte raw-html tag', async () => {
    for (const path of FILES) {
      const source = await Bun.file(new URL(`../${path}`, import.meta.url)).text();
      expect(source).not.toContain('{@html');
    }
  });

  test('a payload that holds markup stays inert text in the viewer', async () => {
    const RawJsonScreen = (await import('../src/ui/screens/RawJsonScreen.svelte')).default;
    const hostile = '<img src=x onerror="alert(1)">';
    const key = putRawPayload(hostile);

    const out = html(RawJsonScreen, { source: key });

    // The bytes print as escaped text. No live `<img>` element appears.
    expect(out).toContain('&lt;img');
    expect(out).not.toContain('<img');
  });

  test('a missing payload says so instead of rendering nothing', async () => {
    const RawJsonScreen = (await import('../src/ui/screens/RawJsonScreen.svelte')).default;
    const out = html(RawJsonScreen, { source: 'rp-missing' });
    expect(out).toContain('no longer holds this payload');
  });
});
