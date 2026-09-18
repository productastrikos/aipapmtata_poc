/* ═══════════════════════════════════════════════════════════════════════════
   Astrikos S!aP — Reliability engineering (Section G)
   ───────────────────────────────────────────────────────────────────────────
   FMECA, RCM strategy selection, condition-based monitoring and maintenance
   interval optimisation, aligned to IEC 60300-3-11 (RCM) and ISO 14224
   (reliability & maintenance data taxonomy).

   Like the index engines, these compute rather than look up: the RPN, the
   recommended strategy and the interval all fall out of the asset's live
   health, criticality and risk, so editing a health weight moves them too.
   ═══════════════════════════════════════════════════════════════════════════ */

import { fmtCr } from './indices';

/* ═══ 1. FMECA LIBRARY ═════════════════════════════════════════════════════
   Failure modes per asset class, with the condition parameter each one is
   detectable through. `severityBase` is the intrinsic severity of the mode;
   occurrence is derived from the observed parameter, and detection from
   whether the platform is actually receiving that parameter. */
export const FAILURE_MODES = {
  power_transformer: [
    { id: 'FM-PT-01', mode: 'Winding insulation degradation', cause: 'Thermal ageing, moisture ingress, partial discharge', effect: 'Inter-turn short, catastrophic failure, extended outage', detectedBy: 'dga',         severityBase: 9, strategy: 'CBM' },
    { id: 'FM-PT-02', mode: 'Oil dielectric breakdown',       cause: 'Moisture, oxidation, particulate contamination',    effect: 'Reduced dielectric strength, flashover risk',      detectedBy: 'oil',         severityBase: 8, strategy: 'CBM' },
    { id: 'FM-PT-03', mode: 'Core / winding overheating',     cause: 'Sustained overload, cooling system fault',          effect: 'Accelerated insulation ageing, loss of life',      detectedBy: 'thermal',     severityBase: 7, strategy: 'CBM' },
    { id: 'FM-PT-04', mode: 'OLTC contact erosion',           cause: 'High operation count, arcing during tap change',    effect: 'Tap changer seizure, voltage regulation loss',     detectedBy: 'maintenance', severityBase: 6, strategy: 'TBM' },
    { id: 'FM-PT-05', mode: 'Bushing failure',                cause: 'Partial discharge, moisture ingress at seal',       effect: 'Explosive failure, fire, collateral damage',       detectedBy: 'pd',          severityBase: 10, strategy: 'CBM' },
    { id: 'FM-PT-06', mode: 'Overload-driven loss of life',   cause: 'Load growth beyond nameplate rating',               effect: 'Cumulative insulation ageing, reduced RUL',        detectedBy: 'loading',     severityBase: 6, strategy: 'CBM' },
  ],
  circuit_breaker: [
    { id: 'FM-CB-01', mode: 'Contact erosion / welding',      cause: 'Cumulative fault interruption duty',                effect: 'Failure to interrupt, backup protection operates',  detectedBy: 'contactWear', severityBase: 9, strategy: 'CBM' },
    { id: 'FM-CB-02', mode: 'SF6 leakage',                    cause: 'Seal degradation, thermal cycling',                 effect: 'Loss of dielectric medium, interruption failure',  detectedBy: 'gasPressure', severityBase: 9, strategy: 'CBM' },
    { id: 'FM-CB-03', mode: 'Trip coil / mechanism latency',  cause: 'Coil ageing, lubrication breakdown',                effect: 'Delayed clearance, extended fault duration',       detectedBy: 'tripTime',    severityBase: 8, strategy: 'CBM' },
    { id: 'FM-CB-04', mode: 'Operating mechanism wear',       cause: 'High operation count',                              effect: 'Failure to operate on demand',                     detectedBy: 'operations',  severityBase: 7, strategy: 'TBM' },
    { id: 'FM-CB-05', mode: 'Deferred servicing drift',       cause: 'Maintenance interval overrun',                      effect: 'Compound degradation across subsystems',           detectedBy: 'maintenance', severityBase: 5, strategy: 'TBM' },
  ],
  rmu: [
    { id: 'FM-RM-01', mode: 'Insulation resistance decay',    cause: 'Moisture ingress, contamination',                   effect: 'Earth fault, ring section outage',                 detectedBy: 'insulation',  severityBase: 8, strategy: 'CBM' },
    { id: 'FM-RM-02', mode: 'Enclosure thermal runaway',      cause: 'Loose connection, ventilation blockage',            effect: 'Busbar fault, consumer group outage',              detectedBy: 'thermal',     severityBase: 8, strategy: 'CBM' },
    { id: 'FM-RM-03', mode: 'Switch mechanism degradation',   cause: 'Operation count, corrosion',                        effect: 'Failure to isolate during switching',              detectedBy: 'operations',  severityBase: 6, strategy: 'TBM' },
    { id: 'FM-RM-04', mode: 'Moisture ingress at gland',      cause: 'Seal failure, monsoon exposure',                    effect: 'Progressive insulation loss',                      detectedBy: 'moisture',    severityBase: 7, strategy: 'CBM' },
  ],
};

