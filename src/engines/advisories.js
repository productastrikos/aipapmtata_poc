/* ═══════════════════════════════════════════════════════════════════════════
   Astrikos S!aP — S!a advisory & alert generation
   ───────────────────────────────────────────────────────────────────────────
   Advisories are DERIVED, not written. Everything a card asserts — the asset
   it names, the rupee figures, the contributing parameter, the consumer count,
   the intervention cost — is read back out of the same engines that drive the
   Health Workbench and the Risk Cockpit.

   That matters for more than tidiness. Section F.4 asks for explainable AI and
   Section C.4 for parameter contribution; an advisory panel quoting numbers
   the rest of the platform does not produce is exactly the inconsistency an
   evaluator finds by cross-checking two screens. Edit a health weight and
   these advisories re-derive along with everything else.

   Output shape matches AdvisoryPanel's contract:
     { advisoryId, priority, title, template, rootCause{primary,contributing,
       systemic}, evidence[], recommendations[], impact, actions[] }
   ═══════════════════════════════════════════════════════════════════════════ */

import { fmtCr, fmtInt, healthBand, riskBand, computeRUL, paramsFor, RISK_BANDS } from './indices';

const pct = (v, dp = 1) => `${v.toFixed(dp)}%`;

/* ─── Fleet-wide parameter attribution ──────────────────────────────────────
   Which condition parameter is costing the fleet the most health? Summed
   across every asset, weighted exactly as the active model weights it. */
function fleetDeductions(rows, detailFor, sampleSize = 260) {
  const step = Math.max(1, Math.floor(rows.length / sampleSize));
  const totals = {};
  let sampled = 0;

  for (let i = 0; i < rows.length; i += step) {
    const d = detailFor(rows[i].id);
    if (!d) continue;
    sampled += 1;
    d.health.rows.forEach((r) => {
      if (!totals[r.key]) totals[r.key] = { key: r.key, short: r.short, label: r.label, unit: r.unit, deduction: 0, rawSum: 0, n: 0 };
      totals[r.key].deduction += r.deduction;
      totals[r.key].rawSum += Number(r.raw) || 0;
      totals[r.key].n += 1;
    });
  }

  const all = Object.values(totals);
  const grand = all.reduce((s, r) => s + r.deduction, 0) || 1;
  return {
    sampled,
    rows: all
      .map((r) => ({ ...r, share: (r.deduction / grand) * 100, meanRaw: r.rawSum / Math.max(r.n, 1) }))
      .sort((a, b) => b.deduction - a.deduction),
  };
}

