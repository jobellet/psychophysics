export const TARGET_DIAMETER_DVA = 0.12;
export const FIXATION_DIAMETER_DVA = 0.12;
export const FLASH_DURATION_MS = 59;
export const NO_RESPONSE_TIMEOUT_MS = 1500;
export const POST_TRIAL_DELAY_MIN_MS = 750;
export const POST_TRIAL_DELAY_MAX_MS = 1250;
export const FIXATION_RELEASE_DELAY_MIN_MS = 0;
export const FIXATION_RELEASE_DELAY_MAX_MS = 1400;
export const TARGET_ONSET_DELAY_MIN_MS = 300;
export const TARGET_ONSET_DELAY_MAX_MS = 500;
export const POST_FIXATION_OFFSET_HOLD_MS = 2000;

function wait(ms) {
  return new Promise(resolve => window.setTimeout(resolve, ms));
}

function randomFixationReleaseDelay() {
  const range = FIXATION_RELEASE_DELAY_MAX_MS - FIXATION_RELEASE_DELAY_MIN_MS;
  return FIXATION_RELEASE_DELAY_MIN_MS + Math.random() * range;
}

function randomNextTrialDelay() {
  const range = POST_TRIAL_DELAY_MAX_MS - POST_TRIAL_DELAY_MIN_MS;
  return POST_TRIAL_DELAY_MIN_MS + Math.random() * range;
}

function randomTargetOnsetDelay() {
  const range = TARGET_ONSET_DELAY_MAX_MS - TARGET_ONSET_DELAY_MIN_MS;
  return TARGET_ONSET_DELAY_MIN_MS + Math.random() * range;
}

function snapFlashDuration(durationMs) {
  let refreshRate = 60;
  const screen = typeof window !== 'undefined' ? window.screen : null;
  if (screen && Number.isFinite(screen.frameRate) && screen.frameRate > 0) {
    refreshRate = screen.frameRate;
  } else if (typeof window !== 'undefined') {
    if (window.matchMedia && window.matchMedia('(min-refresh-rate: 120hz)').matches) {
      refreshRate = 120;
    } else if (window.matchMedia && window.matchMedia('(min-resolution: 2dppx)').matches) {
      refreshRate = 120;
    }
  }
  const frameDuration = 1000 / refreshRate;
  const frames = Math.max(1, Math.round(durationMs / frameDuration));
  return Math.round(frames * frameDuration);
}

export function sampleAnnulusPointDeg(rMinDeg, rMaxDeg) {
  const u = Math.random();
  const r = Math.sqrt(u * (rMaxDeg * rMaxDeg - rMinDeg * rMinDeg) + rMinDeg * rMinDeg);
  const th = Math.random() * 2 * Math.PI;
  const x = r * Math.cos(th);
  const y = r * Math.sin(th);
  return { xDeg: x, yDeg: y, rDeg: r, thetaRad: th };
}

function formatNumber(value, digits = 2) {
  return Number.isFinite(value) ? value.toFixed(digits) : '—';
}

function buildCsv(data) {
  if (!Array.isArray(data) || data.length === 0) {
    return 'trial_index';
  }
  const columns = Object.keys(data[0]);
  const header = columns.join(',');
  const rows = data.map(row =>
    columns
      .map(key => {
        const value = row[key];
        if (value === null || value === undefined) return '';
        if (typeof value === 'string') {
          const escaped = value.replace(/"/g, '""');
          return `"${escaped}"`;
        }
        if (Number.isFinite(value)) {
          return String(value);
        }
        if (value instanceof Date) {
          return value.toISOString();
        }
        return String(value);
      })
      .join(',')
  );
  return [header, ...rows].join('\n');
}

function downloadBlob(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function ensureElement(id) {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`Expected element with id "${id}"`);
  }
  return el;
}

let errorAudioContext = null;

