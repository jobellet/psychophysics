// Shared calibration utilities for experiments requiring visual angle conversions.
// Provides UI management, object list loading, persistence, and state access.

const DEFAULT_OPTIONS = {
  defaultObjectId: 'credit-card',
  storageKey: 'visual-calibration',
  legacyStorageKeys: ['visual-jnd-calibration'],
  referenceDataUrl: '../shared-resources/reference-data/object-dimensions.xml',
  elements: {},
  startButton: null
};

const LEGACY_NAME_MAP = new Map([
  ['Credit / ID Card (ID-1)', ['ID-1']],
  ['€1 Coin', ['EUR-1']]
]);

const FALLBACK_CALIBRATION_ENTRIES = [
  {
    type: 'object',
    name: 'Credit / ID Card (ID-1)',
    shape: 'rect',
    lengthMm: 85.6,
    widthMm: 53.98,
    radiusMm: null,
    legacyIds: ['ID-1']
  },
  {
    type: 'object',
    name: '€1 Coin',
    shape: 'circle',
    lengthMm: 23.25,
    widthMm: 23.25,
    radiusMm: 11.625,
    legacyIds: ['EUR-1']
  }
];

const TABLE_NS = 'urn:oasis:names:tc:opendocument:xmlns:table:1.0';
const TEXT_NS = 'urn:oasis:names:tc:opendocument:xmlns:text:1.0';

const slugRegistry = new Set();

const calibrationState = {
  ready: false,
  mmPerPixel: null,
  viewingDistanceMm: null,
  reference: null,
  objectId: null,
  pixelSize: null,
  timestamp: null,
  dvaPerPixel: null
};

let options = { ...DEFAULT_OPTIONS };
let calibrationElements = {
  section: null,
  objectSelect: null,
  display: null,
  shape: null,
  slider: null,
  readout: null,
  status: null,
  confirm: null,
  viewingDistance: null,
  target: null
};

let calibrationObjects = [];
let calibrationDirty = true;
let suppressCalibrationUpdates = false;
let initPromise = null;
let startButtonElement = null;

const ZIP_LIBRARY_URL = typeof import.meta !== 'undefined' && import.meta.url
  ? new URL('./vendor/fflate.mjs', import.meta.url).href
  : null;
let zipLibraryPromise = null;

const readyListeners = new Set();

function resolveElement(name, fallbackId, overrides = {}) {
  if (overrides && overrides[name]) {
    return overrides[name];
  }
  return document.getElementById(fallbackId);
}

function assignCalibrationElements(overrides = {}) {
  calibrationElements = {
    section: resolveElement('section', 'calibration-section', overrides),
    objectSelect: resolveElement('objectSelect', 'calibration-object', overrides),
    display: resolveElement('display', 'calibration-display', overrides),
    shape: resolveElement('shape', 'calibration-shape', overrides),
    slider: resolveElement('slider', 'calibration-slider', overrides),
    readout: resolveElement('readout', 'calibration-size-readout', overrides),
    status: resolveElement('status', 'calibration-status', overrides),
    confirm: resolveElement('confirm', 'calibration-confirm', overrides),
    viewingDistance: resolveElement('viewingDistance', 'viewing-distance', overrides),
    target: resolveElement('target', 'calibration-target-info', overrides)
  };
}

function resolveZipModuleExports(mod) {
  if (!mod) return null;
  if (typeof mod.unzipSync === 'function') {
    return mod;
  }
  if (mod.default && typeof mod.default.unzipSync === 'function') {
    return { ...mod.default, ...mod };
  }
  return null;
}

async function ensureZipLibrary() {
  if (typeof ZIP_LIBRARY_URL !== 'string' || !ZIP_LIBRARY_URL) {
    throw new Error('Zip library URL is not available.');
  }
  if (zipLibraryPromise) {
    return zipLibraryPromise;
  }
  zipLibraryPromise = import(/* @vite-ignore */ ZIP_LIBRARY_URL)
    .then(resolveZipModuleExports)
    .then(mod => {
      if (!mod || typeof mod.unzipSync !== 'function') {
        throw new Error('Zip library missing unzipSync export.');
      }
      return mod;
    })
    .catch(error => {
      zipLibraryPromise = null;
      throw error;
    });
  return zipLibraryPromise;
}

function arrayBufferToUint8(buffer) {
  if (buffer instanceof Uint8Array) {
    return buffer;
  }
  return new Uint8Array(buffer);
}

