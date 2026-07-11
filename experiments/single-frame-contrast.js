import { secureRandom } from '../shared-resources/utils/random.js';
import { formatTimestampForFilename } from '../shared-resources/utils/date.js';
import { downloadBlob } from '../shared-resources/utils/downloadBlob.js';

// -------------------------------------------------------------
// Constants & Configuration
// -------------------------------------------------------------

const STIM_SIZE = 256; 
const RESPONSE_WINDOW_MS = 1000;
const MIN_GAP_MS = 1000;
const MEAN_LAMBDA_MS = 3000; // Poisson average timing (3s)
const MASK_FRAMES = 5;       // Number of backward mask noise frames after stimulus

const IMAGE_FILENAMES = [
  "baby_17s.jpg", "beard_11s.jpg", "bench_02s.jpg", "bikini_08s.jpg", "binder_21s.jpg",
  "bologna_12s.jpg", "brass_knuckles_04s.jpg", "bumper_12s.jpg", "calf2_03s.jpg", "candy_bar_04s.jpg",
  "cape_07s.jpg", "chaps_04s.jpg", "cheeseburger_10s.jpg", "chute_10s.jpg", "comic_book_15s.jpg",
  "contact_lens_12s.jpg", "crayon_09s.jpg", "cummerbund_03s.jpg", "cummerbund_14s.jpg", "dip_06s.jpg",
  "doorstop_10s.jpg", "duck_09s.jpg", "ear_09s.jpg", "eclair_04s.jpg", "egg_roll_09n.jpg",
  "footbath_01s.jpg", "footprint_01b.jpg", "giraffe_06s.jpg", "gold_04s.jpg", "gorilla_13s.jpg",
  "handprint_01b.jpg", "headband_02s.jpg", "headscarf_11s.jpg", "hula_hoop_15s.jpg", "juicer1_10s.jpg",
  "kilt_01b.jpg", "leotard_05s.jpg", "license_plate_03s.jpg", "lip_balm_11s.jpg", "loincloth_01b.jpg",
  "macaroni_01b.jpg", "macaroni_14s.jpg", "marker_13s.jpg", "memory_stick_16s.jpg", "mouthpiece_02s.jpg",
  "mulberry_03s.jpg", "mullet_06s.jpg", "mustache_03s.jpg", "mustache_07s.jpg", "mustache_13s.jpg",
  "nacho_04s.jpg", "nail_04s.jpg", "nest_04s.jpg", "notepad_03s.jpg", "orange_rind_14s.jpg",
  "pancake_11s.jpg", "panther_01b.jpg", "parfait_15s.jpg", "pasta_08s.jpg", "peppermint_07s.jpg",
  "pepperoni_08s.jpg", "pig_06s.jpg", "piglet_02s.jpg", "pipe1_04s.jpg", "plaster_cast_02s.jpg",
  "pug_05s.jpg", "rack1_07s.jpg", "ramp_05s.jpg", "screen2_01b.jpg", "seesaw_12s.jpg",
  "sequin_05s.jpg", "shelf_07s.jpg", "snowball_08s.jpg", "sonogram_08s.jpg", "spam_02s.jpg",
  "splinter_11s.jpg", "springboard_13s.jpg", "spur_03s.jpg", "stiletto_06s.jpg", "stockings_12s.jpg",
  "straw2_14s.jpg", "string_cheese_04s.jpg", "suspenders_12s.jpg", "sweater_19s.jpg", "swimsuit_06s.jpg",
  "tack_03s.jpg", "tamale_06s.jpg", "tarantula_07s.jpg", "test_tube_01b.jpg", "toilet_paper_01b.jpg",
  "toothpick_11s.jpg", "torso_05s.jpg", "tube_top_12s.jpg", "turban_07s.jpg", "turf_09s.jpg",
  "videogame_01b.jpg", "visor_08s.jpg", "whistle_11s.jpg", "wig_14s.jpg", "wooden_leg_01b.jpg"
];

