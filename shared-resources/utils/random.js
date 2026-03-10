/**
 * Returns a random floating-point number between min (inclusive) and max (exclusive).
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

// Support for non-module HTML inclusion
if (typeof window !== 'undefined') {
  window.randomBetween = randomBetween;
}