async function extractXmlFromOdsBuffer(buffer) {
  const zipModule = await ensureZipLibrary();
  const data = arrayBufferToUint8(buffer);
  const archive = zipModule.unzipSync(data);
  const filenames = Object.keys(archive || {});
  const contentName = filenames.find(name => /content\.xml$/i.test(name));
  if (!contentName) {
    throw new Error('content.xml not found inside the ODS archive.');
  }
  const xmlBytes = archive[contentName];
  if (!xmlBytes) {
    throw new Error('content.xml is empty or unreadable.');
  }
  if (typeof TextDecoder !== 'undefined') {
    return new TextDecoder('utf-8').decode(xmlBytes);
  }
  if (typeof zipModule.strFromU8 === 'function') {
    return zipModule.strFromU8(xmlBytes);
  }
  throw new Error('No UTF-8 decoder available for the extracted XML.');
}

function slugify(text, fallback = 'object') {
  if (!text) {
    return fallback;
  }
  let normalized = text;
  if (typeof normalized.normalize === 'function') {
    normalized = normalized.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }
  normalized = normalized.replace(/€/g, 'eur').replace(/£/g, 'gbp').replace(/\$/g, 'usd');
  const base = normalized.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const slug = base || fallback;
  let candidate = slug;
  let counter = 2;
  while (slugRegistry.has(candidate)) {
    candidate = `${slug}-${counter++}`;
  }
  slugRegistry.add(candidate);
  return candidate;
}

function parseCalibrationObjects(selectEl) {
  if (!selectEl) return [];
  return Array.from(selectEl.options || [])
    .map(option => {
      const id = option.value;
      if (!id) {
        return null;
      }
      const shape = (option.dataset.shape || 'rect').toLowerCase();
      const lengthMm = parseFloat(option.dataset.lengthMm);
      const widthMm = parseFloat(option.dataset.widthMm);
      const radiusMm = parseFloat(option.dataset.radiusMm);
      const hasLength = Number.isFinite(lengthMm) && lengthMm > 0;
      const hasWidth = Number.isFinite(widthMm) && widthMm > 0;
      const hasRadius = Number.isFinite(radiusMm) && radiusMm > 0;
      const legacyIds = (option.dataset.legacyIds || '')
        .split(',')
        .map(value => value.trim())
        .filter(Boolean);
      let widthReferenceMm = null;
      let heightReferenceMm = null;
      let diameterMm = null;

      if (shape === 'circle') {
        if (hasRadius) {
          diameterMm = radiusMm * 2;
        } else if (hasLength) {
          diameterMm = lengthMm;
        } else if (hasWidth) {
          diameterMm = widthMm;
        }
        widthReferenceMm = diameterMm;
        heightReferenceMm = diameterMm;
      } else {
        widthReferenceMm = hasLength ? lengthMm : hasWidth ? widthMm : null;
        heightReferenceMm = hasWidth ? widthMm : hasLength ? lengthMm : null;
      }

      if (!widthReferenceMm || widthReferenceMm <= 0) {
        return null;
      }

      return {
        id,
        name: option.textContent.trim(),
        shape,
        lengthMm: hasLength ? lengthMm : null,
        widthMm: hasWidth ? widthMm : null,
        radiusMm: hasRadius ? radiusMm : null,
        diameterMm: diameterMm || (hasRadius ? radiusMm * 2 : null),
        widthReferenceMm,
        heightReferenceMm: heightReferenceMm && heightReferenceMm > 0 ? heightReferenceMm : widthReferenceMm,
        aspectRatio:
          widthReferenceMm && heightReferenceMm && heightReferenceMm > 0
            ? heightReferenceMm / widthReferenceMm
            : 1,
        legacyIds
      };
    })
    .filter(Boolean);
}

function decodeCellValue(cell) {
  if (!cell) return null;
  const textP = cell.getElementsByTagNameNS(TEXT_NS, 'p')[0];
  if (!textP) return null;
  const text = textP.textContent.trim();
  if (!text) return null;
  if (/^[-+]?\d+(?:\.\d+)?$/.test(text)) {
    return parseFloat(text);
  }
  return text;
}

