const manifestUrl = '../shared-resources/things_images/manifest.json';
const NEUTRAL_DIR = '../shared-resources/things_images/neutral_images';

const startButton = document.getElementById('start-button');
const stopButton = document.getElementById('stop-button');
const downloadCsvButton = document.getElementById('download-csv');
const downloadJsonButton = document.getElementById('download-json');
const stimulusStatus = document.getElementById('stimulus-status');
const progressStatus = document.getElementById('progress-status');
const messageArea = document.getElementById('message-area');
const jspsychContainer = document.getElementById('jspsych-target');

const jsPsych = initJsPsych({
  display_element: 'jspsych-target',
  show_progress_bar: true,
  auto_update_progress_bar: false,
  on_finish: () => finalizeSession('complete'),
  on_data_update: function(data) {
    if (data.task === 'dual-image-masking') {
      completedTrials += 1;
      if (typeof jsPsych.setProgressBar === 'function') {
        jsPsych.setProgressBar(completedTrials / totalTrials);
      }
      updateProgress();
    }
  }
});

let allTrials = [];
let experimentRunning = false;
let completedTrials = 0;
let totalTrials = 0;
let questEngine = null;
let imagePool = [];

function formatTimestamp() {
  const now = new Date();
  const pad = (n) => `${n}`.padStart(2, '0');
  return [
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`,
    `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  ].join('-');
}

function setStatus(text, type = 'info') {
  messageArea.textContent = text;
  messageArea.className = type === 'error' ? 'error-message' : type === 'success' ? 'completion-message' : '';
}

function joinPath(base, filename) {
  return `${base}/${encodeURIComponent(filename)}`;
}

function chooseRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function shuffleInPlace(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

async function loadManifest() {
  const response = await fetch(manifestUrl, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Failed to load manifest (${response.status})`);
  }
  return response.json();
}

const decodedImageCache = new Map();
async function ensureImageDecoded(src) {
  if (decodedImageCache.has(src)) return decodedImageCache.get(src);
  const decoded = await new Promise((resolve, reject) => {
    const img = new Image();
    img.src = src;
    img.decoding = 'sync';
    img.onload = async () => {
      try {
        if (typeof img.decode === 'function') await img.decode();
      } catch (error) {
        console.warn('Image decode warning for', src, error);
      }
      resolve(img);
    };
    img.onerror = () => reject(new Error(`Failed to decode image: ${src}`));
  });
  decodedImageCache.set(src, decoded);
  return decoded;
}

async function preloadImages(filenames) {
  const images = new Set();
  for (const file of filenames) {
    images.add(joinPath(NEUTRAL_DIR, file));
  }
  const imageList = Array.from(images);
  await jsPsych.pluginAPI.preloadImages(imageList);
  await Promise.all(imageList.map((src) => ensureImageDecoded(src).catch((error) => console.error(error))));
}

async function prepare() {
  try {
    stimulusStatus.textContent = 'Loading stimulus manifest…';
    const manifest = await loadManifest();

    const neutralFiles = manifest['neutral_images'] || [];
    if (neutralFiles.length < 10) throw new Error('Not enough neutral images.');

    imagePool = shuffleInPlace([...neutralFiles]).slice(0, 10);

    stimulusStatus.textContent = 'Preloading 10 selected images…';
    await preloadImages(imagePool);

    stimulusStatus.textContent = 'Images preloaded. Press Start to begin.';
    startButton.disabled = false;
    startButton.textContent = 'Start experiment';
    downloadCsvButton.disabled = jsPsych.data.get().count() === 0;
    downloadJsonButton.disabled = downloadCsvButton.disabled;
  } catch (error) {
    console.error(error);
    stimulusStatus.textContent = 'Could not prepare the experiment.';
    setStatus(error.message || 'Unknown error', 'error');
  }
}

function finalizeSession(status) {
  experimentRunning = false;
  if (status === 'complete') {
    jspsychContainer.classList.remove('active');
    const display = jsPsych.getDisplayElement();
    if (display) display.innerHTML = '';
  } else {
    jspsychContainer.classList.add('active');
  }
  stopButton.disabled = true;
  startButton.disabled = false;
  startButton.textContent = 'Restart experiment';
  setStatus(status === 'complete' ? 'Experiment finished. You may download your data.' : 'Experiment stopped. You may download your data.', status === 'complete' ? 'success' : 'info');
}

// jsQuestPlus wrapper for Weibull psychometric function
function pWeibull(stim, alpha, beta, guess, lapse) {
  return guess + (1 - guess - lapse) * (1 - Math.exp(-Math.pow(stim / alpha, beta)));
}

function initQuest() {
  const soaFrames = [1, 2, 3, 4, 5, 6, 7]; // 1-7 frames
  const alphas = [1, 2, 3, 4, 5, 6, 7]; // threshold guesses
  const betas = [1, 2, 3, 4]; // slopes
  const guessRates = [0.20]; // 2/10 chance of randomly picking T1
  const lapseRates = [0.01, 0.02, 0.05];

  questEngine = new jsQuestPlus({
    psych_func: [
      (stim, alpha, beta, guess, lapse) => pWeibull(stim, alpha, beta, guess, lapse),
      (stim, alpha, beta, guess, lapse) => 1 - pWeibull(stim, alpha, beta, guess, lapse)
    ],
    stim_samples: [soaFrames],
    psych_samples: [alphas, betas, guessRates, lapseRates]
  });
}

// Target 75% accuracy
const QUEST_TARGET_P = 0.75;

function suggestSOA() {
  let chosen = questEngine.getStimParams();
  let chosenValue = Array.isArray(chosen) ? chosen[0] : chosen;

  try {
    const est = questEngine.getEstimates('mode');
    if (Array.isArray(est) && est.length >= 4) {
      let best = chosenValue;
      let bestDiff = Infinity;
      const soaFrames = [1, 2, 3, 4, 5, 6, 7];
      for (const v of soaFrames) {
        const p = pWeibull(v, est[0], est[1], est[2], est[3]);
        const d = Math.abs(p - QUEST_TARGET_P);
        if (d < bestDiff) {
          bestDiff = d;
          best = v;
        }
      }
      chosenValue = best;
    }
  } catch (e) {
    // ignore
  }
  return chosenValue;
}

function buildTimeline(numTrials) {
  let index = 0;
  const timeline = [];

  const fixation = {
    type: jsPsychHtmlKeyboardResponse,
    stimulus: '<div style="font-size: 60px; color: white;">+</div>',
    choices: 'NO_KEYS',
    trial_duration: 500,
    post_trial_gap: 200
  };

  for (let i = 0; i < numTrials; i++) {
    index += 1;
    const trialIndex = index;
    timeline.push(fixation);

    // Pick T1 and T2 randomly from the 10 loaded images
    const t1Filename = chooseRandom(imagePool);
    let t2Filename;
    do {
      t2Filename = chooseRandom(imagePool);
    } while (t2Filename === t1Filename);

    const t1Src = joinPath(NEUTRAL_DIR, t1Filename);
    const t2Src = joinPath(NEUTRAL_DIR, t2Filename);

    // Flash node: Fixation -> T1 -> SOA delay -> T2
    const flashNode = {
      type: jsPsychHtmlKeyboardResponse,
      stimulus: `
        <div class="rsvp-trial">
          <div class="rsvp-stage">
            <div class="rsvp-reference-phase">
              <div class="rsvp-reference-frame" id="stimulus-frame">
                <img id="flash-image" src="" alt="Flash stimulus" style="display:none;" />
              </div>
            </div>
          </div>
        </div>
      `,
      choices: 'NO_KEYS',
      post_trial_gap: 0,
      on_load: () => {
        const currentSOA = suggestSOA();
        flashNode.data = { soa_frames: currentSOA }; // inject data

        const frameMs = 1000 / 60; // Approximate 16.67ms
        const t1Duration = 1 * frameMs;
        const soaMs = currentSOA * frameMs;
        const t2Duration = 1 * frameMs;

        const imgElement = document.getElementById('flash-image');

        imgElement.src = t1Src;
        imgElement.style.display = 'block';

        window.setTimeout(() => {
          imgElement.style.display = 'none';

          window.setTimeout(() => {
            imgElement.src = t2Src;
            imgElement.style.display = 'block';

            window.setTimeout(() => {
              imgElement.style.display = 'none';
              jsPsych.pluginAPI.clearAllTimeouts(); // Ensure no internal jsPsych timeouts bleed over
              jsPsych.finishTrial({
                t1_filename: t1Filename,
                t2_filename: t2Filename,
                soa_frames: currentSOA
              });
            }, t2Duration);
          }, Math.max(0, soaMs - t1Duration));

        }, t1Duration);
      }
    };

    timeline.push(flashNode);

    // Response Node (all 10 images)
    const choices = shuffleInPlace([...imagePool]).map(filename => ({
      filename,
      src: joinPath(NEUTRAL_DIR, filename)
    }));

    const choiceButtons = choices.map((choice, idx) => {
      return `<button type="button" class="afc-choice" data-index="${idx}" data-filename="${choice.filename}"><img src="${choice.src}" alt="Option" /></button>`;
    });

    const responseNode = {
      type: jsPsychHtmlButtonResponse,
      stimulus: `
        <div class="rsvp-trial">
          <div class="rsvp-instructions">Select the two images you saw.</div>
          <div class="afc-choice-phase is-active">
            ${choiceButtons.join('')}
          </div>
          <div style="margin-top: 20px;">
            <button type="button" id="submit-selection" class="primary" disabled style="font-size: 1.1rem; padding: 12px 24px;">Submit Selection</button>
          </div>
        </div>
      `,
      choices: [],
      margin_vertical: '0px',
      margin_horizontal: '0px',
      data: {
        task: 'dual-image-masking',
        trial_number: trialIndex,
        t1_filename: t1Filename,
        t2_filename: t2Filename
      },
      on_load: () => {
        // Retrieve the actual SOA used from the previous flashNode trial data
        const prevData = jsPsych.data.get().last(1).values()[0];
        const soa_frames = prevData.soa_frames;
        responseNode._currentSoa = soa_frames;

        const buttons = document.querySelectorAll('.afc-choice');
        let selectionOrder = [];

        const submitButton = document.getElementById('submit-selection');

        const updateSelectionVisuals = () => {
          buttons.forEach((btn, idx) => {
            btn.classList.remove('selected');
            if (selectionOrder.includes(idx)) {
              btn.classList.add('selected');
            }
          });
          submitButton.disabled = selectionOrder.length !== 2;
        };

        const finishTrial = () => {
          buttons.forEach(b => b.disabled = true);
          const choice1 = choices[selectionOrder[0]];
          const choice2 = choices[selectionOrder[1]];
          const selectedFilenames = [choice1.filename, choice2.filename];

          const t1Correct = selectedFilenames.includes(t1Filename);
          const t2Correct = selectedFilenames.includes(t2Filename);

          // Update QUEST
          try {
            questEngine.update(soa_frames, t1Correct ? 1 : 0);
          } catch (e) {
            console.warn('Quest update skipped', e);
          }

          jsPsych.finishTrial({
            selected_1: choice1.filename,
            selected_2: choice2.filename,
            correct_1: t1Correct,
            correct_2: t2Correct,
            both_correct: t1Correct && t2Correct,
            soa_frames: soa_frames,
            rt: performance.now() - responseNode._startTime
          });
        };

        submitButton.addEventListener('click', finishTrial);

        buttons.forEach((btn, idx) => {
          btn.addEventListener('click', (e) => {
            e.preventDefault();
            const pos = selectionOrder.indexOf(idx);
            if (pos !== -1) {
              selectionOrder.splice(pos, 1); // deselect
            } else {
              if (selectionOrder.length < 2) {
                selectionOrder.push(idx);
              }
            }
            updateSelectionVisuals();
          });
        });
        responseNode._startTime = performance.now();
      },
      post_trial_gap: () => 800 + Math.floor(Math.random() * 1000)
    };

    timeline.push(responseNode);
  }

  return timeline;
}

function updateProgress() {
  progressStatus.textContent = `Trials completed: ${completedTrials} / ${totalTrials}`;
  downloadCsvButton.disabled = jsPsych.data.get().count() === 0;
  downloadJsonButton.disabled = downloadCsvButton.disabled;
}

function download(type) {
  const stamp = formatTimestamp();
  const filename = `dual-image-masking-${stamp}.${type}`;
  const mime = type === 'csv' ? 'text/csv' : 'application/json';
  const payload = type === 'csv' ? jsPsych.data.get().csv() : jsPsych.data.get().json(true);
  const blob = new Blob([payload], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

startButton.addEventListener('click', () => {
  if (imagePool.length < 10) {
    setStatus('Stimuli are not ready yet.', 'error');
    return;
  }

  jsPsych.data.reset();

  const subject_id = jsPsych.randomization.randomID(10);
  const filename = `${subject_id}.csv`;
  jsPsych.data.addProperties({ subject_id: subject_id });

  completedTrials = 0;
  totalTrials = 50; // 50 trials per experiment
  updateProgress();

  initQuest();
  const timeline = buildTimeline(totalTrials);

  const save_data = {
    type: jsPsychPipe,
    action: "save",
    experiment_id: "EJ8DP6RjZItO",
    filename: filename,
    data_string: () => jsPsych.data.get().csv()
  };
  timeline.push(save_data);

  setStatus('');
  jspsychContainer.classList.add('active');
  startButton.disabled = true;
  stopButton.disabled = false;
  experimentRunning = true;

  jsPsych.run(timeline);
});

stopButton.addEventListener('click', () => {
  if (!experimentRunning) return;
  jsPsych.endExperiment('Experiment stopped early. You may close this window or download your data below.');
  finalizeSession('stopped');
});

downloadCsvButton.addEventListener('click', () => {
  if (!downloadCsvButton.disabled) download('csv');
});

downloadJsonButton.addEventListener('click', () => {
  if (!downloadJsonButton.disabled) download('json');
});

prepare();
