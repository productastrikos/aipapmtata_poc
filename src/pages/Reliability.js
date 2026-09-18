/* Reliability — Section G of the checkpoint sheet.
   G.1 RCM, G.2 CBM, G.3 FMECA library, G.4 failure modes, G.5 consequence
   modelling, G.6 maintenance optimisation, G.7 work-order recommendation,
   G.8 SAP trigger capability.

   The work-order push is a genuine HTTP round trip to the SAP PM simulator in
   server/integrations.js — real payload, real validation, real order number
   back, and a real rejection if the payload is malformed. */

import React, { useMemo, useState } from 'react';
import { useApm } from '../services/apmStore';
import { useRole } from '../services/roleContext';
import { ASSETS, CLASS_LABEL } from '../data/network';
import { fmtCr, fmtInt } from '../engines/indices';
import {
  computeFMECA, selectStrategy, optimiseInterval, recommendWorkOrder,
  fleetReliability, RPN_BANDS, failureModesFor,
} from '../engines/reliability';
import { pushWorkOrder, ApiError } from '../services/backend';
import { Panel, PageHead, Tabs, BarRow, SimulatedNote } from '../components/apmUi';
import KPICard, { IcoWrench, IcoAlert, IcoClock, IcoShield, IcoClipboard, IcoFire } from '../components/KPICard';
import KPIDetailModal from '../components/KPIDetailModal';

const MODE_COLORS = ['#dc2626', '#ea580c', '#d97706', '#ca8a04', '#0891b2', '#7c3aed'];

