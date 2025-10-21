const manifestUrl = '../shared-resources/things_images/manifest.json';
const NEUTRAL_DIR = '../shared-resources/things_images/neutral_images';
const PROTOTYPICAL_DIR = '../shared-resources/things_images/prototypical_images';
const OUTLIER_DIR = '../shared-resources/things_images/outliers_images';

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
const keyboardListeners = new WeakMap();

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

function prefixFromFilename(filename) {
  const basename = filename.replace(/\.[^.]+$/, '');
  const idx = basename.lastIndexOf('_');
  return idx >= 0 ? basename.slice(0, idx) : basename;
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

function mapByPrefix(files) {
  const map = new Map();
  for (const file of files) {
    const prefix = prefixFromFilename(file);
    if (!map.has(prefix)) {
      map.set(prefix, []);
    }
    map.get(prefix).push(file);
  }
  return map;
}

function buildTrials(manifest) {
  const neutralFiles = manifest['neutral_images'] || [];
  const prototypicalMap = mapByPrefix(manifest['prototypical_images'] || []);
  const outlierMap = mapByPrefix(manifest['outliers_images'] || []);

  const trials = [];
  const skipped = [];

  for (const neutralFilename of neutralFiles) {
    const prefix = prefixFromFilename(neutralFilename);
    const prototypicalCandidates = prototypicalMap.get(prefix) || [];
    const outlierCandidates = outlierMap.get(prefix) || [];

    if (prototypicalCandidates.length === 0 || outlierCandidates.length === 0) {
      console.warn(`Skipping ${neutralFilename}: missing prototypical or outlier match.`);
      skipped.push({ neutral: neutralFilename, prefix, missingPrototypical: prototypicalCandidates.length === 0, missingOutlier: outlierCandidates.length === 0 });
      continue;
    }

    const prototypicalFilename = prototypicalCandidates[0];
    const outlierFilename = outlierCandidates[0];

    const distractorPool = neutralFiles.filter((f) => f !== neutralFilename);
    if (distractorPool.length === 0) {
      throw new Error('At least two neutral images are required to generate distractors.');
    }

    const makeTrial = (condition, targetFilename) => {
      const targetFolder = condition === 'prototypical' ? PROTOTYPICAL_DIR : OUTLIER_DIR;
      const targetPath = joinPath(targetFolder, targetFilename);
      const referencePath = joinPath(NEUTRAL_DIR, neutralFilename);
      const distractorFilename = chooseRandom(distractorPool);
      const distractorPath = joinPath(NEUTRAL_DIR, distractorFilename);
      const targetOnLeft = Math.random() < 0.5;

      const leftImagePath = targetOnLeft ? targetPath : distractorPath;
      const rightImagePath = targetOnLeft ? distractorPath : targetPath;

      return {
        condition,
        prefix,
        neutralFilename,
        referencePath,
        targetFilename,
        targetPath,
        distractorFilename,
        distractorPath,
        targetPosition: targetOnLeft ? 'left' : 'right',
        leftImagePath,
        rightImagePath
      };
    };

    trials.push(makeTrial('prototypical', prototypicalFilename));
    trials.push(makeTrial('outlier', outlierFilename));
  }

  return { trials: shuffleInPlace(trials), skipped };
}

const decodedImageCache = new Map();

async function ensureImageDecoded(src) {
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
    images.add(trial.referencePath);
    images.add(trial.leftImagePath);
    images.add(trial.rightImagePath);
  }
  const imageList = Array.from(images);
  await jsPsych.pluginAPI.preloadImages(imageList);
  await Promise.all(imageList.map((src) => ensureImageDecoded(src).catch((error) => console.error(error))));
}

function renderStimulus(referencePath) {
  return `
    <div class="afc-trial">
      <div class="afc-instructions">Memorize the reference image. When it disappears, choose the matching image.</div>
      <div class="afc-stage">
        <div class="afc-reference-phase" data-phase="reference">
          <div class="afc-reference-frame">
            <img src="${referencePath}" alt="Reference image" />
          </div>
          <div class="afc-reference-label" aria-hidden="true">Reference</div>
        </div>
        <div class="afc-choice-phase" data-phase="choices">
          <div class="afc-choice-slot" data-slot="left"></div>
          <div class="afc-choice-slot" data-slot="right"></div>
        </div>
      </div>
    </div>
  `;
}