// Quest+ Staircase configurations
const CONTRAST_GRID = [
  0.0, 0.005, 0.01, 0.015, 0.02, 0.025, 0.03, 0.04, 0.05, 0.06, 0.07, 0.08, 0.09, 0.10,
  0.12, 0.14, 0.16, 0.18, 0.20, 0.23, 0.26, 0.30, 0.35, 0.40, 0.45, 0.50, 0.60, 0.70, 0.80, 0.90, 1.0
];

const thresholdGrid = [
  0.005, 0.01, 0.015, 0.02, 0.025, 0.03, 0.04, 0.05, 0.06, 0.07, 0.08, 0.09, 0.10,
  0.12, 0.15, 0.18, 0.22, 0.26, 0.30, 0.35, 0.40, 0.45, 0.50, 0.60, 0.70
];
const betaGrid = [1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 5.0, 6.0]; // slope
const guessGrid = [0.01, 0.03, 0.05, 0.08, 0.12, 0.18, 0.25]; // false alarm rate parameter
const lapseGrid = [0.01, 0.02, 0.03, 0.04]; // lapse rate parameter

// Weibull psychometric function for jsQuestPlus
function pWeibull(stim, alpha, beta, guess, lapse) {
  return guess + (1 - guess - lapse) * (1 - Math.exp(-Math.pow(stim / alpha, beta)));
}

// -------------------------------------------------------------
// State Management
// -------------------------------------------------------------

let loadedImages = {};
let sessionRunning = false;
let trialCount = 0;
let maxTrials = 80;
let trialDataLog = [];
let spontaneousPressCount = 0;
let spontaneousPresses = [];
let nextStimTimeoutId = null;

// Quest+ Instance
let questEngine = null;

// Gated stimulus state for render loop sequence
let stimulusState = null; 
let noiseFrameCount = 0;

// Response window tracking
let activeResponseWindow = null; 

// DOM Elements cache
const preloaderPanel = document.getElementById('preloader');
const preloaderText = document.getElementById('preloader-text');
const preloaderBar = document.getElementById('preloader-bar');
const setupPanel = document.getElementById('setup-panel');
const startBtn = document.getElementById('start-btn');
const practiceBtn = document.getElementById('practice-btn');
const arenaPanel = document.getElementById('arena-panel');
const stopBtn = document.getElementById('stop-btn');
const resultsPanel = document.getElementById('results-panel');
const restartBtn = document.getElementById('restart-btn');
const downloadCsvBtn = document.getElementById('download-csv-btn');
const downloadJsonBtn = document.getElementById('download-json-btn');
const tapTarget = document.getElementById('tap-target');

const trialCounterEl = document.getElementById('trial-counter');
const fadosCounterEl = document.getElementById('fados-counter');
const trialCountInput = document.getElementById('trial-count-input');

const canvas = document.getElementById('stimulus-canvas');
const ctx = canvas.getContext('2d', { alpha: false }); // disable alpha channel for faster rendering

// ImageData buffer for direct 400x400 pixel manipulation (160,000 pixels)
const mainImgData = ctx.createImageData(canvas.width, canvas.height);
const mainBuf = new Uint32Array(mainImgData.data.buffer);
let noiseSeed = Math.floor(Math.random() * 10000000);

// -------------------------------------------------------------
// High-Performance Noise Generation
// -------------------------------------------------------------

function generateNoiseFrame() {
  const len = mainBuf.length;
  let seed = noiseSeed;
  
  // High-speed LCG PRNG loop to set every single pixel to a random RGB value
  for (let i = 0; i < len; i++) {
    seed = (seed * 1664525 + 1013904223) | 0;
    // Set alpha to 255 (opaque), and let the random seed fill R, G, B
    mainBuf[i] = seed | 0xff000000;
  }
  noiseSeed = seed; // store seed back
  ctx.putImageData(mainImgData, 0, 0);
}

// -------------------------------------------------------------
// Preloading & Pre-decoding Stimuli
// -------------------------------------------------------------

