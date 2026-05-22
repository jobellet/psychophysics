import test from 'node:test';
import assert from 'node:assert';
import { secureRandom } from './random.js';

test('secureRandom returns a number between 0 and 1', () => {
  const result = secureRandom();
  assert.ok(typeof result === 'number');
  assert.ok(result >= 0 && result < 1);
});

test('secureRandom returns different values on consecutive calls', () => {
  const values = new Set();
  for (let i = 0; i < 100; i++) {
    values.add(secureRandom());
  }
  // While there's a mathematically non-zero chance of collision,
  // it's practically zero for 100 iterations of 32-bit randoms.
  assert.ok(values.size > 1);
});
