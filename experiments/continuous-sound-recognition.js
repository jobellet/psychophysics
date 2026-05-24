import { secureRandom } from '../shared-resources/utils/random.js';
import { formatTimestampForFilename } from '../shared-resources/utils/date.js';
import { downloadBlob } from '../shared-resources/utils/downloadBlob.js';

// jsQuestPlus is loaded globally from unpkg
// jsPsych is loaded globally from unpkg

let jsPsych;
let audioContext = null;
let soundManifest = [];
let audioBuffers = {}; // cache decoded audio buffers

// Adaptive Bias Controller
const BiasCtrl = (() => {
  const cfg = {
    emaAlpha: 0.12,  // EMA smoothing factor
    Kp: 0.5,         // Proportional controller gain
    pLoud: 0.2       // Proportion of Loud Different trials (catch trials)
  };

  let hrEma = 0.5;
  let faEma = 0.15;
  let pSameFaint = 0.5;

  let nFaintSame = 0;
  let nFaintDiff = 0;
  let nFaintSameHits = 0;
  let nFaintDiffFAs = 0;

  function onTrialEnd(trialType, responded) {
    if (trialType === 'FaintSame') {
      nFaintSame++;
      if (responded) nFaintSameHits++;
      hrEma = (1 - cfg.emaAlpha) * hrEma + cfg.emaAlpha * (responded ? 1 : 0);
    } else if (trialType === 'FaintDifferent') {
      nFaintDiff++;
      if (responded) nFaintDiffFAs++;
      faEma = (1 - cfg.emaAlpha) * faEma + cfg.emaAlpha * (responded ? 1 : 0);
    } else {
      return; // LoudDifferent trial, doesn't affect faint bias
    }

    const error = hrEma + faEma - 1.0;
    pSameFaint = 0.5 - cfg.Kp * error;
    pSameFaint = Math.max(0.2, Math.min(0.8, pSameFaint));
  }

  function getStats() {
    return {
      hrEma,
      faEma,
      pSameFaint,
      nFaintSame,
      nFaintDiff,
      nFaintSameHits,
      nFaintDiffFAs
    };
  }

  function reset() {
    hrEma = 0.5;
    faEma = 0.15;
    pSameFaint = 0.5;
    nFaintSame = 0;
    nFaintDiff = 0;
    nFaintSameHits = 0;
    nFaintDiffFAs = 0;
  }

  return { onTrialEnd, getStats, reset, cfg };
})();

// DOM Elements
const preExperimentOverlay = document.getElementById('pre-experiment');
const startButton = document.getElementById('start-experiment');
const statusEl = document.getElementById('session-status');
const stopExperimentButton = document.getElementById('stop-experiment');
const experimentStage = document.getElementById('experiment-stage');
const sameButton = document.getElementById('same-button');
const trialProgressEl = document.getElementById('trial-progress-el');

// State
let sessionRunning = false;
let sessionFinalized = false;
let trialCount = 0;
let questEngine = null;

const trialState = {
  previousSound: null,
  currentSound: null,
  isGo: false, // matches isSame (repeat)
  currentVolume: 1.0,
  isi: 1000,
  responded: false,
  rt: null,
  trialType: null, // 'LoudDifferent', 'FaintDifferent', 'FaintSame'
  responseWindowActive: false,
  soundStartTime: null
};

function setStatus(message, state = 'info') {
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.dataset.state = state;
}

// Load manifest
async function loadManifest() {
  try {
    const response = await fetch('../assets/sound-manifest.json');
    soundManifest = await response.json();
    setStatus(`Loaded ${soundManifest.length} sounds. Ready to start.`, 'info');
  } catch (e) {
    setStatus('Failed to load sound manifest.', 'error');
  }
}

// Ensure Audio Context
function ensureAudioContext() {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioContext.state === 'suspended') {
    audioContext.resume();
  }
}

// Decode Audio Data
async function getAudioBuffer(path) {
  if (audioBuffers[path]) return audioBuffers[path];

  try {
    const response = await fetch(`../assets/${path}`);
    const arrayBuffer = await response.arrayBuffer();
    ensureAudioContext();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    audioBuffers[path] = audioBuffer;
    return audioBuffer;
  } catch (e) {
    console.error(`Failed to load or decode audio: ${path}`, e);
    return null;
  }
}

