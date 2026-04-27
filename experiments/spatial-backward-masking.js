import {
  init as initCalibration,
  getReference as getCalibrationReference,
  getState as getCalibrationState,
  onReady as onCalibrationReady,
} from "../shared-resources/calibration.js";

import { downloadBlob } from "../shared-resources/utils/downloadBlob.js";
import { formatTimestampForFilename } from "../shared-resources/utils/date.js";

const TARGET_DIAMETER_DVA = 0.5;
const FIXATION_DIAMETER_DVA = 0.15;
const TARGET_ECCENTRICITY_DVA = 4.0;
const MASK_DURATION_MS = 250;
const FIXATION_MIN_MS = 500;
const FIXATION_MAX_MS = 700;
const NUM_LOCATIONS = 8;
const MIN_SOA_FRAMES = 1;
const MAX_SOA_FRAMES = 4;
const TOTAL_TRIALS = 200;

// Default px fallback
let DOT_DIAMETER = 30;
let FIXATION_DIAMETER_PX = 8;
let TARGET_ECCENTRICITY_PX = 200;
let stageSide = 0;
let stageCenter = 0;

let sessionRunning = false;
let sessionFinalized = false;
let trials = [];

const preExperimentOverlay = document.getElementById("pre-experiment");
const startButton = document.getElementById("start-experiment");
const stopButton = document.getElementById("stop-experiment");
const downloadButton = document.getElementById("download-data");
const stage = document.getElementById("experiment-stage");
const fixationEl = document.getElementById("fixation");
const jspsychTarget = document.getElementById("jspsych-target");

const calibrationStatusEl = document.getElementById("calibration-status");

function showCalibrationStatus(message, state = "info") {
  if (!calibrationStatusEl) return;
  calibrationStatusEl.textContent = message;
  calibrationStatusEl.dataset.state = state;
}

initCalibration({
  defaultObjectId: "credit-card",
  storageKey: "visual-jnd-calibration",
  startButton,
  referenceDataUrl: "../shared-resources/reference-data/object-dimensions.xml",
  elements: {
    section: document.getElementById("calibration-section"),
    objectSelect: document.getElementById("calibration-object"),
    display: document.getElementById("calibration-display"),
    shape: document.getElementById("calibration-shape"),
    slider: document.getElementById("calibration-slider"),
    readout: document.getElementById("calibration-size-readout"),
    status: calibrationStatusEl,
    confirm: document.getElementById("calibration-confirm"),
    viewingDistance: document.getElementById("viewing-distance"),
    target: document.getElementById("calibration-target-info"),
  },
}).catch((error) => {
  console.error("Calibration initialization failed", error);
  showCalibrationStatus(
    "Calibration could not be initialised. Please reload the page.",
    "error",
  );
});

const calibrationState = getCalibrationState();
function getVisualReference() {
  return getCalibrationReference();
}

function updateDerivedDvaMetrics() {
  const reference = getVisualReference();
  if (!reference || typeof VisualAngle === "undefined") {
    return;
  }
  try {
    DOT_DIAMETER = Math.max(
      2,
      Math.round(VisualAngle.dvaToPixels(TARGET_DIAMETER_DVA, reference)),
    );
    FIXATION_DIAMETER_PX = Math.max(
      2,
      Math.round(VisualAngle.dvaToPixels(FIXATION_DIAMETER_DVA, reference)),
    );
    TARGET_ECCENTRICITY_PX = Math.round(
      VisualAngle.dvaToPixels(TARGET_ECCENTRICITY_DVA, reference),
    );

    stageSide = Math.min(window.innerWidth, window.innerHeight) * 0.85;
    stageCenter = stageSide / 2;
    document.documentElement.style.setProperty(
      "--stage-size",
      `${Math.round(stageSide)}px`,
    );
  } catch (error) {
    console.warn("Failed to derive DVA metrics", error);
  }
}

