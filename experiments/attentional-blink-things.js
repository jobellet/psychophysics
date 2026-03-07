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
  on_finish: () => finalizeSession('complete')
});

let allTrials = [];
let experimentRunning = false;
let completedTrials = 0;
let totalTrials = 0;

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

function generateShuffledMask(imageSrc) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const size = 300;
      canvas.width = size;
      canvas.height = size;
      ctx.drawImage(img, 0, 0, size, size);

      const gridSize = 10;
      const tileSize = size / gridSize;
      const tiles = [];
      for (let y = 0; y < gridSize; y++) {
        for (let x = 0; x < gridSize; x++) {
          tiles.push(ctx.getImageData(x * tileSize, y * tileSize, tileSize, tileSize));
        }
      }

      shuffleInPlace(tiles);
      const maskedCanvas = document.createElement('canvas');
      maskedCanvas.width = size;
      maskedCanvas.height = size;
      const maskedCtx = maskedCanvas.getContext('2d');

      let i = 0;
      for (let y = 0; y < gridSize; y++) {
        for (let x = 0; x < gridSize; x++) {
          maskedCtx.putImageData(tiles[i++], x * tileSize, y * tileSize);
        }
      }
      resolve(maskedCanvas.toDataURL());
    };
    img.onerror = () => reject(new Error('Failed to load image for masking.'));
    img.src = imageSrc;
  });
}

async function buildTrials(manifest) {
  const neutralFiles = manifest['neutral_images'] || [];
  const trials = [];

  if (neutralFiles.length < 50) {
    throw new Error('Not enough neutral images to generate trials.');
  }

  // Pre-generate a pool of 50 shuffled masks to reuse as distractors
  stimulusStatus.textContent = 'Generating distractor masks...';
  const maskPoolFiles = shuffleInPlace([...neutralFiles]).slice(0, 50);
  const maskPoolUrls = [];
  for (let i = 0; i < maskPoolFiles.length; i++) {
    const path = joinPath(NEUTRAL_DIR, maskPoolFiles[i]);
    const dataUrl = await generateShuffledMask(path);
    maskPoolUrls.push(dataUrl);
    if (i % 5 === 0) {
      stimulusStatus.textContent = `Generating distractor masks (${i}/${maskPoolFiles.length})...`;
    }
  }

  // Generate trials (e.g. 50 trials)
  const numTrials = 50;
  const trialImages = shuffleInPlace([...neutralFiles]).slice(50); // Images not used for masks

  // Lags and possible T1 positions
  const possibleT1Positions = [2, 3, 4]; // Frame 3, 4, or 5 (0-indexed)
  const possibleLags = [1, 2, 8];

  for (let i = 0; i < numTrials; i++) {
    // Pick T1 and T2 images
    const t1Filename = chooseRandom(trialImages);
    let t2Filename;
    do {
      t2Filename = chooseRandom(trialImages);
    } while (t2Filename === t1Filename);

    // Pick 4 distractor images for the response screen
    const responseDistractors = [];
    while (responseDistractors.length < 4) {
      const d = chooseRandom(trialImages);
      if (d !== t1Filename && d !== t2Filename && !responseDistractors.includes(d)) {
        responseDistractors.push(d);
      }
    }

    const t1Position = chooseRandom(possibleT1Positions);
    const lag = chooseRandom(possibleLags);
    const t2Position = t1Position + lag;

    // Build the stream of 20 items
    const stream = [];
    for (let f = 0; f < 20; f++) {
      if (f === t1Position) {
        stream.push({ type: 't1', src: joinPath(NEUTRAL_DIR, t1Filename), filename: t1Filename });
      } else if (f === t2Position) {
        stream.push({ type: 't2', src: joinPath(NEUTRAL_DIR, t2Filename), filename: t2Filename });
      } else {
        stream.push({ type: 'distractor', src: chooseRandom(maskPoolUrls) });
      }
    }

    // Build response choices
    const choices = [
      { type: 't1', src: joinPath(NEUTRAL_DIR, t1Filename), filename: t1Filename },
      { type: 't2', src: joinPath(NEUTRAL_DIR, t2Filename), filename: t2Filename },
      ...responseDistractors.map(d => ({ type: 'distractor', src: joinPath(NEUTRAL_DIR, d), filename: d }))
    ];
    shuffleInPlace(choices);

    trials.push({
      t1Position,
      t2Position,
      lag,
      stream,
      choices,
      t1Filename,
      t2Filename
    });
  }

  return trials;
}

