import {
  init as initCalibration,
  getReference as getCalibrationReference,
  onReady as onCalibrationReady
} from '../shared-resources/calibration.js';

// Color Memory (Single Patch) – trial flow:
// fixation → random(300–500 ms) → patch 60 ms → delay random(0–1400 ms) → color wheel until response → next trial in 1000 ms

// === Tunables / defaults (also user-editable via UI) ===
const FLASH_DURATION_MS = 60;
const TARGET_ONSET_MIN_MS = 300;
const TARGET_ONSET_MAX_MS = 500;
const DELAY_AFTER_PATCH_MIN_MS = 0;
const DELAY_AFTER_PATCH_MAX_MS = 1400;
const NEXT_TRIAL_DELAY_AFTER_RESPONSE_MS = 1000;
const WHEEL_RING_INNER_FRACTION = 0.70; // inner radius relative to wheel radius (0–1)
const ERROR_TONE_FREQ = 420;
const ERROR_TONE_MS = 110;

// === Utilities ===
function $(id) { const el = document.getElementById(id); if (!el) throw new Error(`Missing #${id}`); return el; }
const introOverlay = $("intro-overlay");
const introStartBtn = $("intro-start");
const calibrationOverlay = $("calibration-overlay");
const calibrationContinueBtn = $("calibration-continue");
const experimentApp = $("experiment-app");
const stage = $("stage");
const fixationEl = $("fixation");
const patchEl = $("patch");
const wheelEl = $("wheel");
const hudTrials = $("hudTrials");
const hudCal = $("hudCal");
const calibrationSummary = $("calibration-summary");
const inputTrials = $("trials");
const inputFixDeg = $("fixDeg");
const inputPatchDeg = $("patchDeg");
const startBtn = $("start");
const stopBtn = $("stop");
const dlCsvBtn = $("dlCsv");
const dlJsonBtn = $("dlJson");
const openCalibrationBtn = $("open-calibration");

let errorAudioContext = null;
async function playErrorTone() {
  try {
    if (!errorAudioContext) errorAudioContext = new (window.AudioContext || window.webkitAudioContext)();
    const sr = errorAudioContext.sampleRate;
    const buffer = errorAudioContext.createBuffer(1, Math.floor((ERROR_TONE_MS/1000)*sr), sr);
    const data = buffer.getChannelData(0);
    const f = ERROR_TONE_FREQ;
    for (let i=0;i<data.length;i++) {
      const t = i/sr;
      const env = Math.min(1, t*60) * (1 - Math.min(1, (t*1000)/ERROR_TONE_MS));
      data[i] = Math.sin(2*Math.PI*f*t) * env * 0.6;
    }
    const src = errorAudioContext.createBufferSource();
    src.buffer = buffer;
    src.connect(errorAudioContext.destination);
    src.start();
  } catch {}
}

function randomInRange(min, max) { return min + Math.random()*(max-min); }
function clamp(v, lo, hi){ return Math.max(lo, Math.min(hi, v)); }
function format(n, d=0){ return Number(n).toFixed(d); }
function degNorm(a){ a %= 360; if (a < 0) a += 360; return a; }
function circErrorDeg(targetDeg, respDeg) {
  let d = degNorm(respDeg) - degNorm(targetDeg);
  d = ((d + 540) % 360) - 180; // shortest signed
  return d;
}

function snapToRefresh(durationMs) {
  // Try detect refresh rate; fallback 60 Hz
  let rr = 60;
  const scr = typeof window !== "undefined" ? window.screen : null;
  if (scr && Number.isFinite(scr.frameRate) && scr.frameRate > 0) rr = scr.frameRate;
  else if (window.matchMedia) {
    if (window.matchMedia('(min-refresh-rate: 120hz)').matches) rr = 120;
    else if (window.matchMedia('(min-resolution: 2dppx)').matches) rr = 120;
  }
  const frameMs = 1000/rr;
  const frames = Math.max(1, Math.round(durationMs/frameMs));
  return Math.round(frames * frameMs);
}

