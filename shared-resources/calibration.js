<script type="module">
// shared-resources/calibration.js
// Exposes a global "Calibration" used by experiment pages.
// Works entirely offline/Pages by using built-in reference objects (no ODS/fetch).

(() => {
  const DEFAULT_ENTRIES = [
    { id: 'credit-card', label: 'Credit / ID Card (ID-1)', width_mm: 85.60, height_mm: 53.98 },
    { id: 'eur-1-coin', label: '€1 coin', diameter_mm: 23.25 }
  ];

  // Persistent state object (same reference returned by getState())
  const state = {
    ready: false,
    objectId: null,
    objectLabel: null,
    // geometry
    mmPerPixel: null,
    viewingDistanceMm: null,
    dvaPerPixel: null,
    // UI bookkeeping
    _dirty: false,
    _storageKey: 'visual-calibration'
  };

  const readyListeners = new Set();

  function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }

  function degPerPixel(mmPerPixel, viewingDistanceMm) {
    // dva per pixel = 2*atan((px_mm)/(2*d_mm)) in radians, then to degrees
    // here px_mm = mmPerPixel (for 1 px); d_mm = viewingDistanceMm
    if (!mmPerPixel || !viewingDistanceMm) return null;
    const rad = 2 * Math.atan((mmPerPixel) / (2 * viewingDistanceMm));
    return rad * (180 / Math.PI);
  }

  function loadFromStorage(storageKey) {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      return parsed;
    } catch {
      return null;
    }
  }

  function saveToStorage(storageKey, data) {
    try {
      localStorage.setItem(storageKey, JSON.stringify(data));
    } catch {}
  }

  function setStatus(el, msg, kind='info') {
    if (!el) return;
    el.textContent = msg;
    el.dataset.state = kind; // "info" | "error" | "success"
  }

  function applyEntriesToSelect(select, entries) {
    if (!select) return;
    select.innerHTML = '';
    for (const e of entries) {
      const opt = document.createElement('option');
      opt.value = e.id;
      opt.textContent = e.label;
      opt.dataset.widthMm = e.width_mm ?? e.widthMm ?? '';
      opt.dataset.heightMm = e.height_mm ?? e.heightMm ?? '';
      opt.dataset.diameterMm = e.diameter_mm ?? e.diameterMm ?? '';
      select.appendChild(opt);
    }
    select.disabled = false;
  }

  function describeEntry(entry) {
    if (!entry) return '';
    if (entry.diameter_mm || entry.diameterMm) {
      const d = entry.diameter_mm ?? entry.diameterMm;
      return `Ø ${d.toFixed(2)} mm`;
    }
    const w = entry.width_mm ?? entry.widthMm;
    const h = entry.height_mm ?? entry.heightMm;
    return `${w.toFixed(2)} × ${h.toFixed(2)} mm`;
  }

  function currentEntry(entries, id) {
    return entries.find(e => e.id === id) || entries[0];
  }

  function pickDefaultId(entries, requested) {
    if (entries.some(e => e.id === requested)) return requested;
    if (entries.some(e => e.id === 'credit-card')) return 'credit-card';
    return entries[0]?.id;
  }

  function setShapeFromEntry(shapeEl, sliderEl, entry) {
    if (!shapeEl || !entry) return;
    const px = Number(sliderEl?.value ?? 200);
    if (entry.diameter_mm || entry.diameterMm) {
      // Circle by diameter
      shapeEl.classList.add('circle');
      shapeEl.style.width = `${px}px`;
      shapeEl.style.height = `${px}px`;
    } else {
      // Rectangle by width, height follows aspect ratio
      shapeEl.classList.remove('circle');
      const wmm = entry.width_mm ?? entry.widthMm;
      const hmm = entry.height_mm ?? entry.heightMm;
      const aspect = hmm / wmm;
      shapeEl.style.width = `${px}px`;
      shapeEl.style.height = `${Math.max(2, Math.round(px * aspect))}px`;
    }
  }

  function updateSizeReadout(readoutEl, sliderEl) {
    if (!readoutEl || !sliderEl) return;
    readoutEl.textContent = `${Math.round(Number(sliderEl.value))} px`;
  }

  function populateTargetInfo(targetEl, entry) {
    if (!targetEl) return;
    targetEl.textContent = describeEntry(entry);
  }

  function enableStart(startBtn, enabled) {
    if (!startBtn) return;
    startBtn.disabled = !enabled;
    if (enabled) {
      if (startBtn.dataset.defaultLabelSaved !== '1') {
        startBtn.dataset.defaultLabelSaved = '1';
        startBtn.dataset.defaultLabel = startBtn.textContent || 'Start experiment';
      }
      startBtn.textContent = startBtn.dataset.defaultLabel || 'Start experiment';
    } else {
      startBtn.textContent = 'Calibrate to start';
    }
  }

  function dispatchUpdated() {
    window.dispatchEvent(new Event('visual-calibration-updated'));
  }

  function dispatchCleared() {
    window.dispatchEvent(new Event('visual-calibration-cleared'));
  }

  async function init(options = {}) {
    const {
      defaultObjectId = 'credit-card',
      storageKey = 'visual-calibration',
      startButton = null,
      elements = {}
    } = options;

    state._storageKey = storageKey;

    const select = elements.objectSelect || document.getElementById('calibration-object');
    const display = elements.display || document.getElementById('calibration-display');
    const shape   = elements.shape   || document.getElementById('calibration-shape');
    const slider  = elements.slider  || document.getElementById('calibration-slider');
    const readout = elements.readout || document.getElementById('calibration-size-readout');
    const status  = elements.status  || document.getElementById('calibration-status');
    const confirm = elements.confirm || document.getElementById('calibration-confirm');
    const vdInput = elements.viewingDistance || document.getElementById('viewing-distance');
    const target  = elements.target  || document.getElementById('calibration-target-info');

    // Populate entries (no network)
    applyEntriesToSelect(select, DEFAULT_ENTRIES);
    const stored = loadFromStorage(storageKey);

    // Choose object
    const wantedId = pickDefaultId(DEFAULT_ENTRIES, stored?.objectId ?? defaultObjectId);
    const entry = currentEntry(DEFAULT_ENTRIES, wantedId);
    if (select) select.value = entry.id;
    populateTargetInfo(target, entry);

    // Prepare shape/slider UI
    if (slider) {
      // If we have a previous mmPerPixel + same object: set slider to match.
      if (stored?.mmPerPixel && stored?.objectId === entry.id) {
        const px = entry.diameter_mm
          ? (entry.diameter_mm / stored.mmPerPixel)
          : ((entry.width_mm / stored.mmPerPixel));
        slider.value = String(clamp(Math.round(px), Number(slider.min || 40), Number(slider.max || 400)));
      }
      updateSizeReadout(readout, slider);
    }
    setShapeFromEntry(shape, slider, entry);

    // Restore viewing distance
    if (vdInput) {
      if (stored?.viewingDistanceMm) {
        vdInput.value = String(Math.round(stored.viewingDistanceMm / 10) / 10); // mm->cm
      }
    }

    // If stored calibration complete, mark ready
    if (stored?.mmPerPixel && stored?.viewingDistanceMm) {
      state.objectId = entry.id;
      state.objectLabel = entry.label;
      state.mmPerPixel = stored.mmPerPixel;
      state.viewingDistanceMm = stored.viewingDistanceMm;
      state.dvaPerPixel = degPerPixel(state.mmPerPixel, state.viewingDistanceMm);
      state.ready = true;
      setStatus(status, 'Saved calibration: ready.', 'success');
      enableStart(startButton, true);
      readyListeners.forEach(cb => { try { cb(); } catch {} });
      dispatchUpdated();
    } else {
      state.ready = false;
      enableStart(startButton, false);
      setStatus(status, 'Calibration required before the experiment can begin.', 'info');
    }

    // Interactions
    if (select) {
      select.addEventListener('change', () => {
        const cur = currentEntry(DEFAULT_ENTRIES, select.value);
        populateTargetInfo(target, cur);
        setShapeFromEntry(shape, slider, cur);
        state._dirty = true;
        state.objectId = cur.id;
        state.objectLabel = cur.label;
        enableStart(startButton, false);
        setStatus(status, 'Adjust the shape and save calibration.', 'info');
      });
    }

    if (slider) {
      slider.addEventListener('input', () => {
        const cur = currentEntry(DEFAULT_ENTRIES, select?.value || defaultObjectId);
        setShapeFromEntry(shape, slider, cur);
        updateSizeReadout(readout, slider);
        state._dirty = true;
        enableStart(startButton, false);
        setStatus(status, 'Adjust the shape and save calibration.', 'info');
      });
    }

    // Optional: pinch/zoom on the display (simple wheel integration)
    if (display && slider) {
      display.addEventListener('wheel', (ev) => {
        ev.preventDefault();
        const step = (Number(slider.max || 400) - Number(slider.min || 40)) / 30;
        const dir = ev.deltaY < 0 ? 1 : -1;
        const next = clamp(Number(slider.value) + dir * step, Number(slider.min || 40), Number(slider.max || 400));
        slider.value = String(Math.round(next));
        slider.dispatchEvent(new Event('input', { bubbles: true }));
      }, { passive: false });
    }

    if (confirm) {
      confirm.addEventListener('click', () => {
        const cur = currentEntry(DEFAULT_ENTRIES, select?.value || defaultObjectId);
        const px = Number(slider?.value || 200);
        const vdCm = Number(vdInput?.value || 0);
        const vdMm = vdCm > 0 ? vdCm * 10 : null;

        if (!vdMm) {
          setStatus(status, 'Please enter your viewing distance in cm.', 'error');
          enableStart(startButton, false);
          return;
        }

        let mm;
        if (cur.diameter_mm) {
          mm = cur.diameter_mm;
        } else {
          mm = cur.width_mm; // We match width for rectangular object
        }
        const mpp = mm / px;

        state.objectId = cur.id;
        state.objectLabel = cur.label;
        state.mmPerPixel = mpp;
        state.viewingDistanceMm = vdMm;
        state.dvaPerPixel = degPerPixel(mpp, vdMm);
        state.ready = true;
        state._dirty = false;

        saveToStorage(storageKey, {
          objectId: state.objectId,
          mmPerPixel: state.mmPerPixel,
          viewingDistanceMm: state.viewingDistanceMm
        });

        setStatus(status, `Saved calibration: ${cur.label} @ ${px}px → ${mpp.toFixed(3)} mm/px; distance ${vdCm} cm.`, 'success');
        enableStart(startButton, true);

        // Notify listeners now that we're ready/updated
        readyListeners.forEach(cb => { try { cb(); } catch {} });
        dispatchUpdated();
      });
    }

    return true;
  }

  function onReady(cb) {
    if (typeof cb === 'function') {
      readyListeners.add(cb);
      if (state.ready) {
        try { cb(); } catch {}
      }
    }
  }

  function clear() {
    try {
      localStorage.removeItem(state._storageKey || 'visual-calibration');
    } catch {}
    state.ready = false;
    state.mmPerPixel = null;
    state.viewingDistanceMm = null;
    state.dvaPerPixel = null;
    dispatchCleared();
  }

  function getReference() {
    if (!state.ready) return null;
    return {
      mmPerPixel: state.mmPerPixel,
      viewingDistanceMm: state.viewingDistanceMm,
      dvaPerPixel: state.dvaPerPixel
    };
  }

  function getState() {
    // Return live reference (the HTML keeps a reference to this object)
    return state;
  }

  // Expose globally for pages that call Calibration.*
  const Calibration = { init, getState, getReference, onReady, clear };
  window.Calibration = Calibration;

  // Also export (module semantic)
  export { init, getState, getReference, onReady, clear };
})();
</script>