async function preloadImages() {
  let loadedCount = 0;
  const total = IMAGE_FILENAMES.length;
  
  const promises = IMAGE_FILENAMES.map(async (filename) => {
    const path = `../assets/highly_memorable_targets/${filename}`;
    try {
      const img = await new Promise((resolve, reject) => {
        const i = new Image();
        i.src = path;
        i.onload = async () => {
          try {
            // Force browser to decode the image and cache the pixel buffer on the GPU.
            // This is absolutely critical for frame-accurate, single-frame drawing.
            if (typeof i.decode === 'function') {
              await i.decode();
            }
            resolve(i);
          } catch (err) {
            console.warn(`Asynchronous decode failed for ${filename}, falling back to onload`, err);
            resolve(i); // Fall back to resolving the image anyway
          }
        };
        i.onerror = (e) => reject(e);
      });
      loadedImages[filename] = img;
    } catch (e) {
      console.warn(`Failed to load image: ${filename}, skipping.`, e);
    } finally {
      loadedCount++;
      const pct = Math.round((loadedCount / total) * 100);
      preloaderText.textContent = `Loading & decoding stimuli: ${loadedCount}/${total}`;
      preloaderBar.style.width = `${pct}%`;
    }
  });

  await Promise.all(promises);
  
  // Transition to setup panel
  preloaderPanel.style.display = 'none';
  setupPanel.style.display = 'flex';
}

// -------------------------------------------------------------
// Quest+ Lifecycle
// -------------------------------------------------------------

function initQuestPlus() {
  questEngine = new jsQuestPlus({
    psych_func: [
      (stim, alpha, beta, guess, lapse) => pWeibull(stim, alpha, beta, guess, lapse),
      (stim, alpha, beta, guess, lapse) => 1 - pWeibull(stim, alpha, beta, guess, lapse)
    ],
    stim_samples: [CONTRAST_GRID],
    psych_samples: [thresholdGrid, betaGrid, guessGrid, lapseGrid]
  });
}

function estimateThreshold75() {
  if (!questEngine) return 0.2;
  try {
    const est = questEngine.getEstimates('mode'); // [alpha, beta, guess, lapse]
    if (Array.isArray(est) && est.length >= 4) {
      const [alpha, beta, guess, lapse] = est;
      
      const target = 0.75;
      if (guess >= target) {
        return alpha;
      }
      
      const denominator = 1 - guess - lapse;
      if (denominator <= 0) return alpha;
      
      const ratio = (target - guess) / denominator;
      if (ratio >= 1.0 || ratio <= 0.0) return alpha;
      
      const val = -Math.log(1 - ratio);
      const thr = alpha * Math.pow(val, 1 / beta);
      return Math.max(0.0, Math.min(1.0, thr));
    }
  } catch (e) {
    console.warn("Error calculating threshold", e);
  }
  
  // Fallback: raw parameter estimate
  try {
    const chosen = questEngine.getStimParams();
    return Array.isArray(chosen) ? chosen[0] : chosen;
  } catch (e) {
    return 0.2;
  }
}

// -------------------------------------------------------------
// Idle Canvas Display
// -------------------------------------------------------------

function drawIdleCanvas() {
  ctx.fillStyle = 'rgb(128, 128, 128)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  
  // Red fixation dot
  ctx.fillStyle = '#ef4444'; 
  ctx.beginPath();
  ctx.arc(canvas.width / 2, canvas.height / 2, 4, 0, 2 * Math.PI);
  ctx.fill();
}

// -------------------------------------------------------------
// Continuous Animation Render Loop (Gated Backward Masking)
// -------------------------------------------------------------