function downloadBlob(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

// === Calibration integration ===
async function setupCalibration() {
  try {
    await initCalibration({
      defaultObjectId: 'credit-card',
      storageKey: 'visual-calibration',
      startButton: calibrationContinueBtn,
      referenceDataUrl: '../shared-resources/reference-data/object-dimensions.xml',
      elements: {
        section: document.getElementById('calibration-section'),
        objectSelect: document.getElementById('calibration-object'),
        display: document.getElementById('calibration-display'),
        shape: document.getElementById('calibration-shape'),
        slider: document.getElementById('calibration-slider'),
        readout: document.getElementById('calibration-size-readout'),
        status: document.getElementById('calibration-status'),
        confirm: document.getElementById('calibration-confirm'),
        viewingDistance: document.getElementById('viewing-distance'),
        target: document.getElementById('calibration-target-info')
      }
    });
  } catch (error) {
    console.error('Calibration initialization failed', error);
    const statusEl = document.getElementById('calibration-status');
    if (statusEl) {
      statusEl.textContent = 'Calibration could not be initialised. Please reload the page.';
      statusEl.dataset.state = 'error';
    }
  }
}
setupCalibration();

introStartBtn.addEventListener('click', () => {
  openCalibrationScreen();
});

calibrationContinueBtn.addEventListener('click', () => {
  closeCalibrationScreen();
  updateHud();
  updateFixationPreview();
});

openCalibrationBtn.addEventListener('click', () => {
  if (!stopBtn.disabled) {
    stopBtn.click();
  }
  openCalibrationScreen();
});

onCalibrationReady(() => {
  updateHud();
  updateFixationPreview();
});

window.addEventListener('visual-calibration-cleared', () => {
  updateHud();
  updateFixationPreview();
  if (calibrationOverlay.hidden !== false) {
    openCalibrationScreen();
  }
});

function getReference() {
  const ref = getCalibrationReference();
  if (!ref || !ref.mmPerPixel || !ref.viewingDistanceMm) return null;
  return ref;
}
function dvaToPx(dva, ref) { return VisualAngle.dvaToPixels(dva, ref); }

// === Layout helpers ===
function setCirclePx(el, diameterPx) {
  el.style.width = `${diameterPx}px`;
  el.style.height = `${diameterPx}px`;
}
function show(el){ el.hidden = false; }
function hide(el){ el.hidden = true; }

function setAriaHidden(el, hiddenState) {
  if (!el) return;
  if (hiddenState) el.setAttribute('aria-hidden', 'true');
  else el.removeAttribute('aria-hidden');
}

function openCalibrationScreen() {
  hide(introOverlay);
  setAriaHidden(introOverlay, true);
  show(calibrationOverlay);
  setAriaHidden(calibrationOverlay, false);
  setAriaHidden(experimentApp, true);
  const focusTarget = document.getElementById('calibration-object');
  if (focusTarget) {
    setTimeout(() => focusTarget.focus(), 120);
  }
}

function closeCalibrationScreen() {
  hide(calibrationOverlay);
  setAriaHidden(calibrationOverlay, true);
  show(experimentApp);
  setAriaHidden(experimentApp, false);
  setTimeout(() => { try { startBtn.focus(); } catch {} }, 160);
}

function updateFixationPreview() {
  const ref = getReference() ?? { mmPerPixel: 0.25, viewingDistanceMm: 500 };
  placeFixation(ref, Number(inputFixDeg.value));
}

// === Trial engine ===
const trials = [];
let stopRequested = false;
let runningCleanup = null;

function updateHud() {
  const ref = getReference();
  hudTrials.textContent = String(trials.length);
  if (ref) {
    const pxPer1deg = VisualAngle.dvaToPixels(1, ref);
    hudCal.textContent = `Dist ${format(ref.viewingDistanceMm/10,1)} cm · 1°≈${format(pxPer1deg,1)} px · 1px≈${format(ref.mmPerPixel,3)} mm`;
    if (calibrationSummary) {
      calibrationSummary.textContent = `Viewing distance ${format(ref.viewingDistanceMm/10,1)} cm · 1°≈${format(pxPer1deg,1)} px · 1 px≈${format(ref.mmPerPixel,3)} mm`;
    }
  } else {
    hudCal.textContent = "Not calibrated";
    if (calibrationSummary) {
      calibrationSummary.textContent = "Calibrate your screen before running trials.";
    }
  }
  dlCsvBtn.disabled = trials.length === 0;
  dlJsonBtn.disabled = trials.length === 0;
}

function placeFixation(ref, dva) {
  setCirclePx(fixationEl, Math.max(2, Math.round(dvaToPx(dva, ref))));
  fixationEl.style.left = "50%"; fixationEl.style.top = "50%"; fixationEl.style.transform = "translate(-50%, -50%)";
}

function placePatch(ref, dva, hueDeg) {
  setCirclePx(patchEl, Math.max(4, Math.round(dvaToPx(dva, ref))));
  patchEl.style.background = `hsl(${degNorm(hueDeg)} 100% 50%)`;
  patchEl.style.left = "50%"; patchEl.style.top = "50%"; patchEl.style.transform = "translate(-50%, -50%)";
}

function showWheel(rotationDeg) {
  wheelEl.style.display = "block";
  // rotate VISUALLY; mapping will invert this rotation
  wheelEl.style.transform = `translate(-50%, -50%) rotate(${rotationDeg}deg)`;
}
function hideWheel() { wheelEl.style.display = "none"; }

// Returns angle (deg) around the UNROTATED screen coordinates center (0° at +x, CCW)
function angleFromCenter(clientX, clientY) {
  const rect = wheelEl.getBoundingClientRect();
  const cx = rect.left + rect.width/2;
  const cy = rect.top + rect.height/2;
  const dx = clientX - cx;
  const dy = clientY - cy;
  let ang = Math.atan2(dy, dx) * 180/Math.PI; // -180..180, 0 at +x
  if (ang < 0) ang += 360;
  return ang; // 0..360
}

function isOnRing(clientX, clientY) {
  const rect = wheelEl.getBoundingClientRect();
  const cx = rect.left + rect.width/2;
  const cy = rect.top + rect.height/2;
  const dx = clientX - cx;
  const dy = clientY - cy;
  const r = Math.hypot(dx, dy);
  const R = rect.width/2;
  const inner = R * WHEEL_RING_INNER_FRACTION;
  return r >= inner && r <= R;
}

async function runOneTrial(trialIndex) {
  const ref = getReference();
  if (!ref) throw new Error("Please calibrate first.");
  const fixDeg = Math.max(0.05, Number(inputFixDeg.value));
  const patchDeg = Math.max(0.1, Number(inputPatchDeg.value));

  // Prepare elements
  placeFixation(ref, fixDeg);
  show(fixationEl);
  hide(patchEl);
  hideWheel();

  // Sample target hue and timings
  const targetHueDeg = Math.random()*360; // uniform
  const targetOnsetDelay = randomInRange(TARGET_ONSET_MIN_MS, TARGET_ONSET_MAX_MS);
  const snappedFlash = snapToRefresh(FLASH_DURATION_MS);
  const delayAfterPatch = randomInRange(DELAY_AFTER_PATCH_MIN_MS, DELAY_AFTER_PATCH_MAX_MS);
  const wheelRotationDeg = Math.random()*360;

  let tFixOn = performance.now();
  let tPatchOn = null;
  let tPatchOff = null;
  let tWheelOn = null;
  let tResp = null;

  // Patch presentation
  const timers = { onset: null, offset: null, wheel: null };
  const clearTimers = () => {
    for (const k in timers) {
      if (timers[k]) { clearTimeout(timers[k]); timers[k] = null; }
    }
  };

  await new Promise(resolve => {
    timers.onset = setTimeout(() => {
      timers.onset = null;
      placePatch(ref, patchDeg, targetHueDeg);
      show(patchEl);
      tPatchOn = performance.now();

      timers.offset = setTimeout(() => {
        timers.offset = null;
        hide(patchEl);
        tPatchOff = performance.now();

        timers.wheel = setTimeout(() => {
          timers.wheel = null;
          tWheelOn = performance.now();
          showWheel(wheelRotationDeg);

          resolve();
        }, delayAfterPatch);
      }, snappedFlash);
    }, targetOnsetDelay);
  });

  // Response on the wheel
  let resolved = false;
  const pointerHandler = (ev) => {
    if (resolved) return;
    const e = (ev.touches && ev.touches[0]) ? ev.touches[0] : ev;
    if (!isOnRing(e.clientX, e.clientY)) {
      // soft error: ignore & beep
      ev.preventDefault();
      playErrorTone();
      return;
    }
    tResp = performance.now();
    const screenAngle = angleFromCenter(e.clientX, e.clientY);    // 0..360
    // Invert the visual rotation to get the REPORTED hue on the true wheel
    const reportedHueDeg = degNorm(screenAngle - wheelRotationDeg);

    hideWheel();
    stage.removeEventListener("pointerdown", pointerHandler);
    resolved = true;

    // Store trial
    const err = circErrorDeg(targetHueDeg, reportedHueDeg);
    trials.push({
      trial_index: trialIndex,
      timestamp_iso: new Date().toISOString(),
      fixation_diameter_deg: fixDeg,
      patch_diameter_deg: patchDeg,
      target_hue_deg: Number(targetHueDeg.toFixed(3)),
      wheel_rotation_deg: Number(wheelRotationDeg.toFixed(3)),
      response_screen_angle_deg: Number(screenAngle.toFixed(3)),
      reported_hue_deg: Number(reportedHueDeg.toFixed(3)),
      circular_error_deg: Number(err.toFixed(3)),
      delay_target_onset_ms: Math.round(targetOnsetDelay),
      flash_duration_ms: Math.round(snappedFlash),
      delay_after_patch_ms: Math.round(delayAfterPatch),
      rt_from_wheel_ms: tResp && tWheelOn ? Math.round(tResp - tWheelOn) : null
    });
    updateHud();

    // Next trial after fixed 750 ms
    setTimeout(() => {
      hide(patchEl);
      show(fixationEl);
      // fallthrough to run loop
      resolve();
    }, NEXT_TRIAL_DELAY_AFTER_RESPONSE_MS);
  };

  stage.addEventListener("pointerdown", pointerHandler);

  // Provide cleanup to outer runner (stop button)
  runningCleanup = () => {
    clearTimers();
    stage.removeEventListener("pointerdown", pointerHandler);
    hideWheel(); hide(patchEl); show(fixationEl);
  };

  // Wait until pointerHandler resolves the promise via setTimeout above
  await new Promise(resolve => {
    const check = () => {
      if (resolved) resolve();
      else setTimeout(check, 16);
    };
    check();
  });

  runningCleanup = null;
}

async function runLoop() {
  stopRequested = false;
  startBtn.disabled = true;
  stopBtn.disabled = false;
  inputTrials.disabled = true;
  inputFixDeg.disabled = true;
  inputPatchDeg.disabled = true;

  try {
    const total = Math.max(1, Math.floor(Number(inputTrials.value)));
    for (let i = 0; i < total; i++) {
      if (stopRequested) break;
      await runOneTrial(i);
    }
  } finally {
    startBtn.disabled = false;
    stopBtn.disabled = true;
    inputTrials.disabled = false;
    inputFixDeg.disabled = false;
    inputPatchDeg.disabled = false;
    hideWheel();
    show(fixationEl);
  }
}

function toCSV(rows) {
  const header = Object.keys(rows[0] ?? {}).join(",");
  const body = rows.map(r => Object.values(r).map(v => String(v)).join(",")).join("\n");
  return [header, body].join("\n");
}

// === Wire up UI ===
startBtn.addEventListener("click", async () => {
  if (!getReference()) {
    alert("Please calibrate first.");
    openCalibrationScreen();
    return;
  }
  trials.length = 0; updateHud();
  await runLoop();
});
stopBtn.addEventListener("click", () => {
  stopRequested = true;
  if (typeof runningCleanup === "function") {
    runningCleanup();
    runningCleanup = null;
  }
});

dlCsvBtn.addEventListener("click", () => {
  if (trials.length === 0) return;
  downloadBlob(`color_memory_single_${Date.now()}.csv`, toCSV(trials), "text/csv");
});
dlJsonBtn.addEventListener("click", () => {
  if (trials.length === 0) return;
  downloadBlob(`color_memory_single_${Date.now()}.json`, JSON.stringify(trials, null, 2), "application/json");
});

// Initial state
setAriaHidden(introOverlay, false);
updateHud();
updateFixationPreview();
inputFixDeg.addEventListener("input", updateFixationPreview);
inputFixDeg.addEventListener("change", updateFixationPreview);
// Ensure the wheel responds to pointer events on iPad
stage.addEventListener("touchstart", () => {}, { passive: true });
