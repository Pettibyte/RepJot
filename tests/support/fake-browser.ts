/**
 * In-memory browser stand-in for the authorization tests.
 *
 * The auth modules read `window` and `document` directly, so each test installs
 * one fake browser, runs, and uninstalls it.
 */

export class MemoryStorage implements Storage {
  private values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.values.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

export interface FakeElement {
  action: string;
  method: string;
  name: string;
  target: string;
  title: string;
  type: string;
  value: string;
  style: { display: string };
  children: FakeElement[];
  appendChild: (child: FakeElement) => void;
  remove: () => void;
  submit: () => void;
}

export interface FakeBrowser {
  assignedUrl: string;
  replacedUrl: string;
  location: {
    href: string;
    pathname: string;
    search: string;
    hash: string;
    replace: (url: string) => void;
  };
  sessionStorage: MemoryStorage;
  localStorage: MemoryStorage;
  submittedForm: FakeElement | null;
  removedElementCount: number;
  /** Event listeners the fake window holds, by type. */
  eventListeners: Record<string, Array<() => void>>;
}

export function installFakeBrowser(route = '#/settings'): FakeBrowser {
  const sessionStorage = new MemoryStorage();
  const localStorage = new MemoryStorage();
  const browser: FakeBrowser = {
    assignedUrl: '',
    replacedUrl: '',
    location: {
      href: `https://repjot.com/${route}`,
      pathname: '/',
      search: '',
      hash: route,
      replace: (url: string): void => {
        browser.assignedUrl = url;
      }
    },
    sessionStorage,
    localStorage,
    submittedForm: null,
    removedElementCount: 0,
    eventListeners: {}
  };

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      crypto: globalThis.crypto,
      location: browser.location,
      sessionStorage,
      localStorage,
      history: {
        replaceState: (_state: unknown, _title: string, url: string): void => {
          browser.replacedUrl = url;
          browser.location.hash = url.includes('#') ? url.slice(url.indexOf('#')) : '';
        }
      },
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
      // Event listener registry. The hash router subscribes here, and a test
      // can fire a type by walking `eventListeners`.
      eventListeners: browser.eventListeners,
      addEventListener: (type: string, listener: () => void): void => {
        const list = browser.eventListeners[type] ?? [];
        list.push(listener);
        browser.eventListeners[type] = list;
      },
      removeEventListener: (type: string, listener: () => void): void => {
        const list = browser.eventListeners[type] ?? [];
        browser.eventListeners[type] = list.filter(
          (item: () => void): boolean => item !== listener
        );
      }
    }
  });
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      title: 'REP JOT',
      createElement: (): FakeElement => {
        const element: FakeElement = {
          action: '',
          method: '',
          name: '',
          target: '',
          title: '',
          type: '',
          value: '',
          style: { display: '' },
          children: [],
          appendChild: (child: FakeElement): void => {
            element.children.push(child);
          },
          remove: (): void => {
            browser.removedElementCount += 1;
          },
          submit: (): void => {
            browser.submittedForm = element;
          }
        };
        return element;
      },
      body: { appendChild: (): void => undefined }
    }
  });
  return browser;
}

export function uninstallFakeBrowser(): void {
  delete (globalThis as { window?: unknown }).window;
  delete (globalThis as { document?: unknown }).document;
}

/** Read the `state` parameter out of a redirect URL. */
export function authorizationState(url: string): string {
  return new URL(url).searchParams.get('state') ?? '';
}

/** Build a Google implicit-flow response fragment. */
export function responseFragment(options: {
  state: string;
  accessToken?: string;
  scope?: string;
  expiresIn?: string;
  tokenType?: string;
}): string {
  const parts = [
    `access_token=${options.accessToken ?? 'test-token'}`,
    `token_type=${options.tokenType ?? 'Bearer'}`,
    `expires_in=${options.expiresIn ?? '3600'}`,
    `scope=${encodeURIComponent(options.scope ?? 'https://www.googleapis.com/auth/drive.appdata')}`,
    `state=${options.state}`
  ];
  return `#${parts.join('&')}`;
}
