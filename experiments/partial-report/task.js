const GRID_ROWS = 3;
const GRID_COLS = 4;
const LETTER_SET = "ABCDEFGHJKLMPQRSTUVXYZ";
const STIM_DURATION_MS = 50;
const FIXATION_MIN_MS = 500;
const FIXATION_MAX_MS = 1000;
const CUE_DELAY_MIN_MS = 0;
const CUE_DELAY_MAX_MS = 1000;
const N_TRIALS = 120;
const PRACTICE_TRIALS = 8;
const USE_MASK = false;
const MASK_DURATION_MS = 100;
const FULLSCREEN = true;
const FONT_FAMILY = "monospace";
const LETTER_FONT_PX = 44;
const GRID_WIDTH_DVA = null;
const RESPONSE_TIMEOUT_MS = 15000;

class PartialReportTrial {
  static info = {
    name: 'partial-report',
    description: 'Sperling-style partial report trial',
    parameters: {
      is_practice: {
        type: jsPsych.plugins.parameterType.BOOL,
        default: false
      }
    }
  };

  constructor(jsPsych) {
    this.jsPsych = jsPsych;
  }

  trial(display_element, trial) {
    const jsPsych = this.jsPsych;
    const container = document.createElement('div');
    container.className = 'task-container';
    container.style.setProperty('--font-family', FONT_FAMILY);

    const stimulusArea = document.createElement('div');
    stimulusArea.className = 'stimulus-area';
    const responseArea = document.createElement('div');
    responseArea.className = 'response-area';
    responseArea.hidden = true;

    container.appendChild(stimulusArea);
    container.appendChild(responseArea);
    display_element.innerHTML = '';
    display_element.appendChild(container);

    const totalCells = GRID_ROWS * GRID_COLS;
    const fixationDuration = FIXATION_MIN_MS === FIXATION_MAX_MS
      ? FIXATION_MIN_MS
      : jsPsych.randomization.randomInt(FIXATION_MIN_MS, FIXATION_MAX_MS);
    const cueDelay = CUE_DELAY_MIN_MS === CUE_DELAY_MAX_MS
      ? CUE_DELAY_MIN_MS
      : jsPsych.randomization.randomInt(CUE_DELAY_MIN_MS, CUE_DELAY_MAX_MS);
    const nCued = jsPsych.randomization.randomInt(1, totalCells);

    const lettersPool = LETTER_SET.split('');
    if (lettersPool.length < totalCells) {
      throw new Error('LETTER_SET must contain at least GRID_ROWS * GRID_COLS unique letters.');
    }
    const lettersFlat = jsPsych.randomization.sampleWithoutReplacement(lettersPool, totalCells);
    const lettersGrid = [];
    for (let r = 0; r < GRID_ROWS; r++) {
      lettersGrid.push(lettersFlat.slice(r * GRID_COLS, (r + 1) * GRID_COLS));
    }

    const flatIndices = Array.from({ length: totalCells }, (_, i) => i);
    const cuedFlat = jsPsych.randomization.sampleWithoutReplacement(flatIndices, nCued);
    const cuedPositions = cuedFlat.map(index => ({
      row: Math.floor(index / GRID_COLS),
      col: index % GRID_COLS
    }));
    const targetLetters = cuedPositions.map(({ row, col }) => lettersGrid[row][col]);

    const letterPositions = [];
    let gridElement = null;
    let cueOnsetTime = null;
    let timedOut = false;
    let responseTimeoutHandle = null;
    let submitted = false;

    const typedRaw = [];

    function showFixation() {
      stimulusArea.innerHTML = '<div class="fixation">+</div>';
      jsPsych.pluginAPI.setTimeout(() => {
        showStimulus();
      }, fixationDuration);
    }

    function createGridCell(letter, row, col) {
      const cell = document.createElement('div');
      cell.className = 'letter-cell';
      cell.dataset.row = String(row);
      cell.dataset.col = String(col);

      if (letter) {
        const span = document.createElement('span');
        span.className = 'letter-symbol';
        span.textContent = letter;
        span.style.fontFamily = FONT_FAMILY;
        span.style.fontSize = `${LETTER_FONT_PX}px`;
        cell.appendChild(span);
      }

      return cell;
    }

    function buildGrid(showLetters = true, mask = false) {
      const grid = document.createElement('div');
      grid.className = 'letter-grid';
      grid.style.setProperty('--rows', GRID_ROWS);
      grid.style.setProperty('--cols', GRID_COLS);

      for (let r = 0; r < GRID_ROWS; r++) {
        for (let c = 0; c < GRID_COLS; c++) {
          const letter = showLetters
            ? lettersGrid[r][c]
            : mask
              ? '#'
              : '';
          const cell = createGridCell(letter, r, c);
          if (mask && letter) {
            cell.firstChild.classList.add('letter-mask');
          }
          grid.appendChild(cell);
        }
      }

      return grid;
    }

    function recordLetterPositions() {
      if (!gridElement) return;
      const cells = gridElement.querySelectorAll('.letter-cell');
      letterPositions.length = 0;
      cells.forEach(cell => {
        const rect = cell.getBoundingClientRect();
        letterPositions.push({
          row: Number(cell.dataset.row),
          col: Number(cell.dataset.col),
          x_px: rect.left + rect.width / 2,
          y_px: rect.top + rect.height / 2
        });
      });
    }

    function showStimulus() {
      stimulusArea.innerHTML = '';
      gridElement = buildGrid(true, false);
      stimulusArea.appendChild(gridElement);

      requestAnimationFrame(() => {
        recordLetterPositions();
      });

      jsPsych.pluginAPI.setTimeout(() => {
        hideStimulus();
      }, STIM_DURATION_MS);
    }

    function hideStimulus() {
      if (!gridElement) return;
      gridElement.querySelectorAll('.letter-cell').forEach(cell => {
        cell.innerHTML = '';
      });

      if (USE_MASK) {
        gridElement.remove();
        gridElement = buildGrid(true, true);
        stimulusArea.appendChild(gridElement);
        jsPsych.pluginAPI.setTimeout(() => {
          clearMask();
        }, MASK_DURATION_MS);
      } else {
        startCueDelay();
      }
    }

    function clearMask() {
      if (gridElement) {
        gridElement.querySelectorAll('.letter-cell').forEach(cell => {
          cell.innerHTML = '';
        });
      }
      startCueDelay();
    }

    function startCueDelay() {
      jsPsych.pluginAPI.setTimeout(() => {
        showCues();
      }, cueDelay);
    }

    function showCues() {
      if (!gridElement) {
        gridElement = buildGrid(false, false);
        stimulusArea.appendChild(gridElement);
      }

      const cells = gridElement.querySelectorAll('.letter-cell');
      cuedPositions.forEach(({ row, col }) => {
        const index = row * GRID_COLS + col;
        const cell = cells[index];
        if (!cell) return;
        const cue = document.createElement('div');
        cue.className = 'cue-square';
        cell.appendChild(cue);
      });

      cueOnsetTime = performance.now();
      responseArea.hidden = false;
      responseArea.innerHTML = `
        <p>Type all letters from the blue squares (order doesn’t matter). Press Enter to submit.</p>
        <div class="response-display" id="response-display">Your response: </div>
        <div class="response-error" id="response-error"></div>
      `;

      const responseDisplay = responseArea.querySelector('#response-display');
      const responseError = responseArea.querySelector('#response-error');

      function updateResponseDisplay() {
        const typed = typedRaw.join('').toUpperCase();
        responseDisplay.textContent = `Your response: ${typed}`;
      }

      function showError(message) {
        responseError.textContent = message;
      }

      function cleanResponse() {
        const lettersOnly = typedRaw
          .map(ch => ch.toUpperCase())
          .filter(ch => /^[A-Z]$/.test(ch));
        return lettersOnly;
      }

      function submitResponse(fromTimeout = false) {
        if (submitted) return;
        submitted = true;
        if (responseTimeoutHandle) {
          jsPsych.pluginAPI.clearTimeout(responseTimeoutHandle);
        }
        document.removeEventListener('keydown', handleKeydown, true);

        const responseLetters = cleanResponse();
        const seen = new Set();
        const responseUnique = [];
        responseLetters.forEach(letter => {
          if (!seen.has(letter)) {
            seen.add(letter);
            responseUnique.push(letter);
          }
        });

        const targetSet = new Set(targetLetters);
        const hits = responseUnique.filter(letter => targetSet.has(letter)).length;
        const misses = nCued - hits;
        const intrusions = responseUnique.filter(letter => !targetSet.has(letter)).length;
        const duplicates = responseLetters.length - responseUnique.length;

        const rt = cueOnsetTime ? performance.now() - cueOnsetTime : null;
        const data = {
          trial_index: jsPsych.getProgress().current_trial_global,
          is_practice: trial.is_practice,
          grid_rows: GRID_ROWS,
          grid_cols: GRID_COLS,
          letters_grid: lettersGrid,
          letter_positions: letterPositions,
          stim_duration_ms: STIM_DURATION_MS,
          fixation_duration_ms: fixationDuration,
          use_mask: USE_MASK,
          mask_duration_ms: MASK_DURATION_MS,
          cue_delay_ms: cueDelay,
          n_cued: nCued,
          cued_positions: cuedPositions,
          target_letters: targetLetters,
          response_raw: typedRaw.join(''),
          response_clean: responseLetters.join(''),
          response_unique: responseUnique,
          n_hits: hits,
          n_misses: misses,
          n_intrusions: intrusions,
          n_duplicates: duplicates,
          prop_correct: nCued > 0 ? hits / nCued : 0,
          rt_ms: rt,
          timed_out: timedOut || fromTimeout,
          response_timeout_ms: RESPONSE_TIMEOUT_MS
        };

        if (trial.is_practice) {
          const feedback = document.createElement('div');
          feedback.className = 'feedback';
          const lettersForFeedback = responseLetters.length > 0 ? responseLetters.join(' ') : '—';
          feedback.innerHTML = `Correct ${hits}/${nCued}.<br />Targets: ${targetLetters.join(' ')}<br />You typed: ${lettersForFeedback}`;
          responseArea.innerHTML = '';
          responseArea.appendChild(feedback);
          jsPsych.pluginAPI.setTimeout(() => {
            finishTrial(data);
          }, 1000);
        } else {
          finishTrial(data);
        }
      }

      function finishTrial(data) {
        display_element.innerHTML = '';
        jsPsych.finishTrial(data);
      }

      function handleKeydown(event) {
        if (submitted) return;
        if (event.key === 'Enter') {
          event.preventDefault();
          if (!RESPONSE_TIMEOUT_MS && typedRaw.length === 0) {
            showError('Please type at least one letter before submitting.');
            return;
          }
          submitResponse(false);
        } else if (event.key === 'Backspace') {
          event.preventDefault();
          typedRaw.pop();
          updateResponseDisplay();
          showError('');
        } else if (/^[a-zA-Z]$/.test(event.key)) {
          event.preventDefault();
          typedRaw.push(event.key);
          updateResponseDisplay();
          showError('');
        } else {
          if (event.key.length === 1) {
            showError('Only letters A–Z are accepted.');
          }
        }
      }

      document.addEventListener('keydown', handleKeydown, true);
      updateResponseDisplay();

      if (RESPONSE_TIMEOUT_MS) {
        responseTimeoutHandle = jsPsych.pluginAPI.setTimeout(() => {
          timedOut = true;
          submitResponse(true);
        }, RESPONSE_TIMEOUT_MS);
      }
    }

    showFixation();
  }
}

