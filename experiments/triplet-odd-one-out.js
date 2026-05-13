/**
 * Triplet Odd One Out Experiment
 */

const jsPsych = initJsPsych({
  display_element: 'jspsych-target',
  show_progress_bar: true,
  auto_update_progress_bar: false,
  on_finish: () => {
    if (!sessionFinalized) finalizeSession('complete');
  }
});

// DOM Elements
const preExperimentOverlay = document.getElementById('pre-experiment');
const startButton = document.getElementById('start-experiment');
const statusEl = document.getElementById('session-status');
const stopExperimentButton = document.getElementById('stop-experiment');

// State
let sessionRunning = false;
let sessionFinalized = false;
let trialCount = 0;

let soundManifest = [];

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

function getRandomSounds(count) {
  const selected = [];
  const manifestCopy = [...soundManifest];
  for (let i = 0; i < count; i++) {
    const index = Math.floor(Math.random() * manifestCopy.length);
    selected.push(manifestCopy.splice(index, 1)[0]);
  }
  return selected;
}

const instructions = {
  type: jsPsychHtmlButtonResponse,
  stimulus: `
    <h1>Triplet Odd One Out</h1>
    <p>
      In each trial, you will hear three sounds played one after another.<br>
      Your task is to identify which sound is the <strong>least similar</strong> to the other two.<br>
      Press <strong>1</strong>, <strong>2</strong>, or <strong>3</strong> on your keyboard, or click the corresponding button on the screen.<br>
    </p>
  `,
  choices: ['Start']
};

const trialState = {};

const pickSoundsNode = {
  type: jsPsychCallFunction,
  func: () => {
    trialState.sounds = getRandomSounds(3);
    trialState.soundStartTime = performance.now();
  }
};

const playSoundPrompt = () => `
  <div class="stage">
    <div class="trial-progress">Trial ${trialCount + 1}</div>
    <div class="speaker-icon" role="img" aria-label="speaker">🔊</div>
    <p class="response-text">Playing sounds...</p>
  </div>
`;

const playSound1 = {
  type: jsPsychAudioKeyboardResponse,
  stimulus: () => `../assets/${trialState.sounds[0]}`,
  choices: "NO_KEYS",
  trial_ends_after_audio: true,
  prompt: playSoundPrompt
};

const isi1 = {
  type: jsPsychHtmlKeyboardResponse,
  stimulus: playSoundPrompt,
  choices: "NO_KEYS",
  trial_duration: 500
};

const playSound2 = {
  type: jsPsychAudioKeyboardResponse,
  stimulus: () => `../assets/${trialState.sounds[1]}`,
  choices: "NO_KEYS",
  trial_ends_after_audio: true,
  prompt: playSoundPrompt
};

const isi2 = {
  type: jsPsychHtmlKeyboardResponse,
  stimulus: playSoundPrompt,
  choices: "NO_KEYS",
  trial_duration: 500
};

const playSound3 = {
  type: jsPsychAudioKeyboardResponse,
  stimulus: () => `../assets/${trialState.sounds[2]}`,
  choices: "NO_KEYS",
  trial_ends_after_audio: true,
  prompt: playSoundPrompt
};

const responseNode = {
  type: jsPsychHtmlKeyboardResponse,
  stimulus: `
    <div class="stage">
      <div class="trial-progress">Trial ${trialCount + 1}</div>
      <div class="speaker-icon" role="img" aria-label="speaker">❓</div>
      <p class="response-text">Which sound was the odd one out?<br>Press 1, 2, or 3.</p>
    </div>
  `,
  choices: ['1', '2', '3'],
  on_finish: (data) => {
    data.sound1 = trialState.sounds[0];
    data.sound2 = trialState.sounds[1];
    data.sound3 = trialState.sounds[2];
    data.response = data.response; // keep '1', '2', or '3'
    trialCount++;
  }
};

const trialSequence = {
  timeline: [pickSoundsNode, playSound1, isi1, playSound2, isi2, playSound3, responseNode]
};

const experimentLoop = {
  timeline: [trialSequence],
  loop_function: () => {
    return true; // Infinite loop until user clicks Stop
  }
};

// ===========================
// Application Flow
// ===========================

function downloadBlob(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function finalizeSession(reason = 'complete') {
  if (sessionFinalized) return;
  sessionFinalized = true;
  sessionRunning = false;

  if (stopExperimentButton) {
    stopExperimentButton.hidden = true;
  }

  const newValues = jsPsych.data.get().values();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

  if (newValues.length) {
    downloadBlob(jsPsych.data.get().csv(), `odd-one-out-${timestamp}.csv`, 'text/csv');
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
  if (soundManifest.length < 3) {
      setStatus('Not enough sounds loaded.', 'error');
      return;
  }

  sessionRunning = true;
  sessionFinalized = false;
  trialCount = 0;

  if (preExperimentOverlay) {
    preExperimentOverlay.classList.add('hidden');
  }

  if (stopExperimentButton) {
    stopExperimentButton.hidden = false;
  }

  jsPsych.data.reset(true);

  const timeline = [];
  timeline.push(instructions);
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

// jsPsych on_finish is already set in initJsPsych

// Initialize
loadManifest();