export function failureModesFor(assetClass) {
  return FAILURE_MODES[assetClass] || FAILURE_MODES.rmu;
}

/* ═══ 2. FMECA — criticality analysis per asset ═════════════════════════════
   RPN = Severity × Occurrence × Detection, the standard FMECA product.
   Occurrence is read from the live condition score for the detecting
   parameter, so a degraded reading raises the RPN of exactly the modes it
   is diagnostic for — rather than every mode moving together. */
export function computeFMECA(detail) {
  const modes = failureModesFor(detail.asset.assetClass);
  const byKey = {};
  detail.health.rows.forEach((r) => { byKey[r.key] = r; });

  const rows = modes.map((m) => {
    const param = byKey[m.detectedBy];

    // Occurrence 1–10: a perfect condition score is 1, a zero score is 10.
    const occurrence = param ? Math.max(1, Math.min(10, Math.round(1 + ((100 - param.score) / 100) * 9))) : 5;

    // Detection 1–10, where 1 = reliably detected. We hold the parameter, so
    // detection is good; it degrades where the parameter carries little weight
    // in the active model (a parameter weighted near zero is barely watched).
    const weight = param ? param.weight : 0;
    const detection = Math.max(1, Math.min(10, Math.round(10 - weight * 18)));

    const severity = m.severityBase;
    const rpn = severity * occurrence * detection;

    return {
      ...m,
      severity,
      occurrence,
      detection,
      rpn,
      paramLabel: param ? param.label : 'Not monitored',
      paramReading: param ? `${param.raw} ${param.unit}` : '—',
      paramScore: param ? param.score : null,
      band: rpn >= 300 ? 'critical' : rpn >= 150 ? 'high' : rpn >= 60 ? 'medium' : 'low',
    };
  });

  rows.sort((a, b) => b.rpn - a.rpn);

  return {
    rows,
    maxRPN: rows.length ? rows[0].rpn : 0,
    totalRPN: rows.reduce((s, r) => s + r.rpn, 0),
    criticalModes: rows.filter((r) => r.rpn >= 300).length,
  };
}

export const RPN_BANDS = {
  critical: { label: 'Critical', color: '#dc2626', floor: 300 },
  high:     { label: 'High',     color: '#ea580c', floor: 150 },
  medium:   { label: 'Medium',   color: '#d97706', floor: 60 },
  low:      { label: 'Low',      color: '#16a34a', floor: 0 },
};

/* ═══ 3. RCM STRATEGY SELECTION (IEC 60300-3-11) ════════════════════════════
   The RCM decision logic in the standard asks, in order: is failure hidden or
   evident? Does it carry safety/environmental consequence? Is a condition task
   applicable and effective? Is a scheduled restoration task? Only then does it
   fall through to run-to-failure. */
export const STRATEGIES = {
  CBM:  { key: 'CBM',  label: 'Condition-Based Maintenance',  note: 'Intervene on measured condition' },
  PDM:  { key: 'PDM',  label: 'Predictive Maintenance',       note: 'Intervene on forecast condition' },
  TBM:  { key: 'TBM',  label: 'Time-Based Maintenance',       note: 'Fixed interval restoration' },
  FF:   { key: 'FF',   label: 'Failure-Finding',              note: 'Scheduled functional test' },
  RTF:  { key: 'RTF',  label: 'Run to Failure',               note: 'Accept failure, corrective response' },
};

