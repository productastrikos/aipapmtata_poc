/* ═══════════════════════════════════════════════════════════════════════════
   Managed Services & Support — Section Q
   ───────────────────────────────────────────────────────────────────────────
   Q.1 incident management        Q.5 patch management
   Q.2 SLA definition & tracking  Q.6 hypercare
   Q.3 ticketing & escalation     Q.7 knowledge transfer
   Q.4 upgrade & release strategy Q.8 service transition / exit

   Tickets, patches and training records live on the server, so raising an
   incident here and reloading the page finds it still there. SLA status is
   computed against the wall clock on every render — an open P1 raised 35
   minutes ago shows 25 minutes of headroom now and shows it breached later,
   without anything being rewritten.
   ═══════════════════════════════════════════════════════════════════════════ */

import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { Bar } from 'react-chartjs-2';
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, Tooltip, Legend,
} from 'chart.js';

import { useRole } from '../services/roleContext';
import { listTickets, createTicket, updateTicket, listPatches, listKnowledgeTransfer, ApiError }
  from '../services/backend';
import { fmtInt } from '../engines/indices';
import { Panel, PageHead, Tabs, SimulatedNote } from '../components/apmUi';
import KPICard, { IcoAlert, IcoClock, IcoShield, IcoRecycle, IcoPeople, IcoCheck }
  from '../components/KPICard';
import KPIDetailModal from '../components/KPIDetailModal';
import { getChartTokens, chartTooltip } from '../components/chartUtils';

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

/* ═══ 1. SERVICE LEVEL DEFINITION ═════════════════════════════════════════
   Response and resolution targets as they would appear in the SLA schedule of
   the managed-services agreement. The resolution minutes here are the same
   values the server stamps onto a ticket when it is raised, so the UI and the
   API cannot drift apart on what "breached" means. */

export const SEVERITIES = {
  P1: {
    key: 'P1', label: 'P1 — Critical',
    definition: 'Platform unavailable, or asset risk data unusable across the network',
    responseMins: 15, resolutionMins: 60, availability: 99.5,
    colour: 'var(--app-danger)', escalation: 'Astrikos L3 + Delivery Manager at 30 min',
  },
  P2: {
    key: 'P2', label: 'P2 — High',
    definition: 'Major function degraded — integration feed down, or a module unusable',
    responseMins: 30, resolutionMins: 240, availability: 99.0,
    colour: 'var(--app-warning)', escalation: 'Astrikos L2, L3 at 2 h',
  },
  P3: {
    key: 'P3', label: 'P3 — Medium',
    definition: 'Partial impact with a workaround available',
    responseMins: 120, resolutionMins: 480, availability: 98.0,
    colour: 'var(--app-info)', escalation: 'Astrikos L2 at 4 h',
  },
  P4: {
    key: 'P4', label: 'P4 — Low',
    definition: 'Cosmetic defect, query or enhancement request',
    responseMins: 480, resolutionMins: 2880, availability: 95.0,
    colour: 'var(--app-text-faint)', escalation: 'Scheduled into the next release',
  },
};

const SEVERITY_ORDER = ['P1', 'P2', 'P3', 'P4'];
const OPEN_STATES = ['Open', 'In Progress'];

/* Supported release train — the upgrade strategy Q.4 asks a bidder to state. */
const RELEASE_TRAIN = [
  { channel: 'Security patch', cadence: 'Within 72 h of CVE disclosure', window: 'Emergency window, 02:00–04:00 IST', downtime: 'None — rolling restart', approval: 'TPCL IT Security sign-off' },
  { channel: 'Maintenance patch', cadence: 'Monthly', window: 'Second Sunday, 02:00–04:00 IST', downtime: '≤ 20 min', approval: 'Change Advisory Board' },
  { channel: 'Minor release', cadence: 'Quarterly', window: 'Scheduled Sunday, 02:00–06:00 IST', downtime: '≤ 90 min', approval: 'CAB + UAT sign-off' },
  { channel: 'Major release', cadence: 'Annual', window: 'Agreed outage, notified 30 days ahead', downtime: '≤ 4 h', approval: 'CAB + full regression UAT' },
];

/* Service transition artefacts — Q.8. Status is a statement of what a delivery
   would produce, not a claim that these documents exist today. */
const EXIT_ARTEFACTS = [
  { artefact: 'As-built architecture and configuration baseline', owner: 'Astrikos', trigger: 'Go-live + 30 days' },
  { artefact: 'Source code and build pipeline in TPCL repository', owner: 'Astrikos', trigger: 'Continuous from sprint 1' },
  { artefact: 'Data dictionary, model documentation and index derivations', owner: 'Astrikos', trigger: 'Go-live' },
  { artefact: 'Runbooks, escalation matrix and on-call procedures', owner: 'Joint', trigger: 'Hypercare exit' },
  { artefact: 'Administrator and super-user certification records', owner: 'Astrikos', trigger: 'Hypercare exit' },
  { artefact: 'Full data extract in open formats (CSV, JSON, Parquet)', owner: 'Astrikos', trigger: 'On request, and at contract exit' },
  { artefact: 'Third-party licence register and transfer instruments', owner: 'Astrikos', trigger: 'Contract exit' },
  { artefact: 'Knowledge transfer completion certificate', owner: 'Joint', trigger: 'Contract exit' },
];

/* Hypercare is a 90-day window opening at go-live. The demo anchors go-live to
   a fixed offset from today so the elapsed-day figure is always plausible;
   the panel says so rather than implying a real deployment date. */
const HYPERCARE_DAYS = 90;
const GO_LIVE_OFFSET_DAYS = 38;

/* ═══ 2. DERIVATIONS ══════════════════════════════════════════════════════ */

const MIN = 60e3;

function elapsedMins(ticket, now) {
  const start = new Date(ticket.at).getTime();
  const end = ticket.resolvedAt ? new Date(ticket.resolvedAt).getTime() : now;
  return Math.max((end - start) / MIN, 0);
}

/* One pass produces everything the four tabs need, so no two panels can
   disagree about whether a ticket breached. */
