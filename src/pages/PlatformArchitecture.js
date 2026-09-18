/* ═══════════════════════════════════════════════════════════════════════════
   Solution Architecture & Platform Overview — Section A
   ───────────────────────────────────────────────────────────────────────────
   A.1 Product architecture        A.5 High availability design
   A.2 Native APM & AIP platform   A.6 Scalability mechanism
   A.3 Technology stack            A.7 Data processing framework
   A.4 Cloud architecture          A.8 API framework

   Section A is the first thing an evaluation panel walks through, and it is the
   one section where the honest answer is "here is the design", not "here is it
   running" — nobody demonstrates a failover by pulling a cable in a bid room.

   What this screen does instead is make the architecture *checkable*. The
   capacity figures are computed from the RFQ's own published volumetrics rather
   than asserted, the component map names the modules the commercial proposal
   actually prices, and the availability arithmetic is derived from the SLA
   targets Astrikos committed to. An evaluator can put a number against any
   claim on this page and follow how it was reached.
   ═══════════════════════════════════════════════════════════════════════════ */

import React, { useMemo, useState } from 'react';

import { useApm } from '../services/apmStore';
import { RFQ_POPULATION } from '../data/network';
import { fmtInt } from '../engines/indices';
import { API_BASE } from '../services/backend';
import { Panel, PageHead, Tabs, SimulatedNote } from '../components/apmUi';
import KPICard, { IcoBox, IcoGlobe, IcoShield, IcoSignal, IcoBolt, IcoLink }
  from '../components/KPICard';
import KPIDetailModal from '../components/KPIDetailModal';

/* ═══ 1. THE TWO-LAYER STACK ══════════════════════════════════════════════
   Straight from the technical proposal §1.3 and the priced BOQ. The module
   names matter: an evaluator holding the commercial schedule should be able to
   match every box on this diagram to a line item they are being asked to buy. */

const LAYERS = [
  {
    key: 'sources',
    label: 'Data Sources',
    tint: '#64748b',
    note: 'TPCL-owned. Not in Astrikos scope.',
    nodes: [
      { name: 'Grid Data Hub (GDH)', detail: 'Primary source — REST, ODBC, SFTP, message queue', primary: true },
      { name: 'SAP MM / PM / PS / FICO', detail: 'Spares, work orders, projects, finance' },
      { name: 'GIS · ADMS · SCADA', detail: 'Topology, switching state, telemetry' },
      { name: 'CYME DIST · MDM · Historian', detail: 'Load flow, meter data, time series' },
    ],
  },
  {
    key: 'connect',
    label: 'Integration — S!aP Konnect',
    tint: '#0ea5e9',
    note: 'Vendor-neutral. Displaces nothing.',
    nodes: [
      { name: 'Protocol adapters', detail: 'REST · SOAP · ODBC · SFTP/FTP · MQ' },
      { name: 'Schema validation', detail: 'Rejects malformed GDH exports at the boundary' },
      { name: 'Published API catalogue', detail: 'Endpoints, schema, auth, error codes, versions' },
      { name: 'Refresh scheduler', detail: 'Real-time · near-real-time · batch' },
    ],
  },
  {
    key: 'data',
    label: 'Data Platform — S!aP Datalake',
    tint: '#8b5cf6',
    note: 'Operational system of record. India-resident.',
    nodes: [
      { name: 'Asset hierarchy & type library', detail: 'Transformers, breakers, switchgear, relays, RMUs, linear' },
      { name: 'Time-series store', detail: 'DGA, oil, thermal, loading, PD, vibration' },
      { name: 'Compliance audit trail', detail: 'Every data change, model output and workflow action' },
      { name: 'Row/column security & masking', detail: 'Retention policy applied at the store' },
    ],
  },
  {
    key: 'engine',
    label: 'Analytics — AVEVA APM + S!aP ML & AI Central',
    tint: '#f59e0b',
    note: 'The COTS mandate is met here.',
    nodes: [
      { name: 'AVEVA APM engine', detail: 'COTS condition monitoring, physics degradation, FMECA/RCM library', primary: true },
      { name: 'AHI · ACI · ARI engines', detail: 'Configurable, explainable, ISO 55001 / ISO 31000 aligned' },
      { name: 'Predictive ageing & RUL', detail: 'IEEE degradation, ISO 14224 Weibull, IEC CIM lifecycle' },
      { name: 'AIP optimisation engine', detail: 'Investment value, portfolio knapsack, scenario modelling' },
    ],
  },
  {
    key: 'app',
    label: 'Workflow & Experience — S!aP BPM · Viz · Agentic',
    tint: '#22c55e',
    note: 'What the user actually touches.',
    nodes: [
      { name: 'S!aP BPM', detail: 'Approvals, task routing, investment governance, work orders' },
      { name: 'S!aP Viz', detail: 'Role-based dashboards, drill-down, reporting, export' },
      { name: 'S!aP Agentic (S!a)', detail: 'Conversational advisory over the same engine output' },
      { name: 'S!aP Sys Admin', detail: 'RBAC/ABAC, configuration studio, security posture' },
    ],
  },
];

/* ═══ 2. TECHNOLOGY STACK — A.3 ═══════════════════════════════════════════ */

const STACK = [
  { layer: 'Presentation', components: 'S!aP Viz — React SPA, responsive, WCAG-aware', deps: 'Modern evergreen browser. No plug-in, no desktop install.', ours: true },
  { layer: 'API', components: 'REST/JSON over TLS 1.2/1.3, OpenAPI-described, versioned', deps: 'Published API catalogue per RFQ Documentation §6', ours: true },
  { layer: 'Workflow', components: 'S!aP BPM — process engine, approvals, task routing', deps: 'Datalake, identity provider', ours: true },
  { layer: 'Analytics', components: 'S!aP ML & AI Central — model registry, training, scoring', deps: 'Datalake time series, historical maintenance records', ours: true },
  { layer: 'COTS APM', components: 'AVEVA Asset Performance Management + Asset Strategy Library', deps: 'AVEVA subscription (BOQ 1.1–1.4)', ours: false },
  { layer: 'Data', components: 'S!aP Datalake — time-series + relational + object store', deps: 'Cloud storage on TPCL VNet', ours: true },
  { layer: 'Integration', components: 'S!aP Konnect — adapters, scheduler, validation', deps: 'GDH endpoints; direct sources confirmed at Blueprinting', ours: true },
  { layer: 'Platform', components: 'Container orchestration, auto-scaling, managed services', deps: 'TPCL Azure/AWS subscription, GDH VNet', ours: false },
  { layer: 'Identity', components: 'RBAC/ABAC bound to TPCL Active Directory, SSO, MFA', deps: 'TPCL AD / SSO endpoints (client responsibility)', ours: false },
  { layer: 'Monitoring', components: 'Platform telemetry forwarded to Microsoft Sentinel', deps: 'TPCL SIEM endpoint (client responsibility)', ours: false },
];

