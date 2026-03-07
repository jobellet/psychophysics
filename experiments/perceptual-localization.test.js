import test from 'node:test';
import assert from 'node:assert';
import { sampleAnnulusPointDeg } from './perceptual-localization.js';

test('sampleAnnulusPointDeg', async (t) => {
  // Store original Math.random
  const originalMathRandom = Math.random;

  // Helper to mock Math.random to return a specific sequence of values
  const mockRandom = (values) => {
    let i = 0;
    Math.random = () => {
      const val = values[i % values.length];
      i++;
      return val;
    };
  };

  t.afterEach(() => {
    // Restore Math.random after each test
    Math.random = originalMathRandom;
  });

  await t.test('returns expected structure', () => {
    const result = sampleAnnulusPointDeg(1, 5);
    assert.ok('xDeg' in result, 'Result missing xDeg');
    assert.ok('yDeg' in result, 'Result missing yDeg');
    assert.ok('rDeg' in result, 'Result missing rDeg');
    assert.ok('thetaRad' in result, 'Result missing thetaRad');
  });

  await t.test('calculates correct coordinates for a known random state (u=0.5, th=0.25)', () => {
    mockRandom([0.5, 0.25]); // u=0.5, th_random=0.25 => th = 0.5 * PI
    const rMin = 3;
    const rMax = 5;
    // Expected r: sqrt(0.5 * (25 - 9) + 9) = sqrt(0.5 * 16 + 9) = sqrt(8 + 9) = sqrt(17) ≈ 4.123
    const expectedR = Math.sqrt(17);
    const expectedTheta = 0.25 * 2 * Math.PI; // 0.5 * PI
    // Expected x: r * cos(0.5 * PI) = 0
    // Expected y: r * sin(0.5 * PI) = r

    const result = sampleAnnulusPointDeg(rMin, rMax);

    // rDeg
    assert.ok(Math.abs(result.rDeg - expectedR) < 1e-10, `Expected rDeg to be ${expectedR}, got ${result.rDeg}`);
    // thetaRad
    assert.ok(Math.abs(result.thetaRad - expectedTheta) < 1e-10, `Expected thetaRad to be ${expectedTheta}, got ${result.thetaRad}`);
    // xDeg
    assert.ok(Math.abs(result.xDeg - 0) < 1e-10, `Expected xDeg to be 0, got ${result.xDeg}`);
    // yDeg
    assert.ok(Math.abs(result.yDeg - expectedR) < 1e-10, `Expected yDeg to be ${expectedR}, got ${result.yDeg}`);
  });

  await t.test('tests inner radius bound (u=0)', () => {
    mockRandom([0, 0.5]); // u=0
    const rMin = 2;
    const rMax = 4;
    const result = sampleAnnulusPointDeg(rMin, rMax);
    assert.strictEqual(result.rDeg, rMin, 'Radius should equal rMin when Math.random() is 0');
  });

  await t.test('tests outer radius bound (u=1)', () => {
    // Note: Math.random() technically returns [0, 1), but for testing the math formula u=1 is useful
    mockRandom([1, 0.5]); // u=1
    const rMin = 2;
    const rMax = 4;
    const result = sampleAnnulusPointDeg(rMin, rMax);
    assert.ok(Math.abs(result.rDeg - rMax) < 1e-10, 'Radius should equal rMax when Math.random() is 1');
  });

  await t.test('tests theta lower bound (random()=0)', () => {
    mockRandom([0.5, 0]); // th_random = 0
    const result = sampleAnnulusPointDeg(1, 2);
    assert.strictEqual(result.thetaRad, 0, 'Theta should be 0 when Math.random() is 0');
  });

  await t.test('tests theta upper bound (random() -> 1)', () => {
    mockRandom([0.5, 0.999999999999]); // th_random almost 1
    const result = sampleAnnulusPointDeg(1, 2);
    // Almost 2 * PI
    assert.ok(Math.abs(result.thetaRad - 2 * Math.PI) < 1e-8, 'Theta should be close to 2*PI');
  });

  await t.test('edge case: rMin equals rMax', () => {
    mockRandom([0.7, 0.3]);
    const r = 5;
    const result = sampleAnnulusPointDeg(r, r);
    assert.ok(Math.abs(result.rDeg - r) < 1e-10, 'Radius should equal the provided single bound');
  });

  await t.test('edge case: rMin and rMax are 0', () => {
    mockRandom([0.5, 0.5]);
    const result = sampleAnnulusPointDeg(0, 0);
    assert.strictEqual(result.rDeg, 0, 'Radius should be 0');
    assert.strictEqual(Math.abs(result.xDeg), 0, 'x coordinate should be 0');
    assert.strictEqual(Math.abs(result.yDeg), 0, 'y coordinate should be 0');
  });
});