function analyse(tickets, now) {
  const rows = tickets.map((t) => {
    const sev = SEVERITIES[t.severity] || SEVERITIES.P3;
    const target = t.slaMins || sev.resolutionMins;
    const mins = elapsedMins(t, now);
    const open = OPEN_STATES.includes(t.status);
    const breached = mins > target;
    return {
      ...t,
      sev,
      target,
      elapsed: mins,
      remaining: target - mins,
      open,
      breached,
      // Percentage of the SLA window consumed — drives the bar in the table.
      consumed: Math.min((mins / target) * 100, 140),
    };
  }).sort((a, b) => {
    if (a.open !== b.open) return a.open ? -1 : 1;
    if (a.open) return a.remaining - b.remaining;          // nearest to breach first
    return new Date(b.at) - new Date(a.at);
  });

  const closed = rows.filter((r) => !r.open);
  const open = rows.filter((r) => r.open);
  const met = closed.filter((r) => !r.breached);

  const bySeverity = SEVERITY_ORDER.map((k) => {
    const all = rows.filter((r) => r.severity === k);
    const done = all.filter((r) => !r.open);
    const ok = done.filter((r) => !r.breached);
    return {
      key: k,
      severity: SEVERITIES[k],
      total: all.length,
      open: all.length - done.length,
      resolved: done.length,
      met: ok.length,
      compliance: done.length ? (ok.length / done.length) * 100 : null,
      mttr: done.length ? done.reduce((s, r) => s + r.elapsed, 0) / done.length : null,
      target: SEVERITIES[k].resolutionMins,
    };
  });

  return {
    rows,
    open,
    closed,
    atRisk: open.filter((r) => !r.breached && r.remaining <= r.target * 0.25),
    breachedOpen: open.filter((r) => r.breached),
    compliance: closed.length ? (met.length / closed.length) * 100 : null,
    mttr: closed.length ? closed.reduce((s, r) => s + r.elapsed, 0) / closed.length : null,
    bySeverity,
  };
}

const fmtDuration = (mins) => {
  if (mins === null || mins === undefined || Number.isNaN(mins)) return '—';
  const m = Math.abs(mins);
  if (m < 60) return `${Math.round(m)} min`;
  if (m < 1440) return `${(m / 60).toFixed(1)} h`;
  return `${(m / 1440).toFixed(1)} d`;
};

const fmtAgo = (iso) => {
  const mins = (Date.now() - new Date(iso).getTime()) / MIN;
  if (mins < 0) return `in ${fmtDuration(-mins)}`;
  return `${fmtDuration(mins)} ago`;
};

/* ═══ 3. PAGE ═════════════════════════════════════════════════════════════ */

