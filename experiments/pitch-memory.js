/**
 * Pitch Memory Experiment
 * Based on: https://github.com/jobellet/pitch_memory
 */

const jsPsych = initJsPsych({
  display_element: 'jspsych-target',
  show_progress_bar: true,
  auto_update_progress_bar: false
});

// DOM Elements
const preExperimentOverlay = document.getElementById('pre-experiment');
const startButton = document.getElementById('start-experiment');
const fileInput = document.getElementById('session-file');
const statusEl = document.getElementById('session-status');
const stopExperimentButton = document.getElementById('stop-experiment');

// ===========================
// Parameters & State
// ===========================
let audioContext;
const TONE_DURATION = 0.05; // seconds
const MIN_BASE_FREQ = 440;
const MAX_BASE_FREQ = 880;
const MIN_GAP_MS    = 1;
const MAX_GAP_MS    = 1000;

// Default sampling range for semitones
let lowSemitoneRange  = 0.01;
let highSemitoneRange = 2.0;

// State
let isTestMode = true;
const NEEDED_TEST_CORRECT = 5;
let testCorrectCount = 0;
let realTrialCount = 0;
let trialNumberInBatch = 0;
let batchNumber = 0;

let sessionRunning = false;
let sessionFinalized = false;
let uploadedDataArray = [];

let trialState = {};

function setStatus(message, state = 'info') {
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.dataset.state = state;
}

// ===========================
// Adaptive Bounds Logic
// ===========================
function updateSamplingBounds(realTrials, defaultLow = 0.01, defaultHigh = 2.0) {
  if (realTrials.length < 50) {
    lowSemitoneRange = defaultLow;
    highSemitoneRange = defaultHigh;
    return;
  }

  const sorted = [...realTrials].sort((a, b) =>
    a.relativeDiffSemitones - b.relativeDiffSemitones
  );

  function accuracy(trials) {
    if (trials.length === 0) return 1;
    let correctCount = trials.filter(t => t.correct).length;
    return correctCount / trials.length;
  }

  let newLow = defaultLow;
  let newHigh = defaultHigh;

  let uniqueSems = [...new Set(sorted.map(t => t.relativeDiffSemitones))];

  for (let c of uniqueSems) {
    let aboveSet = sorted.filter(t => t.relativeDiffSemitones > c);
    if (accuracy(aboveSet) > 0.9) {
      newHigh = c;
      break;
    }
  }

  for (let c of uniqueSems) {
    let rangeSet = sorted.filter(t => t.relativeDiffSemitones >= c && t.relativeDiffSemitones <= newHigh);
    if (accuracy(rangeSet) > 0.6) {
      newLow = c;
      break;
    }
  }

  if (newLow < 0.01) newLow = 0.01;
  if (newHigh < 0.01) newHigh = 0.01;
  if (newHigh < newLow) {
    newLow = defaultLow;
    newHigh = defaultHigh;
  }

  lowSemitoneRange = newLow;
  highSemitoneRange = newHigh;
}

// ===========================
// Audio Helpers
// ===========================
async function ensureAudioContext() {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioContext.state === 'suspended') {
    try {
      await audioContext.resume();
    } catch (error) {
      console.error('Unable to resume audio context', error);
    }
  }
}

async function renderDoubleTone(freq1, freq2, toneDurationSec, gapMs) {
  const sampleRate = audioContext.sampleRate || 44100;
  const fadeTime = 0.01;
  const fadeSamples = Math.floor(sampleRate * fadeTime);

  const toneSamples = Math.floor(sampleRate * toneDurationSec);
  const gapSamples  = Math.floor(sampleRate * (gapMs / 1000));
  const totalSamples = toneSamples + gapSamples + toneSamples;

  const offline = new OfflineAudioContext(1, totalSamples, sampleRate);
  const audioBuffer = offline.createBuffer(1, totalSamples, sampleRate);
  const data = audioBuffer.getChannelData(0);

  // 1) First Tone
  for (let i = 0; i < toneSamples; i++) {
    let envelope = 1.0;
    if (i < fadeSamples) envelope = i / fadeSamples;
    else if (i > toneSamples - fadeSamples) envelope = (toneSamples - i) / fadeSamples;
    data[i] = envelope * Math.sin(2 * Math.PI * freq1 * (i / sampleRate));
  }

  // 2) Gap (already 0)

  // 3) Second Tone
  const secondToneStart = toneSamples + gapSamples;
  for (let i = 0; i < toneSamples; i++) {
    let envelope = 1.0;
    if (i < fadeSamples) envelope = i / fadeSamples;
    else if (i > toneSamples - fadeSamples) envelope = (toneSamples - i) / fadeSamples;
    data[secondToneStart + i] = envelope * Math.sin(2 * Math.PI * freq2 * (i / sampleRate));
  }

  // Return the raw AudioBuffer directly, bypassing OfflineAudioContext rendering since we manually filled it.
  return audioBuffer;
}