function renderLoop() {
  if (!sessionRunning) return;

  if (stimulusState) {
    if (noiseFrameCount === 0) {
      // Frame 1: draw target stimulus cleanly on solid gray background (no noise under it)
      ctx.fillStyle = 'rgb(128, 128, 128)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.save();
      ctx.globalAlpha = stimulusState.contrast;
      const dx = (canvas.width - STIM_SIZE) / 2;
      const dy = (canvas.height - STIM_SIZE) / 2;
      ctx.drawImage(stimulusState.img, dx, dy, STIM_SIZE, STIM_SIZE);
      ctx.restore();

      // Red fixation dot remains visible on top
      ctx.fillStyle = '#ef4444';
      ctx.beginPath();
      ctx.arc(canvas.width / 2, canvas.height / 2, 4, 0, 2 * Math.PI);
      ctx.fill();

      stimulusState.onsetTime = performance.now();
      noiseFrameCount = 1;
      
      // Request next frame (first backward masking noise frame)
      requestAnimationFrame(renderLoop);
    } else if (noiseFrameCount <= MASK_FRAMES) {
      // Frames 2-6 (backward masking): draw noise only, completely replacing the clean stimulus
      generateNoiseFrame();

      // Red fixation dot remains visible on top
      ctx.fillStyle = '#ef4444';
      ctx.beginPath();
      ctx.arc(canvas.width / 2, canvas.height / 2, 4, 0, 2 * Math.PI);
      ctx.fill();

      if (noiseFrameCount === 1) {
        stimulusState.offsetTime = performance.now();
        onStimulusPresented(stimulusState);
      }

      noiseFrameCount++;
      
      // Request next frame
      requestAnimationFrame(renderLoop);
    } else {
      // Frame 7: Clear canvas back to solid gray (reset is empty) and terminate render loop
      drawIdleCanvas();
      stimulusState = null;
      noiseFrameCount = 0;
    }
  } else {
    // If renderLoop runs without a valid stimulusState, clear and terminate
    drawIdleCanvas();
    noiseFrameCount = 0;
  }
}

// -------------------------------------------------------------
// Experiment Timeline
// -------------------------------------------------------------

function getNextISI() {
  // Shifted exponential distribution to model Poisson arrivals:
  // Ensures at least 1s gap and averages 3s (lambda = 3s)
  const exponentialPart = -Math.log(secureRandom()) * (MEAN_LAMBDA_MS - MIN_GAP_MS);
  return MIN_GAP_MS + exponentialPart;
}

function runNextTrial() {
  if (!sessionRunning) return;

  if (trialCount >= maxTrials) {
    endExperiment('complete');
    return;
  }

  trialCount++;
  trialCounterEl.textContent = `Trial ${trialCount} / ${maxTrials}`;

  // Select stimulus image
  const keys = Object.keys(loadedImages);
  const randomFilename = keys[Math.floor(secureRandom() * keys.length)];
  const imgObj = loadedImages[randomFilename];

  // Determine trial type & contrast level
  let trialType = 'quest';
  let contrast = 0.1;

  if (trialCount <= 2) {
    // Warm-up trials: Force 100% contrast so the user aligns attention
    trialType = 'warmup';
    contrast = 1.0;
  } else {
    const randSelect = secureRandom();
    if (randSelect < 0.10) {
      // Catch trial (alpha = 0)
      trialType = 'catch';
      contrast = 0.0;
    } else if (randSelect < 0.20) {
      // Random Probe trial (to sample psychometric curves at extremes)
      trialType = 'probe';
      const probes = [0.03, 0.08, 0.15, 0.35, 0.70, 1.0];
      contrast = probes[Math.floor(secureRandom() * probes.length)];
    } else {
      // Quest+ guided trial
      trialType = 'quest';
      try {
        const stimParams = questEngine.getStimParams();
        contrast = Array.isArray(stimParams) ? stimParams[0] : stimParams;
      } catch (e) {
        contrast = 0.15; // default fallback
      }
    }
  }

  // Ensure contrast is clean float
  contrast = Math.round(contrast * 1000) / 1000;

  // Schedule the stimulus using a Poisson interval
  const isi = getNextISI();
  
  nextStimTimeoutId = setTimeout(() => {
    if (!sessionRunning) return;

    // Queue stimulus rendering in the continuous loop
    stimulusState = {
      img: imgObj,
      contrast,
      onsetTime: null,
      offsetTime: null,
      trialIndex: trialCount,
      imageName: randomFilename,
      trialType,
      isi
    };

    // Reset frame counter and launch render loop sequence
    noiseFrameCount = 0;
    requestAnimationFrame(renderLoop);

  }, isi);
}

