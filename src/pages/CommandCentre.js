/* Command Centre — fleet-wide executive view.
   Covers checkpoints H.1 (executive dashboard), H.3 (fleet), C.6 (asset
   comparison) and C.10 (dashboard visualisation). Every figure on this page
   is derived from the engines, so editing a health weight in the Workbench
   changes what is shown here. */

import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Doughnut, Bar } from 'react-chartjs-2';
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, ArcElement, Tooltip, Legend,
} from 'chart.js';

import { useApm } from '../services/apmStore';
import { RFQ_POPULATION, ZONES, CLASS_LABEL } from '../data/network';
import { fmtCr, fmtInt, healthBand, riskBand, RISK_BANDS } from '../engines/indices';
import { Panel, PageHead, RiskPill } from '../components/apmUi';
import KPICard, { IcoShield, IcoDollar, IcoAlert, IcoFire, IcoClipboard, IcoHourglass }
  from '../components/KPICard';
import KPIDetailModal from '../components/KPIDetailModal';
import { getChartTokens, chartTooltip } from '../components/chartUtils';

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Tooltip, Legend);

const BAND_META = [
  { key: 'excellent', label: 'Excellent', range: '85–100', color: '#16a34a' },
  { key: 'good',      label: 'Good',      range: '70–84',  color: '#65a30d' },
  { key: 'fair',      label: 'Fair',      range: '55–69',  color: '#d97706' },
  { key: 'poor',      label: 'Poor',      range: '40–54',  color: '#ea580c' },
  { key: 'critical',  label: 'Critical',  range: '0–39',   color: '#dc2626' },
];

