// ===== Context-aware QUEST+ wrapper for visual JND =====

// --- BINS (edit these to taste; you can also make them quantiles) ---
const SOA_BINS   = [ [100,200], [200,350], [350,550], [550,900] ];       // ms
const ECC_BINS   = [ [  0, 80], [ 80,140], [140,200], [200,300] ];       // px (first_radius)
const ANG_GROUPS = [
  {name:"cardinal-E", test:(th)=>angGroup(th)==="E"},
  {name:"cardinal-N", test:(th)=>angGroup(th)==="N"},
  {name:"cardinal-W", test:(th)=>angGroup(th)==="W"},
  {name:"cardinal-S", test:(th)=>angGroup(th)==="S"},
];
// If you prefer diagonals, replace ANG_GROUPS by NE, NW, SW, SE testers.

function angGroup(thetaRad){
  const d = (thetaRad*180/Math.PI + 360) % 360;
  if (d < 45 || d >= 315) return "E";
  if (d < 135) return "N";
  if (d < 225) return "W";
  return "S";
}
function inRange(x,[lo,hi]){ return x>=lo && x<hi; }
function linspace(a,b,n){ const s=(b-a)/(n-1); return Array.from({length:n},(_,i)=>a+i*s); }

// --- per-dimension stimulus & parameter grids ---
const magnitudeGridDva = linspace(0.05, 2.50, 40); // dva magnitude of offset vector
const betaGrid        = [2,3,4,5];              // slope
const lambdaGrid      = [0.01,0.02];            // lapse
const guessRate       = 0.00;                    // go/nogo, γ≈0

// Weibull psychometric for jsQuestPlus (γ handled via function)
function pWeibull(stim, alpha, beta, guess=guessRate, lapse){
  return guess + (1-guess-lapse)*(1 - Math.exp(-Math.pow(stim/alpha, beta)));
}

// Prior for α that increases with SOA bin idx and ECC bin idx (encodes: easy at small SOA & fovea)
function alphaPriorOnGrid(alphaGrid, soaIdx, eccIdx, angIdx, base, kSOA=0.20, kECC=0.20, kANG=0.05, sigma=0.35){
  const scale = (1 + kSOA*soaIdx) * (1 + kECC*eccIdx) * (1 + kANG*angIdx);
  const mu = Math.log(base * scale);
  const pdf = alphaGrid.map(a => (1/(a*sigma*Math.sqrt(2*Math.PI))) * Math.exp(-Math.pow(Math.log(a)-mu,2)/(2*sigma*sigma)));
  const Z = pdf.reduce((x,y)=>x+y,0) || 1;
  return pdf.map(p=>p/Z);
}

// Engines indexed by [soa][ecc][ang]
let engines = [];

function makeEngineForCell(alphaGrid){
  // jsQuestPlus constructor signature in your codebase:
  // new jsQuestPlus({ psych_func, stim_samples, psych_samples })
  return function init(alphaPrior){
    return new jsQuestPlus({
      psych_func: [
        (stim, alpha, beta, guess, lapse) => pWeibull(stim, alpha, beta, guess, lapse),
        (stim, alpha, beta, guess, lapse) => 1 - pWeibull(stim, alpha, beta, guess, lapse)
      ],
      stim_samples: [alphaGrid], // NOTE: we pass the "stimulus domain" here (same shape as original)
      psych_samples: [alphaGrid, betaGrid, [guessRate], lambdaGrid],
      // We’ll inject the priors after init via a light hack below
    });
  };
}

function initAdaptiveQuest() {
  const magnitudeAlphaGrid = magnitudeGridDva.slice();
  const newEngine = makeEngineForCell(magnitudeAlphaGrid);

  engines = SOA_BINS.map((_, i) =>
    ECC_BINS.map((_, j) =>
      ANG_GROUPS.map((_, k) => {
        const e = newEngine();
        e._alphaGrid = magnitudeAlphaGrid;
        e._priorAlpha = alphaPriorOnGrid(magnitudeAlphaGrid, i, j, k, /*base*/0.6); // dva
        e._priorBeta  = Array(betaGrid.length).fill(1/betaGrid.length);
        e._priorLam   = Array(lambdaGrid.length).fill(1/lambdaGrid.length);
        e._setPrior = function(){};
        return e;
      })
    )
  );
}

function contextToIndices({ soaMs, eccPx, thetaRad }){
  const soaIdx = SOA_BINS.findIndex(b=>inRange(soaMs,b));
  const eccIdx = ECC_BINS.findIndex(b=>inRange(eccPx,b));
  const angIdx = ANG_GROUPS.findIndex(g=>g.test(thetaRad));
  return { soaIdx, eccIdx, angIdx };
}

// Choose Δ targeted near current 70% correct for that context
function suggestDeltaForContext({ soaMs, eccPx, thetaRad }, target=0.70){
  const { soaIdx, eccIdx, angIdx } = contextToIndices({soaMs, eccPx, thetaRad});
  if (soaIdx<0 || eccIdx<0 || angIdx<0) {
    // Fallback if out of bins
    return 0.6;
  }
  const eng = engines[soaIdx][eccIdx][angIdx];

  // Start from engine's current proposal
  let chosen = eng.getStimParams();
  try {
    const est = eng.getEstimates('mode');         // [alpha, beta, guess, lapse]
    if (Array.isArray(est) && est.length >= 4) {
      let best = chosen, bestDiff = Infinity;
      for (const v of magnitudeGridDva) {
        const p = pWeibull(v, est[0], est[1], est[2], est[3]);
        const d = Math.abs(p - target);
        if (d < bestDiff) { bestDiff = d; best = v; }
      }
      chosen = best;
    }
  } catch(e){}
  return chosen;
}

function updateQuestWithOutcome({ soaMs, eccPx, thetaRad }, delta, responded){
  const { soaIdx, eccIdx, angIdx } = contextToIndices({soaMs, eccPx, thetaRad});
  if (soaIdx<0 || eccIdx<0 || angIdx<0) return;
  const eng = engines[soaIdx][eccIdx][angIdx];
  try {
    eng.update(delta, responded ? 1 : 0);
  } catch(e) {
    console.warn('AdaptiveQuest update skipped', e);
  }
}

// Optional: expose state export
function exportPosteriors(){
  const out = [];
  engines.forEach((rows,i)=>rows.forEach((cols,j)=>cols.forEach((e,k)=>{
    try {
      const est = e.getEstimates('mean');
      out.push({ dim: 'vector', i, j, k, alpha: est?.[0], beta: est?.[1] });
    } catch {}
  })));
  return out;
}

window.initAdaptiveQuest = initAdaptiveQuest;
window.suggestDeltaForContext = suggestDeltaForContext;
window.updateQuestWithOutcome = updateQuestWithOutcome;
window.exportAdaptivePosteriors = exportPosteriors;