function extractEntriesFromSheet(xmlText) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'text/xml');
  const table = doc.getElementsByTagNameNS(TABLE_NS, 'table')[0];
  if (!table) return [];

  const entries = [];
  const rows = Array.from(table.getElementsByTagNameNS(TABLE_NS, 'table-row'));
  rows.forEach(row => {
    const cells = Array.from(row.getElementsByTagNameNS(TABLE_NS, 'table-cell'));
    const values = cells.map(decodeCellValue);
    if (values.length < 2) return;
    const [type, name, ...rest] = values;
    if (!type || typeof type !== 'string') return;
    if (type === 'category') {
      if (typeof name === 'string' && name.trim()) {
        entries.push({ type: 'category', label: name.trim() });
      }
      return;
    }
    if (type !== 'object') return;

    const [shape, lengthMm, widthMm, radiusMm, legacyIdsRaw] = rest;
    const legacyIds = typeof legacyIdsRaw === 'string'
      ? legacyIdsRaw
          .split(',')
          .map(value => value.trim())
          .filter(Boolean)
      : [];

    entries.push({
      type: 'object',
      name: typeof name === 'string' ? name.trim() : 'Object',
      shape: typeof shape === 'string' ? shape.trim() : null,
      lengthMm: Number.isFinite(lengthMm) ? lengthMm : null,
      widthMm: Number.isFinite(widthMm) ? widthMm : null,
      radiusMm: Number.isFinite(radiusMm) ? radiusMm : null,
      legacyIds
    });
  });

  return entries;
}

function applyCalibrationEntries(entries) {
  const select = calibrationElements.objectSelect;
  if (!select) return [];
  select.innerHTML = '';
  slugRegistry.clear();

  let currentGroup = null;
  (Array.isArray(entries) ? entries : []).forEach(entry => {
    if (!entry) return;
    if (entry.type === 'category') {
      if (!entry.label) return;
      const group = document.createElement('optgroup');
      group.label = entry.label;
      select.appendChild(group);
      currentGroup = group;
      return;
    }
    if (entry.type !== 'object') {
      return;
    }
    const option = document.createElement('option');
    const name = entry.name || 'Object';
    const id = entry.id || slugify(name);
    const legacyIds = Array.isArray(entry.legacyIds)
      ? entry.legacyIds.filter(Boolean)
      : LEGACY_NAME_MAP.get(name) || [];
    const hasLength = Number.isFinite(entry.lengthMm);
    const hasWidth = Number.isFinite(entry.widthMm);
    const hasRadius = Number.isFinite(entry.radiusMm);
    const radiusPreferred =
      hasRadius &&
      (!hasLength || !hasWidth || Math.abs((entry.lengthMm || 0) - (entry.widthMm || 0)) <= Math.max(0.5, (entry.widthMm || 0) * 0.05));
    const shape = (entry.shape || (radiusPreferred ? 'circle' : 'rect')).toLowerCase();

    option.value = id;
    option.textContent = name;
    option.dataset.shape = shape;
    option.dataset.lengthMm = hasLength ? String(entry.lengthMm) : '';
    option.dataset.widthMm = hasWidth ? String(entry.widthMm) : '';
    option.dataset.radiusMm = hasRadius ? String(entry.radiusMm) : '';
    if (legacyIds.length) {
      option.dataset.legacyIds = legacyIds.join(',');
    }

    if (currentGroup) {
      currentGroup.appendChild(option);
    } else {
      select.appendChild(option);
    }
  });

  const parsed = parseCalibrationObjects(select);
  select.disabled = parsed.length === 0;
  return parsed;
}

function showCalibrationStatus(message, state = 'info') {
  if (!calibrationElements.status) return;
  calibrationElements.status.textContent = message;
  calibrationElements.status.dataset.state = state;
}

function updateCalibrationTargetInfo() {
  if (!calibrationElements.target) return;
  const obj = getSelectedCalibrationObject();
  if (!obj) {
    calibrationElements.target.textContent = '';
    return;
  }
  if (obj.shape === 'circle') {
    if (Number.isFinite(obj.diameterMm)) {
      calibrationElements.target.textContent = `Match a circle of ${obj.diameterMm.toFixed(2)} mm diameter.`;
    } else {
      calibrationElements.target.textContent = '';
    }
    return;
  }
  if (Number.isFinite(obj.widthReferenceMm) && Number.isFinite(obj.heightReferenceMm)) {
    calibrationElements.target.textContent = `Match a rectangle ${obj.widthReferenceMm.toFixed(2)} × ${obj.heightReferenceMm.toFixed(2)} mm.`;
  } else {
    calibrationElements.target.textContent = '';
  }
}