/* ═══ 3. DATA PROCESSING PATHS — A.7 ══════════════════════════════════════
   The RFQ asks for real-time *and* batch. Three paths, each with a stated
   latency envelope and the use cases that actually sit on it. */

const PROCESSING_PATHS = [
  {
    path: 'Real-time / streaming',
    latency: '< 30 seconds',
    mechanism: 'Message queue → S!aP Konnect stream adapter → in-memory scoring → alert',
    volume: 'SCADA telemetry, ADMS switching state, PQM events',
    drives: 'Condition alarms, anomaly detection, live advisory',
  },
  {
    path: 'Near-real-time / micro-batch',
    latency: '5 – 15 minutes',
    mechanism: 'GDH API poll → validation → Datalake upsert → incremental index recompute',
    volume: 'Historian trends, meter events, diagnostic readings',
    drives: 'AHI refresh, deterioration trend, RUL re-forecast',
  },
  {
    path: 'Batch',
    latency: 'Nightly, or on demand',
    mechanism: 'SFTP/CSV or bulk API → staged validation → full recompute → snapshot',
    volume: 'SAP MM/PM/FICO extracts, GIS topology, CYME load-flow results',
    drives: 'Portfolio optimisation, ARR modelling, regulatory reporting',
  },
];

/* ═══ 4. HIGH AVAILABILITY & DR — A.5 ═════════════════════════════════════ */

const SLA_TARGETS = {
  availabilityPct: 99.5,   // monthly, per proposal §Support Model
  rpoMinutes: 15,
  rtoMinutes: 60,
  loginSec: 5,
  dashboardSec: 10,
  searchSec: 5,
  reportSec: 60,
  apiSec: 3,
};

const HA_LAYERS = [
  { tier: 'Edge / ingress', mechanism: 'Load balancer across availability zones, health-checked', failure: 'Zone loss', recovery: 'Automatic — traffic re-routes, no data loss' },
  { tier: 'Application', mechanism: 'Stateless containers, N+1 replicas, rolling deployment', failure: 'Node or pod loss', recovery: 'Automatic — orchestrator reschedules' },
  { tier: 'Analytics workers', mechanism: 'Queue-backed workers, idempotent jobs, checkpointed', failure: 'Worker loss mid-computation', recovery: 'Job re-queued, recomputed from checkpoint' },
  { tier: 'Datalake', mechanism: 'Synchronous replication within region, PITR snapshots', failure: 'Storage or instance loss', recovery: 'Failover replica; PITR for logical corruption' },
  { tier: 'Region', mechanism: 'Warm standby in a second India region, replicated backups', failure: 'Region loss', recovery: 'Declared DR invocation within the RTO' },
];

/* ═══ 5. PAGE ═════════════════════════════════════════════════════════════ */

