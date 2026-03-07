const test = require('node:test');
const assert = require('node:assert');
const VisualAngle = require('./visual-angle.js');

test('VisualAngle.pixelsToDVA', async (t) => {
  const reference = {
    mmPerPixel: 0.25,
    viewingDistanceMm: 500
  };

  await t.test('converts pixels to DVA correctly', () => {
    // 50 pixels * 0.25 mm/pixel = 12.5 mm
    // angle = 2 * atan(12.5 / (2 * 500)) * (180 / PI)
    // angle = 2 * atan(0.0125) * (180 / PI) approx 1.4323
    const pixels = 50;
    const expectedDVA = 2 * Math.atan((pixels * reference.mmPerPixel / 2) / reference.viewingDistanceMm) * (180 / Math.PI);
    const result = VisualAngle.pixelsToDVA(pixels, reference);
    assert.strictEqual(typeof result, 'number');
    assert.ok(Math.abs(result - expectedDVA) < 1e-10);
  });

  await t.test('returns 0 for 0 pixels', () => {
    const result = VisualAngle.pixelsToDVA(0, reference);
    assert.strictEqual(result, 0);
  });

  await t.test('handles numeric strings', () => {
    const result = VisualAngle.pixelsToDVA("50", reference);
    const expectedDVA = 2 * Math.atan((50 * reference.mmPerPixel / 2) / reference.viewingDistanceMm) * (180 / Math.PI);
    assert.ok(Math.abs(result - expectedDVA) < 1e-10);
  });
});

test('VisualAngle.dvaToPixels', async (t) => {
  const reference = {
    mmPerPixel: 0.25,
    viewingDistanceMm: 500
  };

  await t.test('converts DVA to pixels correctly', () => {
    const dva = 2;
    // mm = 2 * 500 * tan( (2 * PI/180) / 2 )
    // pixels = mm / 0.25
    const expectedPixels = (2 * reference.viewingDistanceMm * Math.tan((dva * Math.PI / 180) / 2)) / reference.mmPerPixel;
    const result = VisualAngle.dvaToPixels(dva, reference);
    assert.ok(Math.abs(result - expectedPixels) < 1e-10);
  });

  await t.test('round trip pixels -> DVA -> pixels', () => {
    const initialPixels = 100;
    const dva = VisualAngle.pixelsToDVA(initialPixels, reference);
    const finalPixels = VisualAngle.dvaToPixels(dva, reference);
    assert.ok(Math.abs(initialPixels - finalPixels) < 1e-10);
  });
});

test('VisualAngle.normalizeReference', async (t) => {
  await t.test('throws for missing or invalid reference object', () => {
    const invalidReferences = [null, undefined, 'string', 123, true];
    for (const ref of invalidReferences) {
      assert.throws(() => VisualAngle.pixelsToDVA(10, ref), {
        name: 'TypeError',
        message: 'A reference object with mmPerPixel and viewingDistanceMm is required.'
      });
    }
  });

  await t.test('throws for non-positive mmPerPixel', () => {
    const invalidValues = [0, -1, NaN, Infinity, -Infinity, 'invalid'];
    for (const val of invalidValues) {
      assert.throws(() => VisualAngle.pixelsToDVA(10, { mmPerPixel: val, viewingDistanceMm: 500 }), {
        name: 'RangeError',
        message: 'Reference.mmPerPixel must be a positive number.'
      });
    }
  });

  await t.test('throws for non-positive viewingDistanceMm', () => {
    const invalidValues = [0, -1, NaN, Infinity, -Infinity, 'invalid'];
    for (const val of invalidValues) {
      assert.throws(() => VisualAngle.pixelsToDVA(10, { mmPerPixel: 0.25, viewingDistanceMm: val }), {
        name: 'RangeError',
        message: 'Reference.viewingDistanceMm must be a positive number.'
      });
    }
  });

  await t.test('normalizes numeric strings correctly', () => {
    // using createReference since it calls normalizeReference and returns the object
    const ref = VisualAngle.createReference({ mmPerPixel: '0.25', viewingDistanceMm: '500' });
    assert.strictEqual(ref.mmPerPixel, 0.25);
    assert.strictEqual(ref.viewingDistanceMm, 500);
  });

  await t.test('normalizes valid reference object correctly', () => {
    const ref = VisualAngle.createReference({ mmPerPixel: 0.25, viewingDistanceMm: 500, extraProperty: 'ignored' });
    assert.strictEqual(ref.mmPerPixel, 0.25);
    assert.strictEqual(ref.viewingDistanceMm, 500);
    assert.strictEqual(ref.extraProperty, undefined);
  });
});