function onStimulusPresented(state) {
  // If this was just a practice flash, do not activate the response window
  if (state.trialType === 'practice') {
    return;
  }

  // Activate response window
  activeResponseWindow = {
    trialIndex: state.trialIndex,
    trialType: state.trialType,
    imageName: state.imageName,
    contrast: state.contrast,
    isi: state.isi,
    onsetTime: state.onsetTime,
    offsetTime: state.offsetTime,
    responded: false,
    rt: null
  };

  const currentTrialIndex = state.trialIndex;
  
  // Set timeout to close response window
  setTimeout(() => {
    // If window is still active for this trial, close it and record Miss
    if (activeResponseWindow && activeResponseWindow.trialIndex === currentTrialIndex) {
      logTrialAndProceed(false, null);
    }
  }, RESPONSE_WINDOW_MS);
}

function logTrialAndProceed(responded, rt) {
  if (!activeResponseWindow) return;

  const currentWindow = activeResponseWindow;
  activeResponseWindow = null; // deactivate

  currentWindow.responded = responded;
  currentWindow.rt = rt;
  currentWindow.correct = currentWindow.contrast > 0 ? responded : !responded;

  // Save data
  trialDataLog.push(currentWindow);

  // Update Quest+ staircase
  if (questEngine) {
    try {
      questEngine.update(currentWindow.contrast, responded ? 1 : 0);
    } catch (e) {
      console.warn("QuestEngine update skipped", e);
    }
  }

  // Loop next
  runNextTrial();
}

// -------------------------------------------------------------
// Interactive Response Controls
// -------------------------------------------------------------

function registerActionResponse() {
  if (!sessionRunning) return;

  // Flash UI button briefly
  tapTarget.classList.add('active');
  setTimeout(() => tapTarget.classList.remove('active'), 100);

  const pressTime = performance.now();

  // Check if we are inside a response window
  if (activeResponseWindow && !activeResponseWindow.responded) {
    const rt = pressTime - activeResponseWindow.onsetTime;
    logTrialAndProceed(true, rt);
  } else {
    // Spontaneous false alarm (pressed during gaps/ISI)
    spontaneousPressCount++;
    fadosCounterEl.textContent = `Presses during gaps: ${spontaneousPressCount}`;
    spontaneousPresses.push(pressTime);
  }
}

// -------------------------------------------------------------
// Results Visualization (Interactive SVG)
// -------------------------------------------------------------

