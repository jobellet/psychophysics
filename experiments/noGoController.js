const NoGoCtrl = (() => {
  const cfg = {
    pTargetFA: 0.05,
    fBase: 0.18,
    fMin: 0.1,
    fMax: 0.45,
    Kp: 2.0,
    emaAlpha: 0.12
  };

  let faEma = null;
  let nNoGo = 0;
  let nFA = 0;

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

  function estFA() {
    return faEma === null ? cfg.pTargetFA : faEma;
  }

  function pNoGo() {
    const err = Math.max(0, estFA() - cfg.pTargetFA);
    let f = cfg.fBase + cfg.Kp * err;
    if (f < cfg.fMin) f = cfg.fMin;
    if (f > cfg.fMax) f = cfg.fMax;
    return f;
  }

  function decideNoGo() {
    return Math.random() < pNoGo();
  }

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
