import { ASSETS } from '../data/network';
import { computeAHI, computeACI, computePoF, computeCoF } from './indices';
import { projectAsset, fleetTrend, criticalityRanking, TREND_ASSUMPTIONS } from './trend';

/* Passing undefined weights makes every engine fall back to its published
   defaults, which is what the trend must reproduce at offset 0. */
const sample = ASSETS.slice(0, 400);

describe('projectAsset', () => {
  const a = ASSETS[0];

  test('offset 0 reproduces the published figures exactly', () => {
    const p = projectAsset(a, 0, undefined, undefined);
    const health = computeAHI(a, undefined);
    const crit = computeACI(a, undefined);
    const pof = computePoF(a, health.ahi).pof;
    const cof = computeCoF(a, crit.aci).cof;

    expect(p.ahi).toBeCloseTo(health.ahi, 10);
    expect(p.aci).toBeCloseTo(crit.aci, 10);
    expect(p.pof).toBeCloseTo(pof, 10);
    expect(p.cof).toBeCloseTo(cof, 10);
    expect(p.ari).toBeCloseTo(pof * cof, 10);
  });

  test('health degrades forward and recovers backward at the asset rate', () => {
    const now = projectAsset(a, 0, undefined, undefined).ahi;
    const fwd = projectAsset(a, 3, undefined, undefined).ahi;
    const back = projectAsset(a, -3, undefined, undefined).ahi;
    // Only assert direction where the clamp is not active
    if (now > 10 && now < 90) {
      expect(fwd).toBeLessThan(now);
      expect(back).toBeGreaterThan(now);
      expect(now - fwd).toBeCloseTo(3 * a.degradationRate, 6);
    }
  });

  test('ageing raises probability of failure', () => {
    const now = projectAsset(a, 0, undefined, undefined).pof;
    const later = projectAsset(a, 5, undefined, undefined).pof;
    expect(later).toBeGreaterThan(now);
  });

  test('load growth raises consequence of failure', () => {
    const now = projectAsset(a, 0, undefined, undefined).cof;
    const later = projectAsset(a, 5, undefined, undefined).cof;
    expect(later).toBeGreaterThan(now);
  });

  test('safety and environmental exposure are not grown with load', () => {
    // Those dimensions are equipment properties; the projection must not
    // silently inflate them, which would overstate criticality growth.
    const grownACI = projectAsset(a, 5, undefined, undefined).aci;
    const nowACI = projectAsset(a, 0, undefined, undefined).aci;
    const ratio = grownACI / nowACI;
    expect(ratio).toBeGreaterThan(1);
    expect(ratio).toBeLessThan(1.35);   // bounded because 2 of 5 dims are fixed
  });

  test('is deterministic', () => {
    expect(projectAsset(a, 4, undefined, undefined)).toEqual(projectAsset(a, 4, undefined, undefined));
  });
});

describe('fleetTrend', () => {
  const trend = fleetTrend(sample, {}, undefined);

  test('spans the stated history and horizon', () => {
    expect(trend.series[0].offset).toBe(-TREND_ASSUMPTIONS.historyYears);
    expect(trend.end.offset).toBe(TREND_ASSUMPTIONS.horizonYears);
    expect(trend.series).toHaveLength(TREND_ASSUMPTIONS.historyYears + TREND_ASSUMPTIONS.horizonYears + 1);
  });

  test('labels reconstructed past separately from projected future', () => {
    expect(trend.series.filter((s) => s.kind === 'reconstructed')).toHaveLength(TREND_ASSUMPTIONS.historyYears);
    expect(trend.series.filter((s) => s.kind === 'projected')).toHaveLength(TREND_ASSUMPTIONS.horizonYears);
    expect(trend.today.kind).toBe('today');
  });

  test('today carries no attributed change', () => {
    expect(trend.today.attribution.total).toBeCloseTo(0, 9);
    expect(trend.today.attribution.condition).toBeCloseTo(0, 9);
    expect(trend.today.attribution.consequence).toBeCloseTo(0, 9);
    expect(trend.today.attribution.interaction).toBeCloseTo(0, 9);
  });

  test('attribution decomposition is exact at every point', () => {
    trend.series.forEach((s) => {
      const { total, condition, consequence, interaction } = s.attribution;
      expect(condition + consequence + interaction).toBeCloseTo(total, 6);
    });
  });

  test('fleet risk rises across the projection', () => {
    expect(trend.end.totalARI).toBeGreaterThan(trend.today.totalARI);
    expect(trend.riskCAGR).toBeGreaterThan(0);
  });

  test('condition and consequence both push risk up, condition dominating', () => {
    const a = trend.end.attribution;
    expect(a.condition).toBeGreaterThan(0);
    expect(a.consequence).toBeGreaterThan(0);
    // Ageing plant moves risk harder than 2.4% load growth does
    expect(a.condition).toBeGreaterThan(a.consequence);
  });

  test('mean criticality rises with connected load', () => {
    expect(trend.end.meanACI).toBeGreaterThan(trend.today.meanACI);
  });

  test('mean health falls across the projection', () => {
    expect(trend.end.meanAHI).toBeLessThan(trend.today.meanAHI);
  });

  test('responds to a health weight change', () => {
    const retuned = fleetTrend(sample, { power_transformer: { dga: 0.6, oil: 0.05, thermal: 0.05, loading: 0.05, maintenance: 0.05, pd: 0.05 } }, undefined);
    expect(retuned.today.totalARI).not.toBeCloseTo(trend.today.totalARI, 3);
  });
});

describe('criticalityRanking', () => {
  const ranked = criticalityRanking(sample, undefined, 25);

  test('returns the requested depth, ranked descending', () => {
    expect(ranked).toHaveLength(25);
    for (let i = 1; i < ranked.length; i += 1) {
      expect(ranked[i - 1].aci).toBeGreaterThanOrEqual(ranked[i].aci);
    }
    expect(ranked[0].rank).toBe(1);
  });

  test('carries every criticality dimension for each asset', () => {
    ranked.forEach((r) => {
      ['consumers', 'revenue', 'reliability', 'safety', 'environment'].forEach((k) => {
        expect(r.dims[k]).toBeDefined();
        expect(typeof r.dims[k].contribution).toBe('number');
      });
    });
  });

  test('names the dimension contributing the most index points', () => {
    ranked.forEach((r) => {
      const max = Math.max(...Object.values(r.dims).map((d) => d.contribution));
      expect(r.driver.contribution).toBeCloseTo(max, 9);
    });
  });

  test('ranking follows the weights it is given', () => {
    const safetyLed = criticalityRanking(sample, { consumers: 0.02, revenue: 0.02, reliability: 0.02, safety: 0.80, environment: 0.02 }, 25);
    expect(safetyLed[0].driver.key).toBe('safety');
  });
});