function renderPsychometricPlot(estThreshold) {
  const svg = document.getElementById('psychometric-svg');
  svg.innerHTML = ''; // clear previous

  const width = 600;
  const height = 350;
  const padding = { top: 30, right: 30, bottom: 50, left: 60 };

  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  // 1. Group trial data by contrast level
  const groups = {};
  trialDataLog.forEach(t => {
    if (!groups[t.contrast]) {
      groups[t.contrast] = { count: 0, seen: 0 };
    }
    groups[t.contrast].count++;
    if (t.responded) {
      groups[t.contrast].seen++;
    }
  });

  const contrastLevels = Object.keys(groups).map(Number).sort((a, b) => a - b);
  const dataPoints = contrastLevels.map(c => ({
    contrast: c,
    seenRate: groups[c].seen / groups[c].count,
    count: groups[c].count
  }));

  const maxPoints = Math.max(...dataPoints.map(d => d.count), 1);

  // Helper scale functions
  const scaleX = (contrast) => padding.left + (contrast * chartWidth);
  const scaleY = (rate) => padding.top + ((1 - rate) * chartHeight);

  // 2. Draw axes, grid lines, and labels
  for (let i = 0; i <= 4; i++) {
    const rate = i * 0.25;
    const y = scaleY(rate);
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", padding.left);
    line.setAttribute("y1", y);
    line.setAttribute("x2", width - padding.right);
    line.setAttribute("y2", y);
    line.setAttribute("class", "grid-line");
    svg.appendChild(line);

    // Y Axis labels
    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", padding.left - 10);
    text.setAttribute("y", y + 4);
    text.setAttribute("text-anchor", "end");
    text.setAttribute("class", "axis-label");
    text.textContent = `${Math.round(rate * 100)}%`;
    svg.appendChild(text);
  }

  // X Axis labels
  const xTicks = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
  xTicks.forEach(tick => {
    const x = scaleX(tick);
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", x);
    line.setAttribute("y1", height - padding.bottom);
    line.setAttribute("x2", x);
    line.setAttribute("y2", height - padding.bottom + 5);
    line.setAttribute("class", "axis-line");
    svg.appendChild(line);

    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", text.textContent === "0.0" ? x - 5 : x);
    text.setAttribute("y", height - padding.bottom + 20);
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("class", "axis-label");
    text.textContent = tick.toFixed(1);
    svg.appendChild(text);
  });

  // Base Axes lines
  const xAxis = document.createElementNS("http://www.w3.org/2000/svg", "line");
  xAxis.setAttribute("x1", padding.left);
  xAxis.setAttribute("y1", height - padding.bottom);
  xAxis.setAttribute("x2", width - padding.right);
  xAxis.setAttribute("y2", height - padding.bottom);
  xAxis.setAttribute("class", "axis-line");
  svg.appendChild(xAxis);

  const yAxis = document.createElementNS("http://www.w3.org/2000/svg", "line");
  yAxis.setAttribute("x1", padding.left);
  yAxis.setAttribute("y1", padding.top);
  yAxis.setAttribute("x2", padding.left);
  yAxis.setAttribute("y2", height - padding.bottom);
  yAxis.setAttribute("class", "axis-line");
  svg.appendChild(yAxis);

  // Axes Title labels
  const xLabel = document.createElementNS("http://www.w3.org/2000/svg", "text");
  xLabel.setAttribute("x", padding.left + chartWidth / 2);
  xLabel.setAttribute("y", height - padding.bottom + 42);
  xLabel.setAttribute("text-anchor", "middle");
  xLabel.setAttribute("class", "axis-label");
  xLabel.setAttribute("style", "font-weight: 500; font-size: 13px; fill: var(--text);");
  xLabel.textContent = "Image Contrast (Alpha value)";
  svg.appendChild(xLabel);

  const yLabel = document.createElementNS("http://www.w3.org/2000/svg", "text");
  yLabel.setAttribute("transform", `rotate(-90, ${padding.left - 42}, ${padding.top + chartHeight / 2})`);
  yLabel.setAttribute("x", padding.left - 42);
  yLabel.setAttribute("y", padding.top + chartHeight / 2);
  yLabel.setAttribute("text-anchor", "middle");
  yLabel.setAttribute("class", "axis-label");
  yLabel.setAttribute("style", "font-weight: 500; font-size: 13px; fill: var(--text);");
  yLabel.textContent = "Proportion Seen";
  svg.appendChild(yLabel);

  // 3. Draw Fitted Weibull Curve
  try {
    const est = questEngine.getEstimates('mode');
    if (Array.isArray(est) && est.length >= 4) {
      const [alpha, beta, guess, lapse] = est;
      let pathD = "";
      
      const steps = 100;
      for (let s = 0; s <= steps; s++) {
        const xContrast = s / steps;
        const yPred = pWeibull(xContrast, alpha, beta, guess, lapse);
        const px = scaleX(xContrast);
        const py = scaleY(yPred);

        if (s === 0) {
          pathD += `M ${px} ${py}`;
        } else {
          pathD += ` L ${px} ${py}`;
        }
      }

      const curve = document.createElementNS("http://www.w3.org/2000/svg", "path");
      curve.setAttribute("d", pathD);
      curve.setAttribute("class", "fit-curve");
      svg.appendChild(curve);
    }
  } catch (e) {
    console.warn("Fitted curve rendering failed", e);
  }

  // 4. Draw Threshold indicators
  if (estThreshold != null && Number.isFinite(estThreshold)) {
    const tx = scaleX(estThreshold);
    const ty = scaleY(0.75);

    // Vertical line to X axis
    const vLine = document.createElementNS("http://www.w3.org/2000/svg", "line");
    vLine.setAttribute("x1", tx);
    vLine.setAttribute("y1", ty);
    vLine.setAttribute("x2", tx);
    vLine.setAttribute("y2", height - padding.bottom);
    vLine.setAttribute("class", "threshold-marker");
    svg.appendChild(vLine);

    // Horizontal line to Y axis
    const hLine = document.createElementNS("http://www.w3.org/2000/svg", "line");
    hLine.setAttribute("x1", padding.left);
    hLine.setAttribute("y1", ty);
    hLine.setAttribute("x2", tx);
    hLine.setAttribute("y2", ty);
    hLine.setAttribute("class", "threshold-marker");
    svg.appendChild(hLine);

    // Threshold indicator circle
    const tCircle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    tCircle.setAttribute("cx", tx);
    tCircle.setAttribute("cy", ty);
    tCircle.setAttribute("r", 5);
    tCircle.setAttribute("fill", "#f43f5e");
    svg.appendChild(tCircle);

    // Threshold label text
    const tText = document.createElementNS("http://www.w3.org/2000/svg", "text");
    tText.setAttribute("x", tx + 8);
    tText.setAttribute("y", ty - 8);
    tText.setAttribute("class", "threshold-label");
    tText.textContent = `Thr: ${estThreshold.toFixed(3)}`;
    svg.appendChild(tText);
  }

  // 5. Draw Empirical Data Points
  dataPoints.forEach(p => {
    const px = scaleX(p.contrast);
    const py = scaleY(p.seenRate);
    const radius = 3.5 + 7.5 * (p.count / maxPoints);

    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", px);
    circle.setAttribute("cy", py);
    circle.setAttribute("r", radius);
    circle.setAttribute("class", "data-point");
    
    const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
    title.textContent = `Contrast: ${p.contrast.toFixed(3)}\nSeen Rate: ${Math.round(p.seenRate * 100)}%\nTrials: ${p.count}`;
    circle.appendChild(title);
    
    svg.appendChild(circle);
  });
}

