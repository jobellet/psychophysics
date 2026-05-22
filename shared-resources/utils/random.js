/**
 * Returns a cryptographically secure random float between 0 (inclusive) and 1 (exclusive).
 * @returns {number}
 */
export function secureRandom() {
  const array = new Uint32Array(1);
  crypto.getRandomValues(array);
  return array[0] / (0xffffffff + 1);
}

if (typeof window !== 'undefined') {
  window.secureRandom = secureRandom;
}