function updateCalibrationShapeFromSlider() {
  const slider = calibrationElements.slider;
  const shape = calibrationElements.shape;
  if (!slider || !shape) return;
  const value = Number(slider.value) || 0;
  shape.dataset.sizePx = String(value);
  const obj = getSelectedCalibrationObject();
  if (obj && obj.shape === 'circle') {
    shape.classList.add('circle');
    shape.style.height = `${value}px`;
  } else {
    shape.classList.remove('circle');
    const aspect = obj && Number.isFinite(obj.aspectRatio) && obj.aspectRatio > 0 ? obj.aspectRatio : 1;
    shape.style.height = `${Math.max(4, value * aspect)}px`;
  }
  shape.style.width = `${value}px`;

  if (calibrationElements.readout) {
    let text = `Width: ${Math.round(value)} px`;
    if (calibrationState.ready && calibrationState.reference && typeof VisualAngle !== 'undefined') {
      try {
        const mm = VisualAngle.pixelsToMillimeters(value, calibrationState.reference);
        const dva = VisualAngle.pixelsToDVA(value, calibrationState.reference);
        text += ` · ${mm.toFixed(1)} mm · ${dva.toFixed(2)}°`;
      } catch (error) {
        console.warn('Calibration readout conversion failed', error);
      }
    }
    calibrationElements.readout.textContent = text;
  }
}

function updateStartButtonAvailability() {
  if (!startButtonElement) return;
  startButtonElement.disabled = !calibrationState.ready;
  startButtonElement.textContent = calibrationState.ready ? 'Start experiment' : 'Calibrate to start';
}

function getVisualReference() {
  return calibrationState.ready && calibrationState.reference ? calibrationState.reference : null;
}

function describeCalibrationMessage(reference, { silent = false } = {}) {
  if (!reference) return '';
  const distanceCm = reference.viewingDistanceMm / 10;
  let message = `${silent ? 'Loaded' : 'Saved'} calibration: viewing distance ${distanceCm.toFixed(1)} cm, 1 px ≈ ${reference.mmPerPixel.toFixed(3)} mm`;
  if (typeof VisualAngle !== 'undefined') {
    try {
      const pxPerDeg = VisualAngle.dvaToPixels(1, reference);
      if (Number.isFinite(pxPerDeg)) {
        message += `, 1° ≈ ${pxPerDeg.toFixed(1)} px`;
      }
    } catch (error) {
      console.warn('Could not compute pixels per degree', error);
    }
  }
  message += '.';
  return message;
}

function persistCalibration(detail) {
  if (!detail || typeof localStorage === 'undefined') return;
  const payload = {
    mmPerPixel: detail.mmPerPixel,
    viewingDistanceMm: detail.viewingDistanceMm,
    objectId: detail.objectId,
    pixelSize: detail.pixelSize,
    timestamp: detail.timestamp
  };
  try {
    localStorage.setItem(options.storageKey, JSON.stringify(payload));
  } catch (storageError) {
    console.warn('Unable to persist calibration', storageError);
  }
}

