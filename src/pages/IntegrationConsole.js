/* Integration Console — Section M of the checkpoint sheet.
   The sheet asks for four things per interface: data ingestion, data mapping,
   error handling, reconciliation. Every run here produces all four.

   These are labelled simulators, and the UI says so. What is real: the HTTP
   round trip, the latency, the payloads, and the schema validation — which
   genuinely rejects records rather than pretending to. SAP MM is seeded with
   records that fail, so the error path can be demonstrated on demand rather
   than waited for. */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useApm } from '../services/apmStore';
import { useRole } from '../services/roleContext';
import { fmtInt } from '../engines/indices';
import {
  integrationCatalogue, integrationLog, runIngest, health, API_BASE,
} from '../services/backend';
import { Panel, PageHead, Tabs, SimulatedNote } from '../components/apmUi';
import KPICard, { IcoLink, IcoSignal, IcoCheck, IcoAlert, IcoClock, IcoGlobe } from '../components/KPICard';
import KPIDetailModal from '../components/KPIDetailModal';
import { RFQ_POPULATION } from '../data/network';

const DIRECTION_TONE = { Inbound: '#0ea5e9', Outbound: '#8b5cf6', 'Bi-directional': '#14b8a6' };

export default function IntegrationConsole() {
  const { can } = useRole();
  const { fleet } = useApm();

  const [catalogue, setCatalogue] = useState([]);
  const [log, setLog] = useState([]);
  const [apiUp, setApiUp] = useState(null);
  const [selected, setSelected] = useState('gdh');
  const [running, setRunning] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('result');
  const [recordCount, setRecordCount] = useState(25);
  const [selectedKPIDetail, setSelectedKPIDetail] = useState(null);
  const showKPIDetail = (d) => setSelectedKPIDetail(d);

  const refreshLog = useCallback(() => {
    integrationLog(40).then(setLog).catch(() => {});
  }, []);

  useEffect(() => {
    let alive = true;
    health()
      .then(() => { if (alive) setApiUp(true); })
      .catch(() => { if (alive) setApiUp(false); });
    integrationCatalogue()
      .then((c) => { if (alive) setCatalogue(c); })
      .catch(() => { if (alive) setCatalogue([]); });
    refreshLog();
    return () => { alive = false; };
  }, [refreshLog]);

  const current = catalogue.find((c) => c.key === selected);

  const doRun = async (systemKey) => {
    setRunning(systemKey);
    setError(null);
    setResult(null);
    setTab('result');
    try {
      const res = await runIngest(systemKey, recordCount);
      setResult(res);
      refreshLog();
    } catch (e) {
      setError(e.message);
    } finally {
      setRunning(null);
    }
  };

  /* Activity aggregates from the log the backend keeps. */
  const stats = useMemo(() => {
    const total = log.length;
    const rec = log.reduce((s, r) => s + (r.received || 0), 0);
    const acc = log.reduce((s, r) => s + (r.accepted || 0), 0);
    const rej = log.reduce((s, r) => s + (r.rejected || 0), 0);
    const ms = log.length ? log.reduce((s, r) => s + (r.durationMs || 0), 0) / log.length : 0;
    return { total, rec, acc, rej, ms, acceptRate: rec ? (acc / rec) * 100 : 100 };
  }, [log]);

  if (apiUp === false) {
    return (
      <div className="space-y-4">
        <PageHead eyebrow="S!aP Konnect · Integration" title="Integration Console" />
        <Panel title="Integration service unavailable">
          <p className="text-[12px] mb-3" style={{ color: 'var(--app-text-muted)' }}>
            The Integration Console talks to the S!aP demo API, which is not responding at
            <code style={{ color: 'var(--app-info)' }}> {API_BASE}</code>.
          </p>
          <div className="apm-formula">npm run server</div>
          <p className="text-[10.5px] mt-3" style={{ color: 'var(--app-text-faint)' }}>
            Sections M, N, O and Q read and write through this service so configuration and audit state survive a
            refresh. The rest of the platform runs without it.
          </p>
        </Panel>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {selectedKPIDetail && <KPIDetailModal kpi={selectedKPIDetail} onClose={() => setSelectedKPIDetail(null)} />}

      <PageHead
        eyebrow="S!aP Konnect · Vendor-neutral integration"
        title="Integration Console"
        sub="Ten interfaces spanning TPCL's IT and OT estate, with the Grid Data Hub as the primary and indigenous source. Each run demonstrates ingestion, field mapping, error handling and reconciliation."
        right={
          <div className="text-right">
            <p className="apm-eyebrow" style={{ fontSize: 9 }}>S!aP Konnect</p>
            <p className="text-[11px] font-semibold mt-1" style={{ color: apiUp ? 'var(--app-success)' : 'var(--app-text-faint)' }}>
              {apiUp === null ? 'Connecting…' : 'Service healthy'}
            </p>
            <p className="text-[9.5px] mt-0.5" style={{ color: 'var(--app-text-faint)' }}>{API_BASE}</p>
          </div>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {(() => { const col = 'text-emerald-400'; return (
          <KPICard icon={<IcoLink />} label="Bound Interfaces" value={fmtInt(catalogue.length)} color={col}
            subValues={[{ label: 'Inbound', value: fmtInt(catalogue.filter((c) => c.direction === 'Inbound').length) }, { label: 'Bi-dir', value: fmtInt(catalogue.filter((c) => c.direction === 'Bi-directional').length) }]}
            onClick={() => showKPIDetail({ icon: <IcoLink />, label: 'Bound Interfaces', value: String(catalogue.length), unit: 'systems', color: col, thresholds: { green: 10, amber: 6 }, inverted: false, definition: 'Source systems bound through S!aP Konnect. The Grid Data Hub is the primary and indigenous route; systems reachable only directly are bound at Blueprinting with field mappings documented in the BRD.', subValues: catalogue.slice(0, 4).map((c) => ({ label: c.name, value: c.method.split(' ')[0] })), target: 'All ten RFQ-named interfaces bound', analysis: 'Vendor-neutral by design — REST, ODBC, file and message-queue transports are all supported, so no source system needs replacing. | The Grid Data Hub carries most traffic; direct binds are the exception, not the rule.' })} />
        ); })()}

        {(() => { const col = stats.acceptRate >= 98 ? 'text-emerald-400' : stats.acceptRate >= 90 ? 'text-amber-400' : 'text-red-400'; return (
          <KPICard icon={<IcoCheck />} label="Record Accept Rate" value={stats.acceptRate.toFixed(1)} unit=" %" color={col}
            subValues={[{ label: 'Accepted', value: fmtInt(stats.acc) }, { label: 'Rejected', value: fmtInt(stats.rej) }]}
            onClick={() => showKPIDetail({ icon: <IcoCheck />, label: 'Record Accept Rate', value: stats.acceptRate.toFixed(1), unit: '%', color: col, thresholds: { green: 98, amber: 90 }, inverted: false, definition: 'Share of ingested records passing schema validation this session. Rejected records are quarantined with a field-level reason rather than silently dropped — an important distinction when the downstream consumer is a risk model.', subValues: [{ label: 'Received', value: fmtInt(stats.rec) }, { label: 'Accepted', value: fmtInt(stats.acc) }, { label: 'Rejected', value: fmtInt(stats.rej) }, { label: 'Runs', value: fmtInt(stats.total) }], target: '98%+ accepted', analysis: 'Validation runs at ingestion so malformed data never reaches the condition models. | SAP MM is deliberately seeded with records missing a unit of measure — the error path is demonstrable on demand. | Every rejection carries the field, the rule and the observed value.' })} />
        ); })()}

        {(() => { const col = 'text-cyan-400'; return (
          <KPICard icon={<IcoSignal />} label="Records This Session" value={fmtInt(stats.rec)} color={col}
            subValues={[{ label: 'Runs', value: fmtInt(stats.total) }, { label: 'Mean Latency', value: `${stats.ms.toFixed(0)} ms` }]}
            onClick={() => showKPIDetail({ icon: <IcoSignal />, label: 'Records This Session', value: String(stats.rec), unit: 'records', color: col, definition: 'Records pulled through S!aP Konnect since this demo session began. The RFQ sizes the production load at roughly 20,000 GB initial and 15 GB/day incremental across all interfaces.', subValues: [{ label: 'Initial Load', value: `${fmtInt(RFQ_POPULATION.initialLoadGB)} GB` }, { label: 'Daily Incremental', value: `${RFQ_POPULATION.dailyIncrementalGB} GB/day` }, { label: 'Runs', value: fmtInt(stats.total) }, { label: 'Mean Latency', value: `${stats.ms.toFixed(0)} ms` }], target: 'Sustained ingestion without degradation', analysis: 'Ingestion supports real-time, near-real-time and batch cadences per interface. | Cadence is configurable per source rather than fixed platform-wide.' })} />
        ); })()}

        {(() => { const col = stats.ms <= 800 ? 'text-emerald-400' : 'text-amber-400'; return (
          <KPICard icon={<IcoClock />} label="Mean Interface Latency" value={stats.ms.toFixed(0)} unit=" ms" color={col}
            subValues={[{ label: 'SLA', value: '≤ 3,000 ms' }, { label: 'Runs', value: fmtInt(stats.total) }]}
            onClick={() => showKPIDetail({ icon: <IcoClock />, label: 'Mean Interface Latency', value: stats.ms.toFixed(0), unit: 'ms', color: col, thresholds: { green: 800, amber: 3000 }, inverted: true, definition: 'Mean round-trip time across integration runs this session, measured client-side. The RFQ SLA sets a 3,000 ms ceiling on API response.', subValues: [{ label: 'Observed', value: `${stats.ms.toFixed(0)} ms` }, { label: 'RFQ SLA', value: '3,000 ms' }, { label: 'Runs', value: fmtInt(stats.total) }, { label: 'Headroom', value: `${(3000 - stats.ms).toFixed(0)} ms` }], target: 'API response ≤ 3,000 ms', analysis: 'Latency here is genuine round-trip time to the integration service, not a simulated delay applied in the browser. | Production latency depends on GDH response times, confirmed during Blueprinting.' })} />
        ); })()}

        {(() => { const col = stats.rej > 0 ? 'text-amber-400' : 'text-emerald-400'; return (
          <KPICard icon={<IcoAlert />} label="Quarantined Records" value={fmtInt(stats.rej)} color={col}
            subValues={[{ label: 'Reason', value: 'Schema' }, { label: 'Action', value: 'Held' }]}
            onClick={() => showKPIDetail({ icon: <IcoAlert />, label: 'Quarantined Records', value: String(stats.rej), unit: 'records', color: col, thresholds: { green: 0, amber: 20 }, inverted: true, definition: 'Records held back from the data lake because they failed schema or range validation. Each carries the offending field, the rule it broke and the observed value, so the source system owner has something actionable rather than a failure count.', subValues: [{ label: 'Quarantined', value: fmtInt(stats.rej) }, { label: 'Accepted', value: fmtInt(stats.acc) }, { label: 'Runs', value: fmtInt(stats.total) }, { label: 'Rate', value: `${(100 - stats.acceptRate).toFixed(1)}%` }], target: 'Zero sustained quarantine', analysis: 'Quarantine is deliberate: a record with a missing unit of measure is worse than a missing record, because it silently corrupts a condition score. | Reconciliation reports variance per run so nothing is lost without being counted.' })} />
        ); })()}

        {(() => { const col = 'text-violet-400'; return (
          <KPICard icon={<IcoGlobe />} label="Assets Under Ingestion" value={fmtInt(fleet.rows.length)} color={col}
            subValues={[{ label: 'Primary Source', value: 'GDH' }, { label: 'Residency', value: 'India' }]}
            onClick={() => showKPIDetail({ icon: <IcoGlobe />, label: 'Assets Under Ingestion', value: String(fleet.rows.length), unit: 'assets', color: col, definition: 'Modelled assets whose condition data flows through these interfaces. Isolators, FPIs, FRTUs and RTUs are tracked as fleet counts in this build and carry no condition model.', subValues: [{ label: 'Modelled', value: fmtInt(fleet.rows.length) }, { label: 'Isolators', value: fmtInt(RFQ_POPULATION.isolators) }, { label: 'FPIs', value: fmtInt(RFQ_POPULATION.fpis) }, { label: 'FRTUs / RTUs', value: `${fmtInt(RFQ_POPULATION.frtus)} / ${RFQ_POPULATION.rtus}` }], target: 'Full RFQ §3.7 population under management', analysis: 'All storage and processing is India-resident on the same VNet as the Grid Data Hub, per RFQ Section 3.6.1. | TPCL retains exclusive ownership of all data at all times.' })} />
        ); })()}
      </div>

      <div className="grid gap-4" style={{ gridTemplateColumns: 'minmax(330px, 0.95fr) minmax(430px, 1.45fr)' }}>
        {/* ─── Interface catalogue ────────────────────────────────────── */}
        <Panel title="Interface catalogue" checkpoints="M · A.8"
               sub="Select an interface, then run an ingestion cycle" bodyClass="p-0">
          <div className="apm-scroll" style={{ maxHeight: 520 }}>
            {catalogue.map((c) => (
              <div
                key={c.key}
                onClick={() => { setSelected(c.key); setResult(null); setError(null); }}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && setSelected(c.key)}
                className="px-4 py-3 border-b border-app-border"
                style={{ cursor: 'pointer', background: selected === c.key ? 'var(--app-info-bg)' : 'transparent' }}
              >
                <div className="flex items-center gap-2">
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: DIRECTION_TONE[c.direction] || 'var(--app-text-faint)', flexShrink: 0 }} />
                  <span className="text-[11.5px] font-bold flex-1 truncate" style={{ color: 'var(--app-text)' }}>{c.name}</span>
                  <button
                    type="button"
                    className="apm-tab"
                    style={{ border: '1px solid var(--app-border)', borderRadius: 6, padding: '3px 8px', fontSize: 10 }}
                    disabled={running === c.key || !can('integration.run')}
                    onClick={(e) => { e.stopPropagation(); setSelected(c.key); doRun(c.key); }}
                  >
                    {running === c.key ? 'Running…' : 'Run'}
                  </button>
                </div>
                <p className="text-[10px] mt-1" style={{ color: 'var(--app-text-faint)' }}>{c.domain}</p>
                <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                  <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: 'var(--app-surface-raised)', color: 'var(--app-text-faint)' }}>{c.method}</span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: 'var(--app-surface-raised)', color: DIRECTION_TONE[c.direction] }}>{c.direction}</span>
                  <span className="text-[9px]" style={{ color: 'var(--app-text-faint)' }}>{c.cadence}</span>
                </div>
              </div>
            ))}
          </div>
        </Panel>

        {/* ─── Run detail ─────────────────────────────────────────────── */}
        <div className="space-y-4">
          <Panel
            title={current ? `${current.name} — ingestion cycle` : 'Select an interface'}
            checkpoints="M.1 · M.2 · M.3 · M.4"
            sub={current ? `${current.vendor} · ${current.method} · ${current.cadence}` : ''}
            right={
              <div className="flex items-center gap-2">
                <input
                  type="number" min="1" max="200" value={recordCount}
                  onChange={(e) => setRecordCount(Math.max(1, Math.min(200, parseInt(e.target.value, 10) || 1)))}
                  aria-label="Records to request"
                  style={{ width: 62, background: 'var(--app-surface-soft)', border: '1px solid var(--app-border)', color: 'var(--app-text)', borderRadius: 6, padding: '4px 7px', fontSize: 11 }}
                />
                <button
                  className="app-btn px-3 py-1.5 text-[11px]"
                  type="button"
                  disabled={!!running || !can('integration.run')}
                  style={{ opacity: running || !can('integration.run') ? 0.55 : 1 }}
                  onClick={() => doRun(selected)}
                >
                  {running ? 'Running…' : 'Run ingestion'}
                </button>
              </div>
            }
          >
            {!can('integration.run') && (
              <div className="rounded-lg px-3 py-2 mb-3" style={{ background: 'var(--app-warning-bg)', border: '1px solid var(--app-warning-border)' }}>
                <p className="text-[10.5px]" style={{ color: 'var(--app-text-muted)' }}>
                  Current role has read-only access to integrations.
                </p>
              </div>
            )}

            {error && (
              <div className="rounded-lg px-3 py-2.5 mb-3" style={{ background: 'var(--app-danger-bg)', border: '1px solid var(--app-danger-border)' }}>
                <p className="text-[11px]" style={{ color: 'var(--app-danger)' }}>{error}</p>
              </div>
            )}

            {!result && !error && (
              <p className="text-[11px]" style={{ color: 'var(--app-text-faint)' }}>
                Run an ingestion cycle to see the payload, the field mapping, any validation rejections and the
                reconciliation report. {current && current.key === 'sap_mm' ? 'This interface is seeded with records that fail validation, to demonstrate the error path.' : ''}
              </p>
            )}

            {result && (
              <>
                <div className="grid gap-2 mb-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(108px, 1fr))' }}>
                  {[
                    ['Received', fmtInt(result.received), 'var(--app-text)'],
                    ['Accepted', fmtInt(result.accepted), 'var(--app-success)'],
                    ['Rejected', fmtInt(result.rejected), result.rejected ? 'var(--app-danger)' : 'var(--app-text-faint)'],
                    ['Duration', `${result.durationMs} ms`, 'var(--app-text)'],
                  ].map(([k, v, c]) => (
                    <div key={k} className="rounded-lg px-3 py-2" style={{ background: 'var(--app-surface-soft)', border: '1px solid var(--app-border)' }}>
                      <p className="text-[9px] font-bold uppercase tracking-wider" style={{ color: 'var(--app-text-faint)' }}>{k}</p>
                      <p className="text-[15px] font-bold mt-0.5" style={{ color: c, fontVariantNumeric: 'tabular-nums' }}>{v}</p>
                    </div>
                  ))}
                </div>

                <Tabs
                  tabs={[
                    { key: 'result', label: `Payload · M.1` },
                    { key: 'mapping', label: `Mapping · M.2` },
                    { key: 'errors', label: `Errors · M.3${result.rejected ? ` (${result.rejected})` : ''}` },
                    { key: 'recon', label: 'Reconciliation · M.4' },
                  ]}
                  active={tab}
                  onChange={setTab}
                />

                {tab === 'result' && (
                  <div className="apm-formula apm-scroll" style={{ maxHeight: 240, fontSize: 10.5 }}>
                    <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>
                      {JSON.stringify(result.sample, null, 2)}
                    </pre>
                  </div>
                )}

                {tab === 'mapping' && (
                  <div className="apm-scroll" style={{ maxHeight: 240 }}>
                    <table className="apm-table">
                      <thead><tr><th>Source field</th><th>Target</th><th>Type</th><th>Note</th></tr></thead>
                      <tbody>
                        {result.mapping.map((m) => (
                          <tr key={m[0]}>
                            <td className="asset-id">{m[0]}</td>
                            <td style={{ color: 'var(--app-info)' }}>{m[1]}</td>
                            <td className="text-[10px]">{m[2]}</td>
                            <td className="text-[10px]" style={{ color: 'var(--app-text-faint)' }}>{m[3]}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {tab === 'errors' && (
                  <div className="apm-scroll" style={{ maxHeight: 240 }}>
                    {result.rejections.length === 0 ? (
                      <p className="text-[11px] py-2" style={{ color: 'var(--app-success)' }}>
                        All {fmtInt(result.received)} records passed schema and range validation.
                      </p>
                    ) : (
                      <table className="apm-table">
                        <thead><tr><th>Row</th><th>Key</th><th>Field</th><th>Rule</th><th>Observed</th><th>Disposition</th></tr></thead>
                        <tbody>
                          {result.rejections.map((r) => r.errors.map((e, i) => (
                            <tr key={`${r.row}-${i}`}>
                              <td className="num">{r.row}</td>
                              <td className="asset-id">{r.key}</td>
                              <td style={{ color: 'var(--app-danger)', fontWeight: 600 }}>{e.field}</td>
                              <td className="text-[10px]">{e.rule}</td>
                              <td className="num">{String(e.got)}</td>
                              <td className="text-[10px]" style={{ color: 'var(--app-text-faint)', maxWidth: 220 }}>{e.note}</td>
                            </tr>
                          )))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}

                {tab === 'recon' && (
                  <div>
                    <div className="apm-formula mb-3">
                      Source <span className="val">{fmtInt(result.reconciliation.sourceCount)}</span>
                      <span className="op">−</span> Target <span className="val">{fmtInt(result.reconciliation.targetCount)}</span>
                      <span className="op">=</span> Variance <span className="res">{fmtInt(result.reconciliation.variance)}</span>
                      <span className="op"> · </span>{result.reconciliation.variancePct}%
                    </div>
                    <div className="rounded-lg px-3 py-2.5"
                         style={{ background: result.rejected ? 'var(--app-warning-bg)' : 'var(--app-success-bg)', border: `1px solid ${result.rejected ? 'var(--app-warning-border)' : 'var(--app-success-border)'}` }}>
                      <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: result.rejected ? 'var(--app-warning)' : 'var(--app-success)' }}>
                        {result.reconciliation.status}
                      </p>
                      <p className="text-[10.5px] mt-1" style={{ color: 'var(--app-text-muted)' }}>
                        {result.rejected
                          ? `${fmtInt(result.rejected)} records held in quarantine with a field-level reason. Source system owner is notified; nothing is discarded silently.`
                          : 'Source and target counts agree. No records quarantined this cycle.'}
                      </p>
                    </div>
                  </div>
                )}
              </>
            )}
          </Panel>

          <Panel title="Integration activity" checkpoints="M" sub="Every call made through S!aP Konnect this session"
                 right={<button className="apm-tab" type="button" style={{ border: '1px solid var(--app-border)', borderRadius: 6, padding: '4px 9px' }} onClick={refreshLog}>Refresh</button>}
                 bodyClass="p-0">
            <div className="apm-scroll" style={{ maxHeight: 220 }}>
              {log.length === 0 ? (
                <p className="text-[11px] p-4" style={{ color: 'var(--app-text-faint)' }}>No calls yet this session.</p>
              ) : (
                <table className="apm-table">
                  <thead><tr><th>Time</th><th>System</th><th>Operation</th><th className="num">In</th><th className="num">OK</th><th className="num">Rej</th><th>Status</th></tr></thead>
                  <tbody>
                    {log.map((r) => (
                      <tr key={r.id}>
                        <td className="text-[10px]">{new Date(r.at).toLocaleTimeString('en-IN', { hour12: false })}</td>
                        <td style={{ color: 'var(--app-text)', fontWeight: 600 }}>{r.systemName}</td>
                        <td className="text-[10px]">{r.operation}{r.reference ? ` · ${r.reference}` : ''}</td>
                        <td className="num">{r.received}</td>
                        <td className="num" style={{ color: 'var(--app-success)' }}>{r.accepted}</td>
                        <td className="num" style={{ color: r.rejected ? 'var(--app-danger)' : 'var(--app-text-faint)' }}>{r.rejected}</td>
                        <td>
                          <span className="apm-pill" style={{ background: r.status === 'OK' ? 'var(--app-success-bg)' : 'var(--app-warning-bg)', color: r.status === 'OK' ? 'var(--app-success)' : 'var(--app-warning)' }}>
                            {r.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </Panel>

          <SimulatedNote>
            Every system on this page is a <strong>labelled simulator</strong> running in this demo's backend — there is
            no live SAP, GDH, SCADA or CYME behind it. What is real: the HTTP round trip, the latency, the payload
            shapes, the field mappings and the schema validation, which genuinely rejects records. Live connectivity
            and final field-level mappings are established during Blueprinting and documented in the BRD.
          </SimulatedNote>
        </div>
      </div>
    </div>
  );
}
