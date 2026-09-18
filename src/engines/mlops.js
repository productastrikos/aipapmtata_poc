/* ═══════════════════════════════════════════════════════════════════════════
   Model training, evaluation and drift — Section F.2, F.3, F.8, F.9
   ───────────────────────────────────────────────────────────────────────────
   The RFQ asks a bidder to demonstrate the ML model training process, not to
   assert an accuracy number. So this module actually trains.

   `trainForecastModel` fits an ordinary-least-squares predictor of next-year
   asset health from present-day observables, on a deterministic train/holdout
   split of the live fleet, and reports the error it achieves on data it did not
   see. The residual is real: the model observes condition and age but not the
   asset's underlying degradation rate, so what it cannot explain is exactly the
   variance a year of additional history would reduce. An R² of 1.0 here would
   mean the evaluation was circular, not that the model was good.

   `populationStability` computes the standard PSI between a baseline and a
   current distribution. It is wired to the live health weights, so an evaluator
   who retunes the model on the Health Workbench makes this number move — which
   is the honest way to demonstrate drift detection rather than animating it.
   ═══════════════════════════════════════════════════════════════════════════ */

/* ─── Linear algebra: OLS by normal equations ────────────────────────────────
   Small, dense and well-conditioned at this feature count, so Gaussian
   elimination with partial pivoting is the right tool — no library needed. */

function solve(A, b) {
  const n = b.length;
  // Augmented copy so the caller's matrices are not mutated
  const M = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    }
    if (Math.abs(M[piv][col]) < 1e-12) return null;  // singular — caller decides
    [M[col], M[piv]] = [M[piv], M[col]];

    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col] / M[col][col];
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  // Matrix is diagonal after full Gauss-Jordan: x_i = augmented_i / diagonal_i
  return M.map((row, i) => row[n] / row[i]);
}

function ols(X, y, ridge = 1e-6) {
  const n = X.length;
  const p = X[0].length;
  const XtX = Array.from({ length: p }, () => new Array(p).fill(0));
  const Xty = new Array(p).fill(0);

  for (let i = 0; i < n; i++) {
    for (let a = 0; a < p; a++) {
      Xty[a] += X[i][a] * y[i];
      for (let b = a; b < p; b++) XtX[a][b] += X[i][a] * X[i][b];
    }
  }
  for (let a = 0; a < p; a++) {
    for (let b = 0; b < a; b++) XtX[a][b] = XtX[b][a];
    XtX[a][a] += ridge;   // tiny ridge keeps a collinear feature set solvable
  }
  return solve(XtX, Xty);
}

/* ─── Feature extraction ─────────────────────────────────────────────────────
   Deliberately excludes the asset's degradation rate. That is the quantity the
   model is implicitly trying to infer; feeding it in would make the evaluation
   meaningless. */

export const FORECAST_FEATURES = [
  { key: 'bias', label: 'Intercept', get: () => 1, unit: '' },
  { key: 'ahi', label: 'Current AHI', get: (r) => r.ahi, unit: 'points' },
  { key: 'age', label: 'Age', get: (r) => r.asset.age, unit: 'years' },
  { key: 'ageFrac', label: 'Age / design life', get: (r) => r.asset.age / r.asset.designLife, unit: 'ratio' },
  { key: 'dga', label: 'DGA TDCG', get: (r) => (r.asset.readings.dga ?? 0) / 1000, unit: 'k ppm' },
  { key: 'oil', label: 'Oil BDV', get: (r) => (r.asset.readings.oil ?? 0) / 10, unit: '×10 kV' },
  { key: 'thermal', label: 'Hotspot', get: (r) => (r.asset.readings.thermal ?? 0) / 100, unit: '×100 °C' },
  { key: 'loading', label: 'Loading', get: (r) => (r.asset.readings.loading ?? 0) / 100, unit: 'fraction' },
  { key: 'maint', label: 'Months since service', get: (r) => (r.asset.readings.maintenance ?? 0) / 12, unit: 'years' },
  { key: 'dataYears', label: 'Observation history', get: (r) => r.asset.dataYears, unit: 'years' },
];

/* Deterministic hash so the train/holdout split is stable across renders — an
   evaluator re-running the training must get the same split, or the metrics
   are not comparable between runs. */
function hashId(id) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