onCalibrationReady(() => {
  updateDerivedDvaMetrics();
});
window.addEventListener("visual-calibration-cleared", () => {
  updateDerivedDvaMetrics();
});
window.addEventListener("resize", () => {
  updateDerivedDvaMetrics();
});

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}
function wait(ms) {
  return new Promise((resolve) => {
    const start = performance.now();
    function check() {
      if (performance.now() - start >= ms) {
        resolve();
      } else {
        requestAnimationFrame(check);
      }
    }
    requestAnimationFrame(check);
  });
}

function waitFrames(frameCount) {
  return new Promise((resolve) => {
    let count = 0;
    function tick() {
      count++;
      if (count >= frameCount) {
        resolve();
      } else {
        requestAnimationFrame(tick);
      }
    }
    requestAnimationFrame(tick);
  });
}

function buildCsv(data) {
  if (!Array.isArray(data) || data.length === 0) return "trial_index";
  const columns = Object.keys(data[0]);
  const header = columns.join(",");
  const rows = data.map((row) =>
    columns
      .map((key) => {
        const value = row[key];
        if (value === null || value === undefined) return "";
        if (typeof value === "string") return `"${value.replace(/"/g, '""')}"`;
        return String(value);
      })
      .join(","),
  );
  return [header, ...rows].join("\n");
}

let currentStaircaseSoaFrames = MAX_SOA_FRAMES;
let consecutiveHits = 0;
let consecutiveMisses = 0;

function snapToRefresh(durationMs) {
  let rr = 60;
  const scr = typeof window !== "undefined" ? window.screen : null;
  if (scr && Number.isFinite(scr.frameRate) && scr.frameRate > 0)
    rr = scr.frameRate;
  else if (window.matchMedia) {
    if (window.matchMedia("(min-refresh-rate: 120hz)").matches) rr = 120;
    else if (window.matchMedia("(min-resolution: 2dppx)").matches) rr = 120;
  }
  const frameMs = 1000 / rr;
  const frames = Math.max(1, Math.round(durationMs / frameMs));
  return Math.round(frames * frameMs);
}

function getStageCoords(locationIndex, eccentricityPx) {
  const angleRad = (locationIndex / NUM_LOCATIONS) * 2 * Math.PI - Math.PI / 2; // start at top
  const x = stageCenter + eccentricityPx * Math.cos(angleRad);
  const y = stageCenter + eccentricityPx * Math.sin(angleRad);
  return { x, y, angleRad };
}