jsPsych.plugins['partial-report'] = PartialReportTrial;

function buildTimeline(jsPsych) {
  const timeline = [];

  if (FULLSCREEN) {
    timeline.push({
      type: jsPsychCallFunction,
      async: true,
      func: () => {
        const el = document.documentElement;
        if (el.requestFullscreen) {
          return el.requestFullscreen().catch(() => null);
        }
        return null;
      }
    });
  }

  timeline.push({
    type: jsPsychHtmlButtonResponse,
    stimulus: `
      <h1>Partial Report Task</h1>
      <p>You will briefly see a grid of letters. After the letters disappear, blue squares will indicate which locations to report.</p>
      <p>Type the letters from the cued positions in any order. Use Backspace to correct and press Enter to submit.</p>
      <p>Please work quickly but try to report all cued letters.</p>
    `,
    choices: ['Begin practice']
  });

  const practiceTrial = {
    type: PartialReportTrial,
    is_practice: true
  };

  timeline.push({
    timeline: [practiceTrial],
    repetitions: PRACTICE_TRIALS
  });

  timeline.push({
    type: jsPsychHtmlButtonResponse,
    stimulus: `
      <h2>Main experiment</h2>
      <p>The practice is complete. The main block has ${N_TRIALS} trials and no feedback.</p>
      <p>Keep your eyes on the fixation cross and respond as accurately as possible. Take breaks when prompted.</p>
    `,
    choices: ['Start main block']
  });

  const mainTrial = {
    type: PartialReportTrial,
    is_practice: false
  };

  const mainTimeline = [];
  for (let i = 0; i < N_TRIALS; i++) {
    mainTimeline.push(mainTrial);
    const isBreakPoint = (i + 1) % 40 === 0 && i !== N_TRIALS - 1;
    if (isBreakPoint) {
      mainTimeline.push({
        type: jsPsychHtmlButtonResponse,
        stimulus: `
          <h3>Break</h3>
          <p>You have completed ${i + 1} of ${N_TRIALS} trials. Take a short break now if you need one.</p>
          <p>Press continue when you are ready to proceed.</p>
        `,
        choices: ['Continue']
      });
    }
  }

  timeline.push({
    timeline: mainTimeline
  });

  timeline.push({
    type: jsPsychHtmlButtonResponse,
    stimulus: `
      <h2>All done!</h2>
      <p>Thank you for participating. Use the buttons below to download your data.</p>
      <div class="download-buttons">
        <button type="button" id="download-json">Download JSON</button>
        <button type="button" id="download-csv">Download CSV</button>
      </div>
    `,
    choices: ['Finish'],
    on_load: () => {
      const jsonButton = document.getElementById('download-json');
      const csvButton = document.getElementById('download-csv');
      jsonButton?.addEventListener('click', () => {
        jsPsych.data.get().localSave('json', 'partial-report-data.json');
      });
      csvButton?.addEventListener('click', () => {
        jsPsych.data.get().localSave('csv', 'partial-report-data.csv');
      });
    },
    on_finish: () => {
      if (FULLSCREEN && document.fullscreenElement) {
        document.exitFullscreen?.();
      }
    }
  });

  return timeline;
}

function startExperiment() {
  const splash = document.querySelector('.splash');
  const root = document.getElementById('jspsych-root');
  splash?.setAttribute('hidden', 'true');
  root?.removeAttribute('hidden');

  const jsPsych = initJsPsych({
    display_element: 'jspsych-root'
  });

  jsPsych.run(buildTimeline(jsPsych));
}

window.addEventListener('DOMContentLoaded', () => {
  const startButton = document.getElementById('start-button');
  startButton?.addEventListener('click', () => {
    startExperiment();
  });
});