/* ═══ 1. TRAINING RUN — Checkpoint F.8 ════════════════════════════════════
   Target: asset health one year forward. Ground truth is the asset's own
   degradation applied to its current index, which is the same forward model the
   RUL forecaster inverts — so the metric below is the error a maintenance
   planner would actually experience when acting on a one-year forecast. */

export function trainForecastModel(rows, options = {}) {
  const { holdoutFraction = 0.30, assetClass = 'power_transformer', horizonYears = 1 } = options;

  const pool = rows.filter((r) => r.assetClass === assetClass && r.asset.readings.dga != null);
  if (pool.length < 50) return null;

  const train = [];
  const test = [];
  pool.forEach((r) => (hashId(r.id) < holdoutFraction ? test : train).push(r));
  if (train.length < 30 || test.length < 10) return null;

  const design = (r) => FORECAST_FEATURES.map((f) => f.get(r));
  const target = (r) => Math.max(r.ahi - r.asset.degradationRate * horizonYears, 0);

  const Xtr = train.map(design);
  const ytr = train.map(target);
  const beta = ols(Xtr, ytr);
  if (!beta) return null;

  const predict = (r) => design(r).reduce((s, x, i) => s + x * beta[i], 0);

  const evaluate = (set) => {
    const n = set.length;
    let sae = 0, sse = 0, sy = 0;
    const preds = [];
    set.forEach((r) => {
      const p = predict(r);
      const a = target(r);
      preds.push({ id: r.id, predicted: p, actual: a, error: p - a });
      sae += Math.abs(p - a);
      sse += (p - a) ** 2;
      sy += a;
    });
    const mean = sy / n;
    const sst = set.reduce((s, r) => s + (target(r) - mean) ** 2, 0);
    // Share of predictions landing inside a maintenance-relevant tolerance
    const within1 = preds.filter((x) => Math.abs(x.error) <= 1).length / n;
    const within2 = preds.filter((x) => Math.abs(x.error) <= 2).length / n;
    return {
      n,
      mae: sae / n,
      rmse: Math.sqrt(sse / n),
      r2: sst > 0 ? 1 - sse / sst : 0,
      bias: preds.reduce((s, x) => s + x.error, 0) / n,
      within1, within2,
      preds,
    };
  };

  const trainMetrics = evaluate(train);
  const testMetrics = evaluate(test);

  /* Skill against the naive forecast.

     R² on a level forecast is flattering by construction: next year's health is
     mostly this year's health, so any model that passes current AHI through
     scores highly. The honest question is whether the model beats the trivial
     predictor that does exactly that — "next year will be the same as now" —
     and by how much. That is the skill score, and it is the figure to quote
     when someone asks whether a high R² means anything. */
  const naiveMae = test.reduce((s, r) => s + Math.abs(r.ahi - target(r)), 0) / test.length;
  const skill = naiveMae > 0 ? 1 - testMetrics.mae / naiveMae : 0;

  return {
    assetClass,
    horizonYears,
    holdoutFraction,
    features: FORECAST_FEATURES.map((f, i) => ({
      ...f,
      coefficient: beta[i],
      // Standardised contribution: coefficient scaled by the feature's spread,
      // which is what makes two features on different units comparable.
      contribution: Math.abs(beta[i]) * stdev(train.map((r) => f.get(r))),
    })),
    beta,
    predict,
    train: trainMetrics,
    test: testMetrics,
    // Generalisation gap — the honest check that the fit is not memorised
    overfitGap: testMetrics.mae - trainMetrics.mae,
    naiveMae,
    skill,
    poolSize: pool.length,
  };
}

function stdev(xs) {
  const n = xs.length;
  if (!n) return 0;
  const m = xs.reduce((s, x) => s + x, 0) / n;
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / n);
}

/* ═══ 2. DRIFT — Population Stability Index ═══════════════════════════════
   The industry-standard measure of whether the population a model is scoring
   still resembles the population it was trained on. Thresholds are the
   conventional ones: below 0.10 stable, 0.10-0.25 moderate, above 0.25 material. */

export const PSI_BANDS = {
  stable: { max: 0.10, label: 'Stable', colour: 'var(--app-success)' },
  moderate: { max: 0.25, label: 'Moderate shift', colour: 'var(--app-warning)' },
  material: { max: Infinity, label: 'Material shift', colour: 'var(--app-danger)' },
};

export function psiBand(psi) {
  if (psi < PSI_BANDS.stable.max) return PSI_BANDS.stable;
  if (psi < PSI_BANDS.moderate.max) return PSI_BANDS.moderate;
  return PSI_BANDS.material;
}