// -------------------------------------------------------------
// Application Lifecycle
// -------------------------------------------------------------

function startExperiment() {
  maxTrials = parseInt(trialCountInput.value) || 80;
  trialCount = 0;
  trialDataLog = [];
  spontaneousPressCount = 0;
  spontaneousPresses = [];
  activeResponseWindow = null;
  stimulusState = null;
  noiseFrameCount = 0;

  initQuestPlus();

  setupPanel.style.display = 'none';
  arenaPanel.style.display = 'flex';

  trialCounterEl.textContent = `Trial 1 / ${maxTrials}`;
  fadosCounterEl.textContent = `Presses during gaps: 0`;

  sessionRunning = true;
  
  // Schedule first trial
  runNextTrial();
}

function endExperiment(reason = 'stopped') {
  if (!sessionRunning) return;
  sessionRunning = false;

  // Clear pending timers
  if (nextStimTimeoutId) {
    clearTimeout(nextStimTimeoutId);
    nextStimTimeoutId = null;
  }
  activeResponseWindow = null;
  stimulusState = null;
  noiseFrameCount = 0;

  // Draw static grey screen with fixation dot
  drawIdleCanvas();

  // Hide arena, show results
  arenaPanel.style.display = 'none';
  resultsPanel.style.display = 'flex';

  const estThreshold = estimateThreshold75();
  
  // Calculate Catch Trial false alarm rate
  const catchTrials = trialDataLog.filter(t => t.trialType === 'catch');
  const catchCount = catchTrials.length;
  const catchSeen = catchTrials.filter(t => t.responded).length;
  const catchFARate = catchCount > 0 ? (catchSeen / catchCount) : 0;

  // Populate UI stats
  document.getElementById('threshold-val').textContent = estThreshold.toFixed(3);
  document.getElementById('total-trials-val').textContent = trialDataLog.length;
  document.getElementById('fa-rate-val').textContent = `${Math.round(catchFARate * 100)}%`;
  document.getElementById('fa-counts-label').textContent = `${spontaneousPressCount} gap presses, ${catchSeen}/${catchCount} catch misses`;

  // Draw chart
  renderPsychometricPlot(estThreshold);

  // Trigger file downloads automatically
  triggerAutoDownload();
}

// -------------------------------------------------------------
// Data Exporting
// -------------------------------------------------------------

