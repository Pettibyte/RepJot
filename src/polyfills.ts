// Svelte 5 uses replaceAll while creating DOM templates. Silk 80 does not expose it.
import 'core-js/actual/string/replace-all';

import { secureUuid } from './domain/ids';

// Silk 80 has no crypto.randomUUID. Back it with secureUuid so no insecure
// random path remains. ARCHITECTURE C-09.
function installRandomUuidPolyfill(): void {
  const browserCrypto: Crypto | undefined = globalThis.crypto;
  if (
    browserCrypto === undefined ||
    typeof browserCrypto.getRandomValues !== 'function' ||
    typeof browserCrypto.randomUUID === 'function'
  ) {
    return;
  }

  try {
    Object.defineProperty(browserCrypto, 'randomUUID', {
      configurable: true,
      value: (): string => secureUuid()
    });
  } catch {
    // Callers use secureUuid directly if this host object cannot be extended.
  }
}

installRandomUuidPolyfill();