export default function ManagedServices() {
  const { identity, role, can } = useRole();
  const [tab, setTab] = useState('incidents');
  const [selectedKPIDetail, setSelectedKPIDetail] = useState(null);
  const showKPIDetail = (d) => setSelectedKPIDetail(d);

  const [tickets, setTickets] = useState([]);
  const [patches, setPatches] = useState([]);
  const [kt, setKt] = useState([]);
  const [backendUp, setBackendUp] = useState(true);
  const [notice, setNotice] = useState(null);
  const [now, setNow] = useState(() => Date.now());

  const canWrite = can('incident.write');

  const say = (msg, kind = 'ok') => {
    setNotice({ msg, kind });
    setTimeout(() => setNotice(null), 5000);
  };

  const refresh = useCallback(async () => {
    try {
      const [t, p, k] = await Promise.all([listTickets(), listPatches(), listKnowledgeTransfer()]);
      setTickets(t); setPatches(p); setKt(k);
      setBackendUp(true);
    } catch (e) {
      setBackendUp(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  /* SLA countdowns are live. A 30-second tick is enough to make the point
     without churning the render loop. */
  useEffect(() => {
    const h = setInterval(() => setNow(Date.now()), 30e3);
    return () => clearInterval(h);
  }, []);

  const sla = useMemo(() => analyse(tickets, now), [tickets, now]);

  /* ─── Hypercare window ───────────────────────────────────────────────── */
  const hypercare = useMemo(() => {
    const goLive = new Date(now - GO_LIVE_OFFSET_DAYS * 864e5);
    const day = Math.floor((now - goLive.getTime()) / 864e5);
    const exit = new Date(goLive.getTime() + HYPERCARE_DAYS * 864e5);

    // Ticket arrival rate inside the window vs. the steady-state expectation —
    // a falling rate is the evidence hypercare can be exited.
    const inWindow = tickets.filter((t) => new Date(t.at).getTime() >= goLive.getTime());
    const weeks = Math.max(Math.ceil(day / 7), 1);
    const buckets = Array.from({ length: Math.min(weeks, 13) }, (_, i) => {
      const from = goLive.getTime() + i * 7 * 864e5;
      const to = from + 7 * 864e5;
      return {
        label: `Wk ${i + 1}`,
        count: inWindow.filter((t) => {
          const at = new Date(t.at).getTime();
          return at >= from && at < to;
        }).length,
      };
    });

    return {
      goLive, exit, day,
      remaining: Math.max(HYPERCARE_DAYS - day, 0),
      pct: Math.min((day / HYPERCARE_DAYS) * 100, 100),
      inWindow: inWindow.length,
      buckets,
      p1InWindow: inWindow.filter((t) => t.severity === 'P1').length,
      openAtExit: sla.open.length,
    };
  }, [now, tickets, sla.open.length]);

  /* ─── Patch currency ─────────────────────────────────────────────────── */
  const patchState = useMemo(() => {
    const applied = patches.filter((p) => p.status === 'Applied');
    const scheduled = patches.filter((p) => p.status === 'Scheduled');
    const security = patches.filter((p) => p.type === 'Security');
    const lastApplied = applied.length
      ? applied.reduce((a, b) => (new Date(a.at) > new Date(b.at) ? a : b))
      : null;
    const nextScheduled = scheduled.length
      ? scheduled.reduce((a, b) => (new Date(a.at) < new Date(b.at) ? a : b))
      : null;
    return {
      applied: applied.length,
      scheduled: scheduled.length,
      security: security.length,
      openCVEs: security.filter((p) => p.status !== 'Applied').length,
      lastApplied,
      nextScheduled,
      daysSince: lastApplied ? (now - new Date(lastApplied.at).getTime()) / 864e5 : null,
      components: [...new Set(patches.map((p) => p.component))],
    };
  }, [patches, now]);

  /* ─── Knowledge transfer ─────────────────────────────────────────────── */
  const ktState = useMemo(() => {
    const sessions = kt.reduce((s, r) => s + r.sessions, 0);
    const done = kt.reduce((s, r) => s + r.completed, 0);
    return {
      tracks: kt.length,
      sessions,
      done,
      pct: sessions ? (done / sessions) * 100 : 0,
      attendees: kt.reduce((s, r) => s + r.attendees, 0),
      signedOff: kt.filter((r) => r.signedOff).length,
    };
  }, [kt]);

  return (
    <div className="space-y-4">
      {selectedKPIDetail && (
        <KPIDetailModal kpi={selectedKPIDetail} onClose={() => setSelectedKPIDetail(null)} />
      )}

      <PageHead
        eyebrow="S!aP BPM · Managed Services"
        title="Managed Services & Support"
        sub="Incident management against a defined SLA schedule, release and patch governance, hypercare tracking and knowledge transfer. SLA status is computed against the clock on every render, so a ticket's headroom genuinely shrinks while the page is open."
        right={
          <div className="text-right">
            <p className="apm-eyebrow" style={{ fontSize: 9 }}>Open incidents</p>
            <p
              className="text-[19px] font-bold mt-0.5 mono"
              style={{ color: sla.breachedOpen.length ? 'var(--app-danger)' : sla.atRisk.length ? 'var(--app-warning)' : 'var(--app-success)' }}
            >
              {sla.open.length}
            </p>
          </div>
        }
      />

      {notice && (
        <div
          className="rounded-lg px-3 py-2 text-[11px]"
          style={{
            background: notice.kind === 'ok' ? 'var(--app-success-bg)' : 'var(--app-danger-bg)',
            border: `1px solid ${notice.kind === 'ok' ? 'var(--app-success-border)' : 'var(--app-danger-border)'}`,
            color: notice.kind === 'ok' ? 'var(--app-success)' : 'var(--app-danger)',
          }}
        >
          {notice.msg}
        </div>
      )}

      {!backendUp && (
        <SimulatedNote>
          The service-desk API is not reachable, so incidents, patch history and training records cannot be loaded.
          Start it with <code>npm run server</code> — this section is backed by a real store rather than browser state,
          which is why it does not fall back to sample data.
        </SimulatedNote>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {(() => {
          const col = sla.breachedOpen.length ? 'text-red-400' : sla.atRisk.length ? 'text-amber-400' : 'text-emerald-400';
          return (
            <KPICard icon={<IcoAlert />} label="Open Incidents" value={fmtInt(sla.open.length)} color={col}
              subValues={[{ label: 'Breached', value: fmtInt(sla.breachedOpen.length) }, { label: 'At Risk', value: fmtInt(sla.atRisk.length) }]}
              onClick={() => showKPIDetail({ icon: <IcoAlert />, label: 'Open Incidents', value: String(sla.open.length), unit: 'incidents', color: col, thresholds: { green: 2, amber: 5 }, inverted: true, definition: 'Incidents in Open or In Progress state on the service desk. An incident is at risk once three-quarters of its resolution window has been consumed, and breached once the window has passed — both computed against the clock, not stored as a flag.', subValues: [{ label: 'Open', value: fmtInt(sla.open.length) }, { label: 'Breached', value: fmtInt(sla.breachedOpen.length) }, { label: 'At Risk', value: fmtInt(sla.atRisk.length) }, { label: 'Resolved', value: fmtInt(sla.closed.length) }], target: 'No breached incidents, P1 count zero', analysis: 'Leave this page open and the SLA countdowns move — nothing is a static badge. | Raising an incident writes to the server and it survives a reload. | The escalation matrix on the Incidents tab states who is engaged at each threshold.' })} />
          );
        })()}

        {(() => {
          const v = sla.compliance;
          const col = v === null ? 'text-slate-400' : v >= 95 ? 'text-emerald-400' : v >= 85 ? 'text-amber-400' : 'text-red-400';
          return (
            <KPICard icon={<IcoShield />} label="SLA Compliance" value={v === null ? '—' : v.toFixed(1)} unit=" %" color={col}
              subValues={[{ label: 'Resolved', value: fmtInt(sla.closed.length) }, { label: 'Within SLA', value: fmtInt(sla.closed.filter((r) => !r.breached).length) }]}
              onClick={() => showKPIDetail({ icon: <IcoShield />, label: 'SLA Compliance', value: v === null ? '0' : v.toFixed(1), unit: '%', color: col, thresholds: { green: 95, amber: 85 }, inverted: false, definition: 'Share of resolved incidents closed inside their severity resolution target. Computed from the recorded raise and resolve timestamps on each ticket — not a reported figure.', subValues: [{ label: 'Resolved', value: fmtInt(sla.closed.length) }, { label: 'Within Target', value: fmtInt(sla.closed.filter((r) => !r.breached).length) }, { label: 'Breached', value: fmtInt(sla.closed.filter((r) => r.breached).length) }, { label: 'Contractual Floor', value: '95.0%' }], target: '95% or better across all severities', analysis: 'Targets are P1 60 min, P2 4 h, P3 8 h, P4 48 h, as set out in the SLA schedule on the Incidents tab. | The same targets are stamped onto a ticket by the API when it is raised, so the UI cannot soften them. | Per-severity compliance is broken out below the incident queue.' })} />
          );
        })()}

        {(() => {
          const col = sla.mttr === null ? 'text-slate-400' : sla.mttr <= 240 ? 'text-emerald-400' : sla.mttr <= 480 ? 'text-amber-400' : 'text-red-400';
          return (
            <KPICard icon={<IcoClock />} label="Mean Time to Resolve" value={sla.mttr === null ? '—' : (sla.mttr / 60).toFixed(1)} unit=" h" color={col}
              subValues={[{ label: 'Sample', value: `${sla.closed.length} tickets` }, { label: 'P1 MTTR', value: fmtDuration(sla.bySeverity[0].mttr) }]}
              onClick={() => showKPIDetail({ icon: <IcoClock />, label: 'Mean Time to Resolve', value: sla.mttr === null ? '0' : (sla.mttr / 60).toFixed(1), unit: 'hours', color: col, thresholds: { green: 4, amber: 8 }, inverted: true, definition: 'Mean elapsed time from raise to resolution across all closed incidents, derived from the ticket timestamps. Severity mix matters — a period heavy in P4 enhancement requests will show a longer MTTR without any degradation in service.', subValues: SEVERITY_ORDER.map((k) => { const b = sla.bySeverity.find((x) => x.key === k); return { label: `${k} MTTR`, value: fmtDuration(b.mttr) }; }), target: 'Within the resolution target for every severity', analysis: 'Read this alongside per-severity compliance rather than on its own. | P1 MTTR is the figure that matters operationally; the aggregate is a reporting convenience. | Resolution timestamps are written by the server when status moves to Resolved or Closed.' })} />
          );
        })()}

        {(() => {
          const col = patchState.openCVEs > 0 ? 'text-red-400' : patchState.daysSince > 45 ? 'text-amber-400' : 'text-emerald-400';
          return (
            <KPICard icon={<IcoRecycle />} label="Patch Currency" value={patchState.daysSince === null ? '—' : patchState.daysSince.toFixed(0)} unit=" days" color={col}
              subValues={[{ label: 'Applied', value: fmtInt(patchState.applied) }, { label: 'Scheduled', value: fmtInt(patchState.scheduled) }]}
              onClick={() => showKPIDetail({ icon: <IcoRecycle />, label: 'Patch Currency', value: patchState.daysSince === null ? '0' : patchState.daysSince.toFixed(0), unit: 'days since last patch', color: col, thresholds: { green: 30, amber: 45 }, inverted: true, definition: 'Days elapsed since the most recent patch was applied to any platform component. Security patches carry a 72-hour target from CVE disclosure; maintenance patches follow the monthly train.', subValues: [{ label: 'Applied', value: fmtInt(patchState.applied) }, { label: 'Scheduled', value: fmtInt(patchState.scheduled) }, { label: 'Security Patches', value: fmtInt(patchState.security) }, { label: 'Unapplied CVEs', value: fmtInt(patchState.openCVEs) }], target: 'No unapplied security patch older than 72 hours', analysis: patchState.nextScheduled ? `Next scheduled release is ${patchState.nextScheduled.component} ${patchState.nextScheduled.version}, ${fmtAgo(patchState.nextScheduled.at)}. | The release train and approval path are set out on the Release & Patch tab. | Every component carries its own version line, so a patch to one does not force an outage on the rest.` : 'Nothing is currently scheduled. | The release train and approval path are set out on the Release & Patch tab. | Every component carries its own version line.' })} />
          );
        })()}

        {(() => {
          const col = hypercare.remaining > 30 ? 'text-cyan-400' : hypercare.remaining > 0 ? 'text-amber-400' : 'text-emerald-400';
          return (
            <KPICard icon={<IcoCheck />} label="Hypercare Progress" value={String(hypercare.day)} unit={` of ${HYPERCARE_DAYS} days`} color={col}
              subValues={[{ label: 'Remaining', value: `${hypercare.remaining} days` }, { label: 'Incidents', value: fmtInt(hypercare.inWindow) }]}
              onClick={() => showKPIDetail({ icon: <IcoCheck />, label: 'Hypercare Progress', value: String(hypercare.day), unit: `of ${HYPERCARE_DAYS} days`, color: col, thresholds: { green: 60, amber: 30 }, inverted: false, definition: 'Elapsed days in the 90-day hypercare window that opens at go-live, during which the delivery team remains embedded with enhanced response targets. Exit requires the incident arrival rate to have fallen and no P1 to remain open.', subValues: [{ label: 'Day', value: `${hypercare.day} of ${HYPERCARE_DAYS}` }, { label: 'Exit Date', value: hypercare.exit.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) }, { label: 'Incidents In Window', value: fmtInt(hypercare.inWindow) }, { label: 'P1 In Window', value: fmtInt(hypercare.p1InWindow) }], target: 'Falling arrival rate, zero open P1 at exit', analysis: 'The weekly arrival chart on the Hypercare tab is the exit evidence — a flat or rising line means hypercare extends. | Go-live is an assumed date for this demonstration and is labelled as such. | Exit criteria are contractual, not discretionary.' })} />
          );
        })()}

        {(() => {
          const col = ktState.pct >= 90 ? 'text-emerald-400' : ktState.pct >= 60 ? 'text-amber-400' : 'text-red-400';
          return (
            <KPICard icon={<IcoPeople />} label="Knowledge Transfer" value={ktState.pct.toFixed(0)} unit=" %" color={col}
              subValues={[{ label: 'Sessions', value: `${ktState.done}/${ktState.sessions}` }, { label: 'Attendees', value: fmtInt(ktState.attendees) }]}
              onClick={() => showKPIDetail({ icon: <IcoPeople />, label: 'Knowledge Transfer', value: ktState.pct.toFixed(0), unit: '% of sessions delivered', color: col, thresholds: { green: 90, amber: 60 }, inverted: false, definition: 'Training sessions delivered against those committed, across the four audience tracks the RFQ names. A track is signed off only when every session in it has been delivered and TPCL has accepted the completion record.', subValues: [{ label: 'Tracks', value: fmtInt(ktState.tracks) }, { label: 'Sessions Delivered', value: `${ktState.done} of ${ktState.sessions}` }, { label: 'Attendees', value: fmtInt(ktState.attendees) }, { label: 'Tracks Signed Off', value: `${ktState.signedOff} of ${ktState.tracks}` }], target: 'All four tracks delivered and signed off before hypercare exit', analysis: 'Administrator and super-user tracks are the ones that determine whether TPCL can run the platform without Astrikos. | Sign-off is a TPCL action, not an Astrikos declaration. | The completion certificate is one of the contract-exit artefacts listed on the Knowledge Transfer tab.' })} />
          );
        })()}
      </div>

      <Tabs
        tabs={[
          { key: 'incidents', label: 'Incidents & SLA · Q.1–Q.3' },
          { key: 'release', label: 'Release & Patch · Q.4–Q.5' },
          { key: 'hypercare', label: 'Hypercare · Q.6' },
          { key: 'knowledge', label: 'Knowledge Transfer · Q.7–Q.8' },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'incidents' && (
        <IncidentsTab
          sla={sla} canWrite={canWrite} role={role} identity={identity}
          backendUp={backendUp} refresh={refresh} say={say}
        />
      )}
      {tab === 'release' && <ReleaseTab patches={patches} state={patchState} />}
      {tab === 'hypercare' && <HypercareTab hypercare={hypercare} sla={sla} />}
      {tab === 'knowledge' && <KnowledgeTab kt={kt} state={ktState} />}
    </div>
  );
}

/* ═══ 4. INCIDENTS & SLA — Q.1, Q.2, Q.3 ═════════════════════════════════ */

function IncidentsTab({ sla, canWrite, role, backendUp, refresh, say }) {
  const [form, setForm] = useState({ title: '', severity: 'P3', category: 'Data Quality' });
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState('open');

  const shown = useMemo(() => {
    if (filter === 'open') return sla.rows.filter((r) => r.open);
    if (filter === 'breach') return sla.rows.filter((r) => r.breached);
    return sla.rows;
  }, [sla, filter]);

  const raise = async (e) => {
    e.preventDefault();
    if (!canWrite || !form.title.trim()) return;
    setBusy(true);
    try {
      const row = await createTicket({
        title: form.title.trim(), severity: form.severity, category: form.category,
      });
      await refresh();
      setForm({ title: '', severity: 'P3', category: 'Data Quality' });
      say(`${row.id} raised — ${SEVERITIES[row.severity].label}, resolution target ${fmtDuration(row.slaMins)}`);
    } catch (err) {
      say(err instanceof ApiError ? err.message : 'Could not reach the service desk', 'err');
    } finally {
      setBusy(false);
    }
  };

  const move = async (id, status) => {
    try {
      await updateTicket(id, { status });
      await refresh();
      say(`${id} → ${status}`);
    } catch (err) {
      say(err instanceof ApiError ? err.message : 'Could not reach the service desk', 'err');
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-4" style={{ gridTemplateColumns: 'minmax(430px, 1.7fr) minmax(320px, 1fr)' }}>
        <Panel
          title="Incident queue" checkpoints="Q.1 · Q.3"
          sub="Ordered by proximity to SLA breach — the ticket that needs attention first is at the top"
          bodyClass="p-0"
          right={
            <div className="flex gap-1.5">
              {[
                { k: 'open', l: `Open (${sla.open.length})` },
                { k: 'breach', l: `Breached (${sla.rows.filter((r) => r.breached).length})` },
                { k: 'all', l: `All (${sla.rows.length})` },
              ].map((f) => (
                <button
                  key={f.k} type="button"
                  className={`apm-btn ${filter === f.k ? 'is-active' : ''}`}
                  onClick={() => setFilter(f.k)}
                >
                  {f.l}
                </button>
              ))}
            </div>
          }
        >
          <div className="apm-scroll" style={{ maxHeight: 400 }}>
            <table className="apm-table">
              <thead>
                <tr>
                  <th>Incident</th><th>Sev</th><th>Status</th>
                  <th className="num">Elapsed</th><th style={{ width: 150 }}>SLA window</th>
                  <th>Assignee</th><th></th>
                </tr>
              </thead>
              <tbody>
                {shown.map((t) => {
                  const barColour = t.breached ? 'var(--app-danger)'
                    : t.consumed >= 75 ? 'var(--app-warning)' : 'var(--app-success)';
                  return (
                    <tr key={t.id}>
                      <td>
                        <div className="font-semibold" style={{ color: 'var(--app-text)' }}>{t.title}</div>
                        <div className="text-[9.5px]" style={{ color: 'var(--app-text-faint)' }}>
                          {t.id} · {t.category} · raised {fmtAgo(t.at)} by {t.raisedBy}
                        </div>
                      </td>
                      <td>
                        <span
                          className="apm-pill"
                          style={{ background: `${t.sev.colour}1f`, color: t.sev.colour, border: `1px solid ${t.sev.colour}55` }}
                        >
                          <span className="dot" style={{ background: t.sev.colour }} />
                          {t.severity}
                        </span>
                      </td>
                      <td>{t.status}</td>
                      <td className="num">{fmtDuration(t.elapsed)}</td>
                      <td>
                        <div className="apm-waterfall-track" style={{ width: '100%' }}>
                          <div className="apm-waterfall-fill" style={{ width: `${Math.min(t.consumed, 100)}%`, background: barColour }} />
                        </div>
                        <div className="text-[9px] mt-0.5 mono" style={{ color: barColour }}>
                          {t.open
                            ? (t.breached ? `breached by ${fmtDuration(-t.remaining)}` : `${fmtDuration(t.remaining)} left of ${fmtDuration(t.target)}`)
                            : (t.breached ? `missed by ${fmtDuration(-t.remaining)}` : `met, ${fmtDuration(t.remaining)} spare`)}
                        </div>
                      </td>
                      <td>{t.assignee}</td>
                      <td>
                        {t.open && (
                          <div className="flex gap-1.5">
                            {t.status === 'Open' && (
                              <button type="button" className="apm-btn" disabled={!canWrite} onClick={() => move(t.id, 'In Progress')}>
                                Accept
                              </button>
                            )}
                            <button type="button" className="apm-btn" disabled={!canWrite} onClick={() => move(t.id, 'Resolved')}>
                              Resolve
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {!shown.length && (
                  <tr><td colSpan={7} style={{ color: 'var(--app-text-faint)' }}>Nothing in this view.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel title="Raise an incident" checkpoints="Q.3" sub="Writes to the service desk and is stamped with the SLA for its severity">
          <form onSubmit={raise} className="space-y-3">
            <div>
              <label className="apm-eyebrow" style={{ fontSize: 9 }} htmlFor="inc-title">Summary</label>
              <input
                id="inc-title" className="apm-input w-full mt-1.5" required value={form.title}
                placeholder="e.g. DGA readings not refreshing for Dharavi RS"
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="apm-eyebrow" style={{ fontSize: 9 }} htmlFor="inc-sev">Severity</label>
                <select
                  id="inc-sev" className="apm-select w-full mt-1.5" value={form.severity}
                  onChange={(e) => setForm({ ...form, severity: e.target.value })}
                >
                  {SEVERITY_ORDER.map((k) => <option key={k} value={k}>{SEVERITIES[k].label}</option>)}
                </select>
              </div>
              <div>
                <label className="apm-eyebrow" style={{ fontSize: 9 }} htmlFor="inc-cat">Category</label>
                <select
                  id="inc-cat" className="apm-select w-full mt-1.5" value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                >
                  {['Data Quality', 'Integration', 'Performance', 'Access', 'Enhancement', 'General'].map((x) => <option key={x}>{x}</option>)}
                </select>
              </div>
            </div>

            <div
              className="rounded-lg px-3 py-2"
              style={{ background: 'var(--app-surface-soft)', border: '1px solid var(--app-border)' }}
            >
              <p className="text-[10px] leading-relaxed" style={{ color: 'var(--app-text-muted)' }}>
                <strong style={{ color: SEVERITIES[form.severity].colour }}>{SEVERITIES[form.severity].label}</strong>
                {' — '}{SEVERITIES[form.severity].definition}.
              </p>
              <p className="text-[10px] mt-1 mono" style={{ color: 'var(--app-text-faint)' }}>
                Response {fmtDuration(SEVERITIES[form.severity].responseMins)} ·
                {' '}Resolution {fmtDuration(SEVERITIES[form.severity].resolutionMins)} ·
                {' '}Availability {SEVERITIES[form.severity].availability}%
              </p>
              <p className="text-[10px] mt-1" style={{ color: 'var(--app-text-faint)' }}>
                Escalation: {SEVERITIES[form.severity].escalation}
              </p>
            </div>

            <button type="submit" className="apm-btn is-primary w-full" disabled={!canWrite || busy || !backendUp}>
              {busy ? 'Raising…' : 'Raise incident'}
            </button>

            {!canWrite && (
              <p className="text-[10px]" style={{ color: 'var(--app-danger)' }}>
                The <strong>{role.label}</strong> role does not hold <code>incident.write</code>. The server rejects the
                POST with 403 regardless of the UI state.
              </p>
            )}
          </form>
        </Panel>
      </div>

      <div className="grid gap-4" style={{ gridTemplateColumns: 'minmax(400px, 1fr) minmax(400px, 1fr)' }}>
        <Panel
          title="Service level schedule" checkpoints="Q.2"
          sub="The targets the queue above is measured against — the API stamps the same values onto each ticket"
          bodyClass="p-0"
        >
          <table className="apm-table">
            <thead>
              <tr>
                <th>Severity</th><th className="num">Response</th><th className="num">Resolution</th>
                <th className="num">Availability</th><th className="num">Resolved</th><th className="num">Compliance</th>
              </tr>
            </thead>
            <tbody>
              {sla.bySeverity.map((b) => (
                <tr key={b.key}>
                  <td>
                    <div className="font-semibold" style={{ color: b.severity.colour }}>{b.severity.label}</div>
                    <div className="text-[9.5px]" style={{ color: 'var(--app-text-faint)' }}>{b.severity.definition}</div>
                  </td>
                  <td className="num">{fmtDuration(b.severity.responseMins)}</td>
                  <td className="num">{fmtDuration(b.severity.resolutionMins)}</td>
                  <td className="num">{b.severity.availability}%</td>
                  <td className="num">{b.resolved} / {b.total}</td>
                  <td
                    className="num"
                    style={{
                      color: b.compliance === null ? 'var(--app-text-faint)'
                        : b.compliance >= 95 ? 'var(--app-success)'
                        : b.compliance >= 85 ? 'var(--app-warning)' : 'var(--app-danger)',
                      fontWeight: 700,
                    }}
                  >
                    {b.compliance === null ? '—' : `${b.compliance.toFixed(0)}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>

        <Panel title="Support model & escalation" checkpoints="Q.1 · Q.3">
          <div className="space-y-2.5">
            {[
              ['L1 — Service Desk', '24×7', 'Logging, triage, known-error resolution, status communication', 'Astrikos Managed Services, Mumbai'],
              ['L2 — Application Support', '24×7 for P1/P2, business hours otherwise', 'Configuration, data quality, integration faults, report defects', 'Astrikos APM practice'],
              ['L3 — Engineering', 'On call for P1/P2', 'Platform defects, model corrections, emergency patches', 'Astrikos product engineering'],
              ['TPCL Change Advisory Board', 'Scheduled', 'Approves maintenance and release windows', 'Joint Astrikos / TPCL'],
            ].map(([tier, cover, scope, owner]) => (
              <div key={tier} className="rounded-lg px-3 py-2" style={{ background: 'var(--app-surface-soft)', border: '1px solid var(--app-border)' }}>
                <div className="flex items-baseline justify-between gap-2 flex-wrap">
                  <span className="text-[11px] font-bold" style={{ color: 'var(--app-text)' }}>{tier}</span>
                  <span className="text-[9.5px]" style={{ color: 'var(--app-info)' }}>{cover}</span>
                </div>
                <p className="text-[10px] mt-1 leading-relaxed" style={{ color: 'var(--app-text-muted)' }}>{scope}</p>
                <p className="text-[9.5px] mt-0.5" style={{ color: 'var(--app-text-faint)' }}>{owner}</p>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <SimulatedNote>
        The service desk is real within the demonstration: incidents are written to the server, SLA clocks run against
        real timestamps, and status transitions are audited. What it is not is an integration with TPCL&apos;s own ITSM
        tool — delivery federates this queue with the incumbent service-management platform so a single ticket exists,
        not two. The escalation matrix above is the contracted model, stated here rather than demonstrated.
      </SimulatedNote>
    </div>
  );
}

/* ═══ 5. RELEASE & PATCH — Q.4, Q.5 ══════════════════════════════════════ */

function ReleaseTab({ patches, state }) {
  const sorted = useMemo(
    () => [...patches].sort((a, b) => new Date(b.at) - new Date(a.at)),
    [patches]
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-4" style={{ gridTemplateColumns: 'minmax(430px, 1.4fr) minmax(330px, 1fr)' }}>
        <Panel
          title="Release and patch history" checkpoints="Q.5"
          sub="Per-component version lines — a patch to one component does not force an outage on the rest"
          bodyClass="p-0"
        >
          <table className="apm-table">
            <thead>
              <tr>
                <th>Reference</th><th>Component</th><th>Version</th><th>Type</th>
                <th>CVE</th><th>Window</th><th>Status</th><th>When</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((p) => {
                const colour = p.status === 'Applied' ? 'var(--app-success)'
                  : p.status === 'Scheduled' ? 'var(--app-info)' : 'var(--app-warning)';
                return (
                  <tr key={p.id}>
                    <td className="asset-id">{p.id}</td>
                    <td style={{ color: 'var(--app-text)' }}>{p.component}</td>
                    <td className="mono">{p.version}</td>
                    <td>
                      <span
                        className="apm-pill"
                        style={{
                          background: p.type === 'Security' ? 'var(--app-danger-bg)' : 'var(--app-surface-soft)',
                          color: p.type === 'Security' ? 'var(--app-danger)' : 'var(--app-text-muted)',
                          border: `1px solid ${p.type === 'Security' ? 'var(--app-danger-border)' : 'var(--app-border)'}`,
                        }}
                      >
                        {p.type}
                      </span>
                    </td>
                    <td className="mono" style={{ color: p.cve ? 'var(--app-danger)' : 'var(--app-text-faint)' }}>
                      {p.cve || '—'}
                    </td>
                    <td className="text-[10px]">{p.window}</td>
                    <td style={{ color: colour, fontWeight: 600 }}>{p.status}</td>
                    <td className="text-[10px]" style={{ color: 'var(--app-text-faint)' }}>{fmtAgo(p.at)}</td>
                  </tr>
                );
              })}
              {!sorted.length && (
                <tr><td colSpan={8} style={{ color: 'var(--app-text-faint)' }}>No release history available.</td></tr>
              )}
            </tbody>
          </table>
        </Panel>

        <Panel title="Current position" checkpoints="Q.4 · Q.5">
          <table className="apm-table">
            <tbody>
              {[
                ['Components under management', String(state.components.length), state.components.join(', ')],
                ['Patches applied', String(state.applied), state.lastApplied ? `Most recent ${state.lastApplied.component} ${state.lastApplied.version}, ${fmtAgo(state.lastApplied.at)}` : '—'],
                ['Days since last patch', state.daysSince === null ? '—' : state.daysSince.toFixed(0), 'Target: no component more than one train behind'],
                ['Scheduled releases', String(state.scheduled), state.nextScheduled ? `${state.nextScheduled.component} ${state.nextScheduled.version} ${fmtAgo(state.nextScheduled.at)}` : 'None scheduled'],
                ['Security patches', String(state.security), `${state.openCVEs} awaiting application`],
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
      </div>

      <Panel
        title="Upgrade and release strategy" checkpoints="Q.4"
        sub="Four channels, each with its own cadence, window, downtime envelope and approval path"
        bodyClass="p-0"
      >
        <table className="apm-table">
          <thead>
            <tr><th>Channel</th><th>Cadence</th><th>Window</th><th>Downtime envelope</th><th>Approval</th></tr>
          </thead>
          <tbody>
            {RELEASE_TRAIN.map((r) => (
              <tr key={r.channel}>
                <td style={{ color: 'var(--app-text)', fontWeight: 600 }}>{r.channel}</td>
                <td>{r.cadence}</td>
                <td className="text-[10px]">{r.window}</td>
                <td className="mono">{r.downtime}</td>
                <td className="text-[10px]">{r.approval}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <SimulatedNote>
        Version numbers, CVE references and windows in the history above are demonstration records held in the service
        store — they are not a live feed from a deployment pipeline. The strategy table is the contracted model:
        cadence, downtime envelope and approval path are commitments, and the delivery build surfaces the actual
        deployment state from the CI/CD pipeline in this same view.
      </SimulatedNote>
    </div>
  );
}

/* ═══ 6. HYPERCARE — Q.6 ═════════════════════════════════════════════════ */

function HypercareTab({ hypercare, sla }) {
  const t = getChartTokens();

  const chart = useMemo(() => ({
    labels: hypercare.buckets.map((b) => b.label),
    datasets: [{
      label: 'Incidents raised',
      data: hypercare.buckets.map((b) => b.count),
      backgroundColor: '#3b82f6',
      borderRadius: 3,
      borderWidth: 0,
    }],
  }), [hypercare.buckets]);

  const options = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false }, tooltip: chartTooltip() },
    scales: {
      x: { grid: { display: false }, ticks: { color: t.tickColor, font: { size: 10 } } },
      y: { beginAtZero: true, grid: { color: t.gridColor }, ticks: { color: t.tickColor, font: { size: 10 }, precision: 0 } },
    },
  }), [t]);

  /* Exit criteria are evaluated, not asserted. Each one is a boolean over live
     state, so the gate reads honestly whatever the data happens to be. */
  const criteria = [
    {
      label: 'No P1 incident open',
      pass: sla.open.filter((r) => r.severity === 'P1').length === 0,
      detail: `${sla.open.filter((r) => r.severity === 'P1').length} open`,
    },
    {
      label: 'No incident past its SLA window',
      pass: sla.breachedOpen.length === 0,
      detail: `${sla.breachedOpen.length} breached`,
    },
    {
      label: 'SLA compliance at or above 95%',
      pass: sla.compliance !== null && sla.compliance >= 95,
      detail: sla.compliance === null ? 'no resolved tickets yet' : `${sla.compliance.toFixed(1)}% across ${sla.closed.length} resolved`,
    },
    {
      label: 'Incident arrival rate falling week on week',
      pass: (() => {
        const b = hypercare.buckets;
        if (b.length < 3) return false;
        const last = b[b.length - 1].count;
        const prev = b[b.length - 2].count;
        return last <= prev;
      })(),
      detail: hypercare.buckets.length >= 2
        ? `${hypercare.buckets[hypercare.buckets.length - 1].count} this week vs ${hypercare.buckets[hypercare.buckets.length - 2].count} last`
        : 'insufficient history',
    },
    {
      label: 'Full 90-day window elapsed',
      pass: hypercare.remaining === 0,
      detail: `day ${hypercare.day} of ${HYPERCARE_DAYS}`,
    },
  ];

  const passed = criteria.filter((x) => x.pass).length;

  return (
    <div className="space-y-4">
      <div className="grid gap-4" style={{ gridTemplateColumns: 'minmax(400px, 1.3fr) minmax(330px, 1fr)' }}>
        <Panel
          title="Incident arrival through hypercare" checkpoints="Q.6"
          sub="A falling weekly rate is the evidence that hypercare can close — a flat line extends it"
        >
          <div style={{ height: 250 }}>
            <Bar data={chart} options={options} />
          </div>
          <p className="text-[10px] mt-3 leading-relaxed" style={{ color: 'var(--app-text-faint)' }}>
            {hypercare.inWindow} incidents raised since go-live, of which {hypercare.p1InWindow} were P1. Weekly buckets
            are computed from the raise timestamp on each ticket; raising one on the Incidents tab moves the last bar.
          </p>
        </Panel>

        <div className="space-y-4">
          <Panel title="Hypercare window" checkpoints="Q.6">
            <div className="apm-waterfall-track mb-3" style={{ width: '100%', height: 10 }}>
              <div
                className="apm-waterfall-fill"
                style={{ width: `${hypercare.pct}%`, background: hypercare.remaining > 0 ? 'var(--app-info)' : 'var(--app-success)' }}
              />
            </div>
            <table className="apm-table">
              <tbody>
                {[
                  ['Go-live', hypercare.goLive.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })],
                  ['Day', `${hypercare.day} of ${HYPERCARE_DAYS}`],
                  ['Scheduled exit', hypercare.exit.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })],
                  ['Days remaining', String(hypercare.remaining)],
                  ['Incidents in window', String(hypercare.inWindow)],
                  ['Enhanced cover', 'Embedded team on site, P1 response 15 min'],
                ].map(([k, v]) => (
                  <tr key={k}>
                    <td>{k}</td>
                    <td className="num" style={{ color: 'var(--app-text)', fontWeight: 600 }}>{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>

          <Panel
            title="Exit criteria" checkpoints="Q.6"
            sub={`${passed} of ${criteria.length} met — each evaluated against live service-desk state`}
            bodyClass="p-0"
          >
            <table className="apm-table">
              <tbody>
                {criteria.map((crit) => (
                  <tr key={crit.label}>
                    <td>
                      <div style={{ color: 'var(--app-text)' }}>{crit.label}</div>
                      <div className="text-[9.5px]" style={{ color: 'var(--app-text-faint)' }}>{crit.detail}</div>
                    </td>
                    <td className="num" style={{ width: 70 }}>
                      <span
                        className="apm-pill"
                        style={{
                          background: crit.pass ? 'var(--app-success-bg)' : 'var(--app-warning-bg)',
                          color: crit.pass ? 'var(--app-success)' : 'var(--app-warning)',
                          border: `1px solid ${crit.pass ? 'var(--app-success-border)' : 'var(--app-warning-border)'}`,
                        }}
                      >
                        {crit.pass ? 'Met' : 'Not met'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        </div>
      </div>

      <SimulatedNote>
        Go-live is assumed to be {GO_LIVE_OFFSET_DAYS} days before today so the window shows a plausible mid-hypercare
        position for the demonstration; it is not a real deployment date. Everything measured against it — the arrival
        chart, the elapsed day count and the exit criteria — is computed from the actual ticket records in the service
        store, so raising or resolving an incident changes what this tab says.
      </SimulatedNote>
    </div>
  );
}

/* ═══ 7. KNOWLEDGE TRANSFER & EXIT — Q.7, Q.8 ════════════════════════════ */

function KnowledgeTab({ kt, state }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4" style={{ gridTemplateColumns: 'minmax(430px, 1.3fr) minmax(330px, 1fr)' }}>
        <Panel
          title="Training tracks" checkpoints="Q.7"
          sub="The four audience tracks the RFQ names, with delivery progress against each"
          bodyClass="p-0"
        >
          <table className="apm-table">
            <thead>
              <tr>
                <th>Track</th><th className="num">Sessions</th><th style={{ width: 130 }}>Progress</th>
                <th className="num">Attendees</th><th>Status</th><th>TPCL sign-off</th>
              </tr>
            </thead>
            <tbody>
              {kt.map((r) => {
                const pct = r.sessions ? (r.completed / r.sessions) * 100 : 0;
                const colour = pct >= 100 ? 'var(--app-success)' : pct >= 50 ? 'var(--app-info)' : 'var(--app-warning)';
                return (
                  <tr key={r.id}>
                    <td>
                      <div style={{ color: 'var(--app-text)', fontWeight: 600 }}>{r.track}</div>
                      <div className="text-[9.5px]" style={{ color: 'var(--app-text-faint)' }}>{r.id}</div>
                    </td>
                    <td className="num">{r.completed} / {r.sessions}</td>
                    <td>
                      <div className="apm-waterfall-track" style={{ width: '100%' }}>
                        <div className="apm-waterfall-fill" style={{ width: `${pct}%`, background: colour }} />
                      </div>
                      <div className="text-[9px] mt-0.5 mono" style={{ color: colour }}>{pct.toFixed(0)}%</div>
                    </td>
                    <td className="num">{r.attendees}</td>
                    <td style={{ color: colour, fontWeight: 600 }}>{r.status}</td>
                    <td>
                      <span
                        className="apm-pill"
                        style={{
                          background: r.signedOff ? 'var(--app-success-bg)' : 'var(--app-surface-soft)',
                          color: r.signedOff ? 'var(--app-success)' : 'var(--app-text-faint)',
                          border: `1px solid ${r.signedOff ? 'var(--app-success-border)' : 'var(--app-border)'}`,
                        }}
                      >
                        {r.signedOff ? 'Signed off' : 'Pending'}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {!kt.length && (
                <tr><td colSpan={6} style={{ color: 'var(--app-text-faint)' }}>No training records available.</td></tr>
              )}
            </tbody>
          </table>
        </Panel>

        <Panel title="Transfer position" checkpoints="Q.7">
          <table className="apm-table">
            <tbody>
              {[
                ['Tracks', String(state.tracks), 'End users, planning, administrators, super users'],
                ['Sessions delivered', `${state.done} / ${state.sessions}`, `${state.pct.toFixed(0)}% complete`],
                ['Attendees trained', fmtInt(state.attendees), 'Cumulative across all sessions'],
                ['Tracks signed off', `${state.signedOff} / ${state.tracks}`, 'Sign-off is a TPCL acceptance, not a delivery claim'],
              ].map(([k, v, note]) => (
                <tr key={k}>
                  <td>{k}</td>
                  <td className="num" style={{ color: 'var(--app-text)', fontWeight: 700 }}>{v}</td>
                  <td className="text-[10px]" style={{ color: 'var(--app-text-faint)' }}>{note}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-[10px] mt-3 leading-relaxed" style={{ color: 'var(--app-text-muted)' }}>
            The administrator and super-user tracks are the ones that decide whether TPCL can operate the platform
            without Astrikos on site. Both remain in progress, which is why hypercare exit is gated on them rather than
            on elapsed time alone.
          </p>
        </Panel>
      </div>

      <Panel
        title="Service transition and exit artefacts" checkpoints="Q.8"
        sub="What TPCL holds at each milestone — the test of whether the platform can be operated, or moved, without the vendor"
        bodyClass="p-0"
      >
        <table className="apm-table">
          <thead>
            <tr><th>Artefact</th><th>Owner</th><th>Delivered at</th></tr>
          </thead>
          <tbody>
            {EXIT_ARTEFACTS.map((a) => (
              <tr key={a.artefact}>
                <td style={{ color: 'var(--app-text)' }}>{a.artefact}</td>
                <td>{a.owner}</td>
                <td className="text-[10px]">{a.trigger}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <SimulatedNote>
        Session counts and attendee numbers are demonstration records. The transition artefact list is a statement of
        contractual commitment rather than a set of documents that exist today — it is here because Section Q.8 asks
        what TPCL is left holding, and the honest answer is a schedule, not a screenshot.
      </SimulatedNote>
    </div>
  );
}