function setCalibrationState(data, { persist = true, silent = false } = {}) {
  if (!data) return null;
  try {
    if (typeof VisualAngle === 'undefined') {
      throw new Error('VisualAngle helpers are not available.');
    }
    const reference = VisualAngle.createReference({
      mmPerPixel: data.mmPerPixel,
      viewingDistanceMm: data.viewingDistanceMm
    });
    calibrationState.mmPerPixel = reference.mmPerPixel;
    calibrationState.viewingDistanceMm = reference.viewingDistanceMm;
    calibrationState.reference = reference;
    calibrationState.objectId = data.objectId || null;
    calibrationState.pixelSize = Number.isFinite(data.pixelSize) ? data.pixelSize : null;
    calibrationState.timestamp = data.timestamp || Date.now();
    calibrationState.ready = true;
    calibrationState.dvaPerPixel = VisualAngle.pixelsToDVA(1, reference);
    calibrationDirty = false;

    if (persist) {
      persistCalibration({
        mmPerPixel: calibrationState.mmPerPixel,
        viewingDistanceMm: calibrationState.viewingDistanceMm,
        objectId: calibrationState.objectId,
        pixelSize: calibrationState.pixelSize,
        timestamp: calibrationState.timestamp
      });
    }

    updateStartButtonAvailability();
    updateCalibrationShapeFromSlider();
    const message = describeCalibrationMessage(reference, { silent });
    showCalibrationStatus(message, 'success');

    const detail = {
      mmPerPixel: calibrationState.mmPerPixel,
      viewingDistanceMm: calibrationState.viewingDistanceMm,
      dvaPerPixel: calibrationState.dvaPerPixel,
      objectId: calibrationState.objectId,
      pixelSize: calibrationState.pixelSize,
      timestamp: calibrationState.timestamp
    };
    window.visualCalibration = detail;
    window.dispatchEvent(new CustomEvent('visual-calibration-ready', { detail }));
    readyListeners.forEach(listener => {
      try {
        listener(detail);
      } catch (error) {
        console.error('Calibration listener failed', error);
      }
    });
    return reference;
  } catch (error) {
    console.error('Calibration validation failed', error);
    calibrationState.ready = false;
    calibrationState.reference = null;
    calibrationState.dvaPerPixel = null;
    if (!silent) {
      showCalibrationStatus('Calibration could not be saved. Please review the inputs.', 'error');
    }
    updateStartButtonAvailability();
    return null;
  }
}

function getCalibrationObjectById(id) {
  if (!calibrationObjects || calibrationObjects.length === 0) {
    return null;
  }
  if (!id) {
    return calibrationObjects[0] || null;
  }
  return (
    calibrationObjects.find(obj => obj.id === id) ||
    calibrationObjects.find(obj => Array.isArray(obj.legacyIds) && obj.legacyIds.includes(id)) ||
    calibrationObjects[0] ||
    null
  );
}

function getSelectedCalibrationObject() {
  const select = calibrationElements.objectSelect;
  if (!select) return null;
  return getCalibrationObjectById(select.value);
}

function applyCalibrationToUI(data) {
  const obj = data?.objectId ? getCalibrationObjectById(data.objectId) : getSelectedCalibrationObject();
  suppressCalibrationUpdates = true;
  try {
    if (obj && calibrationElements.objectSelect) {
      calibrationElements.objectSelect.value = obj.id;
    }
    updateCalibrationTargetInfo();

    if (calibrationElements.slider && Number.isFinite(data?.pixelSize)) {
      const slider = calibrationElements.slider;
      const value = Math.max(slider.min ? Number(slider.min) : 40, Math.min(Number(slider.max) || 400, data.pixelSize));
      slider.value = String(value);
    }

    if (calibrationElements.viewingDistance && Number.isFinite(data?.viewingDistanceMm)) {
      const cm = data.viewingDistanceMm / 10;
      calibrationElements.viewingDistance.value = cm % 1 === 0 ? String(cm.toFixed(0)) : String(cm.toFixed(1));
    }

    updateCalibrationShapeFromSlider();
  } finally {
    suppressCalibrationUpdates = false;
  }
}

function updateCalibrationSliderRange() {
  const slider = calibrationElements.slider;
  if (!slider) return;
  const screenMax = Math.max(window.innerWidth, window.innerHeight);
  const currentValue = Number(slider.value) || 0;
  const max = Math.max(60, Math.ceil(Math.max(screenMax, currentValue)));
  slider.min = '20';
  slider.max = String(max);
  if (Number(slider.value) > max) {
    slider.value = String(Math.round(max * 0.8));
  }
}

function loadStoredCalibration() {
  if (typeof localStorage === 'undefined') return null;
  const keys = new Set([options.storageKey, ...(options.legacyStorageKeys || [])]);
  for (const key of keys) {
    try {
      const stored = localStorage.getItem(key);
      if (!stored) continue;
      const parsed = JSON.parse(stored);
      if (parsed && Number.isFinite(parsed.mmPerPixel) && Number.isFinite(parsed.viewingDistanceMm)) {
        applyCalibrationToUI(parsed);
        setCalibrationState(parsed, { persist: key === options.storageKey, silent: true });
        return parsed;
      }
    } catch (error) {
      console.warn('Ignoring stored calibration entry', error);
    }
  }
  return null;
}

function handleCalibrationAdjustment(message) {
  if (suppressCalibrationUpdates) return;
  calibrationDirty = true;
  window.visualCalibration = null;
  window.dispatchEvent(new CustomEvent('visual-calibration-cleared'));
  showCalibrationStatus(message, 'warning');
  updateStartButtonAvailability();
}

