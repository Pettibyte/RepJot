function randomBytes(): Uint8Array {
  const bytes = new Uint8Array(16);
  const browserCrypto: Crypto | undefined = globalThis.crypto;

  if (browserCrypto !== undefined && typeof browserCrypto.getRandomValues === 'function') {
    browserCrypto.getRandomValues(bytes);
    return bytes;
  }

  // The UUID is only a multipart boundary, not a credential or security token.
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Math.floor(Math.random() * 256);
  }
  return bytes;
}

function byteToHex(value: number): string {
  return (value + 0x100).toString(16).slice(1);
}

function uuidFromBytes(bytes: Uint8Array): string {
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, byteToHex).join('');

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function installRandomUuidPolyfill(): void {
  const browserCrypto: Crypto | undefined = globalThis.crypto;
  if (
    browserCrypto === undefined ||
    typeof browserCrypto.randomUUID === 'function' ||
    typeof browserCrypto.getRandomValues !== 'function'
  ) {
    return;
  }

  try {
    Object.defineProperty(browserCrypto, 'randomUUID', {
      configurable: true,
      value: (): string => uuidFromBytes(randomBytes())
    });
  } catch {
    // Drive still uses randomUuid directly if this host object cannot be extended.
  }
}

export function randomUuid(): string {
  const browserCrypto: Crypto | undefined = globalThis.crypto;
  if (browserCrypto !== undefined && typeof browserCrypto.randomUUID === 'function') {
    return browserCrypto.randomUUID();
  }
  return uuidFromBytes(randomBytes());
}
