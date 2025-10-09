(function (global, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    const namespace = factory();
    Object.assign(global, { VisualAngle: namespace });
  }
})(typeof self !== 'undefined' ? self : this, function () {
  const DEG_PER_RAD = 180 / Math.PI;
  const RAD_PER_DEG = Math.PI / 180;

  function normalizeReference(reference) {
    if (!reference || typeof reference !== 'object') {
      throw new TypeError('A reference object with mmPerPixel and viewingDistanceMm is required.');
    }
    const mmPerPixel = Number(reference.mmPerPixel);
    const viewingDistanceMm = Number(reference.viewingDistanceMm);
    if (!Number.isFinite(mmPerPixel) || mmPerPixel <= 0) {
      throw new RangeError('Reference.mmPerPixel must be a positive number.');
    }
    if (!Number.isFinite(viewingDistanceMm) || viewingDistanceMm <= 0) {
      throw new RangeError('Reference.viewingDistanceMm must be a positive number.');
    }
    return { mmPerPixel, viewingDistanceMm };
  }

  function pixelsToMillimeters(pixels, reference) {
    const { mmPerPixel } = normalizeReference(reference);
    return Number(pixels) * mmPerPixel;
  }

  function millimetersToPixels(mm, reference) {
    const { mmPerPixel } = normalizeReference(reference);
    return Number(mm) / mmPerPixel;
  }

  function millimetersToDVA(mm, reference) {
    const { viewingDistanceMm } = normalizeReference(reference);
    const half = Number(mm) / 2;
    return 2 * Math.atan(half / viewingDistanceMm) * DEG_PER_RAD;
  }

  function dvaToMillimeters(dva, reference) {
    const { viewingDistanceMm } = normalizeReference(reference);
    const radians = Number(dva) * RAD_PER_DEG;
    return 2 * viewingDistanceMm * Math.tan(radians / 2);
  }

  function pixelsToDVA(pixels, reference) {
    return millimetersToDVA(pixelsToMillimeters(pixels, reference), reference);
  }

  function dvaToPixels(dva, reference) {
    return millimetersToPixels(dvaToMillimeters(dva, reference), reference);
  }

  function createReference({ mmPerPixel, viewingDistanceMm }) {
    return normalizeReference({ mmPerPixel, viewingDistanceMm });
  }

  return {
    createReference,
    pixelsToDVA,
    dvaToPixels,
    pixelsToMillimeters,
    millimetersToPixels,
    millimetersToDVA,
    dvaToMillimeters
  };
});