function onCalibrationTouchStart(event) {
  if (!calibrationElements.display) return;
  if (event.touches && event.touches.length === 2) {
    event.preventDefault();
    calibrationElements.display.dataset.pinching = 'true';
    const [a, b] = event.touches;
    const dx = b.clientX - a.clientX;
    const dy = b.clientY - a.clientY;
    calibrationElements.display.dataset.pinchDistance = String(Math.hypot(dx, dy));
  }
}

function onCalibrationTouchMove(event) {
  if (!calibrationElements.display) return;
  if (event.touches && event.touches.length === 2 && calibrationElements.display.dataset.pinching === 'true') {
    event.preventDefault();
    const [a, b] = event.touches;
    const dx = b.clientX - a.clientX;
    const dy = b.clientY - a.clientY;
    const current = Math.hypot(dx, dy);
    const initial = Number(calibrationElements.display.dataset.pinchDistance) || current;
    const ratio = current / initial;
    const slider = calibrationElements.slider;
    if (slider) {
      const currentValue = Number(slider.value) || 0;
      const newValue = Math.min(Number(slider.max) || 400, Math.max(Number(slider.min) || 20, currentValue * ratio));
      suppressCalibrationUpdates = true;
      slider.value = String(newValue);
      updateCalibrationShapeFromSlider();
      suppressCalibrationUpdates = false;
      handleCalibrationAdjustment('Calibration changed. Save again to update the conversion.');
    }
    calibrationElements.display.dataset.pinchDistance = String(current);
  }
}

function onCalibrationTouchEnd() {
  if (!calibrationElements.display) return;
  calibrationElements.display.dataset.pinching = 'false';
  calibrationElements.display.dataset.pinchDistance = '';
}

async function loadCalibrationObjectOptions() {
  const select = calibrationElements.objectSelect;
  if (!select) {
    calibrationObjects = [];
    return calibrationObjects;
  }
  const previousSelection = select.value;
  select.disabled = true;

  let entries = [];
  try {
    const response = await fetch(options.referenceDataUrl, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }
    const buffer = await response.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let xmlText = '';
    const isZip = bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b;
    if (isZip) {
      xmlText = await extractXmlFromOdsBuffer(buffer);
    } else {
      if (typeof TextDecoder !== 'undefined') {
        xmlText = new TextDecoder('utf-8').decode(bytes);
      } else {
        xmlText = Array.from(bytes, byte => String.fromCharCode(byte)).join('');
      }
    }
    entries = extractEntriesFromSheet(xmlText);
    if (!entries.some(entry => entry && entry.type === 'object')) {
      throw new Error('No measurable reference objects found in the spreadsheet.');
    }
  } catch (error) {
    console.warn('Falling back to bundled reference object list for calibration.', error);
    entries = FALLBACK_CALIBRATION_ENTRIES;
  }

  const objects = applyCalibrationEntries(entries);
  calibrationObjects = objects;

  if (objects.length) {
    const preferred =
      objects.find(obj => obj.id === previousSelection) ||
      objects.find(obj => Array.isArray(obj.legacyIds) && obj.legacyIds.includes(previousSelection));
    const defaultId = options.defaultObjectId;
    const defaultObject = defaultId ? objects.find(obj => obj.id === defaultId) : null;
    const selected = preferred || defaultObject || objects[0];
    select.value = selected.id;
  } else {
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'No reference objects available';
    select.appendChild(placeholder);
  }

  select.disabled = objects.length === 0;
  updateCalibrationTargetInfo();
  updateCalibrationShapeFromSlider();

  return objects;
}

function initializeCalibration() {
  updateCalibrationSliderRange();
  updateCalibrationTargetInfo();
  updateCalibrationShapeFromSlider();
  loadStoredCalibration();
}