export function populationStability(baseline, current, bins = 10, lo = 0, hi = 100) {
  const width = (hi - lo) / bins;
  const hist = (xs) => {
    const h = new Array(bins).fill(0);
    xs.forEach((x) => {
      let b = Math.floor((x - lo) / width);
      if (b < 0) b = 0;
      if (b >= bins) b = bins - 1;
      h[b] += 1;
    });
    return h.map((c) => c / Math.max(xs.length, 1));
  };

  const be = hist(baseline);
  const ce = hist(current);

  // Floor at a small epsilon: an empty bin on one side must not make PSI
  // infinite, and the conventional treatment is to substitute a tiny share.
  const EPS = 1e-4;
  let psi = 0;
  const detail = [];
  for (let i = 0; i < bins; i++) {
    const e = Math.max(be[i], EPS);
    const a = Math.max(ce[i], EPS);
    const term = (a - e) * Math.log(a / e);
    psi += term;
    detail.push({
      bin: `${(lo + i * width).toFixed(0)}–${(lo + (i + 1) * width).toFixed(0)}`,
      baseline: be[i], current: ce[i], contribution: term,
    });
  }
  /* PSI over ten bins of a broad distribution is insensitive to a small shift
     in location — which is correct behaviour, but it makes the metric hard to
     read on its own. The first two moments say plainly what moved, so the two
     together are interpretable where either alone is not. */
  const moments = (xs) => {
    const n = xs.length || 1;
    const mean = xs.reduce((a, b) => a + b, 0) / n;
    const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
    return { mean, sd, n: xs.length };
  };
  const b = moments(baseline);
  const c = moments(current);

  return {
    psi, detail, bins, band: psiBand(psi),
    baselineStats: b,
    currentStats: c,
    meanShift: c.mean - b.mean,
    sdRatio: b.sd > 0 ? c.sd / b.sd : 1,
    // Cohen's d — the shift expressed in standard deviations, so it is
    // comparable across differently-scaled populations.
    effectSize: b.sd > 0 ? (c.mean - b.mean) / b.sd : 0,
  };
}

/* ═══ 3. ANOMALY DETECTION — Checkpoint F.3 ═══════════════════════════════
   Robust z-score against the asset's own class cohort. Median and MAD rather
   than mean and standard deviation, because a handful of genuinely bad assets
   would otherwise drag the baseline far enough to hide themselves. */

const MAD_TO_SIGMA = 1.4826;

export function detectAnomalies(rows, parameters, options = {}) {
  const { threshold = 3.5, assetClass = 'power_transformer' } = options;
  const pool = rows.filter((r) => r.assetClass === assetClass);
  if (pool.length < 30) return { findings: [], cohorts: [] };

  const cohorts = parameters.map((p) => {
    const vals = pool.map((r) => r.asset.readings[p.key]).filter((v) => v != null).sort((a, b) => a - b);
    const median = vals[Math.floor(vals.length / 2)];
    const devs = vals.map((v) => Math.abs(v - median)).sort((a, b) => a - b);
    const mad = devs[Math.floor(devs.length / 2)] || 1e-6;
    return { ...p, median, mad, sigma: mad * MAD_TO_SIGMA, n: vals.length };
  });

  const findings = [];
  pool.forEach((r) => {
    cohorts.forEach((c) => {
      const v = r.asset.readings[c.key];
      if (v == null) return;
      // Direction matters: high DGA is bad, low oil BDV is bad.
      const z = (v - c.median) / Math.max(c.sigma, 1e-6);
      const signed = c.higherIsWorse ? z : -z;
      if (signed >= threshold) {
        findings.push({
          id: r.id, zone: r.zone, ahi: r.ahi, ari: r.ari,
          parameter: c.key, label: c.label, value: v,
          cohortMedian: c.median, z: signed, unit: c.unit,
        });
      }
    });
  });

  return {
    findings: findings.sort((a, b) => b.z - a.z),
    cohorts,
    threshold,
    scanned: pool.length,
  };
}

/* ═══ 4. FEEDBACK — Checkpoint F.9 ════════════════════════════════════════
   Field confirmation or rejection of a model output, aggregated into the
   precision figure that governs whether the model stays in production. */