async function runTrial(trialParams) {
  const { trialIndex, isTargetPresent, targetLocation, soaFrames } =
    trialParams;

  // Create mask elements if not exist
  const existingMasks = stage.querySelectorAll(".mask-square");
  if (existingMasks.length === 0) {
    for (let i = 0; i < NUM_LOCATIONS; i++) {
      const m = document.createElement("div");
      m.className = "mask-square";
      m.id = `mask-${i}`;
      stage.appendChild(m);
    }
  }
  const maskEls = stage.querySelectorAll(".mask-square");
  maskEls.forEach((el) => {
    el.style.width = `${DOT_DIAMETER}px`;
    el.style.height = `${DOT_DIAMETER}px`;
  });

  let targetEl = document.getElementById("target-square");
  if (!targetEl) {
    targetEl = document.createElement("div");
    targetEl.className = "target";
    targetEl.id = "target-square";
    stage.appendChild(targetEl);
  }
  targetEl.style.width = `${DOT_DIAMETER}px`;
  targetEl.style.height = `${DOT_DIAMETER}px`;

  // Position elements
  maskEls.forEach((el, i) => {
    const { x, y } = getStageCoords(i, TARGET_ECCENTRICITY_PX);
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
  });

  if (isTargetPresent) {
    const { x, y } = getStageCoords(targetLocation, TARGET_ECCENTRICITY_PX);
    targetEl.style.left = `${x}px`;
    targetEl.style.top = `${y}px`;
  }

  const fixationMs =
    FIXATION_MIN_MS + Math.random() * (FIXATION_MAX_MS - FIXATION_MIN_MS);

  // 1. Fixation
  fixationEl.style.width = `${FIXATION_DIAMETER_PX}px`;
  fixationEl.style.height = `${FIXATION_DIAMETER_PX}px`;
  fixationEl.className = "fixation"; // reset

  document.getElementById("hud-trial").textContent =
    `Trial ${trialIndex + 1} of ${TOTAL_TRIALS}`;

  await wait(fixationMs);

  let targetOnset = null;
  let maskOnset = null;

  // 2. Target (if present)
  if (isTargetPresent) {
    targetEl.classList.add("visible");
    targetOnset = performance.now();
    await waitFrames(1); // Target appears for exactly 1 frame
    targetEl.classList.remove("visible");
  } else {
    targetOnset = performance.now(); // benchmark for SOA
    await waitFrames(1);
  }

  // 3. SOA Delay
  const delayFrames = soaFrames - 1; // 1 frame was already consumed by the target
  if (delayFrames > 0) {
    await waitFrames(delayFrames);
  }

  // 4. Mask
  maskEls.forEach((el) => el.classList.add("visible"));
  maskOnset = performance.now();

  await wait(MASK_DURATION_MS); // Mask duration doesn't need to be strictly frame-accurate
  maskEls.forEach((el) => el.classList.remove("visible"));

  // 5. Response
  let resolveResponse;
  const responsePromise = new Promise((resolve) => {
    resolveResponse = resolve;
  });

  const handlePointer = (event) => {
    event.preventDefault();
    const rect = stage.getBoundingClientRect();
    const responseX = event.clientX - rect.left;
    const responseY = event.clientY - rect.top;

    // determine closest
    let closestLoc = -1;
    let minDiff = Infinity;

    // Check fixation
    const distFix = Math.hypot(
      responseX - stageCenter,
      responseY - stageCenter,
    );
    if (distFix < TARGET_ECCENTRICITY_PX * 0.5) {
      closestLoc = -1; // Fixation tapped
    } else {
      for (let i = 0; i < NUM_LOCATIONS; i++) {
        const { x, y } = getStageCoords(i, TARGET_ECCENTRICITY_PX);
        const d = Math.hypot(responseX - x, responseY - y);
        if (d < minDiff) {
          minDiff = d;
          closestLoc = i;
        }
      }
    }

    stage.removeEventListener("pointerdown", handlePointer);
    resolveResponse({
      rt: performance.now() - maskOnset,
      tappedLocation: closestLoc,
      responseXPx: responseX,
      responseYPx: responseY,
    });
  };

  stage.addEventListener("pointerdown", handlePointer);
  const responseData = await responsePromise;

  // 6. Classification & Feedback & Staircase
  let classification = "";
  let hit = false;

  if (isTargetPresent) {
    if (responseData.tappedLocation === targetLocation) {
      classification = "Hit";
      hit = true;
      consecutiveHits++;
      consecutiveMisses = 0;
    } else {
      classification = "Miss";
      hit = false;
      consecutiveMisses++;
      consecutiveHits = 0;
    }

    if (consecutiveHits >= 3) {
      currentStaircaseSoaFrames = Math.max(
        MIN_SOA_FRAMES,
        currentStaircaseSoaFrames - 1,
      );
      consecutiveHits = 0;
    } else if (consecutiveMisses >= 3) {
      currentStaircaseSoaFrames = Math.min(
        MAX_SOA_FRAMES,
        currentStaircaseSoaFrames + 1,
      );
      consecutiveMisses = 0;
    }
  } else {
    if (responseData.tappedLocation === -1) {
      classification = "Correct Rejection";
      hit = true;
    } else {
      classification = "False Alarm";
      hit = false;
    }
  }

  fixationEl.classList.add(hit ? "hit" : "miss");
  await wait(150);
  fixationEl.classList.remove("hit", "miss");
  await wait(500); // ITI

  const result = {
    ...trialParams,
    ...responseData,
    classification,
    targetOnset,
    maskOnset,
    realSoaMs: maskOnset - targetOnset,
    staircaseLevel: currentStaircaseSoaFrames,
    consecutiveHits,
    consecutiveMisses,
    timestamp_iso: new Date().toISOString(),
  };

  trials.push(result);
  return result;
}

