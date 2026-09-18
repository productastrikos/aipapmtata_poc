/* ═══════════════════════════════════════════════════════════════════════════
   Astrikos S!aP — Configuration & derived-state store
   ───────────────────────────────────────────────────────────────────────────
   Holds the things TPCL is allowed to change at runtime: health model weights,
   criticality weights, and the capital budget. Everything else on screen is
   derived from these three inputs through the engines in src/engines.

   This is what makes Checkpoints C.7 and J.2 demonstrable rather than
   assertable — a weight edited on the Health Workbench moves the fleet health
   distribution on the Command Centre, the ranking on the Risk Cockpit, and the
   selected portfolio in the Scenario Lab, because all three read this store.
   ═══════════════════════════════════════════════════════════════════════════ */

import React, { createContext, useContext, useMemo, useState, useCallback } from 'react';
import { ASSETS, ASSET_BY_ID, HERO_ID } from '../data/network';
import {
  HEALTH_PARAMS, CRITICALITY_DIMENSIONS, RISK_BANDS,
  computeAHI, computeACI, computePoF, computeCoF,
  buildCandidate, optimisePortfolio,
} from '../engines/indices';
import { buildAdvisories, buildAlerts } from '../engines/advisories';

const ApmContext = createContext(null);
export const useApm = () => useContext(ApmContext);

/* ─── Factory defaults, read straight off the engine definitions ─────────── */
function defaultHealthWeights() {
  const out = {};
  Object.entries(HEALTH_PARAMS).forEach(([cls, params]) => {
    out[cls] = params.reduce((m, p) => { m[p.key] = p.weight; return m; }, {});
  });
  return out;
}
function defaultAciWeights() {
  return CRITICALITY_DIMENSIONS.reduce((m, d) => { m[d.key] = d.weight; return m; }, {});
}

/* The approved budget is derived from the identified need rather than being a
   magic number, so the scenario controls keep working if the asset base or the
   intervention costs are ever changed. */
const FACTORY_HW = defaultHealthWeights();
const FACTORY_AW = defaultAciWeights();

const BASELINE_NEED_CR = ASSETS
  .map((a) => buildCandidate(a, FACTORY_HW[a.assetClass], FACTORY_AW))
  .filter(Boolean)
  .reduce((s, c) => s + c.capex, 0);

/* FY27 approved plan funds ~62% of identified need — the gap is what the
   Scenario Lab exists to argue about. */
export const DEFAULT_BUDGET_CR = Math.round((BASELINE_NEED_CR * 0.62) / 5) * 5;
export const BUDGET_MAX_CR = Math.round((BASELINE_NEED_CR * 1.15) / 5) * 5;
export const TOTAL_NEED_CR = BASELINE_NEED_CR;