function buildTimeline(trials) {
  let index = 0;
  return trials.map((trial) => {
    index += 1;

    const node = {
      type: jsPsychHtmlButtonResponse,
      stimulus: renderStimulus(trial.referencePath),
      choices: ['', ''],
      button_html: [
        `<button type="button" class="afc-choice" data-choice="left" aria-label="Left choice"><img src="${trial.leftImagePath}" alt="Left option" /></button>`,
        `<button type="button" class="afc-choice" data-choice="right" aria-label="Right choice"><img src="${trial.rightImagePath}" alt="Right option" /></button>`
      ],
      margin_vertical: '0px',
      margin_horizontal: '0px',
      prompt: '<div class="afc-help">Use ← / → keys or tap an image to respond.</div>',
      data: {
        task: 'things-2afc',
        trial_number: index,
        trial_condition: trial.condition,
        reference_image: trial.neutralFilename,
        target_image: trial.targetFilename,
        target_folder: trial.condition === 'prototypical' ? 'prototypical_images' : 'outliers_images',
        distractor_image: trial.distractorFilename,
        target_position: trial.targetPosition,
        object_prefix: trial.prefix
      }
    };

    node.on_load = () => {
      const syncProgressBar = () => {
        const progressInner = document.querySelector('#jspsych-progressbar-inner');
        if (progressInner) {
          const progress = totalTrials === 0 ? 0 : completedTrials / totalTrials;
          jsPsych.setProgressBar(progress);
        } else {
          requestAnimationFrame(syncProgressBar);
        }
      };

      syncProgressBar();

      const group = document.getElementById('jspsych-html-button-response-btngroup');
      const choicePhase = document.querySelector('.afc-choice-phase');
      const referencePhase = document.querySelector('.afc-reference-phase');
      if (group && choicePhase) {
        group.classList.add('afc-choice-group');
        const [leftWrapper, rightWrapper] = group.querySelectorAll('.jspsych-html-button-response-button');
        const leftSlot = choicePhase.querySelector('.afc-choice-slot[data-slot="left"]');
        const rightSlot = choicePhase.querySelector('.afc-choice-slot[data-slot="right"]');
        if (leftWrapper && leftSlot) {
          leftSlot.appendChild(leftWrapper);
        }
        if (rightWrapper && rightSlot) {
          rightSlot.appendChild(rightWrapper);
        }
      }

      const activeImages = document.querySelectorAll('.afc-stage img');
      activeImages.forEach((img) => {
        const src = img.getAttribute('src');
        if (!src) return;
        const cached = decodedImageCache.get(src);
        if (cached) {
          img.src = cached.src;
        }
      });

      const leftButton = document.querySelector('#jspsych-html-button-response-button-0 button');
      const rightButton = document.querySelector('#jspsych-html-button-response-button-1 button');
      node._responseSource = 'unknown';
      const allButtons = [leftButton, rightButton].filter(Boolean);
      allButtons.forEach((btn) => {
        btn.disabled = true;
      });
      if (leftButton) {
        leftButton.addEventListener('pointerdown', () => { node._responseSource = 'pointer'; }, { once: true });
      }
      if (rightButton) {
        rightButton.addEventListener('pointerdown', () => { node._responseSource = 'pointer'; }, { once: true });
      }

      node._choicesAvailable = false;
      node._trialStart = performance.now();
      const revealChoices = () => {
        if (referencePhase) {
          referencePhase.classList.add('afc-phase--hidden');
        }
        if (choicePhase) {
          choicePhase.classList.add('is-active');
        }
        allButtons.forEach((btn) => {
          if (btn) {
            btn.disabled = false;
          }
        });
        node._choicesAvailable = true;
        node._choiceRevealTime = performance.now();
      };
      node._choiceRevealTimeout = window.setTimeout(revealChoices, 500);

      const listener = jsPsych.pluginAPI.getKeyboardResponse({
        callback_function: (info) => {
          if (!node._choicesAvailable) {
            return;
          }
          if (info.key === 'arrowleft' && leftButton) {
            node._responseSource = 'keyboard';
            leftButton.click();
          } else if (info.key === 'arrowright' && rightButton) {
            node._responseSource = 'keyboard';
            rightButton.click();
          }
        },
        valid_responses: ['arrowleft', 'arrowright'],
        rt_method: 'performance',
        persist: false,
        allow_held_key: false
      });
      keyboardListeners.set(node, listener);
    };

    node.on_finish = (data) => {
      const listener = keyboardListeners.get(node);
      if (listener) {
        jsPsych.pluginAPI.cancelKeyboardResponse(listener);
        keyboardListeners.delete(node);
      }
      if (node._choiceRevealTimeout) {
        window.clearTimeout(node._choiceRevealTimeout);
        node._choiceRevealTimeout = null;
      }

      const responseIndex = typeof data.response === 'number' ? data.response : null;
      const selection = responseIndex === 0 ? 'left' : responseIndex === 1 ? 'right' : null;

      data.selection = selection;
      data.correct = selection === trial.targetPosition ? 1 : 0;
      data.target_path = trial.targetPath;
      data.reference_path = trial.referencePath;
      data.distractor_path = trial.distractorPath;
      data.response_key = selection;
      data.response_source = node._responseSource || 'unknown';
      if (typeof data.rt === 'number' && typeof node._choiceRevealTime === 'number' && typeof node._trialStart === 'number') {
        const revealOffset = Math.max(0, node._choiceRevealTime - node._trialStart);
        const adjusted = Math.max(0, data.rt - revealOffset);
        data.rt = adjusted;
        data.choice_delay = revealOffset;
      }

      completedTrials += 1;
      jsPsych.setProgressBar(completedTrials / totalTrials);
      updateProgress();
    };

    return node;
  });
}

function updateProgress() {
  progressStatus.textContent = `Trials completed: ${completedTrials} / ${totalTrials}`;
  downloadCsvButton.disabled = jsPsych.data.get().count() === 0;
  downloadJsonButton.disabled = downloadCsvButton.disabled;
}

function download(type) {
  const stamp = formatTimestamp();
  const filename = `things-2afc-${stamp}.${type}`;
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
    const { trials, skipped } = buildTrials(manifest);
    if (trials.length === 0) {
      throw new Error('No trials could be generated.');
    }
    allTrials = trials;
    totalTrials = trials.length;
    progressStatus.textContent = `Trials prepared: ${totalTrials}`;
    stimulusStatus.textContent = 'Preloading images…';
    await preloadImages(trials);
    stimulusStatus.textContent = 'Stimuli ready. Press Start to begin.';
    startButton.disabled = false;
    startButton.textContent = 'Start experiment';
    if (skipped.length > 0) {
      setStatus(`${skipped.length} reference image${skipped.length === 1 ? ' was' : 's were'} skipped due to missing matches.`, 'info');
    }
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
  const trialOrder = jsPsych.randomization.shuffle(allTrials.slice());
  const timeline = buildTimeline(trialOrder);
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