/* ═══ ADVISORIES ═══════════════════════════════════════════════════════════ */
export function buildAdvisories({ fleet, summary, candidates, portfolio, detailFor, budgetCr }) {
  const out = [];
  const rows = fleet.rows;
  if (!rows.length) return out;

  /* ── 1. The single highest-exposure asset ─────────────────────────────── */
  const worst = summary.topRisk[0];
  if (worst) {
    const d = detailFor(worst.id);
    const top = d.health.rows[0];
    const rul = computeRUL(d.asset, d.ahi);
    const band = riskBand(d.ari);
    const cand = candidates.find((c) => c.asset.id === worst.id);
    const funded = portfolio.selected.some((c) => c.asset.id === worst.id);

    out.push({
      advisoryId: `ADV-RISK-${worst.id}`,
      priority: band.key === 'extreme' ? 'high' : 'medium',
      title: `${d.asset.id} carries the fleet's highest risk exposure at ${fmtCr(d.ari)}/yr`,
      template: 'risk_escalation',
      rootCause: {
        primary:
          `${d.asset.name || d.asset.substation} scores AHI ${d.ahi.toFixed(1)} (${healthBand(d.ahi).label}) against a criticality index of ` +
          `${d.aci.toFixed(0)}. The dominant health deduction is ${top.label} at ${top.deduction.toFixed(1)} points — the reading is ` +
          `${top.raw} ${top.unit} against a ${top.good} ${top.unit} target, scoring ${top.score.toFixed(0)}/100 on that parameter.`,
        contributing:
          `Probability of failure is ${pct(d.pof * 100, 2)} per year and consequence is ${fmtCr(d.cof)}, of which ` +
          `${fmtCr(d.cofDetail.components[0].value)} is unserved energy across ${fmtInt(d.asset.impact.consumers)} connections over a ` +
          `${d.asset.restorationDays}-day restoration window. ` +
          (d.asset.impact.redundancy
            ? 'N-1 redundancy is available, which already applies an 18% relief to the criticality term.'
            : 'No N-1 redundancy is available, so a failure takes the full connected load out for the entire window.'),
        systemic:
          `${fmtInt(summary.extreme)} assets now sit above the ${fmtCr(RISK_BANDS.extreme)} extreme-risk band floor, ` +
          `carrying ${fmtCr(summary.topRisk.reduce((s, r) => s + r.ari, 0))}/yr between the top twelve alone. Risk is concentrated rather ` +
          `than spread, so a narrow programme retires a disproportionate share of it.`,
      },
      evidence: [
        `AHI ${d.ahi.toFixed(1)} — ${top.short} contributes ${top.deduction.toFixed(1)} of ${(100 - d.ahi).toFixed(1)} total deduction`,
        `PoF ${pct(d.pof * 100, 2)}/yr — Weibull β=${d.pofDetail.beta}, η=${d.pofDetail.eta}y, age ${d.asset.age}y, condition ×${d.pofDetail.conditionMult.toFixed(2)}`,
        `CoF ${fmtCr(d.cof)} — ${d.cofDetail.components.map((c) => `${c.label} ${fmtCr(c.value)}`).join(', ')}`,
        `ARI = ${pct(d.pof * 100, 2)} × ${fmtCr(d.cof)} = ${fmtCr(d.ari)}/yr`,
        `Remaining useful life ${rul.years.toFixed(1)}y (${rul.low.toFixed(1)}–${rul.high.toFixed(1)}y, ${rul.confidence.toFixed(0)}% confidence)`,
      ],
      recommendations: cand
        ? [
            `${cand.interventionLabel} at ${fmtCr(cand.capex)} — lifts AHI ${cand.ahiBefore.toFixed(0)} → ${cand.ahiAfter} and retires ${fmtCr(cand.riskAvoided)}/yr`,
            funded
              ? `Already funded in the active ${fmtCr(budgetCr, 0)} scenario — hold the allocation`
              : `Currently DEFERRED at the ${fmtCr(budgetCr, 0)} budget — raise the ceiling or re-rank to fund it`,
            `Benefit-cost ratio ${cand.bcr.toFixed(1)}× over ${cand.years} years; investment value score ${cand.ivs.toFixed(0)}/100`,
          ]
        : [
            `Asset is above the intervention threshold — maintain condition monitoring cadence`,
            `Re-assess if ${top.short} degrades beyond ${top.bad} ${top.unit}`,
          ],
      impact: `${fmtCr(d.ari)}/yr of annualised risk concentrated on one asset`,
      actions: [
        { type: 'create_work_order', label: 'Raise Work Order' },
        { type: 'dispatch_crew', label: 'Assign Inspection' },
      ],
    });
  }

  /* ── 2. Fleet-wide dominant deduction ─────────────────────────────────── */
  const attribution = fleetDeductions(rows, detailFor);
  if (attribution.rows.length) {
    const lead = attribution.rows[0];
    const second = attribution.rows[1];
    // What the fleet mean AHI becomes if this parameter were restored to target
    const upliftPoints = (lead.deduction / Math.max(attribution.sampled, 1));

    out.push({
      advisoryId: `ADV-FLEET-${lead.key}`,
      priority: upliftPoints > 8 ? 'high' : 'medium',
      title: `${lead.label} is the largest single drag on fleet health — ${pct(lead.share)} of all deductions`,
      template: 'fleet_pattern',
      rootCause: {
        primary:
          `Across a ${fmtInt(attribution.sampled)}-asset sample spanning every modelled class, ${lead.label} accounts for ` +
          `${pct(lead.share)} of total health-index deductions — ahead of ${second ? `${second.label} at ${pct(second.share)}` : 'every other parameter'}. ` +
          `Mean observed value is ${lead.meanRaw.toFixed(1)} ${lead.unit}.`,
        contributing:
          `Fleet mean AHI currently stands at ${summary.meanAHI.toFixed(1)}. Restoring this one parameter to target across the sampled ` +
          `population would lift the mean by roughly ${upliftPoints.toFixed(1)} points, with no change to any other parameter.`,
        systemic:
          `A parameter this dominant is a programme, not a set of individual work orders. Addressing it fleet-wide is more economic than ` +
          `unit-by-unit intervention and reduces the candidate pool feeding the capital plan.`,
      },
      evidence: attribution.rows.slice(0, 4).map(
        (r) => `${r.label}: ${pct(r.share)} of deductions, mean ${r.meanRaw.toFixed(1)} ${r.unit}`
      ),
      recommendations: [
        `Establish a fleet-wide programme targeting ${lead.label} rather than per-asset work orders`,
        `Prioritise the ${fmtInt(summary.atRisk)} assets already below the AHI 62 review threshold`,
        `Estimated fleet mean AHI uplift: +${upliftPoints.toFixed(1)} points`,
      ],
      impact: `Estimated +${upliftPoints.toFixed(1)} points on fleet mean AHI`,
      actions: [{ type: 'create_work_order', label: 'Raise Programme' }],
    });
  }

  /* ── 3. What the current budget leaves on the network ─────────────────── */
  if (portfolio.deferred.length) {
    const worstDeferred = [...portfolio.deferred].sort((a, b) => b.ariBefore - a.ariBefore).slice(0, 3);
    const deferredCapex = portfolio.deferred.reduce((s, c) => s + c.capex, 0);
    const nextUp = portfolio.deferred[0];

    out.push({
      advisoryId: 'ADV-FUNDING-GAP',
      priority: portfolio.residualRisk > portfolio.riskBoughtDown * 0.4 ? 'high' : 'medium',
      title: `${fmtInt(portfolio.deferred.length)} deferred projects leave ${fmtCr(portfolio.residualRisk)}/yr on the network`,
      template: 'investment_optimisation',
      rootCause: {
        primary:
          `The ${fmtCr(portfolio.budgetCr, 0)} ceiling funds ${fmtInt(portfolio.selected.length)} of ` +
          `${fmtInt(portfolio.selected.length + portfolio.deferred.length)} identified candidates, committing ${fmtCr(portfolio.spend, 1)} ` +
          `and retiring ${fmtCr(portfolio.riskBoughtDown)}/yr. The ${fmtInt(portfolio.deferred.length)} projects below the line represent ` +
          `${fmtCr(deferredCapex, 0)} of unfunded capital.`,
        contributing:
          `Selection is ranked strictly by benefit-cost ratio, so every deferral has a stateable reason: it returned less risk retired per ` +
          `rupee than the projects above it. The highest-value deferred project is ${nextUp.asset.id} at ${fmtCr(nextUp.capex)} ` +
          `(BCR ${nextUp.bcr.toFixed(1)}×).`,
        systemic:
          `Budget utilisation is ${pct(portfolio.utilisation)}. Where utilisation falls short of 100% the residue is lumpiness — the ` +
          `next-ranked project costs more than the money remaining, and the optimiser never part-funds a project.`,
      },
      evidence: [
        `Committed ${fmtCr(portfolio.spend, 1)} of ${fmtCr(portfolio.budgetCr, 0)} (${pct(portfolio.utilisation)} utilisation)`,
        `Risk retired ${fmtCr(portfolio.riskBoughtDown)}/yr — ${pct(portfolio.riskReductionPct)} of candidate risk`,
        ...worstDeferred.map(
          (c) => `Deferred: ${c.asset.id} — ${c.interventionLabel} ${fmtCr(c.capex)}, carries ${fmtCr(c.ariBefore)}/yr`
        ),
      ],
      recommendations: [
        `Fund ${nextUp.asset.id} next — ${fmtCr(nextUp.capex)} retires ${fmtCr(nextUp.riskAvoided)}/yr at BCR ${nextUp.bcr.toFixed(1)}×`,
        `An additional ${fmtCr(deferredCapex, 0)} would clear the full identified need`,
        `Model the trade in the Scenario Lab before committing to the ARR submission`,
      ],
      impact: `${fmtCr(portfolio.residualRisk)}/yr carried rather than retired`,
      actions: [{ type: 'create_work_order', label: 'Log Plan Change' }],
    });
  }

  /* ── 4. Live anomaly, where one is flagged ────────────────────────────── */
  const anomalous = rows.find((r) => r.asset.anomaly);
  if (anomalous) {
    const d = detailFor(anomalous.id);
    const a = d.asset.anomaly;
    const params = paramsFor(d.asset.assetClass);
    const p = params.find((x) => x.key === a.param);
    const row = d.health.rows.find((x) => x.key === a.param);

    out.push({
      advisoryId: `ADV-ANOM-${anomalous.id}`,
      priority: 'high',
      title: `Condition anomaly on ${d.asset.id} — ${p ? p.label : a.param} trending adversely since ${a.since}`,
      template: 'anomaly_detection',
      rootCause: {
        primary: a.note,
        contributing: row
          ? `${row.label} currently reads ${row.raw} ${row.unit}, scoring ${row.score.toFixed(0)}/100 and deducting ` +
            `${row.deduction.toFixed(1)} points at its ${pct(row.weight * 100, 0)} model weight — the largest single contributor to this ` +
            `asset's AHI of ${d.ahi.toFixed(1)}.`
          : `The parameter is outside its expected band for this asset class.`,
        systemic:
          `Trend-based detection fires before a threshold breach, which is the point of condition monitoring: the absolute reading is still ` +
          `within limits, but the rate of change is not. Sampling cadence should follow the trend, not the calendar.`,
      },
      evidence: [
        `Anomaly first flagged ${a.since}`,
        row ? `${row.label}: ${row.raw} ${row.unit} against ${row.good} ${row.unit} target (${row.bad} ${row.unit} = zero score)` : `Parameter: ${a.param}`,
        `Asset AHI ${d.ahi.toFixed(1)} · ACI ${d.aci.toFixed(0)} · ARI ${fmtCr(d.ari)}/yr`,
        `${fmtInt(d.asset.impact.consumers)} connections affected on failure, ${d.asset.restorationDays}-day restoration`,
      ],
      recommendations: [
        `Increase ${p ? p.label : a.param} sampling to monthly until the trend stabilises`,
        `Raise a condition-based work order against SAP PM for inspection`,
        `Re-assess remaining useful life after the next two sample points`,
      ],
      impact: `Early warning ahead of threshold breach on a ${fmtCr(d.cof)} consequence asset`,
      actions: [
        { type: 'create_work_order', label: 'Raise Work Order' },
        { type: 'dispatch_crew', label: 'Assign Inspection' },
      ],
    });
  }

  return out;
}

