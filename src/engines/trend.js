/* ═══════════════════════════════════════════════════════════════════════════
   Risk and criticality over time — Checkpoints E.5 and D.9
   ───────────────────────────────────────────────────────────────────────────
   Nothing here draws a curve. Every point on every series is a full pass
   through the same engines the rest of the application uses: the asset is
   re-aged, its condition is moved along its own measured degradation rate,
   its connected load is grown, and computeAHI / computeACI / computePoF /
   computeCoF are called again. Change a health weight on the workbench and
   these curves move, because they are recomputed from the same weights.

   Two honesty constraints shape the module:

   1. Points to the left of today are a RECONSTRUCTION, not a measurement.
      The demo fleet is synthetic and carries no archived readings, so past
      condition is inferred by running the degradation rate backwards. It is
      labelled as reconstructed wherever it is plotted. On live data this
      function reads the historian instead and nothing above it changes.

   2. Points to the right are a PROJECTION under stated assumptions, which
      are exported as TREND_ASSUMPTIONS so the screen can print them next to
      the chart. A projection whose assumptions are not on screen is an
      assertion.
   ═══════════════════════════════════════════════════════════════════════════ */

import { computeAHI, computeACI, computePoF, computeCoF } from './indices';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/* Growth assumptions. Indicative figures for a Mumbai licence area; the
   delivery build takes them from the approved load forecast rather than from
   this file, which is why they live in one exported object. */
export const TREND_ASSUMPTIONS = {
  historyYears: 5,
  horizonYears: 5,
  consumerCAGR: 0.024,   // connection growth per year
  demandCAGR: 0.031,     // energy per connection per year
  note: 'Safety and environmental exposure are properties of the equipment and its site, not of connected load, so they are held constant. Consumer count, revenue at risk and reliability impact grow with the load forecast.',
};

/* ─── One asset at one point in time ────────────────────────────────────────
   `yearOffset` is signed: negative reconstructs the past, positive projects
   forward, zero must reproduce today's published figures exactly. */
export function projectAsset(asset, yearOffset, healthWeights, aciWeights, opts = {}) {
  const { consumerCAGR, demandCAGR } = { ...TREND_ASSUMPTIONS, ...opts };

  /* Condition. Sign convention matches healthHistory() in data/network.js:
     going back in time the asset was healthier, forward it is worse. */
  const baseAHI = computeAHI(asset, healthWeights).ahi;
  const ahi = clamp(baseAHI - yearOffset * asset.degradationRate, 0, 100);

  // Age drives the Weibull hazard, so it moves with the clock.
  const aged = { ...asset, age: Math.max(asset.age + yearOffset, 0.5) };

  // Connected load grows; equipment-intrinsic exposure does not.
  const gC = Math.pow(1 + consumerCAGR, yearOffset);
  const gD = Math.pow(1 + demandCAGR, yearOffset);
  const grown = {
    ...aged,
    impact: {
      ...asset.impact,
      consumers: asset.impact.consumers * gC,
      revenue: asset.impact.revenue * gC * gD,
      reliability: asset.impact.reliability * gC,
    },
  };

  const crit = computeACI(grown, aciWeights);
  const pof = computePoF(grown, ahi).pof;
  const cof = computeCoF(grown, crit.aci).cof;

  return { ahi, aci: crit.aci, pof, cof, ari: pof * cof };
}

/* ─── Fleet series ──────────────────────────────────────────────────────────
   Returns one row per year with the aggregates the risk and criticality
   screens plot, plus the exact attribution described below. */
export function fleetTrend(assets, healthWeights, aciWeights, opts = {}) {
  const { historyYears, horizonYears } = { ...TREND_ASSUMPTIONS, ...opts };
  const thisYear = new Date().getFullYear();
  const offsets = [];
  for (let t = -historyYears; t <= horizonYears; t += 1) offsets.push(t);

  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;

  /* Today's figures are needed for every attribution, so they are computed
     once and reused rather than recomputed inside the year loop. */
  const base = assets.map((a) => projectAsset(a, 0, healthWeights[a.assetClass], aciWeights));
  const basePoF = base.reduce((s, x) => s + x.pof, 0) / base.length;
  const baseARI = base.reduce((s, x) => s + x.ari, 0);

  const series = offsets.map((t) => {
    let totalARI = 0, sumACI = 0, sumAHI = 0, sumPoF = 0;
    let pofOnly = 0, cofOnly = 0;   // counterfactual totals for attribution
    let extreme = 0, criticalACI = 0;

    assets.forEach((a, i) => {
      const p = t === 0 ? base[i] : projectAsset(a, t, healthWeights[a.assetClass], aciWeights);
      totalARI += p.ari;
      sumACI += p.aci;
      sumAHI += p.ahi;
      sumPoF += p.pof;

      /* Exact decomposition of ARI = PoF × CoF. Holding one factor at its
         value today isolates the other's contribution; whatever the two
         counterfactuals fail to explain is the interaction term, which is
         reported rather than quietly absorbed into one of them. */
      pofOnly += p.pof * base[i].cof;
      cofOnly += base[i].pof * p.cof;

      if (p.ari >= 1.5) extreme += 1;
      if (p.aci >= 70) criticalACI += 1;
    });

    const n = assets.length;
    const dTotal = totalARI - baseARI;
    const dPoF = pofOnly - baseARI;
    const dCoF = cofOnly - baseARI;

    return {
      offset: t,
      year: thisYear + t,
      kind: t < 0 ? 'reconstructed' : t === 0 ? 'today' : 'projected',
      totalARI,
      meanACI: sumACI / n,
      meanAHI: sumAHI / n,
      meanPoF: sumPoF / n,
      extreme,
      criticalACI,
      attribution: {
        total: dTotal,
        condition: dPoF,                       // ageing + degradation
        consequence: dCoF,                     // load growth
        interaction: dTotal - dPoF - dCoF,
      },
    };
  });

  const today = series.find((s) => s.offset === 0);
  const end = series[series.length - 1];
  const years = end.offset || 1;

  return {
    series,
    today,
    end,
    basePoF,
    /* Compound annual growth in fleet risk exposure over the projection. */
    riskCAGR: Math.pow(end.totalARI / today.totalARI, 1 / years) - 1,
    computeMs: (typeof performance !== 'undefined' ? performance.now() : 0) - t0,
    assumptions: { ...TREND_ASSUMPTIONS, ...opts },
  };
}

/* ─── Multi-dimensional criticality ranking — Checkpoint D.8 ────────────────
   A single ACI number hides which dimension put the asset near the top. This
   returns the ranked fleet with every dimension's score carried alongside, so
   two assets with the same index can be told apart by what drives them. */
export function criticalityRanking(assets, aciWeights, limit = 25) {
  const scored = assets.map((a) => {
    const crit = computeACI(a, aciWeights);
    const dims = {};
    crit.rows.forEach((r) => { dims[r.key] = r; });
    return {
      id: a.id,
      asset: a,
      aci: crit.aci,
      redundancyRelief: crit.redundancyRelief,
      dims,
      /* The dimension contributing the most index points — the honest answer
         to "why is this asset here", and not always the largest raw reading. */
      driver: crit.rows[0],
    };
  });

  scored.sort((x, y) => y.aci - x.aci);
  return scored.slice(0, limit).map((r, i) => ({ ...r, rank: i + 1 }));
}
