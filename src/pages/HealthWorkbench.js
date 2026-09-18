/* Health Workbench — Sections C, D and F of the checkpoint sheet.
   This is the screen the demo run sheet builds to: the parameter contribution
   waterfall, the live weight editor (C.7 / O.7), the identical-health /
   different-criticality comparison (D), and RUL with explainability (F).

   Nothing here is hardcoded — every figure comes back from src/engines. */

import React, { useMemo, useState } from 'react';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Filler,
} from 'chart.js';

import { useApm } from '../services/apmStore';
import { ASSETS, healthHistory, CLASS_LABEL } from '../data/network';
import { computeRUL, healthBand, paramsFor, fmtInt, fmtCr } from '../engines/indices';
import { Panel, PageHead, Tabs, BarRow, HealthPill, SimulatedNote } from '../components/apmUi';
import { getChartTokens, chartTooltip } from '../components/chartUtils';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Filler);

const PARAM_COLORS = ['#dc2626', '#ea580c', '#d97706', '#ca8a04', '#65a30d', '#0891b2'];

export default function HealthWorkbench() {
  const {
    selectedId, setSelectedId, detailFor, healthWeights, setHealthWeight,
    aciWeights, setAciWeight, resetModel, dirty, fleet,
  } = useApm();

  const [tab, setTab] = useState('health');
  const t = getChartTokens();

  const detail = detailFor(selectedId);
  const asset = detail?.asset;

  /* Asset picker limited to the transformer fleet plus heroes — the demo
     drives from transformers, and a 6,000-row select is unusable. */
  const pickList = useMemo(() => {
    const heroes = ASSETS.filter((a) => a.hero);
    const dss = ASSETS.filter((a) => a.tier === 'dss' && !a.hero).slice(0, 60);
    return [...heroes, ...dss];
  }, []);

  if (!detail) return <div className="p-6" style={{ color: 'var(--app-text-muted)' }}>Select an asset.</div>;

  const band = healthBand(detail.ahi);
  const rul = computeRUL(asset, detail.ahi);
  const history = healthHistory(asset, detail.ahi);

  const trendData = {
    labels: history.map((h) => h.label),
    datasets: [
      {
        label: 'Asset Health Index',
        data: history.map((h) => h.value),
        borderColor: band.color,
        backgroundColor: `${band.color}22`,
        fill: true, tension: 0.35, pointRadius: 0, borderWidth: 2,
      },
      {
        label: 'Forecast to intervention',
        data: [
          ...Array(history.length - 1).fill(null),
          detail.ahi,
          ...Array.from({ length: 5 }, (_, i) => Math.max(detail.ahi - (i + 1) * asset.degradationRate, 20)),
        ],
        borderColor: '#8b5cf6', borderDash: [5, 4], fill: false,
        tension: 0.3, pointRadius: 0, borderWidth: 1.8,
      },
    ],
  };
  const trendLabels = [...history.map((h) => h.label), ...Array.from({ length: 5 }, (_, i) => `${new Date().getFullYear() + i + 1}`)];

  return (
    <div className="space-y-4">
      <PageHead
        eyebrow="S!aP ML & AI Central · Condition Intelligence"
        title="Health Workbench"
        sub="Asset Health Index with full parameter attribution, a configurable scoring model, and remaining-useful-life forecasting with explainability."
        right={
          <div className="flex items-center gap-2">
            <select
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
              aria-label="Select asset"
              style={{ background: 'var(--app-surface-soft)', border: '1px solid var(--app-border)', color: 'var(--app-text)', borderRadius: 8, padding: '8px 10px', fontSize: 11.5, maxWidth: 300 }}
            >
              {pickList.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.id} — {a.name || a.substation}{a.hero ? ' ★' : ''}
                </option>
              ))}
            </select>
          </div>
        }
      />

      <Tabs
        tabs={[
          { key: 'health', label: 'Health Index · Section C' },
          { key: 'criticality', label: 'Criticality · Section D' },
          { key: 'predictive', label: 'Predictive & XAI · Section F' },
        ]}
        active={tab}
        onChange={setTab}
      />

      {/* ═══ TAB 1 — HEALTH ═══════════════════════════════════════════════ */}
      {tab === 'health' && (
        <div className="grid gap-4" style={{ gridTemplateColumns: 'minmax(480px, 1.6fr) minmax(320px, 1fr)' }}>
          <div className="space-y-4">
            {/* Score + attribution */}
            <Panel
              title={`${asset.id} — ${asset.name || asset.substation}`}
              checkpoints="C.1 · C.2 · C.4 · C.8"
              sub={`${CLASS_LABEL[asset.assetClass]} · ${asset.rating} · ${asset.make} · commissioned ${asset.commissioned}`}
            >
              <div className="flex items-start gap-5 flex-wrap">
                <div className="flex-shrink-0" style={{ minWidth: 128 }}>
                  <p className="apm-eyebrow" style={{ fontSize: 9 }}>Asset Health Index</p>
                  <div className="apm-dial-value mt-1.5" style={{ color: band.color }}>{detail.ahi.toFixed(1)}</div>
                  <div className="mt-2"><HealthPill ahi={detail.ahi} /></div>
                  {dirty && (
                    <p className="text-[9.5px] mt-2" style={{ color: 'var(--app-warning)' }}>
                      Recomputed from edited model
                    </p>
                  )}
                </div>

                <div className="flex-1 min-w-0" style={{ minWidth: 300 }}>
                  <div className="flex items-center justify-between mb-1.5">
                    <p className="apm-eyebrow" style={{ fontSize: 9 }}>Parameter contribution — points deducted</p>
                    <p className="text-[9.5px]" style={{ color: 'var(--app-text-faint)' }}>
                      Σ deductions = {(100 - detail.ahi).toFixed(1)}
                    </p>
                  </div>
                  {detail.health.rows.map((r, i) => (
                    <BarRow
                      key={r.key}
                      label={r.short}
                      sublabel={`${r.raw} ${r.unit} · weight ${(r.weight * 100).toFixed(0)}%`}
                      pct={(r.deduction / Math.max(100 - detail.ahi, 1)) * 100}
                      value={`−${r.deduction.toFixed(1)}`}
                      color={PARAM_COLORS[i % PARAM_COLORS.length]}
                    />
                  ))}
                </div>
              </div>

              {asset.anomaly && (
                <div className="mt-4 rounded-lg px-3 py-2.5" style={{ background: 'var(--app-danger-bg)', border: '1px solid var(--app-danger-border)' }}>
                  <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--app-danger)' }}>
                    Anomaly detected · since {asset.anomaly.since}
                  </p>
                  <p className="text-[11px] mt-1" style={{ color: 'var(--app-text-muted)' }}>{asset.anomaly.note}</p>
                </div>
              )}
            </Panel>

            {/* Trend */}
            <Panel title="Health deterioration trend" checkpoints="C.5 · C.9"
                   sub={`Five-year history with forecast at ${asset.degradationRate} AHI points per year`}>
              <div style={{ height: 190 }}>
                <Line
                  data={{ ...trendData, labels: trendLabels }}
                  options={{
                    responsive: true, maintainAspectRatio: false,
                    plugins: { legend: { display: false }, tooltip: chartTooltip() },
                    scales: {
                      x: { grid: { display: false }, ticks: { color: t.tickColor, font: { size: 9 } } },
                      y: { grid: { color: t.gridColor }, ticks: { color: t.tickColor, font: { size: 9 } }, min: 20, max: 100 },
                    },
                  }}
                />
              </div>
              <div className="flex items-center gap-4 mt-2">
                <span className="text-[9.5px] flex items-center gap-1.5" style={{ color: 'var(--app-text-faint)' }}>
                  <span style={{ width: 12, height: 2, background: band.color, display: 'inline-block' }} /> Observed
                </span>
                <span className="text-[9.5px] flex items-center gap-1.5" style={{ color: 'var(--app-text-faint)' }}>
                  <span style={{ width: 12, height: 2, background: '#8b5cf6', display: 'inline-block' }} /> Forecast
                </span>
              </div>
            </Panel>
          </div>

          {/* ─── Model configurator — the live-edit moment ─────────────── */}
          <div className="space-y-4">
            <Panel
              title="Health model configurator"
              checkpoints="C.3 · C.7 · O.2 · O.7"
              sub={`Weights for ${CLASS_LABEL[asset.assetClass]} — changes apply immediately across every screen`}
              right={
                <button className="apm-tab" type="button" onClick={resetModel}
                        style={{ border: '1px solid var(--app-border)', borderRadius: 6, padding: '4px 9px' }}>
                  Reset
                </button>
              }
            >
              {paramsFor(asset.assetClass).map((p) => {
                const w = healthWeights[asset.assetClass][p.key];
                return (
                  <div key={p.key} className="apm-weight-row">
                    <div className="min-w-0">
                      <p className="text-[11px] font-semibold truncate" style={{ color: 'var(--app-text-muted)' }}>{p.label}</p>
                      <p className="text-[9.5px]" style={{ color: 'var(--app-text-faint)' }}>
                        {p.good} → {p.bad} {p.unit}
                      </p>
                    </div>
                    <input
                      type="range" min="0" max="0.6" step="0.01" value={w}
                      className="apm-slider"
                      aria-label={`${p.label} weight`}
                      onChange={(e) => setHealthWeight(asset.assetClass, p.key, parseFloat(e.target.value))}
                    />
                    <span className="text-[11px] font-bold text-right" style={{ color: 'var(--app-text)', fontVariantNumeric: 'tabular-nums' }}>
                      {(w * 100).toFixed(0)}%
                    </span>
                  </div>
                );
              })}
              <div className="mt-3 pt-3 border-t border-app-border">
                <p className="text-[10px]" style={{ color: 'var(--app-text-faint)' }}>
                  Weights are normalised, so the index stays on a 0–100 scale even when they no longer sum to 1.
                  Current total: <strong style={{ color: 'var(--app-text-muted)' }}>{(detail.health.totalWeight * 100).toFixed(0)}%</strong>
                </p>
              </div>
            </Panel>

            <Panel title="Fleet comparison" checkpoints="C.6" sub="Where this asset sits against its class">
              {(() => {
                const peers = fleet.rows.filter((r) => r.assetClass === asset.assetClass && r.tier === asset.tier);
                const sorted = [...peers].sort((a, b) => a.ahi - b.ahi);
                const rank = sorted.findIndex((r) => r.id === asset.id) + 1;
                const mean = peers.reduce((s, r) => s + r.ahi, 0) / peers.length;
                return (
                  <div className="space-y-2.5">
                    {[
                      ['Rank in class', `${fmtInt(rank)} of ${fmtInt(peers.length)}`, 'lowest health first'],
                      ['Class mean AHI', mean.toFixed(1), `this asset ${detail.ahi > mean ? '+' : ''}${(detail.ahi - mean).toFixed(1)}`],
                      ['Percentile', `${((rank / peers.length) * 100).toFixed(0)}th`, 'from the bottom of the class'],
                    ].map(([k, v, note]) => (
                      <div key={k} className="flex items-baseline justify-between gap-2">
                        <span className="text-[10.5px]" style={{ color: 'var(--app-text-faint)' }}>{k}</span>
                        <div className="text-right">
                          <span className="text-[12px] font-bold" style={{ color: 'var(--app-text)', fontVariantNumeric: 'tabular-nums' }}>{v}</span>
                          <p className="text-[9px]" style={{ color: 'var(--app-text-faint)' }}>{note}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </Panel>
          </div>
        </div>
      )}

      {/* ═══ TAB 2 — CRITICALITY ══════════════════════════════════════════ */}
      {tab === 'criticality' && <CriticalityTab aciWeights={aciWeights} setAciWeight={setAciWeight} detailFor={detailFor} />}

      {/* ═══ TAB 3 — PREDICTIVE ═══════════════════════════════════════════ */}
      {tab === 'predictive' && (
        <div className="grid gap-4" style={{ gridTemplateColumns: 'minmax(400px, 1.3fr) minmax(320px, 1fr)' }}>
          <div className="space-y-4">
            <Panel title="Remaining useful life" checkpoints="F.1 · F.5"
                   sub={`Years until this asset crosses the AHI ${rul.thresholdAHI} intervention threshold`}>
              <div className="flex items-end gap-6 flex-wrap">
                <div>
                  <p className="apm-eyebrow" style={{ fontSize: 9 }}>Predicted RUL</p>
                  <div className="flex items-baseline gap-1.5 mt-1.5">
                    <span className="apm-dial-value" style={{ color: 'var(--app-violet)' }}>{rul.years.toFixed(1)}</span>
                    <span className="text-[12px] font-medium" style={{ color: 'var(--app-text-faint)' }}>years</span>
                  </div>
                  <p className="text-[10.5px] mt-2" style={{ color: 'var(--app-text-faint)' }}>
                    Range {rul.low.toFixed(1)} – {rul.high.toFixed(1)} years
                  </p>
                </div>
                <div>
                  <p className="apm-eyebrow" style={{ fontSize: 9 }}>Model confidence</p>
                  <div className="flex items-baseline gap-1.5 mt-1.5">
                    <span className="apm-dial-value" style={{ fontSize: 26, color: rul.confidence >= 80 ? 'var(--app-success)' : 'var(--app-warning)' }}>
                      {rul.confidence.toFixed(0)}%
                    </span>
                  </div>
                  <p className="text-[10.5px] mt-2" style={{ color: 'var(--app-text-faint)' }}>
                    {asset.dataYears} years of observation history
                  </p>
                </div>
                <div className="flex-1" style={{ minWidth: 180 }}>
                  <p className="apm-eyebrow mb-2" style={{ fontSize: 9 }}>Confidence band</p>
                  <div className="h-5 rounded relative" style={{ background: 'var(--app-surface-soft)' }}>
                    <div
                      className="absolute top-0 bottom-0 rounded"
                      style={{
                        left: `${(rul.low / Math.max(rul.high * 1.2, 1)) * 100}%`,
                        width: `${((rul.high - rul.low) / Math.max(rul.high * 1.2, 1)) * 100}%`,
                        background: 'rgba(139,92,246,0.35)', border: '1px solid var(--app-violet)',
                      }}
                    />
                    <div className="absolute top-0 bottom-0" style={{ left: `${(rul.years / Math.max(rul.high * 1.2, 1)) * 100}%`, width: 2, background: 'var(--app-violet)' }} />
                  </div>
                  <div className="flex justify-between mt-1">
                    <span className="text-[9px]" style={{ color: 'var(--app-text-faint)' }}>0y</span>
                    <span className="text-[9px]" style={{ color: 'var(--app-text-faint)' }}>{(rul.high * 1.2).toFixed(0)}y</span>
                  </div>
                </div>
              </div>
            </Panel>

            <Panel title="Explainability — why this prediction" checkpoints="F.4 · F.7"
                   sub="Feature contributions to the forecast, largest first">
              {detail.health.rows.map((r, i) => (
                <BarRow
                  key={r.key}
                  label={r.short}
                  sublabel={`observed ${r.raw} ${r.unit} · condition score ${r.score.toFixed(0)}/100`}
                  pct={(r.deduction / Math.max(100 - detail.ahi, 1)) * 100}
                  value={`${((r.deduction / Math.max(100 - detail.ahi, 1)) * 100).toFixed(0)}%`}
                  color={PARAM_COLORS[i % PARAM_COLORS.length]}
                />
              ))}
              <div className="apm-formula mt-3">
                RUL <span className="op">=</span> (AHI <span className="val">{detail.ahi.toFixed(1)}</span>
                <span className="op">−</span> threshold <span className="val">{rul.thresholdAHI}</span>)
                <span className="op">÷</span> degradation <span className="val">{rul.degradationRate}</span>/yr
                <span className="op">=</span> <span className="res">{rul.years.toFixed(1)} years</span>
              </div>
            </Panel>
          </div>

          <div className="space-y-4">
            <Panel title="Recommendation" checkpoints="F.6 · F.7 · G.7" sub="Generated from condition, risk and criticality">
              <div className="rounded-lg px-3 py-3" style={{ background: 'var(--app-surface-soft)', border: '1px solid var(--app-border)' }}>
                <p className="text-[12px] font-bold" style={{ color: 'var(--app-text)' }}>
                  {detail.ahi < 45 ? 'Replace' : detail.ahi < 62 ? 'Refurbish' : detail.ahi < 74 ? 'Enhanced condition monitoring' : 'Continue routine maintenance'}
                </p>
                <p className="text-[10.5px] mt-1.5 leading-relaxed" style={{ color: 'var(--app-text-muted)' }}>
                  {detail.health.rows[0].short} is the dominant deduction at {detail.health.rows[0].deduction.toFixed(1)} points
                  ({detail.health.rows[0].raw} {detail.health.rows[0].unit} against a {detail.health.rows[0].good} {detail.health.rows[0].unit} target).
                  With ACI {detail.aci.toFixed(0)} and {fmtCr(detail.cof)} of consequence exposure, the asset carries{' '}
                  {fmtCr(detail.ari)} per year of annualised risk.
                </p>
              </div>

              <div className="mt-3 space-y-2">
                <p className="apm-eyebrow" style={{ fontSize: 9 }}>Supporting logic</p>
                {[
                  `Condition: AHI ${detail.ahi.toFixed(1)} — ${band.label} band`,
                  `Probability of failure: ${(detail.pof * 100).toFixed(1)}% per year`,
                  `Consequence: ${fmtCr(detail.cof)} · ${fmtInt(asset.impact.consumers)} connections`,
                  `Redundancy: ${asset.impact.redundancy ? 'N-1 available' : 'none — full outage on failure'}`,
                ].map((s) => (
                  <div key={s} className="flex items-start gap-2">
                    <span style={{ color: 'var(--app-info)', fontSize: 10, lineHeight: 1.6 }}>▸</span>
                    <span className="text-[10.5px]" style={{ color: 'var(--app-text-muted)' }}>{s}</span>
                  </div>
                ))}
              </div>

              <div className="flex gap-2 mt-4">
                <button className="app-btn px-3 py-2 text-[11px] flex-1" type="button"
                        onClick={() => window.alert('Work order payload prepared for SAP PM.\n\nIn the full build this posts to the SAP PM simulator and returns an order number (Checkpoint G.8).')}>
                  Raise Work Order
                </button>
                <button className="apm-tab" type="button"
                        style={{ border: '1px solid var(--app-border)', borderRadius: 8, padding: '8px 12px' }}
                        onClick={() => window.alert('Engineer feedback recorded against the model (Checkpoint F.9).')}>
                  Accept
                </button>
              </div>
            </Panel>

            <SimulatedNote>
              RUL here is a transparent degradation-rate extrapolation, not a trained model. The delivery build
              replaces it with gradient-boosted survival models and SHAP attributions over the Grid Data Hub
              history, keeping this same explainability panel.
            </SimulatedNote>
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══ Criticality tab — the scenario Section D asks for by name ═══════════ */
function CriticalityTab({ aciWeights, setAciWeight, detailFor }) {
  const A = detailFor('TR-DSS-007');
  const B = detailFor('TR-DSS-022');
  if (!A || !B) return null;

  const Card = ({ d }) => (
    <Panel title={d.asset.name} sub={`${d.asset.rating} · ${d.asset.zone}`}>
      <div className="flex items-baseline gap-5 mb-3">
        <div>
          <p className="apm-eyebrow" style={{ fontSize: 9 }}>Health</p>
          <p className="apm-dial-value mt-1" style={{ fontSize: 24, color: healthBand(d.ahi).color }}>{d.ahi.toFixed(1)}</p>
        </div>
        <div>
          <p className="apm-eyebrow" style={{ fontSize: 9 }}>Criticality</p>
          <p className="apm-dial-value mt-1" style={{ fontSize: 24, color: 'var(--app-info)' }}>{d.aci.toFixed(0)}</p>
        </div>
        <div>
          <p className="apm-eyebrow" style={{ fontSize: 9 }}>Risk ₹ Cr/yr</p>
          <p className="apm-dial-value mt-1" style={{ fontSize: 24, color: 'var(--app-danger)' }}>{d.ari.toFixed(2)}</p>
        </div>
      </div>

      <p className="apm-eyebrow mb-1" style={{ fontSize: 9 }}>Criticality drivers</p>
      {d.crit.rows.map((r, i) => (
        <BarRow
          key={r.key}
          label={r.label}
          sublabel={`${r.key === 'consumers' ? fmtInt(r.raw) : r.raw} ${r.unit}`}
          pct={r.score}
          value={r.contribution.toFixed(1)}
          color={PARAM_COLORS[i % PARAM_COLORS.length]}
        />
      ))}

      <p className="text-[10.5px] mt-3 pt-3 border-t border-app-border leading-relaxed" style={{ color: 'var(--app-text-faint)' }}>
        {d.asset.note}
      </p>
    </Panel>
  );

  return (
    <div className="space-y-4">
      <div className="rounded-xl px-4 py-3" style={{ background: 'var(--app-info-bg)', border: '1px solid var(--app-info-border)' }}>
        <p className="text-[11px] font-bold" style={{ color: 'var(--app-text)' }}>
          Demonstration scenario — Checkpoint D.2
        </p>
        <p className="text-[11px] mt-1" style={{ color: 'var(--app-text-muted)' }}>
          Two substations with <strong>identical asset health</strong> ({A.ahi.toFixed(1)} on both — the condition readings are
          the same by construction) but materially different business impact. Criticality reads none of the condition
          parameters, so the two indices separate: <strong>ACI {A.aci.toFixed(0)}</strong> against <strong>ACI {B.aci.toFixed(0)}</strong>,
          and risk exposure differs by <strong>{(A.ari / Math.max(B.ari, 0.01)).toFixed(1)}×</strong>.
        </p>
      </div>

      <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))' }}>
        <Card d={A} />
        <Card d={B} />
      </div>

      <Panel title="Criticality model configurator" checkpoints="D.7 · O.4"
             sub="Dimension weights — applied fleet-wide, immediately">
        <div className="grid gap-x-8" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
          {Object.entries(aciWeights).map(([key, w]) => {
            const dim = A.crit.rows.find((r) => r.key === key);
            return (
              <div key={key} className="apm-weight-row">
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold truncate" style={{ color: 'var(--app-text-muted)' }}>{dim?.label || key}</p>
                  <p className="text-[9.5px]" style={{ color: 'var(--app-text-faint)' }}>{dim?.unit}</p>
                </div>
                <input
                  type="range" min="0" max="0.6" step="0.01" value={w}
                  className="apm-slider"
                  aria-label={`${dim?.label || key} weight`}
                  onChange={(e) => setAciWeight(key, parseFloat(e.target.value))}
                />
                <span className="text-[11px] font-bold text-right" style={{ color: 'var(--app-text)', fontVariantNumeric: 'tabular-nums' }}>
                  {(w * 100).toFixed(0)}%
                </span>
              </div>
            );
          })}
        </div>
      </Panel>
    </div>
  );
}