async function playErrorTone() {
  if (typeof window === 'undefined') return;
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;
  if (!errorAudioContext) {
    errorAudioContext = new AudioContext();
  }
  if (errorAudioContext.state === 'suspended') {
    try {
      await errorAudioContext.resume();
    } catch (err) {
      return;
    }
  }

  const now = errorAudioContext.currentTime;
  const duration = 0.28;
  const gain = errorAudioContext.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.22, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  gain.connect(errorAudioContext.destination);

  const osc1 = errorAudioContext.createOscillator();
  const osc2 = errorAudioContext.createOscillator();
  osc1.type = 'sawtooth';
  osc2.type = 'square';
  osc1.frequency.setValueAtTime(330, now);
  osc2.frequency.setValueAtTime(355, now);
  osc1.connect(gain);
  osc2.connect(gain);
  osc1.start(now);
  osc2.start(now);
  const stopTime = now + duration;
  osc1.stop(stopTime);
  osc2.stop(stopTime);
  osc2.onended = () => {
    osc1.disconnect();
    osc2.disconnect();
    gain.disconnect();
  };
}

export function run({ reference, trialCount = 1000 } = {}) {
  if (!reference) {
    throw new Error('A calibration reference is required to run the experiment.');
  }

  const stage = ensureElement('experiment-stage');
  const fixation = ensureElement('fixation');
  const target = ensureElement('flash-target');
  const hudTrial = document.getElementById('hud-trial');
  const hudCalibration = document.getElementById('hud-calibration');
  const downloadCsvButton = document.getElementById('download-csv');
  const downloadJsonButton = document.getElementById('download-json');
  const downloadPanel = document.getElementById('download-panel');

  const dvaPerPixel = VisualAngle.pixelsToDVA(1, reference);
  const targetDiameterPx = Math.max(2, VisualAngle.dvaToPixels(TARGET_DIAMETER_DVA, reference));
  const fixationDiameterPx = Math.max(2, VisualAngle.dvaToPixels(FIXATION_DIAMETER_DVA, reference));

  fixation.style.width = `${fixationDiameterPx}px`;
  fixation.style.height = `${fixationDiameterPx}px`;

  target.style.width = `${targetDiameterPx}px`;
  target.style.height = `${targetDiameterPx}px`;

  if (hudCalibration) {
    const distanceCm = reference.viewingDistanceMm / 10;
    const mmPerPixel = reference.mmPerPixel;
    hudCalibration.textContent = `Distance ${formatNumber(distanceCm, 1)} cm · 1° ≈ ${formatNumber(
      VisualAngle.dvaToPixels(1, reference),
      1
    )} px · 1 px ≈ ${formatNumber(mmPerPixel, 3)} mm`;
  }

  const trials = [];
  let stopRequested = false;
  let running = true;
  let activeCleanup = null;

  const snappedFlashDuration = snapFlashDuration(FLASH_DURATION_MS);
  let nextTrialEarliestStart = performance.now();

  function cleanupTrialTimers(timerHandles) {
    if (!timerHandles) return;
    const {
      initialFlashTimeout,
      flashTimeout,
      reflashTimeout,
      releaseTimeout,
      responseTimeout
    } = timerHandles;
    if (initialFlashTimeout) {
      window.clearTimeout(initialFlashTimeout);
      timerHandles.initialFlashTimeout = null;
    }
    if (flashTimeout) {
      window.clearTimeout(flashTimeout);
      timerHandles.flashTimeout = null;
    }
    if (reflashTimeout) {
      window.clearTimeout(reflashTimeout);
      timerHandles.reflashTimeout = null;
    }
    if (releaseTimeout) {
      window.clearTimeout(releaseTimeout);
      timerHandles.releaseTimeout = null;
    }
    if (responseTimeout) {
      window.clearTimeout(responseTimeout);
      timerHandles.responseTimeout = null;
    }
  }

  function updateHud(index, total) {
    if (hudTrial) {
      hudTrial.textContent = `Trial ${Math.min(index + 1, total)} of ${total}`;
    }
  }

  function hideTarget() {
    target.classList.remove('visible');
  }

  function showFixation() {
    fixation.classList.remove('hidden');
  }

  function concealFixation() {
    fixation.classList.add('hidden');
  }

  async function runTrial(trialIndex) {
    const targetSample = sampleAnnulusPointDeg(0.3, 5.0);
    const targetXPx = VisualAngle.dvaToPixels(targetSample.xDeg, reference);
    const targetYPx = VisualAngle.dvaToPixels(targetSample.yDeg, reference);
    const targetThetaDeg = (targetSample.thetaRad * 180) / Math.PI;

    target.style.transform = `translate(-50%, -50%) translate(${targetXPx}px, ${-targetYPx}px)`;

    let reflashCount = 0;
    let firstOnset = null;
    let awaitingResponse = true;
    let responseWindowOpen = false;
    let lastReleaseDelayMs = null;
    let releaseOpenedAt = null;
    let firstReleaseOpenedAt = null;
    let fixationOffsetAt = null;
    let prematureResponses = 0;
    const nextTrialDelayMs = randomNextTrialDelay();
    const timerHandles = {
      initialFlashTimeout: null,
      flashTimeout: null,
      reflashTimeout: null,
      releaseTimeout: null,
      responseTimeout: null
    };

    showFixation();
    const fixationOnset = performance.now();

    function finishTrial(result) {
      awaitingResponse = false;
      cleanupTrialTimers(timerHandles);
      hideTarget();
      stage.removeEventListener('pointerdown', handlePointer);
      responseWindowOpen = false;
      releaseOpenedAt = null;
      firstReleaseOpenedAt = null;
      const readyAt = fixationOffsetAt !== null
        ? fixationOffsetAt + nextTrialDelayMs
        : performance.now() + nextTrialDelayMs;
      nextTrialEarliestStart = Math.max(nextTrialEarliestStart, readyAt);
      fixationOffsetAt = null;
      showFixation();
      resolveTrial(result);
    }

    function handleNoResponse() {
      if (!awaitingResponse) return;
      const responseTimestamp = performance.now();
      const rt = firstOnset !== null ? responseTimestamp - firstOnset : null;
      const referenceRelease = firstReleaseOpenedAt !== null ? firstReleaseOpenedAt : releaseOpenedAt;
      const rtFromRelease = referenceRelease !== null
        ? Math.min(responseTimestamp - referenceRelease, POST_FIXATION_OFFSET_HOLD_MS)
        : null;

      const result = {
        trial_index: trialIndex,
        timestamp_iso: new Date().toISOString(),
        target_x_deg: targetSample.xDeg,
        target_y_deg: targetSample.yDeg,
        target_r_deg: targetSample.rDeg,
        target_theta_deg: targetThetaDeg,
        target_x_px: targetXPx,
        target_y_px: targetYPx,
        target_diameter_deg: TARGET_DIAMETER_DVA,
        fixation_diameter_deg: FIXATION_DIAMETER_DVA,
        reflash_count: reflashCount,
        responded: false,
        rt_ms: rt,
        rt_from_fixation_offset_ms: rtFromRelease,
        fixation_release_delay_ms: lastReleaseDelayMs,
        premature_response_count: prematureResponses,
        response_x_deg: null,
        response_y_deg: null,
        response_x_px: null,
        response_y_px: null,
        target_onset_delay_ms: firstOnset !== null ? firstOnset - fixationOnset : null,
        post_offset_hold_target_ms: nextTrialDelayMs,
        mm_per_pixel: reference.mmPerPixel,
        viewing_distance_mm: reference.viewingDistanceMm,
        dva_per_pixel: dvaPerPixel,
        screen_w_px: window.screen.width,
        screen_h_px: window.screen.height,
        stage_w_px: stageWidth,
        stage_h_px: stageHeight,
        devicePixelRatio: window.devicePixelRatio || 1
      };

      finishTrial(result);
    }

    function presentFlash() {
      if (!awaitingResponse) return;
      hideTarget();
      if (timerHandles.flashTimeout) {
        window.clearTimeout(timerHandles.flashTimeout);
        timerHandles.flashTimeout = null;
      }
      if (timerHandles.reflashTimeout) {
        window.clearTimeout(timerHandles.reflashTimeout);
        timerHandles.reflashTimeout = null;
      }
      if (timerHandles.releaseTimeout) {
        window.clearTimeout(timerHandles.releaseTimeout);
        timerHandles.releaseTimeout = null;
      }
      responseWindowOpen = false;
      releaseOpenedAt = null;
      showFixation();

      const now = performance.now();
      if (firstOnset === null) {
        firstOnset = now;
      }

      target.classList.add('visible');
      timerHandles.flashTimeout = window.setTimeout(() => {
        hideTarget();
        const releaseDelay = randomFixationReleaseDelay();
        lastReleaseDelayMs = releaseDelay;
        timerHandles.releaseTimeout = window.setTimeout(() => {
          responseWindowOpen = true;
          releaseOpenedAt = performance.now();
          if (firstReleaseOpenedAt === null) {
            firstReleaseOpenedAt = releaseOpenedAt;
          }
          fixationOffsetAt = releaseOpenedAt;
          concealFixation();
          if (!timerHandles.responseTimeout) {
            timerHandles.responseTimeout = window.setTimeout(() => {
              timerHandles.responseTimeout = null;
              handleNoResponse();
            }, POST_FIXATION_OFFSET_HOLD_MS);
          }
        }, releaseDelay);
      }, snappedFlashDuration);

      timerHandles.reflashTimeout = window.setTimeout(() => {
        if (!awaitingResponse) return;
        reflashCount += 1;
        presentFlash();
      }, NO_RESPONSE_TIMEOUT_MS);
    }

    const stageRect = stage.getBoundingClientRect();
    const stageWidth = stageRect.width;
    const stageHeight = stageRect.height;

    let resolveTrial;
    const trialPromise = new Promise(resolve => {
      resolveTrial = resolve;
    });

    const initialTargetDelay = randomTargetOnsetDelay();
    timerHandles.initialFlashTimeout = window.setTimeout(() => {
      timerHandles.initialFlashTimeout = null;
      presentFlash();
    }, initialTargetDelay);

    function handlePointer(event) {
      if (!awaitingResponse) return;
      if (!responseWindowOpen) {
        event.preventDefault();
        prematureResponses += 1;
        playErrorTone();
        return;
      }

      awaitingResponse = false;
      event.preventDefault();
      cleanupTrialTimers(timerHandles);
      hideTarget();
      concealFixation();
      stage.removeEventListener('pointerdown', handlePointer);

      const rect = stage.getBoundingClientRect();
      const relativeX = event.clientX - rect.left;
      const relativeY = event.clientY - rect.top;
      const centeredX = relativeX - rect.width / 2;
      const centeredY = rect.height / 2 - relativeY;

      const responseXPx = centeredX;
      const responseYPx = centeredY;
      const responseXDeg = VisualAngle.pixelsToDVA(responseXPx, reference);
      const responseYDeg = VisualAngle.pixelsToDVA(responseYPx, reference);

      const responseTimestamp = performance.now();
      const rt = firstOnset !== null ? responseTimestamp - firstOnset : null;
      const rtFromRelease = releaseOpenedAt !== null ? responseTimestamp - releaseOpenedAt : null;

      const result = {
        trial_index: trialIndex,
        timestamp_iso: new Date().toISOString(),
        target_x_deg: targetSample.xDeg,
        target_y_deg: targetSample.yDeg,
        target_r_deg: targetSample.rDeg,
        target_theta_deg: targetThetaDeg,
        target_x_px: targetXPx,
        target_y_px: targetYPx,
        target_diameter_deg: TARGET_DIAMETER_DVA,
        fixation_diameter_deg: FIXATION_DIAMETER_DVA,
        reflash_count: reflashCount,
        responded: true,
        rt_ms: rt,
        rt_from_fixation_offset_ms: rtFromRelease,
        fixation_release_delay_ms: lastReleaseDelayMs,
        premature_response_count: prematureResponses,
        response_x_deg: responseXDeg,
        response_y_deg: responseYDeg,
        response_x_px: responseXPx,
        response_y_px: responseYPx,
        target_onset_delay_ms: firstOnset !== null ? firstOnset - fixationOnset : null,
        post_offset_hold_target_ms: nextTrialDelayMs,
        mm_per_pixel: reference.mmPerPixel,
        viewing_distance_mm: reference.viewingDistanceMm,
        dva_per_pixel: dvaPerPixel,
        screen_w_px: window.screen.width,
        screen_h_px: window.screen.height,
        stage_w_px: stageWidth,
        stage_h_px: stageHeight,
        devicePixelRatio: window.devicePixelRatio || 1
      };

      finishTrial(result);
    }

    stage.addEventListener('pointerdown', handlePointer);
    activeCleanup = () => {
      stage.removeEventListener('pointerdown', handlePointer);
      cleanupTrialTimers(timerHandles);
      hideTarget();
      showFixation();
      resolveTrial(null);
    };

    const trialResult = await trialPromise;
    activeCleanup = null;
    return trialResult;
  }

  async function runLoop() {
    try {
      stage.classList.add('running');
      stage.setAttribute('data-active', 'true');
      stage.style.cursor = 'crosshair';
      if (downloadPanel) {
        downloadPanel.hidden = true;
        downloadPanel.setAttribute('hidden', 'hidden');
      }

      for (let i = 0; i < trialCount; i += 1) {
        if (stopRequested) break;
        const now = performance.now();
        if (nextTrialEarliestStart > now) {
          await wait(nextTrialEarliestStart - now);
        }
        if (stopRequested) break;
        updateHud(i, trialCount);
        const trialResult = await runTrial(i);
        if (trialResult) {
          trials.push(trialResult);
        }
        if (stopRequested) break;
      }
    } finally {
      running = false;
      stage.classList.remove('running');
      stage.removeAttribute('data-active');
      hideTarget();
      showFixation();
      stage.style.cursor = 'default';
      if (hudTrial) {
        hudTrial.textContent = trials.length
          ? `Completed ${trials.length} trial${trials.length === 1 ? '' : 's'}.`
          : 'No responses recorded.';
      }
      if (downloadPanel) {
        downloadPanel.hidden = false;
        downloadPanel.removeAttribute('hidden');
        const countEl = document.getElementById('download-count');
        if (countEl) {
          countEl.textContent = `${trials.length} trial${trials.length === 1 ? '' : 's'} recorded.`;
        }
      }
      if (downloadCsvButton) {
        downloadCsvButton.disabled = trials.length === 0;
      }
      if (downloadJsonButton) {
        downloadJsonButton.disabled = trials.length === 0;
      }
      window.PERCEPTUAL_LOCALIZATION_DELAYED = { trials: [...trials] };
    }
  }

  const runPromise = runLoop();

  function stop(immediate = false) {
    stopRequested = true;
    if (immediate && typeof activeCleanup === 'function') {
      activeCleanup();
    }
  }

  function downloadCsv() {
    if (!trials.length) return;
    const headerLines = [
      `# Perceptual Localization (Delayed)`,
      `# Timestamp: ${new Date().toISOString()}`,
      `# Viewing distance (mm): ${reference.viewingDistanceMm}`,
      `# mm per pixel: ${reference.mmPerPixel}`,
      `# trials: ${trials.length}`
    ];
    const csv = buildCsv(trials);
    const content = `${headerLines.join('\n')}\n${csv}`;
    downloadBlob('perceptual-localization-delayed.csv', content, 'text/csv');
  }

  function downloadJson() {
    if (!trials.length) return;
    const payload = {
      task: 'perceptual-localization-delayed',
      generated_at: new Date().toISOString(),
      calibration: {
        mm_per_pixel: reference.mmPerPixel,
        viewing_distance_mm: reference.viewingDistanceMm,
        dva_per_pixel: dvaPerPixel
      },
      trials
    };
    downloadBlob('perceptual-localization-delayed.json', JSON.stringify(payload, null, 2), 'application/json');
  }

  return {
    stop,
    getData: () => [...trials],
    finished: runPromise,
    isRunning: () => running,
    downloadCsv,
    downloadJson
  };
}

if (typeof window !== 'undefined') {
  window.PerceptualLocalizationDelayed = {
    run,
    sampleAnnulusPointDeg
  };
}

export default {
  run,
  sampleAnnulusPointDeg
};