export function selectStrategy(detail, fmeca) {
  const { ahi, aci, ari } = detail;
  const top = fmeca.rows[0];
  const safetyCritical = detail.asset.impact.safety >= 60 || (top && top.severity >= 9);
  const noRedundancy = !detail.asset.impact.redundancy;

  const reasons = [];
  let key;

  if (safetyCritical && (ahi < 70 || (top && top.rpn >= 300))) {
    key = 'CBM';
    reasons.push(`Safety/environmental consequence is significant (safety index ${detail.asset.impact.safety}, worst mode severity ${top ? top.severity : '—'}/10)`);
    reasons.push('IEC 60300-3-11 requires a condition task where one is applicable and effective before accepting failure');
  } else if (ahi < 55 || ari >= 0.8) {
    key = 'PDM';
    reasons.push(`Condition is degraded (AHI ${ahi.toFixed(1)}) and exposure is material (${fmtCr(ari)}/yr)`);
    reasons.push('Forecast-driven intervention is warranted ahead of the measured threshold');
  } else if (ahi < 74) {
    key = 'CBM';
    reasons.push(`Condition is monitorable and degrading (AHI ${ahi.toFixed(1)}) — a condition task is applicable and effective`);
  } else if (aci >= 55) {
    key = 'FF';
    reasons.push(`Condition is good (AHI ${ahi.toFixed(1)}) but criticality is high (ACI ${aci.toFixed(0)}) — failure would be consequential`);
    reasons.push('Scheduled functional testing confirms availability without unnecessary intrusion');
  } else {
    key = 'TBM';
    reasons.push(`Condition is good (AHI ${ahi.toFixed(1)}) and criticality is moderate (ACI ${aci.toFixed(0)})`);
    reasons.push('Fixed-interval restoration is sufficient and least disruptive');
  }

  if (noRedundancy) reasons.push('No N-1 redundancy — failure is not maskable, which raises task priority');

  return { ...STRATEGIES[key], reasons, safetyCritical, noRedundancy };
}

/* ═══ 4. MAINTENANCE INTERVAL OPTIMISATION ══════════════════════════════════
   Base interval by class, compressed by condition and criticality. The
   objective is the classic RCM trade: intervene often enough that expected
   failure cost stays below the cost of intervening, and no more often. */
const BASE_INTERVAL_MONTHS = { power_transformer: 24, circuit_breaker: 18, rmu: 12 };

export function optimiseInterval(detail, strategy) {
  const base = BASE_INTERVAL_MONTHS[detail.asset.assetClass] || 18;

  // Condition factor: perfect health leaves the base interval alone, poor
  // health compresses it toward a quarter of base.
  const conditionFactor = 0.25 + 0.75 * Math.pow(detail.ahi / 100, 1.4);
  // Criticality factor: the most critical assets get up to 30% tighter.
  const criticalityFactor = 1 - 0.3 * (detail.aci / 100);

  let months = base * conditionFactor * criticalityFactor;
  if (strategy.key === 'PDM') months *= 0.8;
  if (strategy.key === 'FF') months *= 1.15;
  if (strategy.key === 'TBM') months *= 1.0;

  months = Math.max(1, Math.round(months));

  const sinceLast = detail.asset.readings.maintenance;
  const overdueBy = typeof sinceLast === 'number' ? sinceLast - months : null;

  // Annual cost of the task set against the annual risk it holds down.
  const taskCost = detail.asset.replacementCost * 0.022;
  const annualTaskCost = taskCost * (12 / months);
  const riskHeldDown = detail.ari * 0.55;

  return {
    months,
    base,
    conditionFactor,
    criticalityFactor,
    sinceLast,
    overdueBy,
    overdue: overdueBy != null && overdueBy > 0,
    nextDue: overdueBy != null ? (overdueBy > 0 ? 'Overdue' : `${Math.abs(overdueBy)} months`) : 'Not scheduled',
    annualTaskCost,
    riskHeldDown,
    ratio: annualTaskCost > 0 ? riskHeldDown / annualTaskCost : 0,
  };
}

