const NoGoCtrl = (() => {
  // Tunable parameters for the controller.  These roughly control how often
  // No-Go trials should appear and how aggressively the controller reacts to
  // participants making false alarms on those trials.
  const cfg = {
    pTargetFA: 0.05, // Desired long-run false alarm rate (5%)
    fBase: 0.18,     // Baseline probability of scheduling a No-Go trial
    fMin: 0.1,       // Lower clamp for the No-Go probability
    fMax: 0.45,      // Upper clamp for the No-Go probability
    Kp: 2.0,         // Proportional gain for the controller
    emaAlpha: 0.12   // Smoothing factor for the false-alarm moving average
  };

  // Running state that tracks the false-alarm history.
  let faEma = null; // Exponential moving average of false alarms
  let nNoGo = 0;    // Total number of No-Go trials presented
  let nFA = 0;      // Total number of false alarms observed

  // Update controller state at the end of each trial.  Only No-Go trials count
  // toward the false-alarm statistics.
  function onTrialEnd({ isNoGo, responded }) {
    if (!isNoGo) return;
    nNoGo += 1;
    if (responded) nFA += 1;
    const obs = responded ? 1 : 0;
    if (faEma === null) {
      faEma = obs;
    } else {
      faEma = (1 - cfg.emaAlpha) * faEma + cfg.emaAlpha * obs;
    }
  }

  // Estimate the false-alarm rate.  Before any No-Go trials occur we just
  // return the controller's target value.
  function estFA() {
    return faEma === null ? cfg.pTargetFA : faEma;
  }

  // Convert the false-alarm error into a probability for presenting a No-Go
  // trial.  The proportional term increases the No-Go frequency whenever the
  // observed false-alarm rate drifts above the target.
  function pNoGo() {
    const err = Math.max(0, estFA() - cfg.pTargetFA);
    let f = cfg.fBase + cfg.Kp * err;
    if (f < cfg.fMin) f = cfg.fMin;
    if (f > cfg.fMax) f = cfg.fMax;
    return f;
  }

  // Flip a biased coin according to the current No-Go probability.
  function decideNoGo() {
    return Math.random() < pNoGo();
  }

  // Provide an immutable snapshot of the controller state for logging and UI.
  function stats() {
    return {
      pNoGo: pNoGo(),
      faEma,
      nNoGo,
      nFA,
      params: { ...cfg }
    };
  }

  return { onTrialEnd, decideNoGo, stats };
})();

if (typeof window !== 'undefined') {
  window.NoGoCtrl = NoGoCtrl;
}

export default NoGoCtrl;