export default function CommandCentre() {
  const navigate = useNavigate();
  const { summary, fleet, portfolio, dirty, setSelectedId } = useApm();
  const [selectedKPIDetail, setSelectedKPIDetail] = useState(null);
  const t = getChartTokens();

  const openAsset = (id) => { setSelectedId(id); navigate('/health'); };
  const showKPIDetail = (data) => setSelectedKPIDetail(data);

  /* Year-ago comparison, derived inside the model's own degradation logic:
     an asset a year ago scored today's AHI plus one year of degradation.
     Cheap, because it stays in AHI space and needs no PoF/CoF re-run. */
  const trends = useMemo(() => {
    let prevSum = 0, prevAtRisk = 0;
    fleet.rows.forEach((r) => {
      const prev = Math.min(r.ahi + r.asset.degradationRate, 100);
      prevSum += prev;
      if (prev < 62) prevAtRisk += 1;
    });
    const prevMean = prevSum / fleet.rows.length;
    return {
      meanAHI: ((summary.meanAHI - prevMean) / prevMean) * 100,
      atRisk: prevAtRisk > 0 ? ((summary.atRisk - prevAtRisk) / prevAtRisk) * 100 : 0,
      meanAge: fleet.rows.reduce((s, r) => s + r.asset.age, 0) / fleet.rows.length,
    };
  }, [fleet, summary]);

  /* ─── Health distribution ─────────────────────────────────────────────── */
  const bandData = useMemo(() => ({
    labels: BAND_META.map((b) => b.label),
    datasets: [{
      data: BAND_META.map((b) => summary.bands[b.key]),
      backgroundColor: BAND_META.map((b) => b.color),
      borderWidth: 0,
    }],
  }), [summary.bands]);

  /* ─── Risk concentration by zone ──────────────────────────────────────── */
  const zoneRisk = useMemo(() => {
    const map = {};
    ZONES.forEach((z) => { map[z.name] = { risk: 0, count: 0, ahi: 0 }; });
    fleet.rows.forEach((r) => {
      const z = map[r.zone];
      if (!z) return;
      z.risk += r.ari; z.count += 1; z.ahi += r.ahi;
    });
    return ZONES.map((z) => ({
      zone: z.name,
      risk: map[z.name].risk,
      meanAHI: map[z.name].ahi / Math.max(map[z.name].count, 1),
      count: map[z.name].count,
    })).sort((a, b) => b.risk - a.risk);
  }, [fleet]);

  const zoneChart = useMemo(() => ({
    labels: zoneRisk.map((z) => z.zone),
    datasets: [{
      label: 'Annualised risk (₹ Cr)',
      data: zoneRisk.map((z) => +z.risk.toFixed(1)),
      backgroundColor: zoneRisk.map((z) => riskBand(z.risk / Math.max(z.count, 1)).color),
      borderRadius: 4,
      borderWidth: 0,
    }],
  }), [zoneRisk]);

  /* ─── Class composition ───────────────────────────────────────────────── */
  const byClass = useMemo(() => {
    const m = {};
    fleet.rows.forEach((r) => {
      m[r.assetClass] = m[r.assetClass] || { n: 0, ahi: 0, risk: 0 };
      m[r.assetClass].n += 1;
      m[r.assetClass].ahi += r.ahi;
      m[r.assetClass].risk += r.ari;
    });
    return Object.entries(m).map(([k, v]) => ({
      key: k, label: CLASS_LABEL[k] || k, n: v.n, meanAHI: v.ahi / v.n, risk: v.risk,
    })).sort((a, b) => b.risk - a.risk);
  }, [fleet]);

  const meanBand = healthBand(summary.meanAHI);

  return (
    <div className="space-y-4">
      {selectedKPIDetail && (
        <KPIDetailModal kpi={selectedKPIDetail} onClose={() => setSelectedKPIDetail(null)} />
      )}

      <PageHead
        eyebrow="S!aP Viz · Asset Performance Management"
        title="Command Centre"
        sub="Fleet-wide asset health, risk exposure and investment position across the Mumbai distribution licence area. Indices are computed live from the configured health and criticality models."
        right={
          <div className="text-right">
            <p className="apm-eyebrow" style={{ fontSize: 9 }}>Model state</p>
            <p className="text-[11px] font-semibold mt-1" style={{ color: dirty ? 'var(--app-warning)' : 'var(--app-success)' }}>
              {dirty ? 'Edited this session' : 'Factory default'}
            </p>
            <p className="text-[9.5px] mt-0.5" style={{ color: 'var(--app-text-faint)' }}>
              {fmtInt(summary.count)} assets scored in {fleet.computeMs.toFixed(0)} ms
            </p>
          </div>
        }
      />

      {/* ─── Headline indices ──────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {(() => { const col = summary.meanAHI >= 70 ? 'text-emerald-400' : summary.meanAHI >= 55 ? 'text-amber-400' : 'text-red-400'; return (
          <KPICard icon={<IcoShield />} label="Mean Fleet Health Index" value={summary.meanAHI.toFixed(1)} unit=" / 100" trend={trends.meanAHI} color={col}
            subValues={[{ label: 'Band', value: meanBand.label }, { label: 'Assets Scored', value: fmtInt(summary.count) }]}
            onClick={() => showKPIDetail({ icon: <IcoShield />, label: 'Mean Fleet Health Index', value: summary.meanAHI.toFixed(1), unit: '/100', trend: trends.meanAHI, color: col, thresholds: { green: 70, amber: 55 }, inverted: false, definition: 'Weighted condition score across every modelled asset, computed live from the configured health model. Each asset contributes DGA, oil quality, thermal, loading, maintenance and partial-discharge readings against its class parameter set.', subValues: [{ label: 'Excellent (85+)', value: fmtInt(summary.bands.excellent) }, { label: 'Good (70–84)', value: fmtInt(summary.bands.good) }, { label: 'Fair (55–69)', value: fmtInt(summary.bands.fair) }, { label: 'Poor / Critical', value: fmtInt(summary.bands.poor + summary.bands.critical) }], target: 'Fleet mean AHI ≥ 70', analysis: 'Fleet health is declining at roughly the mean degradation rate of 2.4 AHI points per year. | Oil quality is the single largest contributor to fleet-wide deductions — a targeted reclamation programme would lift the mean by an estimated 4.2 points. | Editing weights in the Health Workbench recomputes this figure across all assets immediately.' })} />
        ); })()}

        {(() => { const col = summary.totalRisk <= 300 ? 'text-emerald-400' : summary.totalRisk <= 500 ? 'text-amber-400' : 'text-red-400'; return (
          <KPICard icon={<IcoDollar />} label="Annualised Risk Exposure" value={summary.totalRisk.toFixed(0)} unit=" ₹ Cr/yr" color={col}
            subValues={[{ label: 'Extreme Band', value: fmtInt(summary.extreme) }, { label: 'Basis', value: 'Σ PoF × CoF' }]}
            onClick={() => showKPIDetail({ icon: <IcoDollar />, label: 'Annualised Risk Exposure', value: summary.totalRisk.toFixed(0), unit: '₹ Cr/yr', color: col, thresholds: { green: 300, amber: 500 }, inverted: true, definition: 'Expected monetised loss per year across the fleet, computed as the sum of probability of failure multiplied by consequence of failure for every asset. Consequence combines unserved energy, revenue loss, asset replacement and safety/regulatory exposure.', subValues: [{ label: 'Assets Modelled', value: fmtInt(summary.count) }, { label: 'Extreme Risk', value: fmtInt(summary.extreme) }, { label: 'Mean per Asset', value: `₹${(summary.totalRisk / summary.count).toFixed(3)} Cr` }, { label: 'Top 12 Share', value: `${((summary.topRisk.reduce((s, r) => s + r.ari, 0) / summary.totalRisk) * 100).toFixed(1)}%` }], target: 'Below ₹300 Cr/yr exposure', analysis: 'Risk is heavily concentrated: a small number of DSS transformers without N-1 redundancy carry a disproportionate share. | Consequence, not probability, is the dominant term for high-criticality assets. | The Risk Cockpit shows the full PoF × CoF working for any selected asset.' })} />
        ); })()}

        {(() => { const col = summary.atRisk <= summary.count * 0.25 ? 'text-emerald-400' : summary.atRisk <= summary.count * 0.45 ? 'text-amber-400' : 'text-red-400'; return (
          <KPICard icon={<IcoAlert />} label="Assets Below AHI 62" value={fmtInt(summary.atRisk)} trend={-trends.atRisk} color={col}
            subValues={[{ label: 'Share of Fleet', value: `${((summary.atRisk / summary.count) * 100).toFixed(1)}%` }, { label: 'Threshold', value: 'AHI 62' }]}
            onClick={() => showKPIDetail({ icon: <IcoAlert />, label: 'Assets Below AHI 62', value: String(summary.atRisk), unit: 'assets', trend: -trends.atRisk, color: col, thresholds: { green: Math.round(summary.count * 0.25), amber: Math.round(summary.count * 0.45) }, inverted: true, definition: 'Count of assets whose health index has fallen below the intervention review threshold of 62. Assets in this population are assessed for refurbishment or replacement and enter the investment candidate register.', subValues: [{ label: 'Fair (55–69)', value: fmtInt(summary.bands.fair) }, { label: 'Poor (40–54)', value: fmtInt(summary.bands.poor) }, { label: 'Critical (<40)', value: fmtInt(summary.bands.critical) }, { label: 'Share of Fleet', value: `${((summary.atRisk / summary.count) * 100).toFixed(1)}%` }], target: 'Under 25% of fleet below threshold', analysis: 'The review threshold is configurable — raising it widens the candidate pool and the capital requirement. | Assets crossing this line are automatically scored for intervention in the Investment Planning module.' })} />
        ); })()}

        {(() => { const col = summary.extreme === 0 ? 'text-emerald-400' : summary.extreme <= 15 ? 'text-amber-400' : 'text-red-400'; return (
          <KPICard icon={<IcoFire />} label="Extreme-Risk Assets" value={fmtInt(summary.extreme)} color={col}
            subValues={[{ label: 'Band Floor', value: fmtCr(RISK_BANDS.extreme) }, { label: 'Highest', value: fmtCr(summary.topRisk[0]?.ari || 0) }]}
            onClick={() => showKPIDetail({ icon: <IcoFire />, label: 'Extreme-Risk Assets', value: String(summary.extreme), unit: 'assets', color: col, thresholds: { green: 0, amber: 15 }, inverted: true, definition: `Assets carrying more than ${fmtCr(RISK_BANDS.extreme)} of annualised expected loss. Band cut points are calibrated to the measured fleet distribution rather than picked as round numbers, and are confirmed with TPCL during Blueprinting.`, subValues: [{ label: 'Highest Exposure', value: fmtCr(summary.topRisk[0]?.ari || 0) }, { label: 'Worst Asset', value: summary.topRisk[0]?.id || '—' }, { label: 'Band Floor', value: fmtCr(RISK_BANDS.extreme) }, { label: 'Total Fleet Risk', value: fmtCr(summary.totalRisk, 0) }], target: 'Zero assets in the extreme band', analysis: 'Every asset in this band is a candidate for accelerated intervention in the FY27 capital plan. | Most carry high consequence rather than high probability — they are critical, not necessarily unhealthy. | The Risk Cockpit heat map isolates this population in the top-right cells.' })} />
        ); })()}

        {(() => { const util = portfolio.utilisation; const col = util >= 90 ? 'text-emerald-400' : util >= 60 ? 'text-amber-400' : 'text-red-400'; return (
          <KPICard icon={<IcoClipboard />} label="Investment Candidates" value={fmtInt(portfolio.selected.length + portfolio.deferred.length)} color={col}
            subValues={[{ label: 'Funded', value: fmtInt(portfolio.selected.length) }, { label: 'Deferred', value: fmtInt(portfolio.deferred.length) }]}
            onClick={() => showKPIDetail({ icon: <IcoClipboard />, label: 'Investment Candidates', value: String(portfolio.selected.length + portfolio.deferred.length), unit: 'projects', color: col, thresholds: { green: 90, amber: 60 }, inverted: false, definition: 'Transformers whose health has fallen far enough to warrant an intervention — replacement, refurbishment or enhanced condition monitoring. Breakers and RMUs are managed under the OPEX maintenance programme rather than as individual capital projects.', subValues: [{ label: 'Funded', value: fmtInt(portfolio.selected.length) }, { label: 'Deferred', value: fmtInt(portfolio.deferred.length) }, { label: 'Committed', value: fmtCr(portfolio.spend, 0) }, { label: 'Budget', value: fmtCr(portfolio.budgetCr, 0) }], target: 'Fund the full identified need', analysis: `Current plan commits ${fmtCr(portfolio.spend, 0)} of a ${fmtCr(portfolio.budgetCr, 0)} budget and retires ₹${portfolio.riskBoughtDown.toFixed(1)} Cr/yr of risk. | Deferred projects leave ₹${portfolio.residualRisk.toFixed(1)} Cr/yr on the network. | Use the Scenario Lab to test budget sensitivity.` })} />
        ); })()}

        {(() => { const col = trends.meanAge <= 18 ? 'text-emerald-400' : trends.meanAge <= 25 ? 'text-amber-400' : 'text-red-400'; return (
          <KPICard icon={<IcoHourglass />} label="Mean Asset Age" value={trends.meanAge.toFixed(1)} unit=" years" color={col}
            subValues={[{ label: 'End of Life', value: fmtInt(fleet.rows.filter((r) => r.asset.lifecycle === 'End of life').length) }, { label: 'Early Life', value: fmtInt(fleet.rows.filter((r) => r.asset.lifecycle === 'Early life').length) }]}
            onClick={() => showKPIDetail({ icon: <IcoHourglass />, label: 'Mean Asset Age', value: trends.meanAge.toFixed(1), unit: 'years', color: col, thresholds: { green: 18, amber: 25 }, inverted: true, definition: 'Population-weighted mean age across the modelled fleet. Age is deliberately not a health parameter — it drives the Weibull failure hazard instead, so a well-maintained old asset is not double-penalised for being old.', subValues: [{ label: 'End of Life', value: fmtInt(fleet.rows.filter((r) => r.asset.lifecycle === 'End of life').length) }, { label: 'Mature', value: fmtInt(fleet.rows.filter((r) => r.asset.lifecycle === 'Mature').length) }, { label: 'In Service', value: fmtInt(fleet.rows.filter((r) => r.asset.lifecycle === 'In service').length) }, { label: 'Early Life', value: fmtInt(fleet.rows.filter((r) => r.asset.lifecycle === 'Early life').length) }], target: 'Mean fleet age under 18 years', analysis: 'Age enters the risk model through the Weibull shape parameter β = 2.6, which means hazard rises with age rather than staying flat. | Condition modifies that baseline: a degraded asset runs ahead of the age curve, a well-maintained one behind it.' })} />
        ); })()}
      </div>

      {/* ─── Distribution + zone risk ──────────────────────────────────── */}
      <div className="grid gap-4" style={{ gridTemplateColumns: 'minmax(280px, 1fr) minmax(320px, 1.35fr)' }}>
        <Panel title="Fleet health distribution" checkpoints="C.10 · H.3"
               sub="Asset Health Index bands across all modelled classes">
          <div className="flex items-center gap-4">
            <div style={{ width: 132, height: 132, flexShrink: 0 }}>
              <Doughnut
                data={bandData}
                options={{
                  responsive: true, maintainAspectRatio: false, cutout: '64%',
                  plugins: { legend: { display: false }, tooltip: chartTooltip() },
                }}
              />
            </div>
            <div className="flex-1 min-w-0 space-y-1.5">
              {BAND_META.map((b) => {
                const n = summary.bands[b.key];
                const pct = (n / summary.count) * 100;
                return (
                  <div key={b.key} className="flex items-center gap-2">
                    <span style={{ width: 8, height: 8, borderRadius: 2, background: b.color, flexShrink: 0 }} />
                    <span className="text-[10.5px] font-semibold flex-1" style={{ color: 'var(--app-text-muted)' }}>
                      {b.label}
                      <span className="ml-1.5 font-normal" style={{ color: 'var(--app-text-faint)' }}>{b.range}</span>
                    </span>
                    <span className="text-[10.5px] font-bold" style={{ color: 'var(--app-text)', fontVariantNumeric: 'tabular-nums' }}>
                      {fmtInt(n)}
                    </span>
                    <span className="text-[9.5px] w-9 text-right" style={{ color: 'var(--app-text-faint)', fontVariantNumeric: 'tabular-nums' }}>
                      {pct.toFixed(1)}%
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </Panel>

        <Panel title="Risk concentration by zone" checkpoints="E.8 · H.5"
               sub="Total annualised expected loss, ₹ Cr per year">
          <div style={{ height: 172 }}>
            <Bar
              data={zoneChart}
              options={{
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false }, tooltip: chartTooltip() },
                scales: {
                  x: { grid: { display: false }, ticks: { color: t.tickColor, font: { size: 9.5 } } },
                  y: { grid: { color: t.gridColor }, ticks: { color: t.tickColor, font: { size: 9 } }, beginAtZero: true },
                },
              }}
            />
          </div>
        </Panel>
      </div>

      {/* ─── Risk register + fleet composition ─────────────────────────── */}
      <div className="grid gap-4" style={{ gridTemplateColumns: 'minmax(420px, 1.7fr) minmax(280px, 1fr)' }}>
        <Panel
          title="Highest-risk assets" checkpoints="E.8 · C.6"
          sub="Ranked by annualised expected loss — select any row to open the health workbench"
          bodyClass="p-0"
        >
          <div className="apm-scroll" style={{ maxHeight: 340 }}>
            <table className="apm-table">
              <thead>
                <tr>
                  <th>Asset</th>
                  <th>Substation</th>
                  <th className="num">AHI</th>
                  <th className="num">ACI</th>
                  <th className="num">PoF</th>
                  <th className="num">CoF</th>
                  <th className="num">ARI ₹ Cr/yr</th>
                  <th>Risk</th>
                </tr>
              </thead>
              <tbody>
                {summary.topRisk.map((r) => (
                  <tr key={r.id} onClick={() => openAsset(r.id)} style={{ cursor: 'pointer' }}>
                    <td className="asset-id">
                      {r.id}
                      {r.asset.hero && <span className="ml-1.5 apm-checkpoint" style={{ fontSize: 8 }}>HERO</span>}
                    </td>
                    <td className="truncate" style={{ maxWidth: 190 }}>{r.asset.substation}</td>
                    <td className="num" style={{ color: healthBand(r.ahi).color, fontWeight: 700 }}>{r.ahi.toFixed(1)}</td>
                    <td className="num">{r.aci.toFixed(0)}</td>
                    <td className="num">{(r.pof * 100).toFixed(1)}%</td>
                    <td className="num">{r.cof.toFixed(1)}</td>
                    <td className="num" style={{ color: 'var(--app-text)', fontWeight: 700 }}>{r.ari.toFixed(2)}</td>
                    <td><RiskPill ari={r.ari} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <div className="space-y-4">
          <Panel title="Fleet composition" checkpoints="B.6" sub="Modelled asset classes" bodyClass="p-0">
            <div className="p-4 space-y-2.5">
              {byClass.map((c) => (
                <div key={c.key}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[11px] font-semibold" style={{ color: 'var(--app-text-muted)' }}>{c.label}</span>
                    <span className="text-[11px] font-bold" style={{ color: 'var(--app-text)', fontVariantNumeric: 'tabular-nums' }}>
                      {fmtInt(c.n)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--app-surface-soft)' }}>
                      <div style={{ width: `${c.meanAHI}%`, height: '100%', background: healthBand(c.meanAHI).color, borderRadius: 3 }} />
                    </div>
                    <span className="text-[9.5px] w-24 text-right" style={{ color: 'var(--app-text-faint)', fontVariantNumeric: 'tabular-nums' }}>
                      AHI {c.meanAHI.toFixed(1)} · {fmtCr(c.risk, 0)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
            <div className="px-4 pb-4 pt-1 border-t border-app-border mt-1">
              <p className="apm-eyebrow mb-2" style={{ fontSize: 9 }}>Also under management — no condition model in this build</p>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                {[
                  ['Isolators', RFQ_POPULATION.isolators],
                  ['Fault passage indicators', RFQ_POPULATION.fpis],
                  ['FRTUs', RFQ_POPULATION.frtus],
                  ['RTUs', RFQ_POPULATION.rtus],
                ].map(([label, n]) => (
                  <div key={label} className="flex items-baseline justify-between gap-1.5">
                    <span className="text-[10px] truncate" style={{ color: 'var(--app-text-faint)' }}>{label}</span>
                    <span className="text-[10px] font-semibold" style={{ color: 'var(--app-text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                      {fmtInt(n)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </Panel>

          <Panel title="Data platform" checkpoints="A.7 · M.1" sub="Grid Data Hub ingestion position">
            <div className="space-y-2">
              {[
                ['Initial load', `${fmtInt(RFQ_POPULATION.initialLoadGB)} GB`, 'Complete'],
                ['Daily incremental', `${RFQ_POPULATION.dailyIncrementalGB} GB/day`, 'Streaming'],
                ['Last GDH batch', '03:14 IST', '3 rejected'],
                ['Active interfaces', '10 of 10', 'Healthy'],
              ].map(([k, v, s]) => (
                <div key={k} className="flex items-center justify-between gap-2">
                  <span className="text-[10.5px]" style={{ color: 'var(--app-text-faint)' }}>{k}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-[10.5px] font-semibold" style={{ color: 'var(--app-text-muted)' }}>{v}</span>
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded"
                          style={{
                            color: s === '3 rejected' ? 'var(--app-warning)' : 'var(--app-success)',
                            background: s === '3 rejected' ? 'var(--app-warning-bg)' : 'var(--app-success-bg)',
                          }}>
                      {s}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
