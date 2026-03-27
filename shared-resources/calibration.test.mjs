import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const calibrationPath = path.join(__dirname, 'calibration.js');
let calibrationContent = fs.readFileSync(calibrationPath, 'utf8');

// Strip the problematic import.meta line for Node.js testing
calibrationContent = calibrationContent.replace(
  /const ZIP_LIBRARY_URL = typeof import\.meta !== 'undefined' && import\.meta\.url\s+\? new URL\('\.\/vendor\/fflate\.mjs', import\.meta\.url\)\.href\s+: null;/,
  "const ZIP_LIBRARY_URL = null;"
);

const tempCalibrationPath = path.join(__dirname, 'calibration.test.temp.mjs');
fs.writeFileSync(tempCalibrationPath, calibrationContent);

try {
  const pkg = await import('./calibration.test.temp.mjs');
  const { slugify } = pkg;

  test('slugify', async (t) => {
    await t.test('converts simple strings to lowercase and replaces non-alphanumeric with hyphens', () => {
      assert.strictEqual(slugify('Hello World'), 'hello-world');
      assert.strictEqual(slugify('Test String'), 'test-string');
    });

    await t.test('handles special characters by replacing them with hyphens', () => {
      const res = slugify('Greeting @ Universe!');
      assert.ok(res.startsWith('greeting-universe'), `Expected start with greeting-universe, got ${res}`);

      const res2 = slugify('Item #456');
      assert.ok(res2.startsWith('item-456'), `Expected start with item-456, got ${res2}`);

      const res3 = slugify('user_profile');
      assert.ok(res3.startsWith('user-profile'), `Expected start with user-profile, got ${res3}`);
    });

    await t.test('collapses multiple hyphens and trims hyphens from ends', () => {
      const res = slugify('  Goodbye   World  ');
      assert.ok(res.startsWith('goodbye-world'), `Expected start with goodbye-world, got ${res}`);

      const res2 = slugify('---Goodbye---World---');
      assert.ok(res2.startsWith('goodbye-world'), `Expected start with goodbye-world, got ${res2}`);

      const res3 = slugify('Goodbye---World');
      assert.ok(res3.startsWith('goodbye-world'), `Expected start with goodbye-world, got ${res3}`);
    });

    await t.test('normalizes accented characters', () => {
      const res = slugify('résumé');
      assert.ok(res.startsWith('resume'), `Expected start with resume, got ${res}`);

      const res2 = slugify('Köln');
      assert.ok(res2.startsWith('koln'), `Expected start with koln, got ${res2}`);

      const res3 = slugify('façade');
      assert.ok(res3.startsWith('facade'), `Expected start with facade, got ${res3}`);
    });

    await t.test('replaces currency symbols with text', () => {
      const res = slugify('20€');
      assert.ok(res.startsWith('20eur'), `Expected start with 20eur, got ${res}`);

      const res2 = slugify('100£');
      assert.ok(res2.startsWith('100gbp'), `Expected start with 100gbp, got ${res2}`);

      const res3 = slugify('10$');
      assert.ok(res3.startsWith('10usd'), `Expected start with 10usd, got ${res3}`);
    });

    await t.test('returns fallback for empty or non-string inputs', () => {
      assert.strictEqual(slugify(''), 'object');
      assert.strictEqual(slugify(null), 'object');
      assert.strictEqual(slugify(undefined), 'object');
      assert.strictEqual(slugify('', 'custom-fallback'), 'custom-fallback');
    });

    await t.test('ensures uniqueness within a session using slugRegistry', () => {
      const base = 'Unique' + Date.now();
      const first = slugify(base);
      const second = slugify(base);
      const third = slugify(base);

      const expectedBase = base.toLowerCase();
      assert.strictEqual(first, expectedBase);
      assert.strictEqual(second, `${expectedBase}-2`);
      assert.strictEqual(third, `${expectedBase}-3`);
    });
  });
} finally {
  // fs.unlinkSync(tempCalibrationPath);
}