export function summariseFeedback(rows) {
  const total = rows.length;
  const confirmed = rows.filter((r) => r.verdict === 'confirmed').length;
  const rejected = rows.filter((r) => r.verdict === 'rejected').length;
  const adjusted = rows.filter((r) => r.verdict === 'adjusted').length;

  const byModel = {};
  rows.forEach((r) => {
    const k = r.modelId || 'unknown';
    byModel[k] = byModel[k] || { modelId: k, total: 0, confirmed: 0, rejected: 0, adjusted: 0 };
    byModel[k].total += 1;
    byModel[k][r.verdict] = (byModel[k][r.verdict] || 0) + 1;
  });

  return {
    total, confirmed, rejected, adjusted,
    // Precision as the field sees it: of the outputs acted on, how many held up
    precision: total ? (confirmed + adjusted * 0.5) / total : null,
    byModel: Object.values(byModel).map((m) => ({
      ...m,
      precision: m.total ? (m.confirmed + (m.adjusted || 0) * 0.5) / m.total : null,
    })),
  };
}

/* ═══ 5. MODEL REGISTRY ═══════════════════════════════════════════════════
   The models the platform runs, with the governance attributes RFQ §3.4.11
   requires: algorithm, feature set, training window, acceptance threshold and
   retraining trigger. Live metrics are attached by the page at render time. */

export const MODEL_REGISTRY = [
  {
    id: 'MDL-AHI-TX-04',
    name: 'Transformer Health Index',
    version: '4.2.0',
    status: 'Production',
    algorithm: 'Weighted parameter scoring with piecewise-linear band mapping',
    explainability: 'Direct — every point of deduction traces to one parameter',
    features: 'DGA TDCG, oil BDV, hotspot, loading, months since service, partial discharge',
    trainingWindow: 'Calibrated against IEEE C57.104 and IEC 60156 thresholds',
    acceptance: 'Engineer agreement ≥ 85% on sampled assets',
    retrigger: 'Parameter distribution PSI > 0.25, or agreement < 85%',
  },
  {
    id: 'MDL-RUL-TX-03',
    name: 'Remaining Useful Life Forecast',
    version: '3.1.4',
    status: 'Production',
    algorithm: 'Degradation-rate extrapolation to intervention threshold, with confidence band from observation depth',
    explainability: 'Direct — rate, threshold and history length are all shown',
    features: 'AHI trajectory, degradation rate, observation years, missing-parameter count',
    trainingWindow: 'Rolling 60 months of condition history',
    acceptance: 'MAE ≤ 1.5 AHI points at 12-month horizon on holdout',
    retrigger: 'Holdout MAE breaches threshold, or quarterly schedule',
  },
  {
    id: 'MDL-POF-TX-02',
    name: 'Probability of Failure',
    version: '2.6.1',
    status: 'Production',
    algorithm: 'Two-parameter Weibull hazard (β = 2.6) modulated by condition multiplier',
    explainability: 'Direct — shape, scale and multiplier shown on the Risk Cockpit',
    features: 'Asset age, design life, AHI',
    trainingWindow: 'ISO 14224 reliability parameters, TPCL failure history at Blueprinting',
    acceptance: 'Calibration within ±20% of observed failure rate by decile',
    retrigger: 'Annual, or on 12 months of new failure data',
  },
  {
    id: 'MDL-ANOM-01',
    name: 'Condition Anomaly Detector',
    version: '1.4.0',
    status: 'Production',
    algorithm: 'Robust z-score (median / MAD) against asset-class cohort',
    explainability: 'Direct — parameter, cohort median and deviation are reported',
    features: 'All condition-monitoring parameters, per asset class',
    trainingWindow: 'Rolling cohort, recomputed on every scan',
    acceptance: 'False-positive rate ≤ 15% on engineer review',
    retrigger: 'Continuous — the cohort baseline is recomputed each run',
  },
  {
    id: 'MDL-FCST-TX-01',
    name: '12-Month Health Forecast',
    version: '1.0.0',
    status: 'Candidate',
    algorithm: 'Ordinary least squares on condition and age features, deterministic 70/30 holdout',
    explainability: 'Direct — coefficients and standardised contributions are published',
    features: 'Current AHI, age, age fraction, DGA, oil, hotspot, loading, service interval, history depth',
    trainingWindow: 'Current fleet snapshot',
    acceptance: 'Holdout MAE ≤ 1.0 AHI points and generalisation gap ≤ 0.25',
    retrigger: 'On promotion review, or PSI > 0.25',
  },
];