/* ═══ 5. WORK ORDER RECOMMENDATION (G.7 → G.8) ══════════════════════════════
   Produces an SAP PM-shaped payload. Field names and limits are SAP's, so
   what the evaluators see on screen is what actually crosses the interface —
   including the 40-character KTEXT limit that trips real integrations up. */
export function recommendWorkOrder(detail, fmeca, strategy, interval) {
  const top = fmeca.rows[0];
  const urgent = interval.overdue || detail.ahi < 55 || (top && top.rpn >= 300);

  const priority = detail.aci >= 80 && urgent ? '1'
    : urgent ? '2'
    : detail.aci >= 60 ? '3'
    : '4';

  const PRIORITY_LABEL = { 1: 'Very high — same day', 2: 'High — within 72 hours', 3: 'Medium — this cycle', 4: 'Low — next planned window' };

  // SAP KTEXT is capped at 40 characters. Build to the cap deliberately
  // rather than discovering it at go-live.
  const shortText = `${top ? top.mode : 'Condition inspection'}`.slice(0, 40);

  const orderType = strategy.key === 'TBM' || strategy.key === 'FF' ? 'PM02' : 'PM01';
  const start = new Date(Date.now() + (urgent ? 3 : 30) * 864e5).toISOString().slice(0, 10);

  return {
    urgent,
    priorityLabel: PRIORITY_LABEL[priority],
    tasks: [
      top ? `Inspect for ${top.mode.toLowerCase()} — detected via ${top.paramLabel}` : 'General condition inspection',
      `Sample and trend ${top ? top.paramLabel : 'condition parameters'} (current reading ${top ? top.paramReading : '—'})`,
      strategy.key === 'CBM' || strategy.key === 'PDM'
        ? `Re-assess health index after results; intervention threshold is AHI 45`
        : `Restore to nameplate condition per ${detail.asset.make} service schedule`,
      interval.overdue
        ? `Bring asset back onto the ${interval.months}-month optimised interval`
        : `Confirm next service at ${interval.months} months`,
    ],
    payload: {
      EQUNR: detail.asset.id,
      AUART: orderType,
      PRIOK: priority,
      KTEXT: shortText,
      GSTRP: start,
      ILART: strategy.key === 'CBM' ? '003' : '001',
      GEWRK: 'T&D-MAINT',
      KOSTL: 'CC-T&D-01',
    },
  };
}

/* ═══ 6. FLEET RELIABILITY ROLL-UP ══════════════════════════════════════════ */
export function fleetReliability(rows, detailFor, sampleSize = 220) {
  const step = Math.max(1, Math.floor(rows.length / sampleSize));
  const byStrategy = {};
  const byMode = {};
  let overdue = 0;
  let sampled = 0;

  for (let i = 0; i < rows.length; i += step) {
    const d = detailFor(rows[i].id);
    if (!d) continue;
    sampled += 1;

    const fmeca = computeFMECA(d);
    const strategy = selectStrategy(d, fmeca);
    const interval = optimiseInterval(d, strategy);

    byStrategy[strategy.key] = (byStrategy[strategy.key] || 0) + 1;
    if (interval.overdue) overdue += 1;

    const top = fmeca.rows[0];
    if (top) {
      if (!byMode[top.id]) byMode[top.id] = { ...top, count: 0, rpnSum: 0 };
      byMode[top.id].count += 1;
      byMode[top.id].rpnSum += top.rpn;
    }
  }

  const scale = rows.length / Math.max(sampled, 1);

  return {
    sampled,
    scale,
    byStrategy: Object.entries(byStrategy)
      .map(([k, n]) => ({ key: k, label: STRATEGIES[k].label, count: n, projected: Math.round(n * scale), share: (n / sampled) * 100 }))
      .sort((a, b) => b.count - a.count),
    topModes: Object.values(byMode)
      .map((m) => ({ ...m, meanRPN: m.rpnSum / m.count, projected: Math.round(m.count * scale) }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6),
    overdueSampled: overdue,
    overdueProjected: Math.round(overdue * scale),
    overduePct: (overdue / Math.max(sampled, 1)) * 100,
  };
}