function generateCSV() {
  const headers = [
    'trial_index',
    'trial_type',
    'image_name',
    'contrast_alpha',
    'isi_ms',
    'responded',
    'rt_ms',
    'correct',
    'onset_time',
    'offset_time'
  ];

  const rows = trialDataLog.map(t => [
    t.trialIndex,
    t.trialType,
    t.imageName,
    t.contrast,
    Math.round(t.isi),
    t.responded ? 1 : 0,
    t.rt != null ? Math.round(t.rt) : '',
    t.correct ? 1 : 0,
    t.onsetTime.toFixed(2),
    t.offsetTime.toFixed(2)
  ]);

  const csvContent = [
    headers.join(','),
    ...rows.map(r => r.join(','))
  ].join('\n');

  return csvContent;
}

function generateJSON() {
  const estimates = questEngine ? questEngine.getEstimates() : null;
  const out = {
    metadata: {
      timestamp: new Date().toISOString(),
      experiment: 'single-frame-contrast-detection-pixel-noise-gated-backward-masking',
      total_trials: trialDataLog.length,
      estimated_threshold: estimateThreshold75(),
      quest_estimates: estimates,
      spontaneous_press_count: spontaneousPressCount,
      spontaneous_presses_timestamps: spontaneousPresses
    },
    trials: trialDataLog
  };
  return JSON.stringify(out, null, 2);
}

function triggerAutoDownload() {
  if (trialDataLog.length === 0) return;
  const timestamp = formatTimestampForFilename(new Date());
  
  const csv = generateCSV();
  downloadBlob(`single-frame-contrast-pixel-noise-${timestamp}.csv`, csv, 'text/csv');
}

// -------------------------------------------------------------
// Interactive Bindings
// -------------------------------------------------------------

startBtn.addEventListener('click', startExperiment);
stopBtn.addEventListener('click', () => endExperiment('stopped'));

restartBtn.addEventListener('click', () => {
  resultsPanel.style.display = 'none';
  setupPanel.style.display = 'flex';
  drawIdleCanvas();
});

downloadCsvBtn.addEventListener('click', () => {
  const timestamp = formatTimestampForFilename(new Date());
  downloadBlob(`single-frame-contrast-pixel-noise-${timestamp}.csv`, generateCSV(), 'text/csv');
});

downloadJsonBtn.addEventListener('click', () => {
  const timestamp = formatTimestampForFilename(new Date());
  downloadBlob(`single-frame-contrast-pixel-noise-${timestamp}.json`, generateJSON(), 'application/json');
});

tapTarget.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  registerActionResponse();
});

document.addEventListener('keydown', (e) => {
  if (e.code === 'Space' || e.key === ' ') {
    e.preventDefault();
    registerActionResponse();
  }
});

// Practice Flash Button Binding
practiceBtn.addEventListener('click', () => {
  practiceBtn.disabled = true;
  
  // Choose random preloaded image
  const keys = Object.keys(loadedImages);
  if (keys.length === 0) {
    practiceBtn.disabled = false;
    return;
  }
  const randomFilename = keys[Math.floor(secureRandom() * keys.length)];
  const imgObj = loadedImages[randomFilename];
  
  // Temporarily set sessionRunning to true to allow practice rendering
  sessionRunning = true;
  
  // Flash stimulus in 800ms
  setTimeout(() => {
    stimulusState = {
      img: imgObj,
      contrast: 1.0, // 100% contrast for clear visibility
      onsetTime: null,
      offsetTime: null,
      trialIndex: 0,
      imageName: randomFilename,
      trialType: 'practice',
      isi: 800
    };
    
    // Reset counter and run loop
    noiseFrameCount = 0;
    requestAnimationFrame(renderLoop);
    
    // When the sequence completes, reset practice states
    setTimeout(() => {
      // Only stop if they are still on the setup panel (haven't started the experiment)
      const currentPanel = setupPanel.style.display;
      if (currentPanel !== 'none') {
        sessionRunning = false;
        drawIdleCanvas();
        practiceBtn.disabled = false;
      }
    }, 300);
  }, 800);
});

// Initialize on load
drawIdleCanvas();
preloadImages();