const decodedImageCache = new Map();

async function ensureImageDecoded(src) {
  if (src.startsWith('data:')) return src;
  if (decodedImageCache.has(src)) {
    return decodedImageCache.get(src);
  }

  const decoded = await new Promise((resolve, reject) => {
    const img = new Image();
    img.src = src;
    img.decoding = 'sync';
    img.onload = async () => {
      try {
        if (typeof img.decode === 'function') {
          await img.decode();
        }
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

async function preloadImages(trials) {
  const images = new Set();
  for (const trial of trials) {
    images.add(trial.stream[trial.t1Position].src);
    images.add(trial.stream[trial.t2Position].src);
    for (const choice of trial.choices) {
      images.add(choice.src);
    }
  }
  const imageList = Array.from(images);
  await jsPsych.pluginAPI.preloadImages(imageList);
  await Promise.all(imageList.map((src) => ensureImageDecoded(src).catch((error) => console.error(error))));
}

function buildTimeline(trials) {
  let index = 0;
  const timeline = [];

  const fixation = {
    type: jsPsychHtmlKeyboardResponse,
    stimulus: '<div style="font-size: 60px; color: white;">+</div>',
    choices: 'NO_KEYS',
    trial_duration: 500,
    post_trial_gap: 0
  };

  trials.forEach((trial) => {
    index += 1;
    const trialIndex = index;

    timeline.push(fixation);

    // RSVP Stream
    const rsvpNode = {
      type: jsPsychHtmlKeyboardResponse,
      stimulus: `
        <div class="rsvp-trial">
          <div class="rsvp-stage">
            <div class="rsvp-reference-phase">
              <div class="rsvp-reference-frame" id="stimulus-frame">
                <img id="rsvp-image" src="${trial.stream[0].src}" alt="RSVP stimulus" />
              </div>
            </div>
          </div>
        </div>
      `,
      choices: 'NO_KEYS',
      trial_duration: 20 * 100, // 20 images * 100ms
      post_trial_gap: 0,
      on_load: () => {
        const imgElement = document.getElementById('rsvp-image');
        let currentFrame = 0;
        const totalFrames = 20;

        const nextFrame = () => {
          currentFrame++;
          if (currentFrame < totalFrames) {
            imgElement.src = trial.stream[currentFrame].src;
            window.setTimeout(nextFrame, 100);
          }
        };
        window.setTimeout(nextFrame, 100);
      }
    };
    timeline.push(rsvpNode);

    // Response Node
    const choiceButtons = trial.choices.map((choice, i) => {
      return `<button type="button" class="afc-choice" data-index="${i}" data-filename="${choice.filename}"><img src="${choice.src}" alt="Option ${i}" /></button>`;
    });

    const responseNode = {
      type: jsPsychHtmlButtonResponse,
      stimulus: `
        <div class="rsvp-trial">
          <div class="rsvp-instructions">Select the 2 target images in the order they appeared.</div>
          <div class="afc-choice-phase is-active">
            ${choiceButtons.join('')}
          </div>
        </div>
      `,
      choices: [],
      margin_vertical: '0px',
      margin_horizontal: '0px',
      data: {
        task: 'attentional-blink-things',
        trial_number: trialIndex,
        t1_filename: trial.t1Filename,
        t2_filename: trial.t2Filename,
        t1_position: trial.t1Position,
        t2_position: trial.t2Position,
        lag: trial.lag
      },
      on_load: () => {
        const buttons = document.querySelectorAll('.afc-choice');
        let selectionOrder = [];

        const updateSelectionVisuals = () => {
          buttons.forEach((btn, idx) => {
            btn.classList.remove('selected', 'selected-1', 'selected-2');
            const pos = selectionOrder.indexOf(idx);
            if (pos !== -1) {
              btn.classList.add('selected');
              btn.classList.add(`selected-${pos + 1}`);
            }
          });
        };

        buttons.forEach((btn, idx) => {
          btn.addEventListener('click', (e) => {
            e.preventDefault();
            const pos = selectionOrder.indexOf(idx);
            if (pos !== -1) {
              // Deselect if already selected
              selectionOrder.splice(pos, 1);
            } else {
              if (selectionOrder.length < 2) {
                selectionOrder.push(idx);
              }
            }
            updateSelectionVisuals();

            if (selectionOrder.length === 2) {
              // Disable all buttons to prevent double firing
              buttons.forEach(b => b.disabled = true);

              // Record data and finish trial
              const choice1 = trial.choices[selectionOrder[0]];
              const choice2 = trial.choices[selectionOrder[1]];

              jsPsych.finishTrial({
                selected_1: choice1.filename,
                selected_2: choice2.filename,
                correct_1: choice1.filename === trial.t1Filename,
                correct_2: choice2.filename === trial.t2Filename,
                both_correct: choice1.filename === trial.t1Filename && choice2.filename === trial.t2Filename,
                rt: performance.now() - responseNode._startTime
              });
            }
          });
        });
        responseNode._startTime = performance.now();
      },
      post_trial_gap: () => 800 + Math.floor(Math.random() * 1200) // 800ms to 2000ms ITI
    };

    timeline.push(responseNode);
  });

  return timeline;
}

function updateProgress() {
  progressStatus.textContent = `Trials completed: ${completedTrials} / ${totalTrials}`;
  downloadCsvButton.disabled = jsPsych.data.get().count() === 0;
  downloadJsonButton.disabled = downloadCsvButton.disabled;
}

function download(type) {
  const stamp = formatTimestamp();
  const filename = `things-attentional-blink-${stamp}.${type}`;
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

function finalizeSession(status) {
  experimentRunning = false;
  if (status === 'complete') {
    jspsychContainer.classList.remove('active');
    const display = jsPsych.getDisplayElement();
    if (display) {
      display.innerHTML = '';
    }
  } else {
    jspsychContainer.classList.add('active');
  }
  stopButton.disabled = true;
  startButton.disabled = false;
  startButton.textContent = 'Restart experiment';
  setStatus(status === 'complete' ? 'Experiment finished. You may download your data.' : 'Experiment stopped. You may download your data.', status === 'complete' ? 'success' : 'info');
}

async function prepare() {
  try {
    stimulusStatus.textContent = 'Loading stimulus manifest…';
    const manifest = await loadManifest();
    stimulusStatus.textContent = 'Building trials…';
    const trials = await buildTrials(manifest);
    if (trials.length === 0) {
      throw new Error('No trials could be generated.');
    }

    allTrials = trials;
    totalTrials = trials.length;
    progressStatus.textContent = `Trials prepared: ${totalTrials}`;

    stimulusStatus.textContent = 'Preloading target images…';
    await preloadImages(trials);

    stimulusStatus.textContent = 'Stimuli ready. Press Start to begin.';
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

startButton.addEventListener('click', () => {
  if (allTrials.length === 0) {
    setStatus('Stimuli are not ready yet.', 'error');
    return;
  }
  jsPsych.data.reset();
  completedTrials = 0;
  updateProgress();
  // Shuffle trial order before running
  const trialOrder = jsPsych.randomization.shuffle(allTrials.slice());
  const timeline = buildTimeline(trialOrder);
  setStatus('');
  jspsychContainer.classList.add('active');
  startButton.disabled = true;
  stopButton.disabled = false;
  experimentRunning = true;

  // Update progress after each trial completes (the response node)
  jsPsych.opts.on_data_update = (data) => {
    if (data.task === 'attentional-blink-things') {
      completedTrials += 1;
      jsPsych.setProgressBar(completedTrials / totalTrials);
      updateProgress();
    }
  };

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
