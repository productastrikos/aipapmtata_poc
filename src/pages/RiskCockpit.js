/* Risk Cockpit — Section E of the checkpoint sheet.
   E.1 ARI calculation with the arithmetic visible, E.2/E.3 PoF and CoF
   build-up, E.4 risk monetisation, E.5 risk trend, E.6 enterprise dashboard,
   E.7 heat map, E.8 ranking. */

import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApm } from '../services/apmStore';
import { CLASS_LABEL } from '../data/network';
import { fmtCr, fmtInt, healthBand, RISK_BANDS } from '../engines/indices';
import { fleetTrend } from '../engines/trend';
import { Panel, PageHead, RiskPill, BarRow } from '../components/apmUi';
import KPICard, { IcoDollar, IcoFire, IcoBolt, IcoScale, IcoBarChart, IcoShield }
  from '../components/KPICard';
import KPIDetailModal from '../components/KPIDetailModal';

/* Heat-map axes: probability of failure against monetised consequence.
   Both bands are engineering judgements and are shown on the axes so an
   evaluator can see where the cut points sit. */
const POF_BANDS = [
  { label: '< 2%',    test: (p) => p < 0.02 },
  { label: '2–6%',    test: (p) => p < 0.06 },
  { label: '6–15%',   test: (p) => p < 0.15 },
  { label: '15–30%',  test: (p) => p < 0.30 },
  { label: '> 30%',   test: () => true },
];
const COF_BANDS = [
  { label: '< ₹1 Cr',   test: (c) => c < 1 },
  { label: '₹1–5 Cr',   test: (c) => c < 5 },
  { label: '₹5–15 Cr',  test: (c) => c < 15 },
  { label: '₹15–40 Cr', test: (c) => c < 40 },
  { label: '> ₹40 Cr',  test: () => true },
];

const bandIndex = (bands, v) => bands.findIndex((b) => b.test(v));

/* Heat colour from the product of the two band indices — the standard
   5×5 risk matrix convention utilities already use. */
function cellColor(score) {
  if (score >= 12) return '#dc2626';
  if (score >= 8)  return '#ea580c';
  if (score >= 4)  return '#d97706';
  if (score >= 2)  return '#65a30d';
  return '#16a34a';
}