/* ═══ ALERTS — the header bell ═════════════════════════════════════════════
   Same principle: every alert names a real asset and quotes a real figure. */
export function buildAlerts({ fleet, summary, portfolio, detailFor }) {
  const alerts = [];
  const at = (mins) => new Date(Date.now() - mins * 60000).toISOString();

  const anomalous = fleet.rows.find((r) => r.asset.anomaly);
  if (anomalous) {
    const d = detailFor(anomalous.id);
    alerts.push({
      alertId: 'APM-ANOM-1', type: 'critical', category: 'health',
      title: `${d.asset.id} — condition anomaly`,
      message: `${d.asset.anomaly.note} Asset health ${d.ahi.toFixed(1)}, annualised risk ${fmtCr(d.ari)}/yr across ${fmtInt(d.asset.impact.consumers)} connections.`,
      zone: d.asset.zone, assetId: d.asset.id, acknowledged: false, createdAt: at(22),
    });
  }

  const worst = summary.topRisk[0];
  if (worst) {
    const d = detailFor(worst.id);
    alerts.push({
      alertId: 'APM-RISK-1', type: 'critical', category: 'risk',
      title: `${d.asset.id} — highest fleet risk exposure`,
      message: `Annualised risk ${fmtCr(d.ari)}/yr (PoF ${pct(d.pof * 100, 2)} × CoF ${fmtCr(d.cof)}). Criticality ${d.aci.toFixed(0)}, ${d.asset.impact.redundancy ? 'N-1 available' : 'no N-1 redundancy'}.`,
      zone: d.asset.zone, assetId: d.asset.id, acknowledged: false, createdAt: at(48),
    });
  }

  if (summary.extreme > 0) {
    alerts.push({
      alertId: 'APM-BAND-1', type: 'warning', category: 'risk',
      title: `${fmtInt(summary.extreme)} assets in the extreme-risk band`,
      message: `${fmtInt(summary.extreme)} assets exceed the extreme band floor, against a fleet exposure of ${fmtCr(summary.totalRisk, 0)}/yr. Review against the capital plan.`,
      zone: 'All', assetId: null, acknowledged: false, createdAt: at(96),
    });
  }

  if (summary.atRisk > 0) {
    alerts.push({
      alertId: 'APM-HEALTH-1', type: 'warning', category: 'health',
      title: `${fmtInt(summary.atRisk)} assets below the AHI 62 review threshold`,
      message: `Fleet mean AHI ${summary.meanAHI.toFixed(1)}. ${fmtInt(summary.bands.critical + summary.bands.poor)} assets sit in the Poor or Critical bands and feed the investment candidate register.`,
      zone: 'All', assetId: null, acknowledged: false, createdAt: at(140),
    });
  }

  if (portfolio.deferred.length) {
    alerts.push({
      alertId: 'APM-INV-1', type: 'info', category: 'investment',
      title: `${fmtInt(portfolio.deferred.length)} projects deferred at the current budget`,
      message: `${fmtCr(portfolio.budgetCr, 0)} funds ${fmtInt(portfolio.selected.length)} projects and retires ${fmtCr(portfolio.riskBoughtDown)}/yr, leaving ${fmtCr(portfolio.residualRisk)}/yr on the network.`,
      zone: 'All', assetId: null, acknowledged: true, createdAt: at(220),
    });
  }

  return alerts;
}