function bindCalibrationEvents() {
  if (calibrationElements.objectSelect) {
    calibrationElements.objectSelect.addEventListener('change', () => {
      updateCalibrationTargetInfo();
      if (!suppressCalibrationUpdates) {
        handleCalibrationAdjustment('Reference object changed. Save the calibration again.');
      }
    });
  }

  if (calibrationElements.slider) {
    calibrationElements.slider.addEventListener('input', () => {
      updateCalibrationShapeFromSlider();
      if (!suppressCalibrationUpdates) {
        handleCalibrationAdjustment('Calibration changed. Save again to update the conversion.');
      }
    });
  }

  if (calibrationElements.viewingDistance) {
    calibrationElements.viewingDistance.addEventListener('input', () => {
      if (!suppressCalibrationUpdates) {
        handleCalibrationAdjustment('Viewing distance changed. Save the calibration to continue.');
      }
    });
  }

  if (calibrationElements.display) {
    calibrationElements.display.addEventListener('touchstart', onCalibrationTouchStart, { passive: false });
    calibrationElements.display.addEventListener('touchmove', onCalibrationTouchMove, { passive: false });
    calibrationElements.display.addEventListener('touchend', onCalibrationTouchEnd);
    calibrationElements.display.addEventListener('touchcancel', onCalibrationTouchEnd);
  }

  if (calibrationElements.confirm) {
    calibrationElements.confirm.addEventListener('click', () => {
      const select = calibrationElements.objectSelect;
      const obj = getSelectedCalibrationObject();
      const shape = calibrationElements.shape;
      const slider = calibrationElements.slider;
      const distanceInput = calibrationElements.viewingDistance;

      if (!select || !obj) {
        showCalibrationStatus('Select a reference object to calibrate.', 'error');
        return;
      }

      if (!shape || !slider) {
        showCalibrationStatus('Resize the on-screen shape to match your object before saving.', 'error');
        return;
      }

      const pixelSize = Number(slider.value) || 0;
      if (!Number.isFinite(pixelSize) || pixelSize <= 0) {
        showCalibrationStatus('Resize the on-screen shape to match your object before saving.', 'error');
        return;
      }

      if (!Number.isFinite(obj.widthReferenceMm)) {
        showCalibrationStatus('The selected reference object is missing dimension information.', 'error');
        return;
      }

      if (!distanceInput) {
        showCalibrationStatus('Enter your viewing distance in centimetres before saving.', 'error');
        return;
      }

      const distanceCm = Number(distanceInput.value);
      if (!Number.isFinite(distanceCm) || distanceCm <= 0) {
        showCalibrationStatus('Enter your viewing distance in centimetres before saving.', 'error');
        return;
      }

      const mmPerPixel = obj.widthReferenceMm / pixelSize;
      const viewingDistanceMm = distanceCm * 10;

      const result = setCalibrationState(
        {
          mmPerPixel,
          viewingDistanceMm,
          objectId: obj.id,
          pixelSize,
          timestamp: Date.now()
        },
        { persist: true, silent: false }
      );

      if (result) {
        calibrationDirty = false;
        showCalibrationStatus(describeCalibrationMessage(result, { silent: false }), 'success');
      }
    });
  }
}

async function init(userOptions = {}) {
  if (initPromise) {
    return initPromise;
  }
  initPromise = (async () => {
    options = { ...DEFAULT_OPTIONS, ...userOptions };
    startButtonElement = options.startButton || null;
    assignCalibrationElements(options.elements || {});
    updateStartButtonAvailability();

    await loadCalibrationObjectOptions();
    initializeCalibration();
    bindCalibrationEvents();
    return calibrationState;
  })();

  return initPromise;
}

function getReference() {
  return getVisualReference();
}

function getState() {
  return calibrationState;
}

function onReady(listener) {
  if (typeof listener === 'function') {
    readyListeners.add(listener);
    if (calibrationState.ready) {
      try {
        listener({
          mmPerPixel: calibrationState.mmPerPixel,
          viewingDistanceMm: calibrationState.viewingDistanceMm,
          dvaPerPixel: calibrationState.dvaPerPixel,
          objectId: calibrationState.objectId,
          pixelSize: calibrationState.pixelSize,
          timestamp: calibrationState.timestamp
        });
      } catch (error) {
        console.error('Calibration listener failed', error);
      }
    }
  }
  return () => readyListeners.delete(listener);
}

function requireReady() {
  if (calibrationState.ready) {
    return Promise.resolve(calibrationState.reference);
  }
  return new Promise(resolve => {
    const off = onReady(() => {
      off();
      resolve(calibrationState.reference);
    });
  });
}

const CalibrationAPI = {
  init,
  getReference,
  getState,
  requireReady,
  onReady
};

if (typeof window !== 'undefined') {
  window.Calibration = CalibrationAPI;
}

export { init, getReference, getState, requireReady, onReady };
export default CalibrationAPI;