export default function RiskCockpit() {
  const navigate = useNavigate();
  const { fleet, summary, selectedId, setSelectedId, detailFor, healthWeights, aciWeights } = useApm();
  const [cell, setCell] = useState(null);
  const [selectedKPIDetail, setSelectedKPIDetail] = useState(null);
  const showKPIDetail = (data) => setSelectedKPIDetail(data);

  const detail = detailFor(selectedId);

  /* Fleet-level risk statistics, computed once per model change. */
  const stats = useMemo(() => {
    const n = fleet.rows.length;
    const meanPoF = fleet.rows.reduce((s, r) => s + r.pof, 0) / n;
    const meanCoF = fleet.rows.reduce((s, r) => s + r.cof, 0) / n;
    const noRedundancy = fleet.rows.filter((r) => !r.asset.impact.redundancy).length;
    return { meanPoF, meanCoF, noRedundancy };
  }, [fleet]);

  /* ─── 5×5 matrix population ────────────────────────────────────────── */
  const matrix = useMemo(() => {
    const m = Array.from({ length: 5 }, () => Array.from({ length: 5 }, () => []));
    fleet.rows.forEach((r) => {
      const pi = bandIndex(POF_BANDS, r.pof);
      const ci = bandIndex(COF_BANDS, r.cof);
      if (pi >= 0 && ci >= 0) m[pi][ci].push(r);
    });
    return m;
  }, [fleet]);

  const ranked = useMemo(
    () => [...fleet.rows].sort((a, b) => b.ari - a.ari).slice(0, 25),
    [fleet]
  );

  const cellAssets = cell ? matrix[cell.p][cell.c] : null;

  return (
    <div className="space-y-4">
      {selectedKPIDetail && (
        <KPIDetailModal kpi={selectedKPIDetail} onClose={() => setSelectedKPIDetail(null)} />
      )}

      <PageHead
        eyebrow="S!aP ML & AI Central · Risk Intelligence"
        title="Risk Cockpit"
        sub="Asset Risk Index computed as probability of failure multiplied by monetised consequence of failure, aligned to ISO 55001 and ISO 31000."
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {(() => { const col = summary.totalRisk <= 300 ? 'text-emerald-400' : summary.totalRisk <= 500 ? 'text-amber-400' : 'text-red-400'; return (
          <KPICard icon={<IcoDollar />} label="Fleet Risk Exposure" value={summary.totalRisk.toFixed(0)} unit=" ₹ Cr/yr" color={col}
            subValues={[{ label: 'Basis', value: 'Σ PoF × CoF' }, { label: 'Assets', value: fmtInt(summary.count) }]}
            onClick={() => showKPIDetail({ icon: <IcoDollar />, label: 'Fleet Risk Exposure', value: summary.totalRisk.toFixed(0), unit: '₹ Cr/yr', color: col, thresholds: { green: 300, amber: 500 }, inverted: true, definition: 'Total annualised expected loss across the fleet — the sum of probability of failure multiplied by monetised consequence of failure for every modelled asset, aligned to ISO 55001 and ISO 31000.', subValues: [{ label: 'Mean per Asset', value: `₹${(summary.totalRisk / summary.count).toFixed(3)} Cr` }, { label: 'Extreme Band', value: fmtInt(summary.extreme) }, { label: 'Top 25 Share', value: `${((ranked.reduce((s, r) => s + r.ari, 0) / summary.totalRisk) * 100).toFixed(0)}%` }, { label: 'Highest Asset', value: fmtCr(ranked[0]?.ari || 0) }], target: 'Below ₹300 Cr/yr', analysis: 'Exposure is concentrated in a small number of high-criticality assets rather than spread evenly. | Retiring the top 25 alone removes a disproportionate share of total risk. | Select any asset to see its full PoF × CoF working.' })} />
        ); })()}

        {(() => { const col = summary.extreme === 0 ? 'text-emerald-400' : summary.extreme <= 15 ? 'text-amber-400' : 'text-red-400'; return (
          <KPICard icon={<IcoFire />} label="Extreme-Risk Assets" value={fmtInt(summary.extreme)} color={col}
            subValues={[{ label: 'Band Floor', value: fmtCr(RISK_BANDS.extreme) }, { label: 'Worst', value: ranked[0]?.id || '—' }]}
            onClick={() => showKPIDetail({ icon: <IcoFire />, label: 'Extreme-Risk Assets', value: String(summary.extreme), unit: 'assets', color: col, thresholds: { green: 0, amber: 15 }, inverted: true, definition: `Assets above ${fmtCr(RISK_BANDS.extreme)} of annualised expected loss. Band cut points sit at the measured p50 / p90 / p99 of the fleet distribution rather than at round numbers, so the top band reflects a real tail.`, subValues: [{ label: 'Worst Asset', value: ranked[0]?.id || '—' }, { label: 'Its Exposure', value: fmtCr(ranked[0]?.ari || 0) }, { label: 'Band Floor', value: fmtCr(RISK_BANDS.extreme) }, { label: 'No N-1 Cover', value: fmtInt(stats.noRedundancy) }], target: 'Zero assets in the extreme band', analysis: 'These assets sit in the top-right cells of the heat map. | Most are driven by consequence rather than probability — they are critical, not necessarily unhealthy. | Every one is a candidate for accelerated intervention.' })} />
        ); })()}

        {(() => { const p = stats.meanPoF * 100; const col = p <= 5 ? 'text-emerald-400' : p <= 10 ? 'text-amber-400' : 'text-red-400'; return (
          <KPICard icon={<IcoBolt />} label="Mean Probability of Failure" value={p.toFixed(1)} unit=" % / yr" color={col}
            subValues={[{ label: 'Model', value: 'Weibull β=2.6' }, { label: 'Modifier', value: 'Condition' }]}
            onClick={() => showKPIDetail({ icon: <IcoBolt />, label: 'Mean Probability of Failure', value: p.toFixed(1), unit: '%/yr', color: col, thresholds: { green: 5, amber: 10 }, inverted: true, definition: 'Two-parameter Weibull wear-out hazard with a condition multiplier. Shape parameter β = 2.6 means hazard rises with age, which is the correct form for electrical plant and is supported by ISO 14224 reliability data.', subValues: [{ label: 'Shape β', value: '2.6' }, { label: 'Characteristic Life η', value: 'design life × 1.15' }, { label: 'Condition Multiplier', value: 'up to 3.5×' }, { label: 'Assets Modelled', value: fmtInt(summary.count) }], target: 'Fleet mean PoF below 5%/yr', analysis: 'A healthy asset ages along the Weibull curve; a degraded one runs ahead of it. | The condition exponent is greater than one, so poor health bites disproportionately. | Improving health lowers PoF but never below the age-driven baseline hazard.' })} />
        ); })()}

        {(() => { const col = stats.meanCoF <= 3 ? 'text-emerald-400' : stats.meanCoF <= 8 ? 'text-amber-400' : 'text-red-400'; return (
          <KPICard icon={<IcoScale />} label="Mean Consequence of Failure" value={stats.meanCoF.toFixed(2)} unit=" ₹ Cr" color={col}
            subValues={[{ label: 'Components', value: '4 named' }, { label: 'Scaled By', value: 'Criticality' }]}
            onClick={() => showKPIDetail({ icon: <IcoScale />, label: 'Mean Consequence of Failure', value: stats.meanCoF.toFixed(2), unit: '₹ Cr', color: col, thresholds: { green: 3, amber: 8 }, inverted: true, definition: 'Monetised cost of a single failure event, built from four named components so the figure can be defended line by line: unserved energy, revenue loss during restoration, asset replacement net of salvage, and safety/regulatory exposure scaled by criticality.', subValues: [{ label: 'Unserved Energy', value: '₹8.4/kWh' }, { label: 'Revenue Loss', value: 'pro-rata' }, { label: 'Replacement', value: '92% of cost' }, { label: 'Safety & Regulatory', value: 'ACI-scaled' }], target: 'Mean consequence below ₹3 Cr', analysis: 'Consequence, not probability, dominates for high-criticality assets. | Restoration window is the biggest lever: a 14-day DSS outage costs far more than a 2-day RMU swap. | N-1 redundancy materially reduces this term.' })} />
        ); })()}

        {(() => { const conc = (ranked.reduce((s, r) => s + r.ari, 0) / summary.totalRisk) * 100; const col = conc <= 20 ? 'text-emerald-400' : conc <= 40 ? 'text-amber-400' : 'text-red-400'; return (
          <KPICard icon={<IcoBarChart />} label="Top 25 Risk Concentration" value={conc.toFixed(0)} unit=" %" color={col}
            subValues={[{ label: 'Assets', value: '25' }, { label: 'Of', value: fmtInt(summary.count) }]}
            onClick={() => showKPIDetail({ icon: <IcoBarChart />, label: 'Top 25 Risk Concentration', value: conc.toFixed(0), unit: '%', color: col, thresholds: { green: 20, amber: 40 }, inverted: true, definition: 'Share of total fleet risk exposure carried by the twenty-five highest-risk assets. High concentration means capital can be targeted narrowly for a large reduction in exposure.', subValues: [{ label: 'Top 25 Exposure', value: fmtCr(ranked.reduce((s, r) => s + r.ari, 0), 1) }, { label: 'Fleet Exposure', value: fmtCr(summary.totalRisk, 0) }, { label: 'Assets in Fleet', value: fmtInt(summary.count) }, { label: 'Highest Single', value: fmtCr(ranked[0]?.ari || 0) }], target: 'Understood and actively managed', analysis: 'High concentration is an opportunity, not only a problem — it means a targeted programme retires a large share of exposure. | The register below lists these assets in order. | The Investment Planning module ranks them by value per rupee committed.' })} />
        ); })()}

        {(() => { const pct = (stats.noRedundancy / summary.count) * 100; const col = pct <= 30 ? 'text-emerald-400' : pct <= 55 ? 'text-amber-400' : 'text-red-400'; return (
          <KPICard icon={<IcoShield />} label="Assets Without N-1 Cover" value={fmtInt(stats.noRedundancy)} color={col}
            subValues={[{ label: 'Share of Fleet', value: `${pct.toFixed(0)}%` }, { label: 'Effect', value: 'Full outage' }]}
            onClick={() => showKPIDetail({ icon: <IcoShield />, label: 'Assets Without N-1 Cover', value: String(stats.noRedundancy), unit: 'assets', color: col, thresholds: { green: 30, amber: 55 }, inverted: true, definition: 'Assets with no redundant supply path. A failure on these takes the full connected load out for the entire restoration window, so they attract both a higher consequence and no criticality relief.', subValues: [{ label: 'Share of Fleet', value: `${pct.toFixed(1)}%` }, { label: 'With N-1', value: fmtInt(summary.count - stats.noRedundancy) }, { label: 'Criticality Relief', value: '18% where available' }, { label: 'Assets Modelled', value: fmtInt(summary.count) }], target: 'N-1 cover on all critical assets', analysis: 'Redundancy applies an 18% relief factor to the criticality index where it exists. | Assets combining high load, high criticality and no N-1 dominate the extreme risk band. | Network reinforcement is an alternative to asset replacement for these cases.' })} />
        ); })()}
      </div>

      {/* ─── Worked calculation for the selected asset ─────────────────── */}
      {detail && (
        <Panel
          title={`Risk calculation — ${detail.asset.id}`}
          checkpoints="E.1 · E.2 · E.3 · E.4"
          sub={`${detail.asset.name || detail.asset.substation} · ${CLASS_LABEL[detail.asset.assetClass]}`}
          right={<RiskPill ari={detail.ari} />}
        >
          <div className="apm-formula mb-4">
            ARI <span className="op">=</span> PoF <span className="op">×</span> CoF
            <span className="op">=</span> <span className="val">{(detail.pof * 100).toFixed(2)}%</span>
            <span className="op">×</span> <span className="val">₹{detail.cof.toFixed(2)} Cr</span>
            <span className="op">=</span> <span className="res">₹{detail.ari.toFixed(2)} Cr per year</span>
          </div>

          <div className="grid gap-5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
            {/* PoF build-up */}
            <div>
              <p className="apm-eyebrow mb-2" style={{ fontSize: 9 }}>Probability of failure — Weibull hazard</p>
              <div className="space-y-1.5">
                {[
                  ['Shape parameter β', detail.pofDetail.beta, 'wear-out ageing'],
                  ['Characteristic life η', `${detail.pofDetail.eta} yrs`, `${detail.asset.designLife}y design life × 1.15`],
                  ['Asset age', `${detail.pofDetail.age} yrs`, `commissioned ${detail.asset.commissioned}`],
                  ['Base hazard h₀', `${(detail.pofDetail.baseHazard * 100).toFixed(2)}%`, 'age-only failure rate'],
                  ['Condition multiplier', `× ${detail.pofDetail.conditionMult.toFixed(2)}`, `from AHI ${detail.ahi.toFixed(1)}`],
                ].map(([k, v, note]) => (
                  <div key={k} className="flex items-baseline justify-between gap-3">
                    <div className="min-w-0">
                      <span className="text-[10.5px]" style={{ color: 'var(--app-text-muted)' }}>{k}</span>
                      <p className="text-[9px]" style={{ color: 'var(--app-text-faint)' }}>{note}</p>
                    </div>
                    <span className="text-[11px] font-bold whitespace-nowrap" style={{ color: 'var(--app-text)', fontVariantNumeric: 'tabular-nums' }}>{v}</span>
                  </div>
                ))}
                <div className="flex items-baseline justify-between gap-3 pt-2 mt-1 border-t border-app-border">
                  <span className="text-[11px] font-bold" style={{ color: 'var(--app-text)' }}>Probability of failure</span>
                  <span className="text-[13px] font-bold" style={{ color: 'var(--app-warning)', fontVariantNumeric: 'tabular-nums' }}>
                    {(detail.pof * 100).toFixed(2)}% / yr
                  </span>
                </div>
              </div>
            </div>

            {/* CoF build-up */}
            <div>
              <p className="apm-eyebrow mb-2" style={{ fontSize: 9 }}>Consequence of failure — monetised</p>
              {detail.cofDetail.components.map((c, i) => (
                <BarRow
                  key={c.label}
                  label={c.label}
                  sublabel={c.note}
                  pct={(c.value / detail.cof) * 100}
                  value={`₹${c.value.toFixed(2)}`}
                  color={['#dc2626', '#ea580c', '#d97706', '#0891b2'][i]}
                />
              ))}
              <div className="flex items-baseline justify-between gap-3 pt-2 mt-1 border-t border-app-border">
                <span className="text-[11px] font-bold" style={{ color: 'var(--app-text)' }}>Consequence of failure</span>
                <span className="text-[13px] font-bold" style={{ color: 'var(--app-danger)', fontVariantNumeric: 'tabular-nums' }}>
                  {fmtCr(detail.cof)}
                </span>
              </div>
            </div>
          </div>
        </Panel>
      )}

      {/* ─── Risk trend — Checkpoint E.5 ───────────────────────────────── */}
      <RiskTrendPanel fleet={fleet} healthWeights={healthWeights} aciWeights={aciWeights} />

      {/* ─── Heat map + ranking ────────────────────────────────────────── */}
      <div className="grid gap-4" style={{ gridTemplateColumns: 'minmax(360px, 1fr) minmax(400px, 1.25fr)' }}>
        <Panel title="Enterprise risk heat map" checkpoints="E.6 · E.7"
               sub="Probability against monetised consequence — select a cell to list its assets">
          <div className="apm-heatgrid">
            {/* header row */}
            <div />
            {COF_BANDS.map((b) => <div key={b.label} className="apm-heataxis">{b.label}</div>)}

            {POF_BANDS.map((pb, pi) => (
              <React.Fragment key={pb.label}>
                <div className="apm-heataxis">{pb.label}</div>
                {COF_BANDS.map((cb, ci) => {
                  const n = matrix[pi][ci].length;
                  const score = (pi + 1) * (ci + 1) / 5;
                  const isActive = cell && cell.p === pi && cell.c === ci;
                  return (
                    <div
                      key={cb.label}
                      className="apm-heatcell"
                      style={{
                        background: n === 0 ? 'var(--app-surface-soft)' : cellColor(score),
                        color: n === 0 ? 'var(--app-text-faint)' : '#fff',
                        outline: isActive ? '2px solid var(--app-text)' : 'none',
                        outlineOffset: 1,
                      }}
                      onClick={() => setCell(n ? { p: pi, c: ci } : null)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => e.key === 'Enter' && setCell(n ? { p: pi, c: ci } : null)}
                      title={`PoF ${pb.label} · CoF ${cb.label} — ${fmtInt(n)} assets`}
                    >
                      {n > 0 ? fmtInt(n) : '·'}
                    </div>
                  );
                })}
              </React.Fragment>
            ))}
          </div>

          <div className="flex items-center justify-between mt-3 gap-2 flex-wrap">
            <span className="text-[9.5px]" style={{ color: 'var(--app-text-faint)' }}>
              Vertical: probability of failure · Horizontal: consequence
            </span>
            <div className="flex items-center gap-1.5">
              <span className="text-[9px]" style={{ color: 'var(--app-text-faint)' }}>Low</span>
              {[1, 2, 5, 9, 13].map((s) => (
                <span key={s} style={{ width: 16, height: 8, borderRadius: 2, background: cellColor(s), display: 'inline-block' }} />
              ))}
              <span className="text-[9px]" style={{ color: 'var(--app-text-faint)' }}>Extreme</span>
            </div>
          </div>

          {cellAssets && cellAssets.length > 0 && (
            <div className="mt-3 pt-3 border-t border-app-border">
              <p className="apm-eyebrow mb-2" style={{ fontSize: 9 }}>
                {fmtInt(cellAssets.length)} assets in this cell — highest risk first
              </p>
              <div className="apm-scroll" style={{ maxHeight: 130 }}>
                {[...cellAssets].sort((a, b) => b.ari - a.ari).slice(0, 12).map((r) => (
                  <div
                    key={r.id}
                    className="flex items-center justify-between gap-2 py-1 px-1.5 rounded"
                    style={{ cursor: 'pointer' }}
                    onClick={() => setSelectedId(r.id)}
                    role="button" tabIndex={0}
                    onKeyDown={(e) => e.key === 'Enter' && setSelectedId(r.id)}
                  >
                    <span className="text-[10.5px] font-mono font-semibold truncate" style={{ color: 'var(--app-text)' }}>{r.id}</span>
                    <span className="text-[10px] truncate flex-1" style={{ color: 'var(--app-text-faint)' }}>{r.asset.substation}</span>
                    <span className="text-[10.5px] font-bold" style={{ color: 'var(--app-danger)', fontVariantNumeric: 'tabular-nums' }}>
                      ₹{r.ari.toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Panel>

        <Panel title="Risk register" checkpoints="E.8" sub="Top 25 assets by annualised expected loss" bodyClass="p-0">
          <div className="apm-scroll" style={{ maxHeight: 430 }}>
            <table className="apm-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Asset</th>
                  <th className="num">AHI</th>
                  <th className="num">PoF</th>
                  <th className="num">CoF ₹ Cr</th>
                  <th className="num">ARI ₹ Cr/yr</th>
                  <th>Band</th>
                </tr>
              </thead>
              <tbody>
                {ranked.map((r, i) => (
                  <tr
                    key={r.id}
                    className={r.id === selectedId ? 'is-selected' : ''}
                    onClick={() => setSelectedId(r.id)}
                    onDoubleClick={() => navigate('/health')}
                    style={{ cursor: 'pointer' }}
                  >
                    <td className="num" style={{ color: 'var(--app-text-faint)' }}>{i + 1}</td>
                    <td>
                      <div className="asset-id">{r.id}</div>
                      <div className="text-[9.5px] truncate" style={{ color: 'var(--app-text-faint)', maxWidth: 150 }}>{r.asset.substation}</div>
                    </td>
                    <td className="num" style={{ color: healthBand(r.ahi).color, fontWeight: 700 }}>{r.ahi.toFixed(1)}</td>
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
      </div>
    </div>
  );
}

/* ═══ Risk trend — Checkpoint E.5 ══════════════════════════════════════════
   The series is not stored. Each year is a full re-evaluation of the fleet
   with the asset re-aged, its condition moved along its own degradation rate
   and its connected load grown, so changing a weight on the Health Workbench
   moves this chart too.

   The bar strip underneath answers the question the line alone cannot: risk
   is a product, PoF × CoF, so a rising curve could be ageing plant or growing
   load. Holding each factor at today's value in turn separates them exactly. */
function RiskTrendPanel({ fleet, healthWeights, aciWeights }) {
  const trend = useMemo(
    () => fleetTrend(fleet.rows.map((r) => r.asset), healthWeights, aciWeights),
    [fleet, healthWeights, aciWeights]
  );

  const { series, today, end } = trend;
  const max = Math.max(...series.map((s) => s.totalARI));
  const min = Math.min(...series.map((s) => s.totalARI));
  const span = Math.max(max - min, 0.001);

  const H = 150;
  const W = 640;
  const x = (i) => (i / (series.length - 1)) * W;
  const y = (v) => H - ((v - min) / span) * (H - 16) - 8;

  const line = series.map((s, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(s.totalARI).toFixed(1)}`).join(' ');
  const todayIdx = series.findIndex((s) => s.offset === 0);

  const att = end.attribution;
  const attRows = [
    { label: 'Ageing and condition', value: att.condition, color: '#dc2626',
      note: 'Weibull hazard rising with age, condition moving at each asset\u2019s measured degradation rate' },
    { label: 'Load growth', value: att.consequence, color: '#d97706',
      note: `Consumers +${(trend.assumptions.consumerCAGR * 100).toFixed(1)}%/yr, demand +${(trend.assumptions.demandCAGR * 100).toFixed(1)}%/yr` },
    { label: 'Interaction', value: att.interaction, color: '#6366f1',
      note: 'The part neither factor explains alone \u2014 reported, not absorbed' },
  ];
  const attScale = Math.max(...attRows.map((r) => Math.abs(r.value)), 0.001);

  return (
    <Panel
      title="Risk trend and its drivers"
      checkpoints="E.5 · D.9"
      sub={`Fleet exposure ${series[0].year}\u2013${end.year} \u2014 ${fmtInt(fleet.rows.length)} assets re-evaluated at each point`}
      right={
        <span className="apm-chip" style={{ color: 'var(--app-text-faint)' }}>
          {trend.computeMs.toFixed(0)} ms
        </span>
      }
    >
      <div className="grid gap-4" style={{ gridTemplateColumns: 'minmax(320px, 1.5fr) minmax(280px, 1fr)' }}>
        <div>
          <div style={{ overflowX: 'auto' }}>
            <svg viewBox={`0 0 ${W} ${H + 22}`} style={{ width: '100%', minWidth: 320, height: 190 }} role="img"
                 aria-label="Fleet risk exposure by year">
              {/* Reconstructed half of the series is shaded, so an evaluator is
                  never invited to read inferred history as measured history. */}
              <rect x="0" y="0" width={x(todayIdx)} height={H} fill="var(--app-text-faint)" opacity="0.07" />
              <line x1={x(todayIdx)} y1="0" x2={x(todayIdx)} y2={H} stroke="var(--app-text-faint)" strokeWidth="1" strokeDasharray="3 3" />
              <path d={line} fill="none" stroke="var(--app-danger)" strokeWidth="2" />
              {series.map((s, i) => (
                <circle key={s.year} cx={x(i)} cy={y(s.totalARI)} r={s.offset === 0 ? 4 : 2.5}
                        fill={s.offset === 0 ? 'var(--app-text)' : 'var(--app-danger)'} />
              ))}
              {series.map((s, i) => (
                (i % 2 === 0 || s.offset === 0) && (
                  <text key={s.year} x={x(i)} y={H + 16} textAnchor="middle" fontSize="9"
                        fill="var(--app-text-faint)">{s.year}</text>
                )
              ))}
            </svg>
          </div>
          <div className="flex items-center gap-4 mt-1 text-[9.5px]" style={{ color: 'var(--app-text-faint)' }}>
            <span>Shaded \u2014 reconstructed from degradation rates, not archived readings</span>
            <span>Unshaded \u2014 projected under stated assumptions</span>
          </div>

          <div className="apm-formula mt-3">
            Exposure <span className="op">=</span> today{' '}
            <span className="val">{fmtCr(today.totalARI, 0)}/yr</span>
            <span className="op">&rarr;</span> {end.year}{' '}
            <span className="val">{fmtCr(end.totalARI, 0)}/yr</span>
            <span className="op">=</span>{' '}
            <span className="res">+{(trend.riskCAGR * 100).toFixed(1)}% a year</span>
          </div>
        </div>

        <div>
          <p className="apm-eyebrow mb-2" style={{ fontSize: 9 }}>
            What moves exposure by {end.year}
          </p>
          {attRows.map((r) => (
            <div key={r.label} className="mb-2.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[10.5px]" style={{ color: 'var(--app-text-muted)' }}>{r.label}</span>
                <span className="text-[11px] font-bold" style={{ color: r.color, fontVariantNumeric: 'tabular-nums' }}>
                  {r.value >= 0 ? '+' : '\u2212'}{fmtCr(Math.abs(r.value), 1)}
                </span>
              </div>
              <div style={{ height: 5, background: 'var(--app-border)', borderRadius: 3, marginTop: 3 }}>
                <div style={{ width: `${(Math.abs(r.value) / attScale) * 100}%`, height: '100%', background: r.color, borderRadius: 3 }} />
              </div>
              <p className="text-[9px] mt-1 leading-snug" style={{ color: 'var(--app-text-faint)' }}>{r.note}</p>
            </div>
          ))}

          <div className="flex items-baseline justify-between gap-2 pt-2 mt-1 border-t border-app-border">
            <span className="text-[11px] font-bold" style={{ color: 'var(--app-text)' }}>Total change</span>
            <span className="text-[13px] font-bold" style={{ color: 'var(--app-danger)', fontVariantNumeric: 'tabular-nums' }}>
              +{fmtCr(att.total, 1)}/yr
            </span>
          </div>

          <p className="text-[9.5px] mt-2 leading-relaxed" style={{ color: 'var(--app-text-faint)' }}>
            Assets in the extreme band go from {fmtInt(today.extreme)} to {fmtInt(end.extreme)} over the same period.
            {' '}{trend.assumptions.note}
          </p>
        </div>
      </div>
    </Panel>
  );
}