export default function PlatformArchitecture() {
  const { summary, fleet } = useApm();
  const [tab, setTab] = useState('architecture');
  const [selectedKPIDetail, setSelectedKPIDetail] = useState(null);
  const showKPIDetail = (d) => setSelectedKPIDetail(d);
  const [activeLayer, setActiveLayer] = useState(null);

  /* ─── Capacity model — A.6 ────────────────────────────────────────────────
     Derived from the RFQ's own published figures rather than asserted, so an
     evaluator can check the arithmetic against §3.7 of their own document. */
  const capacity = useMemo(() => {
    const p = RFQ_POPULATION;
    const totalAssets =
      p.powerTransformersDSS + p.transformersCSS + p.circuitBreakers +
      p.isolators + p.rmus + p.fpis + p.frtus + p.rtus;

    const initialGB = p.initialLoadGB;
    const dailyGB = p.dailyIncrementalGB;
    const yearlyGB = dailyGB * 365;
    const fiveYearGB = initialGB + yearlyGB * 5;

    // Retention is one year per proposal §8.2; the steady-state working set is
    // the initial load plus one year of increment, with older data archived.
    const workingSetGB = initialGB + yearlyGB;

    // Telemetry arrival rate implied by the daily increment, at an indicative
    // 2 KB per condition-monitoring record.
    const recordsPerDay = (dailyGB * 1024 * 1024) / 2;
    const recordsPerSec = recordsPerDay / 86400;

    return {
      totalAssets, initialGB, dailyGB, yearlyGB, fiveYearGB, workingSetGB,
      recordsPerDay, recordsPerSec,
      // Headroom against the modelled fleet: the demo scores this many assets
      // in the measured time below, which sets the per-asset compute budget.
      modelledAssets: summary.count,
      computeMs: fleet.computeMs,
      perAssetUs: (fleet.computeMs * 1000) / Math.max(summary.count, 1),
      // At the measured per-asset cost, a full-population recompute takes:
      fullPopulationMs: ((fleet.computeMs * 1000) / Math.max(summary.count, 1)) * totalAssets / 1000,
    };
  }, [summary.count, fleet.computeMs]);

  /* ─── Availability arithmetic — A.5 ─────────────────────────────────────── */
  const availability = useMemo(() => {
    const pct = SLA_TARGETS.availabilityPct;
    const minutesPerMonth = 30 * 24 * 60;
    const allowedDownMins = minutesPerMonth * (1 - pct / 100);
    return {
      pct,
      allowedDownMins,
      allowedDownYearMins: allowedDownMins * 12,
      rpo: SLA_TARGETS.rpoMinutes,
      rto: SLA_TARGETS.rtoMinutes,
      // Maintenance windows are excluded from the availability calculation, so
      // state how much of the allowance they would otherwise consume.
      monthlyWindowMins: 120,
    };
  }, []);

  return (
    <div className="space-y-4">
      {selectedKPIDetail && (
        <KPIDetailModal kpi={selectedKPIDetail} onClose={() => setSelectedKPIDetail(null)} />
      )}

      <PageHead
        eyebrow="AVEVA APM + Astrikos S!aP · Solution Architecture"
        title="Platform Architecture"
        sub="The two-layer solution as proposed: AVEVA Asset Performance Management satisfying the COTS mandate, with the Astrikos S!aP overlay delivering integration, AIP intelligence, workflow and advisory. Capacity and availability figures on this page are computed from the RFQ's published volumetrics and the committed SLA, not asserted."
        right={
          <div className="text-right">
            <p className="apm-eyebrow" style={{ fontSize: 9 }}>Deployment</p>
            <p className="text-[12px] font-bold mt-1" style={{ color: 'var(--app-success)' }}>
              SaaS · TPCL VNet · India-resident
            </p>
          </div>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {(() => { const col = 'text-cyan-400'; return (
          <KPICard icon={<IcoBox />} label="Assets In Scope" value={fmtInt(capacity.totalAssets)} color={col}
            subValues={[{ label: 'Substations', value: fmtInt(RFQ_POPULATION.distributionSubstations + RFQ_POPULATION.consumerSubstations) }, { label: 'Modelled Here', value: fmtInt(capacity.modelledAssets) }]}
            onClick={() => showKPIDetail({ icon: <IcoBox />, label: 'Assets In Scope', value: String(capacity.totalAssets), unit: 'assets', color: col, thresholds: { green: 1000, amber: 100 }, inverted: false, definition: 'Total field assets named in RFQ §3.7, summed across every published class. This is the population the platform is sized for, and the figure every capacity number on this page is derived from.', subValues: [{ label: 'Transformers (DSS)', value: fmtInt(RFQ_POPULATION.powerTransformersDSS) }, { label: 'Transformers (CSS)', value: fmtInt(RFQ_POPULATION.transformersCSS) }, { label: 'Breakers', value: fmtInt(RFQ_POPULATION.circuitBreakers) }, { label: 'Isolators', value: fmtInt(RFQ_POPULATION.isolators) }], target: 'Full published population under management', analysis: `RMUs add ${fmtInt(RFQ_POPULATION.rmus)}, FPIs ${fmtInt(RFQ_POPULATION.fpis)}, FRTUs ${fmtInt(RFQ_POPULATION.frtus)} and RTUs ${fmtInt(RFQ_POPULATION.rtus)}. | This demonstration models ${fmtInt(capacity.modelledAssets)} of them in the browser to keep the build self-contained. | The delivered platform scores the full population server-side on the same engines.` })} />
        ); })()}

        {(() => { const col = 'text-violet-400'; return (
          <KPICard icon={<IcoGlobe />} label="Initial Data Load" value={fmtInt(capacity.initialGB / 1000)} unit=" TB" color={col}
            subValues={[{ label: 'Daily Increment', value: `${capacity.dailyGB} GB` }, { label: 'Yearly', value: `${(capacity.yearlyGB / 1000).toFixed(1)} TB` }]}
            onClick={() => showKPIDetail({ icon: <IcoGlobe />, label: 'Initial Data Load', value: (capacity.initialGB / 1000).toFixed(1), unit: 'TB', color: col, thresholds: { green: 20, amber: 50 }, inverted: true, definition: 'Historical data volume to be migrated at go-live, per RFQ §3.7, with the stated daily incremental rate. These two figures size the Datalake, the ingestion path and the backup strategy.', subValues: [{ label: 'Initial Load', value: `${fmtInt(capacity.initialGB)} GB` }, { label: 'Daily Increment', value: `${capacity.dailyGB} GB` }, { label: 'Annual Growth', value: `${fmtInt(capacity.yearlyGB)} GB` }, { label: 'Working Set', value: `${fmtInt(capacity.workingSetGB)} GB` }], target: 'Ingested without performance degradation', analysis: `At ${capacity.dailyGB} GB/day the store grows ${fmtInt(capacity.yearlyGB)} GB a year; over the 5-year AMC that is ${fmtInt(capacity.fiveYearGB)} GB gross. | Retention is one year of hot data per the proposal, so the working set stabilises near ${fmtInt(capacity.workingSetGB)} GB with the remainder archived. | That is what the storage tier is sized against, not the gross figure.` })} />
        ); })()}

        {(() => { const col = 'text-emerald-400'; return (
          <KPICard icon={<IcoSignal />} label="Ingest Rate" value={capacity.recordsPerSec.toFixed(0)} unit=" rec/s" color={col}
            subValues={[{ label: 'Per Day', value: `${(capacity.recordsPerDay / 1e6).toFixed(1)}M` }, { label: 'Paths', value: '3 — RT, NRT, batch' }]}
            onClick={() => showKPIDetail({ icon: <IcoSignal />, label: 'Ingest Rate', value: capacity.recordsPerSec.toFixed(0), unit: 'records/second', color: col, thresholds: { green: 500, amber: 2000 }, inverted: true, definition: 'Sustained record arrival rate implied by the RFQ\'s daily incremental volume at an indicative 2 KB per condition-monitoring record. It is a derived figure, and the assumption behind it is stated so it can be challenged.', subValues: [{ label: 'Daily Volume', value: `${capacity.dailyGB} GB` }, { label: 'Records/Day', value: `${(capacity.recordsPerDay / 1e6).toFixed(2)}M` }, { label: 'Records/Second', value: capacity.recordsPerSec.toFixed(0) }, { label: 'Assumed Size', value: '2 KB/record' }], target: 'Headroom of at least 5× sustained rate for burst', analysis: 'A sustained rate in the low hundreds per second is comfortably inside a single queue partition — this is not a volume that needs exotic engineering. | Burst capacity matters more than sustained: a nightly SAP extract arrives as a spike, which is why the batch path is separated from the streaming path. | Refine the record-size assumption during Blueprinting against real GDH exports.' })} />
        ); })()}

        {(() => { const col = 'text-emerald-400'; return (
          <KPICard icon={<IcoShield />} label="Availability Target" value={availability.pct.toFixed(1)} unit=" %" color={col}
            subValues={[{ label: 'Allowed Down', value: `${availability.allowedDownMins.toFixed(0)} min/mo` }, { label: 'RTO / RPO', value: `${availability.rto}m / ${availability.rpo}m` }]}
            onClick={() => showKPIDetail({ icon: <IcoShield />, label: 'Availability Target', value: availability.pct.toFixed(1), unit: '% monthly', color: col, thresholds: { green: 99.5, amber: 99.0 }, inverted: false, definition: 'Committed monthly availability, with the downtime allowance that figure actually permits. Stating the allowance in minutes rather than as a percentage is the honest way to present it — 99.5% sounds absolute and is not.', subValues: [{ label: 'Monthly Allowance', value: `${availability.allowedDownMins.toFixed(0)} min` }, { label: 'Annual Allowance', value: `${(availability.allowedDownYearMins / 60).toFixed(1)} h` }, { label: 'RPO', value: `${availability.rpo} min` }, { label: 'RTO', value: `${availability.rto} min` }], target: '99.5% monthly, excluding agreed maintenance windows', analysis: `99.5% permits ${availability.allowedDownMins.toFixed(0)} minutes of unplanned outage a month — about ${(availability.allowedDownYearMins / 60).toFixed(1)} hours a year. | Agreed maintenance windows sit outside that allowance; the monthly patch window is ${availability.monthlyWindowMins} minutes. | RPO of ${availability.rpo} minutes is met by synchronous replication, RTO of ${availability.rto} minutes by warm standby — both on the High Availability tab.` })} />
        ); })()}

        {(() => { const col = capacity.fullPopulationMs < 2000 ? 'text-emerald-400' : 'text-amber-400'; return (
          <KPICard icon={<IcoBolt />} label="Index Recompute" value={capacity.fullPopulationMs.toFixed(0)} unit=" ms" color={col}
            subValues={[{ label: 'Per Asset', value: `${capacity.perAssetUs.toFixed(0)} µs` }, { label: 'Measured On', value: fmtInt(capacity.modelledAssets) }]}
            onClick={() => showKPIDetail({ icon: <IcoBolt />, label: 'Index Recompute', value: capacity.fullPopulationMs.toFixed(0), unit: 'ms, full population', color: col, thresholds: { green: 2000, amber: 5000 }, inverted: true, definition: 'Projected time to recompute AHI, ACI, PoF, CoF and ARI across the entire RFQ asset population, extrapolated from the per-asset cost actually measured in this browser on this dataset.', subValues: [{ label: 'Measured Fleet', value: fmtInt(capacity.modelledAssets) }, { label: 'Measured Time', value: `${capacity.computeMs.toFixed(0)} ms` }, { label: 'Per Asset', value: `${capacity.perAssetUs.toFixed(1)} µs` }, { label: 'Full Population', value: `${capacity.fullPopulationMs.toFixed(0)} ms` }], target: 'Dashboard load ≤ 10 s per the SLA', analysis: `This is a real measurement extrapolated, not a benchmark claim: ${fmtInt(capacity.modelledAssets)} assets scored in ${capacity.computeMs.toFixed(0)} ms in single-threaded JavaScript in your browser right now. | Server-side the same arithmetic runs on more cores against a columnar store. | The point is that index recomputation is not the bottleneck at this population — data movement is, which is why the processing tab separates the three paths.` })} />
        ); })()}

        {(() => { const col = 'text-cyan-400'; return (
          <KPICard icon={<IcoLink />} label="Integration Surface" value="10" unit=" systems" color={col}
            subValues={[{ label: 'Primary', value: 'GDH' }, { label: 'Protocols', value: '5' }]}
            onClick={() => showKPIDetail({ icon: <IcoLink />, label: 'Integration Surface', value: '10', unit: 'systems', color: col, thresholds: { green: 10, amber: 5 }, inverted: false, definition: 'Source systems the platform integrates with, per the RFQ integration matrix. The Grid Data Hub is the primary and preferred path; direct connections are used only where GDH cannot supply the data, and that list is confirmed at Blueprinting.', subValues: [{ label: 'Via GDH', value: 'SAP PM/PS/FICO, CYME, Wrench' }, { label: 'Direct or CSV', value: 'SAP MM, GIS, MDM, SAP ISU' }, { label: 'Database', value: 'ADMS (MSSQL), SCADA (Mongo/Cassandra)' }, { label: 'Protocols', value: 'REST · SOAP · ODBC · SFTP · MQ' }], target: 'Every source reachable without displacing a TPCL system', analysis: 'Vendor neutrality is the architectural commitment here: S!aP Konnect reads from these systems and writes back only to SAP PM. | Nothing in the TPCL estate is replaced or re-licensed. | The Integration Console demonstrates the ingest, mapping, error and reconciliation behaviour against labelled simulators.' })} />
        ); })()}
      </div>

      <Tabs
        tabs={[
          { key: 'architecture', label: 'Architecture · A.1 · A.2' },
          { key: 'stack', label: 'Technology Stack · A.3' },
          { key: 'cloud', label: 'Cloud & Availability · A.4 · A.5' },
          { key: 'scale', label: 'Scale & Processing · A.6 · A.7' },
          { key: 'api', label: 'API Framework · A.8' },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'architecture' && (
        <ArchitectureTab activeLayer={activeLayer} setActiveLayer={setActiveLayer} />
      )}
      {tab === 'stack' && <StackTab />}
      {tab === 'cloud' && <CloudTab availability={availability} />}
      {tab === 'scale' && <ScaleTab capacity={capacity} />}
      {tab === 'api' && <ApiTab />}
    </div>
  );
}

/* ═══ 6. ARCHITECTURE — A.1, A.2 ══════════════════════════════════════════ */

function ArchitectureTab({ activeLayer, setActiveLayer }) {
  return (
    <div className="space-y-4">
      <Panel
        title="Solution architecture" checkpoints="A.1 · A.2"
        sub="Data moves upward. Click a layer to see what sits in it and who owns it."
      >
        <div className="space-y-2">
          {[...LAYERS].reverse().map((layer) => {
            const open = activeLayer === layer.key;
            return (
              <div key={layer.key}>
                <button
                  type="button"
                  className="w-full text-left rounded-lg px-3.5 py-2.5 transition-colors"
                  style={{
                    background: open ? `${layer.tint}22` : 'var(--app-surface-soft)',
                    border: `1px solid ${open ? layer.tint : 'var(--app-border)'}`,
                    borderLeft: `3px solid ${layer.tint}`,
                  }}
                  onClick={() => setActiveLayer(open ? null : layer.key)}
                >
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <span className="text-[12px] font-bold" style={{ color: 'var(--app-text)' }}>
                      {layer.label}
                    </span>
                    <span className="text-[10px]" style={{ color: 'var(--app-text-faint)' }}>
                      {layer.note}
                    </span>
                  </div>
                </button>

                {open && (
                  <div className="grid gap-2 mt-2 mb-1 pl-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))' }}>
                    {layer.nodes.map((n) => (
                      <div
                        key={n.name}
                        className="rounded-lg px-3 py-2"
                        style={{
                          background: 'var(--app-panel)',
                          border: `1px solid ${n.primary ? layer.tint : 'var(--app-border)'}`,
                        }}
                      >
                        <p className="text-[11px] font-semibold" style={{ color: n.primary ? layer.tint : 'var(--app-text)' }}>
                          {n.name}
                        </p>
                        <p className="text-[9.5px] mt-0.5 leading-relaxed" style={{ color: 'var(--app-text-faint)' }}>
                          {n.detail}
                        </p>
                      </div>
                    ))}
                  </div>
                )}

                {layer.key !== 'sources' && (
                  <div className="flex justify-center py-0.5">
                    <svg width="14" height="12" viewBox="0 0 14 12" style={{ opacity: 0.4 }}>
                      <path d="M7 12V2M3 6l4-4 4 4" fill="none" stroke="var(--app-text-faint)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Panel>

      <div className="grid gap-4" style={{ gridTemplateColumns: 'minmax(360px, 1fr) minmax(360px, 1fr)' }}>
        <Panel
          title="Both modules, one platform" checkpoints="A.2"
          sub="Checkpoint A.2 asks for APM and AIP natively on the same platform — not two products with a shared login"
        >
          <p className="text-[10.5px] leading-relaxed mb-3" style={{ color: 'var(--app-text-muted)' }}>
            The test of "native" is not whether both appear in one navigation. It is whether a change on the APM side
            propagates into the AIP side without an export. It does, and you can see it happen:
          </p>
          <ol className="space-y-2 text-[10.5px] leading-relaxed" style={{ color: 'var(--app-text-muted)' }}>
            {[
              ['Health Workbench', 'Raise the DGA weighting on the transformer health model.'],
              ['Risk Cockpit', 'Every affected asset\'s PoF moves, because PoF reads AHI.'],
              ['Investment Planning', 'Candidate benefit-cost ratios re-rank, because benefit is recomputed risk.'],
              ['Reporting', 'Export the portfolio — the new ranking is in the file.'],
            ].map(([where, what], i) => (
              <li key={where} className="flex gap-2">
                <span
                  className="flex-shrink-0 rounded-full flex items-center justify-center mono"
                  style={{ width: 16, height: 16, fontSize: 9, background: 'var(--app-info-bg)', color: 'var(--app-info)', border: '1px solid var(--app-info-border)' }}
                >
                  {i + 1}
                </span>
                <span>
                  <strong style={{ color: 'var(--app-text)' }}>{where}</strong> — {what}
                </span>
              </li>
            ))}
          </ol>
          <p className="text-[10px] mt-3 leading-relaxed" style={{ color: 'var(--app-text-faint)' }}>
            One store, one set of engines, four screens reading them. Nothing is exported between modules because there
            is nothing to export between.
          </p>
        </Panel>

        <Panel
          title="Why two layers" checkpoints="A.1 · A.2"
          sub="The COTS mandate and the AIP requirement pull in different directions"
        >
          <table className="apm-table">
            <thead>
              <tr><th>Requirement</th><th>Satisfied by</th></tr>
            </thead>
            <tbody>
              {[
                ['COTS product, not bespoke build', 'AVEVA APM — condition monitoring, physics degradation, FMECA/RCM library'],
                ['Pre-built asset templates by make/model', 'AVEVA Asset Strategy Library'],
                ['Configurable AHI/ACI/ARI without vendor code', 'S!aP ML & AI Central — Glass Box models'],
                ['AIP: investment value, optimisation, ARR', 'S!aP ML & AI Central + S!aP BPM'],
                ['Vendor-neutral integration with GDH and SAP', 'S!aP Konnect'],
                ['Role-based dashboards and reporting', 'S!aP Viz'],
                ['Conversational advisory with traceable rationale', 'S!aP Agentic (S!a)'],
              ].map(([req, by]) => (
                <tr key={req}>
                  <td style={{ color: 'var(--app-text)' }}>{req}</td>
                  <td className="text-[10px]">{by}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-[10px] mt-3 leading-relaxed" style={{ color: 'var(--app-text-faint)' }}>
            A packaged APM product alone does not deliver investment optimisation, tariff modelling or regulatory packs;
            a bespoke build alone does not satisfy the COTS mandate. The split is deliberate, and each layer is priced
            separately in the commercial schedule so TPCL can see exactly what each one costs.
          </p>
        </Panel>
      </div>

      <SimulatedNote>
        This screen documents the proposed architecture — it is a design, presented as a design. What is
        <strong> running in front of you</strong> is the S!aP overlay's analytical and workflow behaviour: the index
        engines, the optimiser, the integration simulators, the RBAC boundary and the reporting layer. The AVEVA APM
        engine, the Grid Data Hub and the TPCL cloud tenancy are not part of this demonstration build and are not
        represented as being connected.
      </SimulatedNote>
    </div>
  );
}

/* ═══ 7. TECHNOLOGY STACK — A.3 ═══════════════════════════════════════════ */

function StackTab() {
  return (
    <div className="space-y-4">
      <Panel
        title="Component and dependency map" checkpoints="A.3"
        sub="Every layer, what provides it, and what it depends on — including the dependencies that are TPCL's to supply"
        bodyClass="p-0"
      >
        <table className="apm-table">
          <thead>
            <tr><th>Layer</th><th>Components</th><th>Depends on</th><th>Supplied by</th></tr>
          </thead>
          <tbody>
            {STACK.map((r) => (
              <tr key={r.layer}>
                <td style={{ color: 'var(--app-text)', fontWeight: 600 }}>{r.layer}</td>
                <td className="text-[10.5px]">{r.components}</td>
                <td className="text-[10px]" style={{ color: 'var(--app-text-faint)' }}>{r.deps}</td>
                <td>
                  <span
                    className="apm-pill"
                    style={{
                      background: r.ours ? 'var(--app-info-bg)' : 'var(--app-surface-soft)',
                      color: r.ours ? 'var(--app-info)' : 'var(--app-text-faint)',
                      border: `1px solid ${r.ours ? 'var(--app-info-border)' : 'var(--app-border)'}`,
                    }}
                  >
                    {r.ours ? 'Astrikos' : 'Third party / TPCL'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <div className="grid gap-4" style={{ gridTemplateColumns: 'minmax(340px, 1fr) minmax(340px, 1fr)' }}>
        <Panel title="Standards alignment" checkpoints="A.3" sub="Named in the proposal and traceable to where each one shows up in the build">
          <table className="apm-table">
            <thead><tr><th>Standard</th><th>Applies to</th><th>Where</th></tr></thead>
            <tbody>
              {[
                ['ISO 55001', 'Asset management system', 'AHI/ACI/ARI framing, investment governance'],
                ['ISO 31000', 'Risk management', 'ARI = PoF × CoF, risk banding'],
                ['IEC 60300-3-11', 'Reliability-centred maintenance', 'RCM strategy selection'],
                ['ISO 14224', 'Reliability & maintenance data', 'Failure mode taxonomy, Weibull parameters'],
                ['IEC 62508', 'Dependability engineering', 'Consequence modelling'],
                ['ISO 13374 / 17359', 'Condition monitoring', 'Parameter scoring, alarm thresholds'],
                ['IEC 62506', 'Accelerated testing', 'Degradation-rate calibration'],
                ['IEC CIM', 'Lifecycle data representation', 'Asset hierarchy and attributes'],
                ['IEC 60156', 'Oil breakdown voltage', 'Oil quality parameter scoring'],
                ['ISO/IEC 27001', 'Information security', 'Security posture, audit trail, encryption'],
              ].map(([std, applies, where]) => (
                <tr key={std}>
                  <td className="mono" style={{ color: 'var(--app-info)' }}>{std}</td>
                  <td className="text-[10px]">{applies}</td>
                  <td className="text-[10px]" style={{ color: 'var(--app-text-faint)' }}>{where}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>

        <Panel title="What this build actually runs on" checkpoints="A.3" sub="The demonstration stack, stated plainly">
          <table className="apm-table">
            <tbody>
              {[
                ['Client', 'React 18 single-page application'],
                ['Charting', 'Chart.js 4'],
                ['Mapping', 'Leaflet with OpenStreetMap tiles'],
                ['Index engines', 'Plain JavaScript modules — no library, no service call'],
                ['Demo API', 'Node.js, zero external dependencies'],
                ['Persistence', 'JSON document store on disk'],
                ['Identity', 'Header-based role selection (demo affordance)'],
                ['Hosting', 'Static server, bound to the local network'],
              ].map(([k, v]) => (
                <tr key={k}>
                  <td>{k}</td>
                  <td style={{ color: 'var(--app-text)' }}>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-[10px] mt-3 leading-relaxed" style={{ color: 'var(--app-text-faint)' }}>
            The demonstration stack is deliberately dependency-light so it runs from a copied folder on a locked-down
            laptop with no internet. It is not the delivery stack, and nothing on this page claims it is — the delivery
            architecture is the table above.
          </p>
        </Panel>
      </div>
    </div>
  );
}

/* ═══ 8. CLOUD & HIGH AVAILABILITY — A.4, A.5 ════════════════════════════ */

function CloudTab({ availability }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4" style={{ gridTemplateColumns: 'minmax(360px, 1.1fr) minmax(340px, 1fr)' }}>
        <Panel
          title="Deployment topology" checkpoints="A.4"
          sub="SaaS on TPCL's own cloud tenancy, on the same VNet as the Grid Data Hub"
        >
          <div className="space-y-2">
            {[
              { zone: 'TPCL Cloud Subscription (Azure / AWS), India region', tint: '#22c55e', items: ['Grid Data Hub (TPCL-owned)', 'APM/AIP VNet — peered, private'] },
              { zone: 'Public subnet — ingress only', tint: '#0ea5e9', items: ['Application gateway / WAF', 'TLS 1.2/1.3 termination', 'Rate limiting, IP allow-list'] },
              { zone: 'Private subnet — application', tint: '#8b5cf6', items: ['S!aP Viz / BPM / Agentic containers', 'AVEVA APM engine', 'S!aP ML & AI Central workers'] },
              { zone: 'Private subnet — data', tint: '#f59e0b', items: ['S!aP Datalake (time series + relational)', 'Object store for documents and exports', 'No route to the internet'] },
              { zone: 'Management plane', tint: '#64748b', items: ['Log forwarding to Microsoft Sentinel', 'Backup vault, PITR snapshots', 'Key vault — customer-managed keys'] },
            ].map((z) => (
              <div key={z.zone} className="rounded-lg px-3 py-2.5" style={{ background: 'var(--app-surface-soft)', border: '1px solid var(--app-border)', borderLeft: `3px solid ${z.tint}` }}>
                <p className="text-[11px] font-bold" style={{ color: 'var(--app-text)' }}>{z.zone}</p>
                <ul className="mt-1 space-y-0.5">
                  {z.items.map((i) => (
                    <li key={i} className="text-[10px] flex gap-1.5" style={{ color: 'var(--app-text-faint)' }}>
                      <span style={{ color: z.tint }}>·</span>{i}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <p className="text-[10px] mt-3 leading-relaxed" style={{ color: 'var(--app-text-muted)' }}>
            All data and processing stay within India. TPCL owns the subscription, the data and the encryption keys —
            on contract expiry there is no data to repatriate because it never left TPCL&apos;s tenancy.
          </p>
        </Panel>

        <div className="space-y-4">
          <Panel title="Availability arithmetic" checkpoints="A.5" sub="What 99.5% actually permits, stated in minutes">
            <div className="apm-formula mb-3">
              Allowance <span className="op">=</span> 43,200 min/month <span className="op">×</span>
              {' '}<span className="val">(1 − {availability.pct}%)</span> <span className="op">=</span>
              {' '}<span className="res">{availability.allowedDownMins.toFixed(0)} min / month</span>
            </div>
            <table className="apm-table">
              <tbody>
                {[
                  ['Monthly availability target', `${availability.pct}%`],
                  ['Permitted unplanned outage', `${availability.allowedDownMins.toFixed(0)} min / month`],
                  ['Equivalent per year', `${(availability.allowedDownYearMins / 60).toFixed(1)} hours`],
                  ['Agreed maintenance window', `${availability.monthlyWindowMins} min / month, excluded`],
                  ['Recovery Point Objective', `${availability.rpo} minutes`],
                  ['Recovery Time Objective', `${availability.rto} minutes`],
                ].map(([k, v]) => (
                  <tr key={k}>
                    <td>{k}</td>
                    <td className="num" style={{ color: 'var(--app-text)', fontWeight: 600 }}>{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>

          <Panel title="Performance SLA" checkpoints="A.5" sub="RFQ §7 response-time targets" bodyClass="p-0">
            <table className="apm-table">
              <thead><tr><th>Operation</th><th className="num">Target</th></tr></thead>
              <tbody>
                {[
                  ['Login', `≤ ${SLA_TARGETS.loginSec} s`],
                  ['Dashboard load', `≤ ${SLA_TARGETS.dashboardSec} s`],
                  ['Asset search', `≤ ${SLA_TARGETS.searchSec} s`],
                  ['Standard report generation', `≤ ${SLA_TARGETS.reportSec} s`],
                  ['API response', `≤ ${SLA_TARGETS.apiSec} s`],
                ].map(([k, v]) => (
                  <tr key={k}><td>{k}</td><td className="num">{v}</td></tr>
                ))}
              </tbody>
            </table>
          </Panel>
        </div>
      </div>

      <Panel
        title="Redundancy by tier" checkpoints="A.5"
        sub="What fails, and what happens when it does"
        bodyClass="p-0"
      >
        <table className="apm-table">
          <thead>
            <tr><th>Tier</th><th>Redundancy mechanism</th><th>Failure mode</th><th>Recovery</th></tr>
          </thead>
          <tbody>
            {HA_LAYERS.map((r) => (
              <tr key={r.tier}>
                <td style={{ color: 'var(--app-text)', fontWeight: 600 }}>{r.tier}</td>
                <td className="text-[10.5px]">{r.mechanism}</td>
                <td className="text-[10px]" style={{ color: 'var(--app-warning)' }}>{r.failure}</td>
                <td className="text-[10px]">{r.recovery}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <SimulatedNote>
        High availability is a design commitment, and this screen presents it as one. No failover is demonstrated here
        — a bid room is not where you prove a region failover, and a bidder who claims to have just shown you one is
        showing you an animation. What is verifiable at this stage is the design, the arithmetic and the contractual
        target; the proof points are the DR test plan and the DR test report, both of which are named deliverables.
      </SimulatedNote>
    </div>
  );
}

/* ═══ 9. SCALE & PROCESSING — A.6, A.7 ═══════════════════════════════════ */

function ScaleTab({ capacity }) {
  return (
    <div className="space-y-4">
      <Panel
        title="Data processing framework" checkpoints="A.7"
        sub="Three paths with different latency envelopes — the RFQ asks for real-time and batch, and they are not the same pipeline"
        bodyClass="p-0"
      >
        <table className="apm-table">
          <thead>
            <tr><th>Path</th><th className="num">Latency</th><th>Mechanism</th><th>Carries</th><th>Drives</th></tr>
          </thead>
          <tbody>
            {PROCESSING_PATHS.map((r) => (
              <tr key={r.path}>
                <td style={{ color: 'var(--app-text)', fontWeight: 600 }}>{r.path}</td>
                <td className="num" style={{ color: 'var(--app-info)' }}>{r.latency}</td>
                <td className="text-[10px]">{r.mechanism}</td>
                <td className="text-[10px]" style={{ color: 'var(--app-text-faint)' }}>{r.volume}</td>
                <td className="text-[10px]">{r.drives}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <div className="grid gap-4" style={{ gridTemplateColumns: 'minmax(360px, 1fr) minmax(340px, 1fr)' }}>
        <Panel title="Capacity model" checkpoints="A.6" sub="Derived from RFQ §3.7 — check the arithmetic against your own copy">
          <table className="apm-table">
            <tbody>
              {[
                ['Assets in published population', fmtInt(capacity.totalAssets), 'Sum of every §3.7 asset class'],
                ['Initial data load', `${fmtInt(capacity.initialGB)} GB`, 'One-time migration at go-live'],
                ['Daily incremental', `${capacity.dailyGB} GB`, 'Sustained arrival rate'],
                ['Annual growth', `${fmtInt(capacity.yearlyGB)} GB`, 'Daily × 365'],
                ['Gross over 5-year AMC', `${fmtInt(capacity.fiveYearGB)} GB`, 'Initial + 5 years of increment'],
                ['Hot working set', `${fmtInt(capacity.workingSetGB)} GB`, 'One-year retention; remainder archived'],
                ['Implied record rate', `${capacity.recordsPerSec.toFixed(0)} /s`, 'At an assumed 2 KB per reading'],
                ['Index recompute, full population', `${capacity.fullPopulationMs.toFixed(0)} ms`, `Extrapolated from ${capacity.perAssetUs.toFixed(1)} µs/asset measured here`],
              ].map(([k, v, note]) => (
                <tr key={k}>
                  <td>{k}</td>
                  <td className="num" style={{ color: 'var(--app-text)', fontWeight: 700 }}>{v}</td>
                  <td className="text-[10px]" style={{ color: 'var(--app-text-faint)' }}>{note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>

        <Panel title="Scaling mechanism" checkpoints="A.6" sub="Horizontal where it matters, vertical where it does not">
          <div className="space-y-2.5">
            {[
              ['Ingestion — horizontal', 'Queue partitions and stateless adapter replicas. Doubling the GDH export rate is a replica-count change, not a redesign.', 'Auto-scales on queue depth'],
              ['Analytics — horizontal', 'Index computation is embarrassingly parallel: each asset scores independently. Workers scale on job backlog.', 'Auto-scales on backlog age'],
              ['Application — horizontal', 'Stateless containers behind the load balancer. Session state lives in the token, not the node.', 'Auto-scales on CPU and request latency'],
              ['Datalake — vertical then partitioned', 'Time-series data partitions by asset and window; the relational core scales vertically first because it is small.', 'Manual, reviewed quarterly'],
              ['Optimiser — vertical', 'Portfolio optimisation is a single-pass greedy knapsack over a few thousand candidates. It does not need a cluster.', 'Fixed allocation'],
            ].map(([title, body, trigger]) => (
              <div key={title} className="rounded-lg px-3 py-2" style={{ background: 'var(--app-surface-soft)', border: '1px solid var(--app-border)' }}>
                <div className="flex items-baseline justify-between gap-2 flex-wrap">
                  <span className="text-[11px] font-bold" style={{ color: 'var(--app-text)' }}>{title}</span>
                  <span className="text-[9px]" style={{ color: 'var(--app-info)' }}>{trigger}</span>
                </div>
                <p className="text-[10px] mt-1 leading-relaxed" style={{ color: 'var(--app-text-muted)' }}>{body}</p>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <SimulatedNote>
        The per-asset compute figure is a genuine measurement taken in this browser on this dataset a moment ago, and
        the full-population projection is that measurement multiplied out — so it is honest about what it is, and it is
        a lower bound on server-side performance rather than a marketing number. The storage and throughput figures are
        arithmetic on the RFQ&apos;s own published volumetrics. The 2 KB record-size assumption is the one input that is
        ours rather than TPCL&apos;s, and it is stated on the card so it can be challenged and corrected at Blueprinting.
      </SimulatedNote>
    </div>
  );
}

/* ═══ 10. API FRAMEWORK — A.8 ════════════════════════════════════════════ */

function ApiTab() {
  /* The endpoints below are the ones this demonstration build actually serves.
     Listing anything else here would be describing an API, not showing one. */
  const ENDPOINTS = [
    { method: 'GET', path: '/api/health', purpose: 'Liveness and store location', auth: 'None' },
    { method: 'GET', path: '/api/config/:kind', purpose: 'List configuration objects of a kind', auth: 'Any role' },
    { method: 'POST', path: '/api/config/:kind', purpose: 'Create a configuration object', auth: 'config.write' },
    { method: 'PATCH', path: '/api/config/:kind/:id', purpose: 'Update in place', auth: 'config.write' },
    { method: 'DELETE', path: '/api/config/:kind/:id', purpose: 'Remove', auth: 'config.write' },
    { method: 'GET', path: '/api/audit-log', purpose: 'Compliance audit trail', auth: 'audit.read' },
    { method: 'POST', path: '/api/audit-log', purpose: 'Record an auditable action', auth: 'Any write role' },
    { method: 'GET', path: '/api/users', purpose: 'User register', auth: 'Any role' },
    { method: 'POST', path: '/api/users', purpose: 'Provision a user', auth: 'user.admin' },
    { method: 'GET', path: '/api/integration/catalogue', purpose: 'Interface catalogue with field mappings', auth: 'Any role' },
    { method: 'POST', path: '/api/integration/:system/ingest', purpose: 'Run an ingest with validation', auth: 'integration.run' },
    { method: 'POST', path: '/api/integration/sap_pm/work-order', purpose: 'Push a work order, BAPI-shaped', auth: 'workorder.raise' },
    { method: 'GET', path: '/api/integration/log', purpose: 'Rolling interface call record', auth: 'Any role' },
    { method: 'GET', path: '/api/tickets', purpose: 'Service desk queue', auth: 'Any role' },
    { method: 'POST', path: '/api/tickets', purpose: 'Raise an incident', auth: 'incident.write' },
    { method: 'PATCH', path: '/api/tickets/:id', purpose: 'Transition status', auth: 'incident.write' },
    { method: 'GET', path: '/api/patches', purpose: 'Release and patch history', auth: 'Any role' },
    { method: 'GET', path: '/api/knowledge-transfer', purpose: 'Training delivery record', auth: 'Any role' },
    { method: 'POST', path: '/api/admin/reset', purpose: 'Restore the demo store to seed', auth: 'admin' },
  ];

  const methodColour = (m) => ({
    GET: 'var(--app-info)', POST: 'var(--app-success)',
    PATCH: 'var(--app-warning)', DELETE: 'var(--app-danger)',
  }[m] || 'var(--app-text-faint)');

  return (
    <div className="space-y-4">
      <div className="grid gap-4" style={{ gridTemplateColumns: 'minmax(400px, 1.3fr) minmax(320px, 1fr)' }}>
        <Panel
          title="Live API surface" checkpoints="A.8"
          sub={`Every endpoint this build serves, at ${API_BASE}. Not a specification — this is what is answering right now.`}
          bodyClass="p-0"
        >
          <div className="apm-scroll" style={{ maxHeight: 440 }}>
            <table className="apm-table">
              <thead>
                <tr><th>Method</th><th>Path</th><th>Purpose</th><th>Authorisation</th></tr>
              </thead>
              <tbody>
                {ENDPOINTS.map((e) => (
                  <tr key={e.method + e.path}>
                    <td>
                      <span className="mono text-[10px] font-bold" style={{ color: methodColour(e.method) }}>
                        {e.method}
                      </span>
                    </td>
                    <td className="mono text-[10.5px]" style={{ color: 'var(--app-text)' }}>{e.path}</td>
                    <td className="text-[10px]">{e.purpose}</td>
                    <td className="mono text-[9.5px]" style={{ color: 'var(--app-text-faint)' }}>{e.auth}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <div className="space-y-4">
          <Panel title="API design commitments" checkpoints="A.8">
            <ul className="space-y-2 text-[10.5px] leading-relaxed" style={{ color: 'var(--app-text-muted)' }}>
              {[
                ['Documented catalogue', 'Endpoints, request/response schema, authentication, error codes, sample payloads and version history — a named deliverable under RFQ §6.'],
                ['Versioned', 'Breaking changes ship behind a new version; the previous version stays available for an agreed deprecation window.'],
                ['Authorised per call', 'Every write checks the caller\'s role server-side. The UI hiding a control is not the access control — this is.'],
                ['Errors that say what went wrong', 'A rejected record comes back with the field, the value and the rule it failed. Try the SAP MM ingest on the Integration Console.'],
                ['Open formats', 'JSON over REST for interactive calls; XML and CSV accepted on the file-based paths; SOAP and ODBC supported by S!aP Konnect.'],
              ].map(([k, v]) => (
                <li key={k}>
                  <strong style={{ color: 'var(--app-text)' }}>{k}.</strong> {v}
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title="Try it" checkpoints="A.8" sub="The API is reachable from any terminal on this network">
            <div
              className="rounded-lg px-3 py-2.5 mono text-[10px] leading-relaxed"
              style={{ background: 'var(--app-bg)', border: '1px solid var(--app-border)', color: 'var(--app-text-muted)', overflowX: 'auto' }}
            >
              <div style={{ color: 'var(--app-text-faint)' }}># Liveness</div>
              <div>curl {API_BASE}/api/health</div>
              <div className="mt-2" style={{ color: 'var(--app-text-faint)' }}># A read-only role attempting a write — expect 403</div>
              <div>curl -X POST {API_BASE}/api/config/reports \</div>
              <div>&nbsp;&nbsp;-H &apos;X-Demo-Role: auditor&apos; -d &apos;{'{'}&quot;name&quot;:&quot;x&quot;{'}'}&apos;</div>
              <div className="mt-2" style={{ color: 'var(--app-text-faint)' }}># An ingest with real validation — expect rejections</div>
              <div>curl -X POST {API_BASE}/api/integration/sap_mm/ingest \</div>
              <div>&nbsp;&nbsp;-H &apos;X-Demo-Role: planner&apos; -d &apos;{'{'}&quot;records&quot;:20{'}'}&apos;</div>
            </div>
            <p className="text-[10px] mt-2.5 leading-relaxed" style={{ color: 'var(--app-text-faint)' }}>
              An evaluator who wants to check that the RBAC boundary is real rather than cosmetic can do it from their
              own laptop in one command, without going through this interface at all.
            </p>
          </Panel>
        </div>
      </div>
    </div>
  );
}