export default function Reliability() {
  const { fleet, selectedId, setSelectedId, detailFor } = useApm();
  const { can, identity } = useRole();

  const [tab, setTab] = useState('fmeca');
  const [selectedKPIDetail, setSelectedKPIDetail] = useState(null);
  const [push, setPush] = useState({ state: 'idle', result: null, error: null });
  const showKPIDetail = (data) => setSelectedKPIDetail(data);

  const detail = detailFor(selectedId);

  const pickList = useMemo(() => {
    const heroes = ASSETS.filter((a) => a.hero);
    const dss = ASSETS.filter((a) => a.tier === 'dss' && !a.hero).slice(0, 50);
    const cb = ASSETS.filter((a) => a.assetClass === 'circuit_breaker').slice(0, 12);
    const rmu = ASSETS.filter((a) => a.assetClass === 'rmu').slice(0, 12);
    return [...heroes, ...dss, ...cb, ...rmu];
  }, []);

  const roll = useMemo(() => fleetReliability(fleet.rows, detailFor), [fleet, detailFor]);

  const analysis = useMemo(() => {
    if (!detail) return null;
    const fmeca = computeFMECA(detail);
    const strategy = selectStrategy(detail, fmeca);
    const interval = optimiseInterval(detail, strategy);
    const order = recommendWorkOrder(detail, fmeca, strategy, interval);
    return { fmeca, strategy, interval, order };
  }, [detail]);

  if (!detail || !analysis) {
    return <div className="p-6" style={{ color: 'var(--app-text-muted)' }}>Select an asset.</div>;
  }

  const { fmeca, strategy, interval, order } = analysis;

  const doPush = async () => {
    setPush({ state: 'sending', result: null, error: null });
    try {
      const res = await pushWorkOrder(order.payload);
      setPush({ state: 'done', result: res, error: null });
    } catch (e) {
      setPush({
        state: 'error',
        result: null,
        error: e instanceof ApiError ? (e.body && e.body.response ? e.body.response : { MESSAGE: e.message }) : { MESSAGE: e.message },
      });
    }
  };

  return (
    <div className="space-y-4">
      {selectedKPIDetail && <KPIDetailModal kpi={selectedKPIDetail} onClose={() => setSelectedKPIDetail(null)} />}

      <PageHead
        eyebrow="AVEVA APM reliability library · S!aP BPM"
        title="Reliability Engineering"
        sub="Failure modes, effects and criticality analysis feeding reliability-centred maintenance strategy selection, interval optimisation and work-order generation into SAP Plant Maintenance."
        right={
          <select
            value={selectedId}
            onChange={(e) => { setSelectedId(e.target.value); setPush({ state: 'idle', result: null, error: null }); }}
            aria-label="Select asset"
            style={{ background: 'var(--app-surface-soft)', border: '1px solid var(--app-border)', color: 'var(--app-text)', borderRadius: 8, padding: '8px 10px', fontSize: 11.5, maxWidth: 300 }}
          >
            {pickList.map((a) => (
              <option key={a.id} value={a.id}>{a.id} — {a.name || a.substation}{a.hero ? ' ★' : ''}</option>
            ))}
          </select>
        }
      />

      {/* ─── Fleet reliability position ─────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {(() => { const col = fmeca.maxRPN >= 300 ? 'text-red-400' : fmeca.maxRPN >= 150 ? 'text-amber-400' : 'text-emerald-400'; return (
          <KPICard icon={<IcoFire />} label="Highest RPN — Selected Asset" value={fmeca.maxRPN} color={col}
            subValues={[{ label: 'Mode', value: fmeca.rows[0].id }, { label: 'Critical Modes', value: fmeca.criticalModes }]}
            onClick={() => showKPIDetail({ icon: <IcoFire />, label: 'Highest RPN — Selected Asset', value: String(fmeca.maxRPN), unit: 'RPN', color: col, thresholds: { green: 150, amber: 300 }, inverted: true, definition: 'Risk Priority Number for the worst failure mode on this asset: Severity × Occurrence × Detection. Severity is intrinsic to the mode; occurrence is read from the live condition score of the parameter that detects it; detection reflects how heavily the active health model weights that parameter.', subValues: fmeca.rows.slice(0, 4).map((r) => ({ label: r.id, value: String(r.rpn) })), target: 'All modes below RPN 150', analysis: `Worst mode is "${fmeca.rows[0].mode}" at RPN ${fmeca.maxRPN}, detected through ${fmeca.rows[0].paramLabel}. | Occurrence ${fmeca.rows[0].occurrence}/10 derives from a condition score of ${fmeca.rows[0].paramScore != null ? fmeca.rows[0].paramScore.toFixed(0) : '—'}/100. | Lower the weight on a parameter and its detection rating worsens — the model change is visible in the RPN.` })} />
        ); })()}

        {(() => { const col = 'text-cyan-400'; return (
          <KPICard icon={<IcoShield />} label="Recommended Strategy" value={strategy.key} color={col}
            subValues={[{ label: 'Basis', value: 'IEC 60300-3-11' }, { label: 'Interval', value: `${interval.months} mo` }]}
            onClick={() => showKPIDetail({ icon: <IcoShield />, label: 'Recommended Strategy', value: String(fmeca.rows.length), unit: 'modes assessed', color: col, definition: `${strategy.label} — ${strategy.note}. Selected by the RCM decision logic in IEC 60300-3-11, which asks in order whether failure carries safety or environmental consequence, whether a condition task is applicable and effective, and only then whether scheduled restoration or run-to-failure is appropriate.`, subValues: [{ label: 'Strategy', value: strategy.key }, { label: 'Interval', value: `${interval.months} months` }, { label: 'Safety Critical', value: strategy.safetyCritical ? 'Yes' : 'No' }, { label: 'N-1 Cover', value: strategy.noRedundancy ? 'None' : 'Available' }], target: 'Strategy matched to consequence and detectability', analysis: strategy.reasons.join(' | ') })} />
        ); })()}

        {(() => { const col = interval.overdue ? 'text-red-400' : 'text-emerald-400'; return (
          <KPICard icon={<IcoClock />} label="Optimised Interval" value={interval.months} unit=" months" color={col}
            subValues={[{ label: 'Since Last', value: `${interval.sinceLast} mo` }, { label: 'Status', value: interval.overdue ? `Overdue ${interval.overdueBy} mo` : interval.nextDue }]}
            onClick={() => showKPIDetail({ icon: <IcoClock />, label: 'Optimised Interval', value: String(interval.months), unit: 'months', color: col, thresholds: { green: 12, amber: 6 }, inverted: false, definition: `Maintenance interval optimised from a ${interval.base}-month class baseline, compressed by measured condition and by criticality. The objective is the classic RCM trade: intervene often enough that expected failure cost stays below the cost of intervening, and no more often.`, subValues: [{ label: 'Class Baseline', value: `${interval.base} mo` }, { label: 'Condition Factor', value: `×${interval.conditionFactor.toFixed(2)}` }, { label: 'Criticality Factor', value: `×${interval.criticalityFactor.toFixed(2)}` }, { label: 'Optimised', value: `${interval.months} mo` }], target: 'Task cost below risk held down', analysis: `Annual task cost ${fmtCr(interval.annualTaskCost)} holds down ${fmtCr(interval.riskHeldDown)}/yr of risk — a ratio of ${interval.ratio.toFixed(1)}×. | ${interval.overdue ? `Asset is ${interval.overdueBy} months past its optimised interval.` : `Next service due in ${interval.nextDue}.`} | Interval tightens automatically as condition degrades.` })} />
        ); })()}

        {(() => { const col = roll.overduePct <= 15 ? 'text-emerald-400' : roll.overduePct <= 35 ? 'text-amber-400' : 'text-red-400'; return (
          <KPICard icon={<IcoAlert />} label="Fleet Overdue Maintenance" value={fmtInt(roll.overdueProjected)} color={col}
            subValues={[{ label: 'Share', value: `${roll.overduePct.toFixed(1)}%` }, { label: 'Sampled', value: fmtInt(roll.sampled) }]}
            onClick={() => showKPIDetail({ icon: <IcoAlert />, label: 'Fleet Overdue Maintenance', value: String(roll.overdueProjected), unit: 'assets', color: col, thresholds: { green: 15, amber: 35 }, inverted: true, definition: 'Assets past their condition-optimised maintenance interval, projected from a stratified sample across the fleet. Note this is measured against the optimised interval, not the calendar interval — an asset can be compliant with its scheduled date and still be overdue on condition.', subValues: [{ label: 'Projected', value: fmtInt(roll.overdueProjected) }, { label: 'In Sample', value: fmtInt(roll.overdueSampled) }, { label: 'Sample Size', value: fmtInt(roll.sampled) }, { label: 'Fleet', value: fmtInt(fleet.rows.length) }], target: 'Under 15% of fleet overdue', analysis: 'Optimised intervals compress as condition degrades, so a growing overdue count is a leading indicator of fleet-wide deterioration rather than a scheduling failure. | Assets here feed directly into the work-order queue.' })} />
        ); })()}

        {(() => { const cbm = roll.byStrategy.find((s) => s.key === 'CBM' || s.key === 'PDM'); const share = cbm ? cbm.share : 0; const col = share >= 50 ? 'text-emerald-400' : 'text-amber-400'; return (
          <KPICard icon={<IcoWrench />} label="Condition-Based Coverage" value={roll.byStrategy.filter((s) => s.key === 'CBM' || s.key === 'PDM').reduce((s, x) => s + x.share, 0).toFixed(0)} unit=" %" color={col}
            subValues={[{ label: 'Strategies', value: String(roll.byStrategy.length) }, { label: 'Sampled', value: fmtInt(roll.sampled) }]}
            onClick={() => showKPIDetail({ icon: <IcoWrench />, label: 'Condition-Based Coverage', value: roll.byStrategy.filter((s) => s.key === 'CBM' || s.key === 'PDM').reduce((s, x) => s + x.share, 0).toFixed(0), unit: '%', color: col, thresholds: { green: 50, amber: 30 }, inverted: false, definition: 'Share of the sampled fleet whose RCM assessment selects a condition-based or predictive strategy rather than a fixed-interval or run-to-failure one. This is the transition the RFQ describes — from time-based to condition-driven maintenance.', subValues: roll.byStrategy.slice(0, 4).map((s) => ({ label: s.key, value: `${s.share.toFixed(0)}%` })), target: 'Majority of fleet on condition-based strategy', analysis: 'Strategy is selected per asset from its own condition, criticality and detectability — not assigned by class. | Assets with good condition but high criticality fall to failure-finding rather than intrusive maintenance. | This distribution shifts as health weights change.' })} />
        ); })()}

        {(() => { const col = 'text-violet-400'; return (
          <KPICard icon={<IcoClipboard />} label="Work Order Priority" value={order.payload.PRIOK} color={col}
            subValues={[{ label: 'Type', value: order.payload.AUART }, { label: 'Urgency', value: order.urgent ? 'Urgent' : 'Planned' }]}
            onClick={() => showKPIDetail({ icon: <IcoClipboard />, label: 'Work Order Priority', value: String(order.payload.PRIOK), unit: 'SAP PRIOK', color: col, definition: `${order.priorityLabel}. SAP priority is derived from criticality and urgency: an asset above ACI 80 that is overdue or degraded takes priority 1, and the scale relaxes from there. Order type ${order.payload.AUART} — ${order.payload.AUART === 'PM01' ? 'corrective' : 'preventive'}.`, subValues: [{ label: 'PRIOK', value: order.payload.PRIOK }, { label: 'AUART', value: order.payload.AUART }, { label: 'ILART', value: order.payload.ILART }, { label: 'Start', value: order.payload.GSTRP }], target: 'Priority matched to consequence', analysis: `${order.priorityLabel}. | Asset criticality ${detail.aci.toFixed(0)}, health ${detail.ahi.toFixed(1)}, exposure ${fmtCr(detail.ari)}/yr. | The payload below is what actually crosses the SAP interface, including the 40-character KTEXT limit.` })} />
        ); })()}
      </div>

      <Tabs
        tabs={[
          { key: 'fmeca', label: 'FMECA · G.3 · G.4' },
          { key: 'rcm', label: 'RCM & CBM · G.1 · G.2 · G.6' },
          { key: 'order', label: 'Work Order & SAP · G.7 · G.8' },
          { key: 'fleet', label: 'Fleet Roll-up' },
        ]}
        active={tab}
        onChange={setTab}
      />

      {/* ═══ FMECA ═══════════════════════════════════════════════════════ */}
      {tab === 'fmeca' && (
        <div className="grid gap-4" style={{ gridTemplateColumns: 'minmax(460px, 1.6fr) minmax(300px, 1fr)' }}>
          <Panel
            title={`FMECA — ${detail.asset.id}`} checkpoints="G.3 · G.4"
            sub={`${CLASS_LABEL[detail.asset.assetClass]} failure mode library · RPN = Severity × Occurrence × Detection`}
            bodyClass="p-0"
          >
            <div className="apm-scroll" style={{ maxHeight: 420 }}>
              <table className="apm-table">
                <thead>
                  <tr>
                    <th>Mode</th>
                    <th>Detected by</th>
                    <th className="num">S</th>
                    <th className="num">O</th>
                    <th className="num">D</th>
                    <th className="num">RPN</th>
                    <th>Band</th>
                  </tr>
                </thead>
                <tbody>
                  {fmeca.rows.map((r) => {
                    const b = RPN_BANDS[r.band];
                    return (
                      <tr key={r.id}>
                        <td>
                          <div className="asset-id" style={{ fontSize: 10 }}>{r.id}</div>
                          <div style={{ color: 'var(--app-text)', fontWeight: 600 }}>{r.mode}</div>
                          <div className="text-[9.5px]" style={{ color: 'var(--app-text-faint)', maxWidth: 260 }}>{r.effect}</div>
                        </td>
                        <td>
                          <div style={{ color: 'var(--app-text-muted)' }}>{r.paramLabel}</div>
                          <div className="text-[9.5px]" style={{ color: 'var(--app-text-faint)' }}>{r.paramReading}</div>
                        </td>
                        <td className="num">{r.severity}</td>
                        <td className="num">{r.occurrence}</td>
                        <td className="num">{r.detection}</td>
                        <td className="num" style={{ color: b.color, fontWeight: 700, fontSize: 12 }}>{r.rpn}</td>
                        <td>
                          <span className="apm-pill" style={{ background: `${b.color}1f`, color: b.color, border: `1px solid ${b.color}55` }}>
                            <span className="dot" style={{ background: b.color }} />{b.label}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>

          <div className="space-y-4">
            <Panel title="Consequence modelling" checkpoints="G.5" sub="Monetised effect of the worst failure mode">
              <div className="apm-formula mb-3">
                Worst mode <span className="val">{fmeca.rows[0].id}</span><br />
                Severity <span className="val">{fmeca.rows[0].severity}</span>
                <span className="op">×</span> Occurrence <span className="val">{fmeca.rows[0].occurrence}</span>
                <span className="op">×</span> Detection <span className="val">{fmeca.rows[0].detection}</span>
                <span className="op">=</span> <span className="res">RPN {fmeca.rows[0].rpn}</span>
              </div>
              {detail.cofDetail.components.map((c, i) => (
                <BarRow key={c.label} label={c.label} sublabel={c.note}
                        pct={(c.value / detail.cof) * 100} value={`₹${c.value.toFixed(2)}`}
                        color={MODE_COLORS[i % MODE_COLORS.length]} />
              ))}
              <div className="flex items-baseline justify-between pt-2 mt-1 border-t border-app-border">
                <span className="text-[11px] font-bold" style={{ color: 'var(--app-text)' }}>Consequence of failure</span>
                <span className="text-[13px] font-bold" style={{ color: 'var(--app-danger)', fontVariantNumeric: 'tabular-nums' }}>{fmtCr(detail.cof)}</span>
              </div>
            </Panel>

            <Panel title="Library coverage" checkpoints="G.3" sub={`${failureModesFor(detail.asset.assetClass).length} modes defined for this class`}>
              <div className="space-y-2">
                {Object.entries(RPN_BANDS).map(([k, b]) => {
                  const n = fmeca.rows.filter((r) => r.band === k).length;
                  return (
                    <div key={k} className="flex items-center gap-2">
                      <span style={{ width: 8, height: 8, borderRadius: 2, background: b.color, flexShrink: 0 }} />
                      <span className="text-[10.5px] flex-1" style={{ color: 'var(--app-text-muted)' }}>
                        {b.label}<span className="ml-1.5" style={{ color: 'var(--app-text-faint)' }}>RPN ≥ {b.floor}</span>
                      </span>
                      <span className="text-[11px] font-bold" style={{ color: 'var(--app-text)', fontVariantNumeric: 'tabular-nums' }}>{n}</span>
                    </div>
                  );
                })}
              </div>
            </Panel>
          </div>
        </div>
      )}

      {/* ═══ RCM / CBM ═══════════════════════════════════════════════════ */}
      {tab === 'rcm' && (
        <div className="grid gap-4" style={{ gridTemplateColumns: 'minmax(420px, 1.3fr) minmax(320px, 1fr)' }}>
          <div className="space-y-4">
            <Panel title="RCM strategy decision" checkpoints="G.1 · G.2"
                   sub="IEC 60300-3-11 decision logic applied to this asset's live condition and criticality">
              <div className="flex items-start gap-5 flex-wrap">
                <div style={{ minWidth: 140 }}>
                  <p className="apm-eyebrow" style={{ fontSize: 9 }}>Selected strategy</p>
                  <div className="apm-dial-value mt-1.5" style={{ fontSize: 30, color: 'var(--app-info)' }}>{strategy.key}</div>
                  <p className="text-[11px] font-semibold mt-1" style={{ color: 'var(--app-text-muted)' }}>{strategy.label}</p>
                  <p className="text-[10px] mt-0.5" style={{ color: 'var(--app-text-faint)' }}>{strategy.note}</p>
                </div>
                <div className="flex-1 min-w-0" style={{ minWidth: 280 }}>
                  <p className="apm-eyebrow mb-2" style={{ fontSize: 9 }}>Why this strategy</p>
                  {strategy.reasons.map((r, i) => (
                    <div key={i} className="flex items-start gap-2 mb-1.5">
                      <span style={{ color: 'var(--app-info)', fontSize: 10, lineHeight: 1.6 }}>▸</span>
                      <span className="text-[11px]" style={{ color: 'var(--app-text-muted)' }}>{r}</span>
                    </div>
                  ))}
                </div>
              </div>
            </Panel>

            <Panel title="Maintenance interval optimisation" checkpoints="G.6"
                   sub="Class baseline compressed by measured condition and criticality">
              <div className="apm-formula mb-4">
                Interval <span className="op">=</span> base <span className="val">{interval.base} mo</span>
                <span className="op">×</span> condition <span className="val">{interval.conditionFactor.toFixed(2)}</span>
                <span className="op">×</span> criticality <span className="val">{interval.criticalityFactor.toFixed(2)}</span>
                <span className="op">=</span> <span className="res">{interval.months} months</span>
              </div>
              <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))' }}>
                <div className="space-y-2">
                  {[
                    ['Class baseline', `${interval.base} months`],
                    ['Optimised interval', `${interval.months} months`],
                    ['Months since last', `${interval.sinceLast}`],
                    ['Status', interval.overdue ? `Overdue by ${interval.overdueBy} months` : `Due in ${interval.nextDue}`],
                  ].map(([k, v]) => (
                    <div key={k} className="flex items-baseline justify-between gap-2">
                      <span className="text-[10.5px]" style={{ color: 'var(--app-text-faint)' }}>{k}</span>
                      <span className="text-[11px] font-bold" style={{ color: k === 'Status' && interval.overdue ? 'var(--app-danger)' : 'var(--app-text)', fontVariantNumeric: 'tabular-nums' }}>{v}</span>
                    </div>
                  ))}
                </div>
                <div className="space-y-2">
                  {[
                    ['Annual task cost', fmtCr(interval.annualTaskCost)],
                    ['Risk held down', `${fmtCr(interval.riskHeldDown)}/yr`],
                    ['Benefit ratio', `${interval.ratio.toFixed(1)}×`],
                    ['Asset exposure', `${fmtCr(detail.ari)}/yr`],
                  ].map(([k, v]) => (
                    <div key={k} className="flex items-baseline justify-between gap-2">
                      <span className="text-[10.5px]" style={{ color: 'var(--app-text-faint)' }}>{k}</span>
                      <span className="text-[11px] font-bold" style={{ color: 'var(--app-text)', fontVariantNumeric: 'tabular-nums' }}>{v}</span>
                    </div>
                  ))}
                </div>
              </div>
            </Panel>
          </div>

          <Panel title="Condition-based monitoring" checkpoints="G.2"
                 sub="Parameters this asset is monitored on, and what each detects">
            {detail.health.rows.map((r, i) => {
              const modes = failureModesFor(detail.asset.assetClass).filter((m) => m.detectedBy === r.key);
              return (
                <div key={r.key} className="py-2.5 border-b border-app-border" style={{ borderBottom: i === detail.health.rows.length - 1 ? 'none' : undefined }}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[11.5px] font-semibold" style={{ color: 'var(--app-text)' }}>{r.label}</span>
                    <span className="text-[11px] font-bold" style={{ color: r.score >= 70 ? 'var(--app-success)' : r.score >= 45 ? 'var(--app-warning)' : 'var(--app-danger)', fontVariantNumeric: 'tabular-nums' }}>
                      {r.raw} {r.unit}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-1.5">
                    <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--app-surface-soft)' }}>
                      <div style={{ width: `${r.score}%`, height: '100%', background: r.score >= 70 ? 'var(--app-success)' : r.score >= 45 ? 'var(--app-warning)' : 'var(--app-danger)', borderRadius: 3 }} />
                    </div>
                    <span className="text-[9.5px] w-16 text-right" style={{ color: 'var(--app-text-faint)', fontVariantNumeric: 'tabular-nums' }}>
                      {r.score.toFixed(0)}/100
                    </span>
                  </div>
                  {modes.length > 0 && (
                    <p className="text-[9.5px] mt-1" style={{ color: 'var(--app-text-faint)' }}>
                      Detects: {modes.map((m) => m.mode).join(' · ')}
                    </p>
                  )}
                </div>
              );
            })}
          </Panel>
        </div>
      )}

      {/* ═══ WORK ORDER / SAP ════════════════════════════════════════════ */}
      {tab === 'order' && (
        <div className="grid gap-4" style={{ gridTemplateColumns: 'minmax(400px, 1.15fr) minmax(360px, 1fr)' }}>
          <div className="space-y-4">
            <Panel title="Recommended work order" checkpoints="G.7"
                   sub={`${order.priorityLabel} · generated from FMECA, strategy and interval`}>
              <div className="flex items-center gap-2 mb-3 flex-wrap">
                <span className="apm-pill" style={{ background: order.urgent ? 'var(--app-danger-bg)' : 'var(--app-info-bg)', color: order.urgent ? 'var(--app-danger)' : 'var(--app-info)' }}>
                  <span className="dot" style={{ background: order.urgent ? 'var(--app-danger)' : 'var(--app-info)' }} />
                  {order.urgent ? 'Urgent' : 'Planned'}
                </span>
                <span className="text-[10.5px]" style={{ color: 'var(--app-text-faint)' }}>
                  {detail.asset.id} · AHI {detail.ahi.toFixed(1)} · ACI {detail.aci.toFixed(0)} · {fmtCr(detail.ari)}/yr
                </span>
              </div>
              <p className="apm-eyebrow mb-2" style={{ fontSize: 9 }}>Task list</p>
              {order.tasks.map((t, i) => (
                <div key={i} className="flex items-start gap-2 mb-2">
                  <span className="text-[9px] font-bold flex-shrink-0 mt-0.5" style={{ color: 'var(--app-info)', minWidth: 14 }}>{i + 1}.</span>
                  <span className="text-[11px]" style={{ color: 'var(--app-text-muted)' }}>{t}</span>
                </div>
              ))}
            </Panel>

            <Panel title="SAP PM payload" checkpoints="G.8"
                   sub="Exactly the fields that cross the interface — SAP names, SAP limits">
              <div className="apm-scroll" style={{ maxHeight: 210 }}>
                <table className="apm-table">
                  <thead><tr><th>SAP field</th><th>Value</th><th>Meaning</th></tr></thead>
                  <tbody>
                    {[
                      ['EQUNR', order.payload.EQUNR, 'Equipment number'],
                      ['AUART', order.payload.AUART, order.payload.AUART === 'PM01' ? 'Corrective order' : 'Preventive order'],
                      ['PRIOK', order.payload.PRIOK, order.priorityLabel],
                      ['KTEXT', order.payload.KTEXT, `Short text — ${order.payload.KTEXT.length}/40 chars`],
                      ['GSTRP', order.payload.GSTRP, 'Scheduled start'],
                      ['ILART', order.payload.ILART, 'Maintenance activity type'],
                      ['GEWRK', order.payload.GEWRK, 'Work centre'],
                      ['KOSTL', order.payload.KOSTL, 'Cost centre'],
                    ].map(([f, v, note]) => (
                      <tr key={f}>
                        <td className="asset-id">{f}</td>
                        <td style={{ color: 'var(--app-text)', fontWeight: 600 }}>{String(v)}</td>
                        <td className="text-[10px]" style={{ color: 'var(--app-text-faint)' }}>{note}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          </div>

          <div className="space-y-4">
            <Panel title="Push to SAP Plant Maintenance" checkpoints="G.8"
                   sub="Genuine HTTP round trip to the SAP PM simulator">
              {!can('workorder.raise') && !can('config.write') ? (
                <div className="rounded-lg px-3 py-2.5 mb-3" style={{ background: 'var(--app-warning-bg)', border: '1px solid var(--app-warning-border)' }}>
                  <p className="text-[10.5px]" style={{ color: 'var(--app-text-muted)' }}>
                    Role <strong>{identity.role}</strong> is not permitted to raise work orders. Switch identity in Security &amp; Administration.
                  </p>
                </div>
              ) : null}

              <button
                className="app-btn w-full px-3 py-2.5 text-[11.5px]"
                type="button"
                disabled={push.state === 'sending' || (!can('workorder.raise') && !can('config.write'))}
                style={{ opacity: push.state === 'sending' || (!can('workorder.raise') && !can('config.write')) ? 0.55 : 1 }}
                onClick={doPush}
              >
                {push.state === 'sending' ? 'Posting to SAP PM…' : `Create SAP PM Order for ${detail.asset.id}`}
              </button>

              {push.state === 'done' && push.result && (
                <div className="mt-3 rounded-lg px-3 py-3" style={{ background: 'var(--app-success-bg)', border: '1px solid var(--app-success-border)' }}>
                  <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--app-success)' }}>
                    HTTP {push.result.status} — order created
                  </p>
                  <p className="text-[15px] font-bold mt-1.5" style={{ color: 'var(--app-text)', fontVariantNumeric: 'tabular-nums' }}>
                    {push.result.response.AUFNR}
                  </p>
                  <div className="apm-formula mt-2" style={{ fontSize: 10.5, borderLeftColor: 'var(--app-success)' }}>
                    {Object.entries(push.result.response).map(([k, v]) => (
                      <div key={k}><span className="op">{k}:</span> {String(v)}</div>
                    ))}
                  </div>
                </div>
              )}

              {push.state === 'error' && push.error && (
                <div className="mt-3 rounded-lg px-3 py-3" style={{ background: 'var(--app-danger-bg)', border: '1px solid var(--app-danger-border)' }}>
                  <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--app-danger)' }}>
                    Rejected by SAP
                  </p>
                  <p className="text-[11.5px] mt-1.5" style={{ color: 'var(--app-text-muted)' }}>{push.error.MESSAGE}</p>
                  {push.error.TYPE && (
                    <p className="text-[10px] mt-1" style={{ color: 'var(--app-text-faint)' }}>
                      Type {push.error.TYPE} · {push.error.ID}{push.error.NUMBER}
                    </p>
                  )}
                </div>
              )}

              <p className="text-[10px] mt-3" style={{ color: 'var(--app-text-faint)' }}>
                The order is posted, logged to the integration activity feed and written to the audit trail
                against the current identity. Try it twice — SAP returns a different order number each time.
              </p>
            </Panel>

            <SimulatedNote>
              SAP Plant Maintenance here is a <strong>simulator</strong> running in this demo's own backend. The round
              trip, the field validation, the 40-character KTEXT limit and the BAPI-shaped response are real; the SAP
              system behind it is not. Live SAP connectivity is established during Blueprinting via the Grid Data Hub.
            </SimulatedNote>
          </div>
        </div>
      )}

      {/* ═══ FLEET ROLL-UP ═══════════════════════════════════════════════ */}
      {tab === 'fleet' && (
        <div className="grid gap-4" style={{ gridTemplateColumns: 'minmax(340px, 1fr) minmax(400px, 1.3fr)' }}>
          <Panel title="Strategy distribution" checkpoints="G.1"
                 sub={`RCM assessment across a ${fmtInt(roll.sampled)}-asset stratified sample`}>
            {roll.byStrategy.map((s, i) => (
              <BarRow key={s.key} label={s.label} sublabel={`${fmtInt(s.projected)} assets projected fleet-wide`}
                      pct={s.share} value={`${s.share.toFixed(0)}%`} color={MODE_COLORS[i % MODE_COLORS.length]} />
            ))}
            <p className="text-[10px] mt-3 pt-3 border-t border-app-border" style={{ color: 'var(--app-text-faint)' }}>
              Strategy is assessed per asset from its own condition, criticality and detectability — not assigned by
              class. Change a health weight and this distribution shifts.
            </p>
          </Panel>

          <Panel title="Dominant failure modes across the fleet" checkpoints="G.4"
                 sub="Worst-RPN mode per asset, aggregated" bodyClass="p-0">
            <div className="apm-scroll" style={{ maxHeight: 360 }}>
              <table className="apm-table">
                <thead>
                  <tr><th>Failure mode</th><th>Detected by</th><th className="num">Assets</th><th className="num">Mean RPN</th></tr>
                </thead>
                <tbody>
                  {roll.topModes.map((m) => (
                    <tr key={m.id}>
                      <td>
                        <div className="asset-id" style={{ fontSize: 10 }}>{m.id}</div>
                        <div style={{ color: 'var(--app-text)', fontWeight: 600 }}>{m.mode}</div>
                      </td>
                      <td style={{ color: 'var(--app-text-muted)' }}>{m.paramLabel}</td>
                      <td className="num">{fmtInt(m.projected)}</td>
                      <td className="num" style={{ color: RPN_BANDS[m.band].color, fontWeight: 700 }}>{m.meanRPN.toFixed(0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
      )}
    </div>
  );
}