// Setup jsQuestPlus
function initQuest() {
  const amplitudes = [];
  for (let i = 0.01; i <= 1.0; i += 0.01) {
    amplitudes.push(Math.round(i * 100) / 100);
  }

  questEngine = new jsQuestPlus({
    psych_func: [
      (stim, alpha, beta, guess, lapse) => 1 - (guess + (1 - guess - lapse) * (1 - Math.exp(-Math.pow(stim / alpha, beta)))),
      (stim, alpha, beta, guess, lapse) => guess + (1 - guess - lapse) * (1 - Math.exp(-Math.pow(stim / alpha, beta)))
    ],
    stim_samples: [amplitudes],
    psych_samples: [
      amplitudes,
      [2, 3, 4, 5], // beta
      [0.05], // guess rate (chance of FA)
      [0.01, 0.02] // lapse
    ]
  });
}

function suggestVolume() {
  if (!questEngine) return 1.0;
  try {
    const est = questEngine.getEstimates('mode');
    if (Array.isArray(est) && est.length >= 4) {
      const target = 0.75;
      const [alpha, beta, guess, lapse] = est;
      let best = 1.0;
      let bestDiff = Infinity;

      for (let v = 0.01; v <= 1.0; v += 0.01) {
        const p = guess + (1 - guess - lapse) * (1 - Math.exp(-Math.pow(v / alpha, beta)));
        const d = Math.abs(p - target);
        if (d < bestDiff) {
          bestDiff = d;
          best = v;
        }
      }
      return Math.max(0.01, best);
    }
  } catch (e) {
    console.warn("Quest suggestVolume error", e);
  }

  // Fallback to questEngine's current suggestion if we couldn't calculate
  try {
    return questEngine.getStimParams();
  } catch (e) {
    return 1.0;
  }
}

// Node: Prepare trial
// Node: Prepare trial
const prepareTrialNode = {
  type: jsPsychCallFunction,
  async: true,
  func: async (done) => {
    ensureAudioContext();

    // Gap: 1 to 5 seconds
    trialState.isi = 1000 + secureRandom() * 4000;

    // Reset button highlight at start of preparation / gap
    if (sameButton) {
      sameButton.style.background = '';
    }

    if (trialCount === 0) {
      // First trial: Random sound, volume 1.0, Loud Different
      trialState.isGo = false;
      trialState.trialType = 'LoudDifferent';
      trialState.currentVolume = 1.0;
      trialState.currentSound = soundManifest[Math.floor(secureRandom() * soundManifest.length)];
    } else {
      // Choose trial type: LoudDifferent, FaintDifferent, FaintSame
      const stats = BiasCtrl.getStats();
      const isLoud = secureRandom() < BiasCtrl.cfg.pLoud;

      if (isLoud) {
        // LoudDifferent
        trialState.isGo = false;
        trialState.trialType = 'LoudDifferent';
        trialState.currentVolume = 1.0;

        let newSound;
        do {
          newSound = soundManifest[Math.floor(secureRandom() * soundManifest.length)];
        } while (newSound === trialState.previousSound);
        trialState.currentSound = newSound;
      } else {
        // Faint trials. Decide if it's Same or Different based on pSameFaint
        const isSame = secureRandom() < stats.pSameFaint;

        if (isSame) {
          // FaintSame (Repeat)
          trialState.isGo = true;
          trialState.trialType = 'FaintSame';
          trialState.currentVolume = suggestVolume();
          trialState.currentSound = trialState.previousSound;
        } else {
          // FaintDifferent (Non-repeat catch trial)
          trialState.isGo = false;
          trialState.trialType = 'FaintDifferent';
          trialState.currentVolume = suggestVolume();

          let newSound;
          do {
            newSound = soundManifest[Math.floor(secureRandom() * soundManifest.length)];
          } while (newSound === trialState.previousSound);
          trialState.currentSound = newSound;
        }
      }
    }

    trialState.responded = false;
    trialState.rt = null;
    trialState.responseWindowActive = false;

    // Decode audio in background during the gap
    await getAudioBuffer(trialState.currentSound);

    // Wait for the random ISI
    setTimeout(() => {
      done();
    }, trialState.isi);
  }
};