// ===========================
// Math Helpers
// ===========================
function randomBaseFreq() {
  return Math.random()*(MAX_BASE_FREQ - MIN_BASE_FREQ) + MIN_BASE_FREQ;
}
function clampFreq(freq) {
  return Math.max(MIN_BASE_FREQ, Math.min(MAX_BASE_FREQ, freq));
}
function pickRandomInLogSpace(minVal, maxVal) {
  const logMin = Math.log10(minVal);
  const logMax = Math.log10(maxVal);
  if(logMax <= logMin) return (minVal + maxVal) / 2;
  const r = Math.random();
  const chosenLog = logMin + r*(logMax - logMin);
  return Math.pow(10, chosenLog);
}

// ===========================
// jsPsych Timeline Logic
// ===========================

function stageHTML(content = '', progress = '') {
  const progressText = progress ? `<div class="trial-progress">${progress}</div>` : '';
  return `<div class="stage">${progressText}${content}</div>`;
}

function responseSplitHTML() {
  return `
    <div class="response-split" id="response-split-area">
      <div class="split-half split-higher" data-choice="higher">HIGHER ↑</div>
      <div class="split-half split-lower" data-choice="lower">LOWER ↓</div>
    </div>
  `;
}

// Instructions
const instructions = {
  type: jsPsychHtmlButtonResponse,
  stimulus: () => `
    <h1 style="margin-top:0">Pitch Memory Experiment</h1>
    <p>
      You will hear two tones in quick succession.<br>
      Decide if the <strong>second tone</strong> is higher (↑) or lower (↓) than the first.<br><br>
      Use the mouse to click the screen halves, or press the <strong>Up / Down arrows</strong> on your keyboard.
    </p>
  `,
  choices: ['Continue']
};

// Trial setup & playback
const createTrialSetup = () => ({
  type: jsPsychCallFunction,
  func: () => {
    trialState = {
      baseFrequency: randomBaseFreq(),
      isSecondHigher: Math.random() < 0.5,
      gap: MIN_GAP_MS + Math.random() * (MAX_GAP_MS - MIN_GAP_MS)
    };

    if (isTestMode) {
      const diffSem = 12;
      let ratio = Math.pow(2, diffSem / 12);
      if (!trialState.isSecondHigher) ratio = 1 / ratio;
      trialState.secondFrequency = clampFreq(trialState.baseFrequency * ratio);
    } else {
      const minVal = (realTrialCount < 50) ? 0.01 : lowSemitoneRange;
      const maxVal = (realTrialCount < 50) ? 2.0 : highSemitoneRange;
      let absSemitone = pickRandomInLogSpace(minVal, maxVal);

      let ratio = Math.pow(2, absSemitone / 12);
      if (!trialState.isSecondHigher) ratio = 1 / ratio;
      trialState.secondFrequency = clampFreq(trialState.baseFrequency * ratio);
    }

    // Recalculate true semitone difference applied due to potential clamping
    const ratioVal = trialState.secondFrequency / trialState.baseFrequency;
    const usedSem = 12 * (Math.log(ratioVal) / Math.log(2));
    trialState.absSemitone = Math.max(0.00001, Math.abs(usedSem));
  }
});