export function ApmProvider({ children }) {
  const [healthWeights, setHealthWeights] = useState(defaultHealthWeights);
  const [aciWeights, setAciWeights] = useState(defaultAciWeights);
  const [budgetCr, setBudgetCr] = useState(DEFAULT_BUDGET_CR);
  const [selectedId, setSelectedId] = useState(HERO_ID);
  const [minCriticality, setMinCriticality] = useState(0);
  const [onlyInterventions, setOnlyInterventions] = useState(null);

  /* Tracks whether the model has been edited this session — the UI badges it,
     which is how an evaluator can see their own change took effect. */
  const [dirty, setDirty] = useState(false);

  const setHealthWeight = useCallback((assetClass, key, value) => {
    setHealthWeights((prev) => ({
      ...prev,
      [assetClass]: { ...prev[assetClass], [key]: value },
    }));
    setDirty(true);
  }, []);

  const setAciWeight = useCallback((key, value) => {
    setAciWeights((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  }, []);

  const resetModel = useCallback(() => {
    setHealthWeights(defaultHealthWeights());
    setAciWeights(defaultAciWeights());
    setDirty(false);
  }, []);

  const resetAll = useCallback(() => {
    resetModel();
    setBudgetCr(DEFAULT_BUDGET_CR);
    setMinCriticality(0);
    setOnlyInterventions(null);
    setSelectedId(HERO_ID);
  }, [resetModel]);

  /* ─── Full-asset detail (rows retained) — for drill-down screens ───────── */
  const detailFor = useCallback((assetId) => {
    const asset = ASSET_BY_ID[assetId];
    if (!asset) return null;
    const health = computeAHI(asset, healthWeights[asset.assetClass]);
    const crit = computeACI(asset, aciWeights);
    const pof = computePoF(asset, health.ahi);
    const cof = computeCoF(asset, crit.aci);
    return {
      asset,
      health, crit, pofDetail: pof, cofDetail: cof,
      ahi: health.ahi, aci: crit.aci,
      pof: pof.pof, cof: cof.cof,
      ari: pof.pof * cof.cof,
    };
  }, [healthWeights, aciWeights]);

  /* ─── Fleet-wide scalars — recomputed whenever the model changes ───────── */
  const fleet = useMemo(() => {
    const t0 = performance.now();
    const rows = ASSETS.map((a) => {
      // Row breakdowns are allocated and discarded here on purpose: the fleet
      // view only needs the scalars, and retaining ~70k row objects would cost
      // memory the demo has no use for.
      const health = computeAHI(a, healthWeights[a.assetClass]);
      const crit = computeACI(a, aciWeights);
      const pof = computePoF(a, health.ahi).pof;
      const cof = computeCoF(a, crit.aci).cof;
      return {
        id: a.id, asset: a, zone: a.zone, assetClass: a.assetClass, tier: a.tier,
        ahi: health.ahi, aci: crit.aci, pof, cof, ari: pof * cof,
      };
    });
    return { rows, computeMs: performance.now() - t0 };
  }, [healthWeights, aciWeights]);

  /* ─── Fleet aggregates for the Command Centre ──────────────────────────── */
  const summary = useMemo(() => {
    const r = fleet.rows;
    const n = r.length;
    const meanAHI = r.reduce((s, x) => s + x.ahi, 0) / n;
    const totalRisk = r.reduce((s, x) => s + x.ari, 0);
    const bands = { excellent: 0, good: 0, fair: 0, poor: 0, critical: 0 };
    r.forEach((x) => {
      if (x.ahi >= 85) bands.excellent++;
      else if (x.ahi >= 70) bands.good++;
      else if (x.ahi >= 55) bands.fair++;
      else if (x.ahi >= 40) bands.poor++;
      else bands.critical++;
    });
    return {
      count: n,
      meanAHI,
      totalRisk,
      bands,
      atRisk: r.filter((x) => x.ahi < 62).length,
      extreme: r.filter((x) => x.ari >= RISK_BANDS.extreme).length,
      topRisk: [...r].sort((a, b) => b.ari - a.ari).slice(0, 12),
    };
  }, [fleet]);

  /* ─── Investment candidates — depend on the model, not on the budget ───── */
  const candidates = useMemo(() => {
    return ASSETS
      .map((a) => buildCandidate(a, healthWeights[a.assetClass], aciWeights))
      .filter(Boolean)
      .sort((a, b) => b.bcr - a.bcr);
  }, [healthWeights, aciWeights]);

  /* ─── Optimised portfolio — the only thing the budget slider re-runs ───── */
  const portfolio = useMemo(
    () => optimisePortfolio(candidates, budgetCr, { minCriticality, onlyInterventions }),
    [candidates, budgetCr, minCriticality, onlyInterventions]
  );

  /* ─── S!a advisories & alerts — derived, never authored ────────────────
     These re-derive whenever the model or the budget changes, so the advisory
     panel can never quote a figure the rest of the platform disagrees with. */
  const advisories = useMemo(
    () => buildAdvisories({ fleet, summary, candidates, portfolio, detailFor, budgetCr }),
    [fleet, summary, candidates, portfolio, detailFor, budgetCr]
  );

  const alerts = useMemo(
    () => buildAlerts({ fleet, summary, portfolio, detailFor }),
    [fleet, summary, portfolio, detailFor]
  );

  const value = {
    healthWeights, aciWeights, budgetCr, minCriticality, onlyInterventions, selectedId, dirty,
    advisories, alerts,
    setHealthWeight, setAciWeight, setBudgetCr, setMinCriticality, setOnlyInterventions, setSelectedId,
    resetModel, resetAll,
    fleet, summary, candidates, portfolio, detailFor,
  };

  return <ApmContext.Provider value={value}>{children}</ApmContext.Provider>;
}
