if (typeof globalThis.crypto === 'undefined') {
  const { webcrypto } = await import('node:crypto');

  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
    configurable: true,
  });
}
