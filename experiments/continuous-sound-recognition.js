import NoGoCtrl from './noGoController.js';
import { secureRandom } from '../shared-resources/utils/random.js';
import { formatTimestampForFilename } from '../shared-resources/utils/date.js';
import { downloadBlob } from '../shared-resources/utils/downloadBlob.js';

// jsQuestPlus is loaded globally from unpkg
// jsPsych is loaded globally from unpkg

let jsPsych;
let audioContext = null;
let soundManifest = [];
let audioBuffers = {}; // cache decoded audio buffers

// DOM Elements
const preExperimentOverlay = document.getElementById('pre-experiment');
const startButton = document.getElementById('start-experiment');
const statusEl = document.getElementById('session-status');
const stopExperimentButton = document.getElementById('stop-experiment');

// State
let sessionRunning = false;
let sessionFinalized = false;
let trialCount = 0;
let questEngine = null;

const trialState = {
  previousSound: null,
  currentSound: null,
  isGo: false, // Go = SAME (target), No-Go = DIFFERENT (distractor)
  currentVolume: 1.0,
  isi: 1000,
  responded: false,
  rt: null
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
const prepareTrialNode = {
  type: jsPsychCallFunction,
  async: true,
  func: async (done) => {
    ensureAudioContext();

    // Gap: 1 to 5 seconds
    trialState.isi = 1000 + secureRandom() * 4000;

    if (trialCount === 0) {
      // First trial: Random sound, volume 1.0
      trialState.isGo = false;
      trialState.currentVolume = 1.0;
      trialState.currentSound = soundManifest[Math.floor(secureRandom() * soundManifest.length)];
    } else {
      // Is this a Go (SAME) or No-Go (DIFFERENT) trial?
      // NoGoCtrl schedules No-Go trials. In our context, No-Go = DIFFERENT.
      // So decideNoGo() returning true means we should present a DIFFERENT sound.

      const isDifferent = NoGoCtrl.decideNoGo();

      if (isDifferent) {
        // No-Go: DIFFERENT sound, Volume 1.0
        trialState.isGo = false;
        trialState.currentVolume = 1.0;

        let newSound;
        do {
          newSound = soundManifest[Math.floor(secureRandom() * soundManifest.length)];
        } while (newSound === trialState.previousSound);
        trialState.currentSound = newSound;

      } else {
        // Go: SAME sound, Quest+ volume
        trialState.isGo = true;
        trialState.currentVolume = suggestVolume();
        trialState.currentSound = trialState.previousSound;
      }
    }

    trialState.responded = false;
    trialState.rt = null;

    // Decode audio
    await getAudioBuffer(trialState.currentSound);

    // Wait for ISI
    setTimeout(() => {
        done();
    }, trialState.isi);
  }
};

// Play audio and show response button
const playSoundAndResponseNode = {
  type: jsPsychHtmlButtonResponse,
  stimulus: () => `
    <div class="stage">
      <div class="trial-progress">Trial ${trialCount + 1}</div>
      <div class="speaker-icon" role="img" aria-label="speaker">🔊</div>
      <p class="response-text">Press Spacebar or click SAME if this sound matches the previous one.</p>
    </div>
  `,
  choices: ['SAME'],
  trial_duration: 2000,
  response_ends_trial: false, // Need to let sound play, wait up to 2 seconds
  on_start: (trial) => {
    // Add keydown listener
    const keyListener = (e) => {
      if (e.code === 'Space' && !trialState.responded) {
        e.preventDefault();
        trialState.responded = true;
        trialState.rt = performance.now() - trialState.soundStartTime;
        // Optionally update UI to show response registered
        const btn = document.querySelector('.jspsych-btn');
        if (btn) btn.style.background = '#10b981'; // Green
      }
    };
    document.addEventListener('keydown', keyListener);
    trialState.keyListener = keyListener;
  },
  on_load: () => {
    // Play sound via Web Audio API with Gain
    ensureAudioContext();
    const source = audioContext.createBufferSource();
    source.buffer = audioBuffers[trialState.currentSound];

    const gainNode = audioContext.createGain();
    gainNode.gain.value = trialState.currentVolume;

    source.connect(gainNode);
    gainNode.connect(audioContext.destination);

    trialState.soundStartTime = performance.now();
    source.start();
    trialState.currentSource = source;

    // Handle button click manually since response_ends_trial is false
    const btn = document.querySelector('.jspsych-btn');
    if (btn) {
      btn.addEventListener('click', () => {
        if (!trialState.responded) {
          trialState.responded = true;
          trialState.rt = performance.now() - trialState.soundStartTime;
          btn.style.background = '#10b981';
        }
      });
    }
  },
  on_finish: (data) => {
    document.removeEventListener('keydown', trialState.keyListener);

    if (trialState.currentSource) {
      try {
        trialState.currentSource.stop();
      } catch (e) {}
    }

    // Determine response (true if button clicked or space pressed within 2s)
    const responded = trialState.responded;

    // Update NoGoCtrl (for DIFFERENT sounds)
    // NoGoCtrl expects { isNoGo, responded }
    NoGoCtrl.onTrialEnd({ isNoGo: !trialState.isGo, responded });

    // Update Quest+ (for SAME sounds)
    if (trialState.isGo && questEngine) {
      try {
        questEngine.update(trialState.currentVolume, responded ? 1 : 0);
      } catch (e) {
        console.warn('Quest update skipped', e);
      }
    }

    // Save data
    data.trial_index = trialCount;
    data.sound = trialState.currentSound;
    data.previous_sound = trialState.previousSound;
    data.is_go = trialState.isGo;
    data.is_same = trialState.isGo;
    data.volume = trialState.currentVolume;
    data.isi = trialState.isi;
    data.responded = responded;
    data.rt = trialState.rt;
    data.correct = trialState.isGo ? responded : !responded;

    // Prepare for next
    trialState.previousSound = trialState.currentSound;
    trialCount++;
  }
};

const trialSequence = {
  timeline: [prepareTrialNode, playSoundAndResponseNode]
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

  if (preExperimentOverlay) {
    preExperimentOverlay.classList.add('hidden');
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

// Event Listeners
if (startButton) startButton.addEventListener('click', handleStartClick);
if (stopExperimentButton) {
  stopExperimentButton.addEventListener('click', () => {
    finalizeSession('stopped');
  });
}

// Initialize
loadManifest();