function generateTrialList() {
  const list = [];
  let dummySoaFrames = currentStaircaseSoaFrames;

  for (let i = 0; i < TOTAL_TRIALS; i++) {
    const isTargetPresent = Math.random() < 0.7;
    const targetLocation = Math.floor(Math.random() * NUM_LOCATIONS);
    list.push({
      trialIndex: i,
      isTargetPresent,
      targetLocation,
      // SOA frames will be evaluated lazily during runtime for target-present trials,
      // but we can set up the structure.
    });
  }
  return list;
}

const jsPsych = initJsPsych({
  display_element: "jspsych-target",
  show_progress_bar: true,
  auto_update_progress_bar: false,
  on_finish: () => finalizeSession("complete"),
});

function finalizeSession(status) {
  sessionRunning = false;
  sessionFinalized = true;
  stopButton.disabled = true;
  downloadButton.disabled = false;
  document.getElementById("hud-trial").textContent =
    status === "complete" ? `Completed all trials` : "Session stopped early";
}

function buildTimeline() {
  const trialList = generateTrialList();
  let timeline = [];

  for (let i = 0; i < trialList.length; i++) {
    const trialParams = trialList[i];

    const node = {
      type: jsPsychCallFunction,
      async: true,
      data: { stage: "trial" },
      func: async (callback) => {
        // Evaluate SOA for this trial
        if (trialParams.isTargetPresent) {
          trialParams.soaFrames = currentStaircaseSoaFrames;
        } else {
          trialParams.soaFrames = currentStaircaseSoaFrames;
        }

        try {
          const result = await runTrial(trialParams);
          callback(result);
        } catch (e) {
          console.error(e);
          callback({});
        }
      },
      on_finish: (data) => {
        jsPsych.setProgressBar((i + 1) / TOTAL_TRIALS);
        Object.assign(data, data.value);
      },
    };

    timeline.push(node);
  }

  return timeline;
}

export function run() {
  sessionRunning = true;
  trials = [];
  currentStaircaseSoaFrames = MAX_SOA_FRAMES;
  consecutiveHits = 0;
  consecutiveMisses = 0;

  const timeline = buildTimeline();
  timeline.unshift({
    type: jsPsychCallFunction,
    func: () => {
      jsPsych.getDisplayElement().appendChild(stage);
    },
  });
  jsPsych.run(timeline);
}

function startExperiment() {
  if (!calibrationState.ready) return;
  preExperimentOverlay.classList.add("hidden");
  stage.style.display = "flex";
  stopButton.hidden = false;
  downloadButton.hidden = false;
  downloadButton.disabled = true;
  updateDerivedDvaMetrics();
  run();
}

startButton.addEventListener("click", startExperiment);

stopButton.addEventListener("click", () => {
  sessionRunning = false;
  jsPsych.endExperiment("Session stopped early");
  finalizeSession("stopped");
});

downloadButton.addEventListener("click", () => {
  const trialData = jsPsych.data.get().filter({ stage: "trial" }).values();
  if (!trialData.length && !trials.length) return;
  const mergedTrials = trials.length > trialData.length ? trials : trialData;

  const ts = formatTimestampForFilename();
  const ref = getVisualReference();
  const meta = {
    viewing_distance_mm: ref ? ref.viewingDistanceMm : null,
    mm_per_pixel: ref ? ref.mmPerPixel : null,
  };

  const csvData = mergedTrials.map((t) => ({ ...meta, ...t }));
  downloadBlob(
    `spatial-backward-masking_${ts}.csv`,
    buildCsv(csvData),
    "text/csv",
  );
  downloadBlob(
    `spatial-backward-masking_${ts}.json`,
    JSON.stringify(csvData, null, 2),
    "application/json",
  );
});