// Node: Play audio and accept responses
const playTrialNode = {
  type: jsPsychCallFunction,
  async: true,
  func: async (done) => {
    // Update UI progress indicator
    if (trialProgressEl) {
      trialProgressEl.textContent = `Trial ${trialCount + 1}`;
    }

    // Reset button background (if it wasn't already reset)
    if (sameButton) {
      sameButton.style.background = '';
    }

    // Play sound via Web Audio API
    ensureAudioContext();
    const source = audioContext.createBufferSource();
    source.buffer = audioBuffers[trialState.currentSound];

    const gainNode = audioContext.createGain();
    gainNode.gain.value = trialState.currentVolume;

    source.connect(gainNode);
    gainNode.connect(audioContext.destination);

    trialState.soundStartTime = performance.now();
    trialState.responseWindowActive = true;
    trialState.currentSource = source;

    source.start();

    // The response window duration is 2 seconds (matching the original trial duration)
    setTimeout(() => {
      // Close response window
      trialState.responseWindowActive = false;

      // Stop source if it's still playing
      if (trialState.currentSource) {
        try {
          trialState.currentSource.stop();
        } catch (e) {}
      }

      const responded = trialState.responded;

      // Update Bias Controller
      BiasCtrl.onTrialEnd(trialState.trialType, responded);

      // Update Quest+ (only for SAME/Repeat trials)
      if (trialState.isGo && questEngine) {
        try {
          questEngine.update(trialState.currentVolume, responded ? 1 : 0);
        } catch (e) {
          console.warn('Quest update skipped', e);
        }
      }

      // Log trial details to jsPsych data
      const stats = BiasCtrl.getStats();
      jsPsych.data.write({
        trial_index: trialCount,
        sound: trialState.currentSound,
        previous_sound: trialState.previousSound,
        is_go: trialState.isGo,
        is_same: trialState.isGo,
        trial_type: trialState.trialType,
        volume: trialState.currentVolume,
        isi: trialState.isi,
        responded: responded,
        rt: trialState.rt,
        correct: trialState.isGo ? responded : !responded,
        p_same_faint: stats.pSameFaint,
        hr_ema: stats.hrEma,
        fa_ema: stats.faEma
      });

      // Prepare for next trial
      trialState.previousSound = trialState.currentSound;
      trialCount++;

      done();
    }, 2000);
  }
};

const trialSequence = {
  timeline: [prepareTrialNode, playTrialNode]
};

const experimentLoop = {
  timeline: [trialSequence],
  loop_function: () => {
    return sessionRunning; // Continue loop only if session is running
  }
};

// ===========================
// Application Flow
// ===========================

function finalizeSession(reason = 'complete') {
  if (sessionFinalized) return;
  sessionFinalized = true;
  sessionRunning = false;

  if (jsPsych) {
    jsPsych.abortExperiment();
  }

  if (experimentStage) {
    experimentStage.classList.add('hidden');
  }

  if (stopExperimentButton) {
    stopExperimentButton.hidden = true;
  }

  if (audioContext) {
    audioContext.close();
    audioContext = null;
  }

  const newValues = jsPsych.data.get().values();
  const timestamp = formatTimestampForFilename(new Date());

  if (newValues.length) {
    downloadBlob(`continuous-sound-recognition-${timestamp}.csv`, jsPsych.data.get().csv(), 'text/csv');
  }

  setStatus(
    newValues.length
      ? `${reason === 'stopped' ? 'Session stopped early.' : 'Session complete.'} Downloaded ${newValues.length} new trials.`
      : `Session ended. No new trials were recorded.`,
    'info'
  );

  if (preExperimentOverlay) {
    preExperimentOverlay.classList.remove('hidden');
  }

  // Update button text
  startButton.textContent = 'Run another block';

  jsPsych.getDisplayElement().innerHTML = '';
}

function handleStartClick() {
  if (sessionRunning) return;
  if (soundManifest.length === 0) {
      setStatus('No sounds loaded.', 'error');
      return;
  }

  sessionRunning = true;
  sessionFinalized = false;
  trialCount = 0;
  trialState.previousSound = null;

  initQuest();
  BiasCtrl.reset();

  if (preExperimentOverlay) {
    preExperimentOverlay.classList.add('hidden');
  }

  if (experimentStage) {
    experimentStage.classList.remove('hidden');
  }

  if (stopExperimentButton) {
    stopExperimentButton.hidden = false;
  }

  jsPsych = initJsPsych({
    display_element: 'jspsych-target',
    show_progress_bar: false,
    on_finish: () => {
      if (!sessionFinalized) finalizeSession('complete');
    }
  });

  jsPsych.data.reset(true);

  const timeline = [];
  timeline.push(experimentLoop);

  jsPsych.run(timeline);
}

// Global Response Handler
function registerResponse() {
  if (!sessionRunning || !trialState.responseWindowActive || trialState.responded) return;

  trialState.responded = true;
  trialState.rt = performance.now() - trialState.soundStartTime;

  if (sameButton) {
    sameButton.style.background = '#10b981'; // Green highlight
  }
}

// Event Listeners
if (startButton) startButton.addEventListener('click', handleStartClick);
if (stopExperimentButton) {
  stopExperimentButton.addEventListener('click', () => {
    finalizeSession('stopped');
  });
}
if (sameButton) {
  sameButton.addEventListener('click', registerResponse);
}
document.addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    e.preventDefault();
    registerResponse();
  }
});

// Initialize
loadManifest();