const playAudioNode = {
  type: jsPsychCallFunction,
  async: true,
  func: async (callback) => {
    const display = jsPsych.getDisplayElement();
    const modeText = isTestMode ? 'Test Mode' : `Trial ${realTrialCount + 1}`;
    if (display) {
      display.innerHTML = stageHTML(
        '<div class="speaker-icon" role="img" aria-label="speaker">🔊</div><p>Listening...</p>',
        modeText
      );
    }

    await ensureAudioContext();
    const buffer = await renderDoubleTone(
      trialState.baseFrequency,
      trialState.secondFrequency,
      TONE_DURATION,
      trialState.gap
    );

    // Give a small pause before sound starts
    window.setTimeout(() => {
      trialState.firstSoundStartTime = performance.now();
      const source = audioContext.createBufferSource();
      source.buffer = buffer;
      source.connect(audioContext.destination);
      source.start();

      source.onended = () => {
        callback();
      };
    }, 300);
  }
};

const responseNode = {
  type: jsPsychCallFunction,
  async: true,
  func: (callback) => {
    const display = jsPsych.getDisplayElement();
    const modeText = isTestMode ? 'Test Mode' : `Trial ${realTrialCount + 1}`;

    if (display) {
      display.innerHTML = stageHTML(
        responseSplitHTML(),
        modeText
      );

      const splitArea = document.getElementById('response-split-area');

      // Delay response activation slightly to match original behavior (enableResponseAreas)
      window.setTimeout(() => {
        splitArea.classList.add('active');
        trialState.responseStartTime = performance.now();

        const handleChoice = (choice) => {
          cleanup();
          const rt = performance.now() - trialState.responseStartTime;
          callback({ choice, rt });
        };

        // Mouse clicks
        const higherBtn = display.querySelector('.split-higher');
        const lowerBtn = display.querySelector('.split-lower');

        higherBtn.onclick = () => handleChoice('higher');
        lowerBtn.onclick = () => handleChoice('lower');

        // Keyboard
        const keyListener = (e) => {
          if (e.key === 'ArrowUp') {
            e.preventDefault();
            handleChoice('higher');
          } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            handleChoice('lower');
          }
        };
        window.addEventListener('keydown', keyListener);

        function cleanup() {
          window.removeEventListener('keydown', keyListener);
        }
      }, 50);
    }
  },
  on_finish: (data) => {
    const result = data.value;
    const userSaysHigher = result.choice === 'higher';
    const correct = (userSaysHigher === trialState.isSecondHigher);

    // Save to jsPsych data
    data.is_test_mode = isTestMode;
    data.first_frequency = trialState.baseFrequency;
    data.second_frequency = trialState.secondFrequency;
    data.gap_ms = trialState.gap;
    data.relativeDiffSemitones = trialState.absSemitone;
    data.user_response = result.choice;
    data.correct = correct;
    data.rt = result.rt;

    trialState.correct = correct;
  }
};

const feedbackNode = {
  type: jsPsychHtmlKeyboardResponse,
  stimulus: () => {
    if (isTestMode) {
      if (trialState.correct) {
        testCorrectCount++;
        return `<h2>Correct! (${testCorrectCount}/${NEEDED_TEST_CORRECT})</h2>`;
      } else {
        testCorrectCount = 0;
        return `<h2>Wrong! You need ${NEEDED_TEST_CORRECT} consecutive correct.</h2>`;
      }
    } else {
      // In real mode, maybe no feedback? Original app had no feedback in real mode.
      return ``;
    }
  },
  choices: "NO_KEYS",
  trial_duration: () => isTestMode ? 1000 : 0
};

const checkTestEndNode = {
  type: jsPsychCallFunction,
  func: () => {
    if (!isTestMode) {
      realTrialCount++;
      trialNumberInBatch++;

      // Update bounds every 50 real trials
      if (realTrialCount >= 50 && realTrialCount % 50 === 0) {
        const allData = jsPsych.data.get().values();
        // Include previously uploaded real trials to ensure we have >= 50 total for bounds update
        const uploadedRealTrials = uploadedDataArray.filter(t => t.is_test_mode === false);
        const newRealTrials = allData.filter(t => t.is_test_mode === false);
        const combinedRealTrials = [...uploadedRealTrials, ...newRealTrials];
        updateSamplingBounds(combinedRealTrials, 0.01, 2.0);
      }
    }
  }
};

const trialSequence = {
  timeline: [createTrialSetup(), playAudioNode, responseNode, feedbackNode, checkTestEndNode]
};

