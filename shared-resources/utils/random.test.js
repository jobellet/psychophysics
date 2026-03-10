import test from 'node:test';
import assert from 'node:assert';
import { randomBetween } from './random.js';

test('randomBetween generates values within bounds', () => {
  for (let i = 0; i < 100; i++) {
    const min = 0;
    const max = 10;
    const val = randomBetween(min, max);
    assert.ok(val >= min);
    assert.ok(val <= max);
  }

  const val2 = randomBetween(-10, -5);
  assert.ok(val2 >= -10);
  assert.ok(val2 <= -5);
});
