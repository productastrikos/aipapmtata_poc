/* ═══════════════════════════════════════════════════════════════════════════
   Astrikos S!aP — Index Engines
   ───────────────────────────────────────────────────────────────────────────
   AHI, ACI, PoF, CoF, ARI and investment value are COMPUTED here — never
   stored as literals on the asset. Every screen calls these functions, so
   changing a weight in the Health Workbench moves every downstream number
   on every other screen. That is the Glass Box claim made literal, and it is
   what Checkpoint C.7 ("show impact on Health Score") actually tests.

   Every function returns its working, not just its answer, so the UI can put
   the arithmetic on screen — Checkpoint E.1 ("with visible calculations").
   ═══════════════════════════════════════════════════════════════════════════ */

/* ─── Scoring primitive ─────────────────────────────────────────────────────
   Maps a raw engineering reading onto a 0–100 condition score by linear
   interpolation between a "good" and a "bad" anchor. Deliberately simple:
   an evaluator can follow it in their head, which is the point. */
export function linScore(raw, good, bad) {
  if (raw === null || raw === undefined || Number.isNaN(raw)) return 50;
  if (good < bad) {
    // higher reading is worse (e.g. dissolved gas, hotspot temperature)
    if (raw <= good) return 100;
    if (raw >= bad) return 0;
    return (100 * (bad - raw)) / (bad - good);
  }
  // higher reading is better (e.g. oil breakdown voltage)
  if (raw >= good) return 100;
  if (raw <= bad) return 0;
  return (100 * (raw - bad)) / (good - bad);
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/* ═══ 1. ASSET HEALTH INDEX (Section C) ═════════════════════════════════════
   Per-class parameter sets. `good`/`bad` are the interpolation anchors and are
   shown in the model configurator so TPCL can see — and change — the bands. */
export const HEALTH_PARAMS = {
  power_transformer: [
    { key: 'dga',         label: 'Dissolved Gas Analysis', short: 'DGA',         unit: 'ppm TDCG', good: 300,  bad: 2500, weight: 0.28 },
    { key: 'oil',         label: 'Oil Quality (BDV)',      short: 'Oil Quality', unit: 'kV',       good: 60,   bad: 25,   weight: 0.18 },
    { key: 'thermal',     label: 'Winding Hotspot',        short: 'Temperature', unit: '°C',       good: 65,   bad: 110,  weight: 0.16 },
    { key: 'loading',     label: 'Loading vs Rated',       short: 'Loading',     unit: '%',        good: 60,   bad: 115,  weight: 0.14 },
    { key: 'maintenance', label: 'Since Last Overhaul',    short: 'Maintenance', unit: 'months',   good: 6,    bad: 60,   weight: 0.12 },
    { key: 'pd',          label: 'Partial Discharge',      short: 'PD',          unit: 'pC',       good: 50,   bad: 1000, weight: 0.12 },
  ],
  circuit_breaker: [
    { key: 'operations',  label: 'Operation Count',        short: 'Operations',  unit: 'ops',      good: 500,  bad: 8000, weight: 0.24 },
    { key: 'contactWear', label: 'Contact Erosion',        short: 'Contact Wear', unit: '%',       good: 5,    bad: 60,   weight: 0.26 },
    { key: 'gasPressure', label: 'SF6 Density',            short: 'SF6',         unit: 'bar',      good: 6.5,  bad: 4.8,  weight: 0.22 },
    { key: 'tripTime',    label: 'Trip Coil Timing',       short: 'Trip Time',   unit: 'ms',       good: 22,   bad: 55,   weight: 0.16 },
    { key: 'maintenance', label: 'Since Last Service',     short: 'Maintenance', unit: 'months',   good: 6,    bad: 48,   weight: 0.12 },
  ],
  rmu: [
    { key: 'insulation',  label: 'Insulation Resistance',  short: 'Insulation',  unit: 'GΩ',       good: 10,   bad: 1,    weight: 0.30 },
    { key: 'thermal',     label: 'Enclosure Temperature',  short: 'Temperature', unit: '°C',       good: 45,   bad: 85,   weight: 0.24 },
    { key: 'operations',  label: 'Switching Operations',   short: 'Operations',  unit: 'ops',      good: 200,  bad: 3000, weight: 0.20 },
    { key: 'moisture',    label: 'Moisture Ingress',       short: 'Moisture',    unit: '%RH',      good: 35,   bad: 85,   weight: 0.26 },
  ],
};

/* Note: asset age is deliberately NOT a health parameter. It drives the
   Weibull hazard in computePoF() instead, so a well-maintained old asset is
   not double-penalised for being old. */

export function paramsFor(assetClass) {
  return HEALTH_PARAMS[assetClass] || HEALTH_PARAMS.rmu;
}

/**
 * computeAHI — returns the score AND the per-parameter contribution breakdown
 * that drives the waterfall chart on the Health Workbench.
 *
 * @param asset    asset record carrying `readings`
 * @param weights  optional { paramKey: weight } override from the config store
 */
export function computeAHI(asset, weights) {
  const params = paramsFor(asset.assetClass);
  const rows = params.map((p) => {
    const w = weights && weights[p.key] != null ? weights[p.key] : p.weight;
    const raw = asset.readings[p.key];
    const score = linScore(raw, p.good, p.bad);
    return {
      ...p,
      weight: w,
      raw,
      score,                        // 0–100 condition of this parameter
      contribution: score * w,      // points this parameter puts into the AHI
      deduction: (100 - score) * w, // points lost — what the waterfall shows
    };
  });

  const totalWeight = rows.reduce((s, r) => s + r.weight, 0) || 1;
  // Normalise so the score stays on a 0–100 scale even if TPCL's weights
  // don't sum to exactly 1 after editing.
  const ahi = rows.reduce((s, r) => s + r.contribution, 0) / totalWeight;

  return {
    ahi: clamp(ahi, 0, 100),
    rows: rows.sort((a, b) => b.deduction - a.deduction),
    totalWeight,
  };
}

export function healthBand(ahi) {
  if (ahi >= 85) return { key: 'excellent', label: 'Excellent', color: '#16a34a' };
  if (ahi >= 70) return { key: 'good',      label: 'Good',      color: '#65a30d' };
  if (ahi >= 55) return { key: 'fair',      label: 'Fair',      color: '#d97706' };
  if (ahi >= 40) return { key: 'poor',      label: 'Poor',      color: '#ea580c' };
  return              { key: 'critical',    label: 'Critical',  color: '#dc2626' };
}

/* ═══ 2. ASSET CRITICALITY INDEX (Section D) ════════════════════════════════
   The scenario the checkpoint sheet asks for: two substations with identical
   health but different business impact must produce different ACI. That falls
   out naturally because ACI reads none of the condition parameters. */
export const CRITICALITY_DIMENSIONS = [
  { key: 'consumers',   label: 'Consumer Impact',      unit: 'connections', weight: 0.30 },
  { key: 'revenue',     label: 'Revenue at Risk',      unit: '₹ Cr/yr',     weight: 0.22 },
  { key: 'reliability', label: 'Reliability Impact',   unit: 'SAIDI min',   weight: 0.18 },
  { key: 'safety',      label: 'Safety Exposure',      unit: 'index',       weight: 0.16 },
  { key: 'environment', label: 'Environmental Impact', unit: 'index',       weight: 0.14 },
];

const ACI_ANCHORS = {
  consumers:   { low: 200,  high: 55000 },
  revenue:     { low: 0.4,  high: 90    },
  reliability: { low: 2,    high: 180   },
  safety:      { low: 5,    high: 100   },
  environment: { low: 5,    high: 100   },
};

/* Criticality scales with diminishing returns: the step from 200 to 10,000
   consumers changes the character of an outage far more than the step from
   40,000 to 50,000. A straight linear anchor pushes every small substation to
   near zero, which is neither true nor defensible in front of a planner. */
function impactScore(raw, low, high) {
  const frac = clamp((raw - low) / (high - low), 0, 1);
  return Math.sqrt(frac) * 100;
}

export function computeACI(asset, weights) {
  const rows = CRITICALITY_DIMENSIONS.map((d) => {
    const w = weights && weights[d.key] != null ? weights[d.key] : d.weight;
    const raw = asset.impact[d.key];
    const a = ACI_ANCHORS[d.key];
    // All criticality dimensions are "higher = more critical"
    const score = impactScore(raw, a.low, a.high);
    return { ...d, weight: w, raw, score, contribution: score * w };
  });

  const totalWeight = rows.reduce((s, r) => s + r.weight, 0) || 1;
  const redundancyRelief = asset.impact.redundancy ? 0.82 : 1.0; // N-1 available
  const aci = (rows.reduce((s, r) => s + r.contribution, 0) / totalWeight) * redundancyRelief;

  return {
    aci: clamp(aci, 0, 100),
    rows: rows.sort((a, b) => b.contribution - a.contribution),
    redundancyRelief,
    totalWeight,
  };
}

/* ═══ 3. PROBABILITY OF FAILURE ═════════════════════════════════════════════
   Two-parameter Weibull wear-out hazard, modified by observed condition.
   β > 1 means the hazard rises with age, which is the correct shape for
   electrical plant and is what ISO 14224 reliability data supports. */
export function computePoF(asset, ahi) {
  const beta = 2.6;                                  // wear-out shape
  const eta = asset.designLife * 1.15;               // characteristic life
  const age = Math.max(asset.age, 0.5);

  // Weibull instantaneous hazard, annualised
  const baseHazard = (beta / eta) * Math.pow(age / eta, beta - 1);

  // Condition multiplier — a healthy asset ages along the curve, a degraded
  // one runs ahead of it. Exponent > 1 so poor health bites disproportionately.
  const conditionMult = 1 + 2.5 * Math.pow((100 - ahi) / 100, 1.5);

  const pof = clamp(baseHazard * conditionMult, 0.002, 0.92);

  return {
    pof,
    beta,
    eta: +eta.toFixed(1),
    age,
    baseHazard,
    conditionMult,
    workings: `β=${beta} · η=${eta.toFixed(1)}y · age=${age}y → h₀=${(baseHazard * 100).toFixed(2)}% × condition ${conditionMult.toFixed(2)}`,
  };
}

/* ═══ 4. CONSEQUENCE OF FAILURE — monetised (Section E.4) ═══════════════════
   Built from four named components so the ₹ figure can be defended line by
   line rather than asserted. All outputs in ₹ Crore. */
export function computeCoF(asset, aci) {
  const i = asset.impact;
  const TARIFF = 8.4;            // ₹/kWh average realisation
  const PENALTY_RATE = 0.65;     // ₹ Cr regulatory exposure at ACI 100

  // 1. Unserved energy during restoration
  const unservedMWh = (i.consumers * i.kwhPerConsumerDay * asset.restorationDays) / 1000;
  const unservedEnergy = (unservedMWh * 1000 * TARIFF) / 1e7;

  // 2. Revenue lost while the asset is out
  const revenueLoss = (i.revenue * asset.restorationDays) / 365;

  // 3. Asset replacement, net of salvage
  const replacement = asset.replacementCost * 0.92;

  // 4. Safety, environmental and regulatory exposure, scaled by criticality
  const safetyEnv = PENALTY_RATE * (aci / 100) * (1 + i.safety / 100);

  const cof = unservedEnergy + revenueLoss + replacement + safetyEnv;

  return {
    cof,
    components: [
      { label: 'Unserved energy',      value: unservedEnergy, note: `${unservedMWh.toFixed(0)} MWh × ₹${TARIFF}/kWh` },
      { label: 'Revenue loss',         value: revenueLoss,    note: `${asset.restorationDays}d of ₹${i.revenue.toFixed(1)} Cr/yr` },
      { label: 'Asset replacement',    value: replacement,    note: `₹${asset.replacementCost.toFixed(2)} Cr less salvage` },
      { label: 'Safety & regulatory',  value: safetyEnv,      note: `ACI ${aci.toFixed(0)} exposure` },
    ],
  };
}

/* ═══ 5. ASSET RISK INDEX — ARI = PoF × CoF ═════════════════════════════════ */
export function computeARI(asset, weights, aciWeights) {
  const health = computeAHI(asset, weights);
  const crit = computeACI(asset, aciWeights);
  const pof = computePoF(asset, health.ahi);
  const cof = computeCoF(asset, crit.aci);

  const ariValue = pof.pof * cof.cof; // ₹ Cr of annualised expected loss

  return {
    ahi: health.ahi,
    aci: crit.aci,
    pof: pof.pof,
    cof: cof.cof,
    ari: ariValue,
    health,
    crit,
    pofDetail: pof,
    cofDetail: cof,
  };
}

/* Bands are calibrated to the observed fleet distribution rather than picked
   from round numbers — otherwise the top band sits empty and the heat map
   reads as broken. TPCL confirms these cut points during Blueprinting. */
/* Measured across the 6,149-asset demo fleet: p50 0.044, p90 0.162,
   p99 0.298, max 1.98 (heavily skewed — RMUs and breakers serve few
   consumers). Cut points sit at roughly p50 / p90 / p99 / top tail. */
export const RISK_BANDS = { extreme: 0.80, high: 0.30, medium: 0.12, low: 0.04 };

export function riskBand(ari) {
  if (ari >= RISK_BANDS.extreme) return { key: 'extreme', label: 'Extreme', color: '#dc2626' };
  if (ari >= RISK_BANDS.high)    return { key: 'high',    label: 'High',    color: '#ea580c' };
  if (ari >= RISK_BANDS.medium)  return { key: 'medium',  label: 'Medium',  color: '#d97706' };
  if (ari >= RISK_BANDS.low)     return { key: 'low',     label: 'Low',     color: '#65a30d' };
  return { key: 'minimal', label: 'Minimal', color: '#16a34a' };
}

/* ═══ 6. INVESTMENT CANDIDATES & PORTFOLIO OPTIMISATION (Sections I & J) ════
   Each at-risk asset generates one recommended intervention. The Investment
   Value Score is a benefit-cost ratio: rupees of annualised risk bought down
   per rupee of capital committed. */
const INTERVENTIONS = [
  { key: 'replace',   label: 'Replace',              targetAHI: 96, costFactor: 1.00, years: 30, threshold: 45 },
  { key: 'refurbish', label: 'Refurbish',            targetAHI: 82, costFactor: 0.34, years: 12, threshold: 62 },
  { key: 'monitor',   label: 'Condition Monitoring', targetAHI: 74, costFactor: 0.08, years: 6,  threshold: 74 },
];

export function buildCandidate(asset, weights, aciWeights) {
  // Breakers and RMUs are managed under the OPEX maintenance programme, not
  // as individual capital projects — a utility does not raise a business case
  // per ring main unit. Only transformers enter the capital portfolio.
  if (asset.assetClass !== 'power_transformer') return null;

  const before = computeARI(asset, weights, aciWeights);
  const plan = INTERVENTIONS.find((iv) => before.ahi < iv.threshold);
  if (!plan) return null; // healthy enough — no intervention warranted

  const capex = asset.replacementCost * plan.costFactor;

  // Re-run the identical risk engine against the post-intervention health,
  // so the benefit is computed, not assumed.
  const pofAfter = computePoF(
    { ...asset, age: plan.key === 'replace' ? 0.5 : asset.age * 0.55 },
    plan.targetAHI
  );
  const ariAfter = pofAfter.pof * before.cof;
  const riskAvoided = Math.max(before.ari - ariAfter, 0);

  // Benefit-cost ratio over the intervention life, lightly discounted
  const bcr = capex > 0 ? (riskAvoided * plan.years * 0.72) / capex : 0;

  return {
    id: `IVC-${asset.id}`,
    asset,
    intervention: plan.key,
    interventionLabel: plan.label,
    capex,
    ahiBefore: before.ahi,
    ahiAfter: plan.targetAHI,
    ariBefore: before.ari,
    ariAfter,
    riskAvoided,
    years: plan.years,
    bcr,
    ivs: clamp(Math.log10(1 + bcr) * 52, 0, 100), // 0–100 Investment Value Score
    aci: before.aci,
    zone: asset.zone,
  };
}

/**
 * optimisePortfolio — greedy knapsack against a hard budget ceiling.
 *
 * Deliberately a transparent heuristic rather than a black-box solver: an
 * evaluator can ask "why was this project cut?" and the answer is always
 * "it ranked below the line when sorted by value per rupee". Section J's
 * live budget change re-runs this function, nothing else.
 */
export function optimisePortfolio(candidates, budgetCr, options = {}) {
  const { minCriticality = 0, onlyInterventions = null } = options;

  const eligible = candidates
    .filter((c) => c.aci >= minCriticality)
    .filter((c) => !onlyInterventions || onlyInterventions.includes(c.intervention))
    .sort((a, b) => b.bcr - a.bcr);

  const selected = [];
  const deferred = [];
  let spend = 0;

  for (const c of eligible) {
    if (spend + c.capex <= budgetCr) {
      selected.push(c);
      spend += c.capex;
    } else {
      deferred.push(c);
    }
  }

  const riskBoughtDown = selected.reduce((s, c) => s + c.riskAvoided, 0);
  const residualRisk = deferred.reduce((s, c) => s + c.ariBefore, 0);
  const totalRisk = candidates.reduce((s, c) => s + c.ariBefore, 0);

  return {
    selected,
    deferred,
    spend,
    budgetCr,
    utilisation: budgetCr > 0 ? (spend / budgetCr) * 100 : 0,
    riskBoughtDown,
    residualRisk,
    totalRisk,
    riskReductionPct: totalRisk > 0 ? (riskBoughtDown / totalRisk) * 100 : 0,
    // Indicative reliability outcome — SAIDI improves as risk is retired
    saidiDelta: -(riskBoughtDown * 1.9),
  };
}

/* ═══ 7. REMAINING USEFUL LIFE (Section F) ══════════════════════════════════
   Inverts the Weibull to find when the asset crosses the intervention
   threshold, and reports a confidence band rather than a bare number —
   Checkpoint F.5 asks for the confidence score explicitly. */
export function computeRUL(asset, ahi) {
  const degradationRate = asset.degradationRate || 2.4; // AHI points lost per year
  const INTERVENTION_AHI = 45;
  const years = Math.max((ahi - INTERVENTION_AHI) / degradationRate, 0);

  // Confidence falls with data sparsity and rises with observation history
  const confidence = clamp(62 + asset.dataYears * 3.4 - (asset.missingParams || 0) * 7, 40, 96);
  const band = years * (1 - confidence / 100) * 1.8;

  return {
    years,
    low: Math.max(years - band, 0),
    high: years + band,
    confidence,
    degradationRate,
    thresholdAHI: INTERVENTION_AHI,
  };
}

/* ─── Formatting helpers (Indian numbering) ─────────────────────────────── */
export const fmtCr = (v, dp = 2) => `₹${v.toFixed(dp)} Cr`;
export const fmtInt = (v) => Math.round(v).toLocaleString('en-IN');
export const fmtPct = (v, dp = 1) => `${v.toFixed(dp)}%`;
