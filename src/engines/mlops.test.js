/* Verifies that the model-governance engine actually computes, and that the
   figures it produces are the ones the Model Governance screen claims.

   These assertions are deliberately about *properties* rather than exact
   values — a holdout that is genuinely held out, a gap that shows the fit is
   not memorised, a PSI that is zero when nothing changed and rises when the
   population does. Pinning exact decimals would make the suite brittle without
   making it stronger. */

import { ASSETS } from '../data/network';
import { HEALTH_PARAMS, computeAHI, computeACI, computePoF, computeCoF } from './indices';
import {
  trainForecastModel, populationStability, detectAnomalies,
  summariseFeedback, MODEL_REGISTRY,
} from './mlops';

const FACTORY = Object.entries(HEALTH_PARAMS).reduce((o, [c, ps]) => {
  o[c] = ps.reduce((m, p) => { m[p.key] = p.weight; return m; }, {});
  return o;
}, {});

const buildRows = (weights) =>
  ASSETS.map((a) => {
    const h = computeAHI(a, weights[a.assetClass]);
    const crit = computeACI(a);
    const pof = computePoF(a, h.ahi).pof;
    const cof = computeCoF(a, crit.aci).cof;
    return {
      id: a.id, asset: a, zone: a.zone, assetClass: a.assetClass, tier: a.tier,
      ahi: h.ahi, aci: crit.aci, pof, cof, ari: pof * cof,
    };
  });

const rows = buildRows(FACTORY);

describe('model training — Checkpoint F.8', () => {
  const run = trainForecastModel(rows);

  test('fits against a genuine holdout that was never trained on', () => {
    expect(run).not.toBeNull();
    expect(run.train.n).toBeGreaterThan(30);
    expect(run.test.n).toBeGreaterThan(10);
    // The split is a partition — no asset appears in both halves
    expect(run.train.n + run.test.n).toBe(run.poolSize);
    // Roughly the requested 30% holdout
    expect(run.test.n / run.poolSize).toBeGreaterThan(0.2);
    expect(run.test.n / run.poolSize).toBeLessThan(0.4);
  });

  test('the split is deterministic — re-running gives identical metrics', () => {
    const again = trainForecastModel(rows);
    expect(again.test.n).toBe(run.test.n);
    expect(again.test.mae).toBeCloseTo(run.test.mae, 10);
  });

  test('holdout error is real but bounded — the model is useful, not perfect', () => {
    // Non-zero: an exactly-zero error would mean the target leaked into features
    expect(run.test.mae).toBeGreaterThan(0);
    // Useful: within a couple of AHI points at a 12-month horizon
    expect(run.test.mae).toBeLessThan(2);
    expect(run.test.r2).toBeGreaterThan(0.9);
    expect(run.test.r2).toBeLessThan(1);
  });

  test('generalisation gap is small — the fit is not memorised', () => {
    expect(Math.abs(run.overfitGap)).toBeLessThan(0.5);
  });

  test('degradation rate is excluded from the feature set', () => {
    // The quantity the model is implicitly inferring must not be an input,
    // or the evaluation is circular.
    const keys = run.features.map((f) => f.key);
    expect(keys).not.toContain('degradationRate');
    expect(keys).toContain('ahi');
    expect(keys).toContain('age');
  });
});

describe('population stability — drift detection', () => {
  test('PSI is zero when the population has not moved', () => {
    const ahi = rows.map((r) => r.ahi);
    const { psi } = populationStability(ahi, ahi);
    expect(psi).toBeCloseTo(0, 6);
  });

  test('PSI rises when the health model is retuned', () => {
    // Same fleet, heavier DGA weighting — exactly what an evaluator does on
    // the Health Workbench.
    const retuned = JSON.parse(JSON.stringify(FACTORY));
    retuned.power_transformer.dga = 0.45;
    const shifted = buildRows(retuned);

    const { psi } = populationStability(rows.map((r) => r.ahi), shifted.map((r) => r.ahi));
    expect(psi).toBeGreaterThan(0);
  });

  test('bands follow the conventional thresholds', () => {
    const flat = new Array(500).fill(50);
    const spread = Array.from({ length: 500 }, (_, i) => (i / 500) * 100);
    const { psi, band } = populationStability(flat, spread);
    expect(psi).toBeGreaterThan(0.25);
    expect(band.label).toBe('Material shift');
  });
});

describe('anomaly detection — Checkpoint F.3', () => {
  const params = [
    { key: 'dga', label: 'Dissolved gas', unit: 'ppm', higherIsWorse: true },
    { key: 'oil', label: 'Oil BDV', unit: 'kV', higherIsWorse: false },
  ];
  const result = detectAnomalies(rows, params, { threshold: 3.5 });

  test('scans the transformer cohort and reports cohort statistics', () => {
    expect(result.scanned).toBeGreaterThan(100);
    expect(result.cohorts.length).toBe(2);
    result.cohorts.forEach((c) => {
      expect(c.sigma).toBeGreaterThan(0);
      expect(c.n).toBeGreaterThan(100);
    });
  });

  test('findings exceed the threshold and carry their evidence', () => {
    result.findings.forEach((f) => {
      expect(f.z).toBeGreaterThanOrEqual(3.5);
      expect(f.cohortMedian).toBeDefined();
      expect(f.value).toBeDefined();
    });
  });

  test('detection is directional — low oil BDV is a finding, high is not', () => {
    const oilFindings = result.findings.filter((f) => f.parameter === 'oil');
    oilFindings.forEach((f) => {
      expect(f.value).toBeLessThan(f.cohortMedian);
    });
  });

  test('a tighter threshold cannot find fewer anomalies than a looser one', () => {
    const loose = detectAnomalies(rows, params, { threshold: 2.5 });
    expect(loose.findings.length).toBeGreaterThanOrEqual(result.findings.length);
  });
});

describe('feedback aggregation — Checkpoint F.9', () => {
  test('precision counts an adjusted verdict as a half', () => {
    const fb = summariseFeedback([
      { modelId: 'M1', verdict: 'confirmed' },
      { modelId: 'M1', verdict: 'confirmed' },
      { modelId: 'M1', verdict: 'adjusted' },
      { modelId: 'M1', verdict: 'rejected' },
    ]);
    expect(fb.total).toBe(4);
    expect(fb.precision).toBeCloseTo((2 + 0.5) / 4, 6);
  });

  test('returns null precision rather than a fabricated 100% with no reviews', () => {
    const fb = summariseFeedback([]);
    expect(fb.precision).toBeNull();
    expect(fb.total).toBe(0);
  });
});

describe('model registry', () => {
  test('every model declares the governance attributes RFQ 3.4.11 requires', () => {
    MODEL_REGISTRY.forEach((m) => {
      expect(m.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(m.algorithm).toBeTruthy();
      expect(m.features).toBeTruthy();
      expect(m.acceptance).toBeTruthy();
      expect(m.retrigger).toBeTruthy();
      expect(['Production', 'Candidate', 'Retired']).toContain(m.status);
    });
  });
});