const testLoop = {
  timeline: [trialSequence],
  loop_function: () => {
    if (isTestMode && testCorrectCount >= NEEDED_TEST_CORRECT) {
      isTestMode = false;
      return false; // Exit loop
    }
    return isTestMode; // Continue if still in test mode
  }
};

const testCompleteScreen = {
  type: jsPsychHtmlButtonResponse,
  stimulus: () => `
    <h1>Test Complete!</h1>
    <p>
      You have reached 5 consecutive correct answers in the test trials.<br>
      Now the real experiment will begin.<br>
      The first 50 real trials sample semitone differences from 0.01..2 (log scale).<br>
      After 50, we adapt bounds to keep you near 60–90% accuracy ranges.<br>
    </p>
  `,
  choices: ['Continue']
};

const realBatchLoop = {
  timeline: [trialSequence],
  loop_function: () => {
    if (trialNumberInBatch >= 10) {
      return false; // Break out of this batch to show batch end screen
    }
    return true; // Continue batch
  }
};

const batchEndScreen = {
  type: jsPsychHtmlButtonResponse,
  stimulus: () => {
    batchNumber++;
    return `
      <h1>Batch Complete</h1>
      <p>
        You have finished ${batchNumber * 10} trials so far.<br>
        Click Continue to proceed to the next batch, or Stop to finish.
      </p>
    `;
  },
  choices: ['Continue', 'Stop'],
  on_finish: (data) => {
    trialNumberInBatch = 0; // reset for next batch
    if (data.response === 1) { // Stop
      jsPsych.endExperiment('Experiment stopped by user.');
    }
  }
};

const realExperimentLoop = {
  timeline: [realBatchLoop, batchEndScreen],
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
  const combined = uploadedDataArray.length ? [...uploadedDataArray, ...newValues] : [...newValues];
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

  if (newValues.length) {
    downloadBlob(JSON.stringify(combined, null, 2), `pitch-memory-${timestamp}.json`, 'application/json');
    downloadBlob(jsPsych.data.get().csv(), `pitch-memory-${timestamp}.csv`, 'text/csv');
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
  sessionRunning = true;
  sessionFinalized = false;

  if (preExperimentOverlay) {
    preExperimentOverlay.classList.add('hidden');
  }

  if (stopExperimentButton) {
    stopExperimentButton.hidden = false;
  }

  jsPsych.data.reset(true);

  // If we loaded data and have > 50 real trials, we skip test mode
  const realTrialsLoaded = uploadedDataArray.filter(t => t.is_test_mode === false);
  if (realTrialsLoaded.length >= 50) {
    isTestMode = false;
    realTrialCount = realTrialsLoaded.length;
    batchNumber = Math.floor(realTrialCount / 10);
    trialNumberInBatch = realTrialCount % 10;
    updateSamplingBounds(realTrialsLoaded, 0.01, 2.0);
  } else {
    isTestMode = true;
    testCorrectCount = 0;
  }

  const timeline = [];
  timeline.push(instructions);

  if (isTestMode) {
    timeline.push(testLoop);
    timeline.push(testCompleteScreen);
  }

  timeline.push(realExperimentLoop);

  jsPsych.run(timeline);
}

function handleFileLoad(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (loadEvent) => {
    try {
      const parsed = JSON.parse(loadEvent.target?.result);
      if (!Array.isArray(parsed)) {
        setStatus('Invalid data array.', 'error');
        return;
      }
      uploadedDataArray = parsed;
      const realTrials = uploadedDataArray.filter(t => t.is_test_mode === false);
      setStatus(`Loaded ${uploadedDataArray.length} total trials (${realTrials.length} real).`, 'info');

      if (realTrials.length >= 50) {
        startButton.textContent = 'Start Real Experiment';
      }
    } catch (e) {
      setStatus('Failed to parse JSON.', 'error');
    }
  };
  reader.readAsText(file);
}

// Event Listeners
if (startButton) startButton.addEventListener('click', handleStartClick);
if (fileInput) fileInput.addEventListener('change', handleFileLoad);
if (stopExperimentButton) {
  stopExperimentButton.addEventListener('click', () => {
    finalizeSession('stopped');
  });
}

jsPsych.onFinish(() => {
  if (!sessionFinalized) finalizeSession('complete');
});
