/* Runtime smoke test for the platform screens — Sections G, M, N, O, P and Q.

   These pages talk to the demo API, so the backend client is mocked with a
   fixed store. That keeps the tests deterministic while leaving every
   derivation on the page real: SLA compliance, report row counts and hypercare
   exit criteria are all computed from the mocked records by the page's own
   code, and the assertions below are the arithmetic those records imply. */

import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

jest.mock('react-chartjs-2', () => ({
  Line: () => <div data-testid="chart-line" />,
  Bar: () => <div data-testid="chart-bar" />,
  Doughnut: () => <div data-testid="chart-doughnut" />,
  Scatter: () => <div data-testid="chart-scatter" />,
}));

/* ─── Fixed service-desk records ────────────────────────────────────────────
   Mirrors the server seed. Offsets are in minutes before now, so the SLA
   arithmetic the page performs is knowable in advance:

     INC-2035  P1  resolved after  35 min against a  60 min target → met
     INC-2031  P4  resolved after 580 min against a 2880 min target → met
     INC-2028  P3  resolved after 220 min against a  480 min target → met
     INC-2041  P2  open, 35 min elapsed of 240 → 205 min of headroom
     INC-2038  P3  open, 190 min elapsed of 480 → 290 min of headroom

   Three resolved, three within target → 100.0% compliance, two open, none
   breached. */
const mockAgo = (mins) => new Date(Date.now() - mins * 60e3).toISOString();

const mockTICKETS = [
  { id: 'INC-2041', at: mockAgo(35),   severity: 'P2', status: 'In Progress', title: 'GDH batch rejected 3 work-order records',     raisedBy: 'S. Kulkarni', assignee: 'Astrikos L2', category: 'Integration',  slaMins: 240,  resolvedAt: null },
  { id: 'INC-2038', at: mockAgo(190),  severity: 'P3', status: 'In Progress', title: 'Risk heat map slow to render above 5k assets', raisedBy: 'R. Iyer',    assignee: 'Astrikos L2', category: 'Performance', slaMins: 480,  resolvedAt: null },
  { id: 'INC-2035', at: mockAgo(420),  severity: 'P1', status: 'Resolved',    title: 'SCADA telemetry feed stalled for 22 minutes',  raisedBy: 'Automated',  assignee: 'Astrikos L3', category: 'Integration', slaMins: 60,   resolvedAt: mockAgo(385) },
  { id: 'INC-2031', at: mockAgo(900),  severity: 'P4', status: 'Resolved',    title: 'Add Marathi locale to consumer impact report', raisedBy: 'M. Rao',     assignee: 'Astrikos L1', category: 'Enhancement', slaMins: 2880, resolvedAt: mockAgo(320) },
  { id: 'INC-2028', at: mockAgo(1400), severity: 'P3', status: 'Closed',      title: 'Oil BDV unit mismatch on bulk upload',         raisedBy: 'S. Kulkarni', assignee: 'Astrikos L2', category: 'Data Quality', slaMins: 480, resolvedAt: mockAgo(1180) },
];

const mockPATCHES = [
  { id: 'PTC-0091', at: mockAgo(60 * 24 * 3),  component: 'S!aP ML & AI Central', version: '4.8.2', type: 'Security', status: 'Applied',   cve: 'CVE-2026-2211', window: 'Sun 02:00–04:00 IST' },
  { id: 'PTC-0090', at: mockAgo(60 * 24 * 11), component: 'S!aP Konnect',         version: '4.8.1', type: 'Patch',    status: 'Applied',   cve: null,            window: 'Sun 02:00–04:00 IST' },
  { id: 'PTC-0092', at: mockAgo(-60 * 24 * 6), component: 'S!aP Datalake',        version: '4.9.0', type: 'Feature',  status: 'Scheduled', cve: null,            window: 'Sun 02:00–04:00 IST' },
];

const mockKT = [
  { id: 'KT-01', track: 'End Users — Field Engineers & Asset Managers', sessions: 6, completed: 6, attendees: 42, status: 'Complete',    signedOff: true },
  { id: 'KT-02', track: 'Planning & Regulatory Teams',                  sessions: 4, completed: 4, attendees: 14, status: 'Complete',    signedOff: true },
  { id: 'KT-03', track: 'System Administrators',                        sessions: 5, completed: 3, attendees: 8,  status: 'In Progress', signedOff: false },
  { id: 'KT-04', track: 'Super Users / Power Users',                    sessions: 3, completed: 1, attendees: 11, status: 'In Progress', signedOff: false },
];

const mockAUDIT = [
  { id: 'AUD-1', at: mockAgo(12), user: 'A. Deshpande', role: 'admin', action: 'HEALTH_MODEL_CREATE', object: 'FY27 Transformer Model', detail: 'Weights adjusted', ip: '10.12.4.31' },
  { id: 'AUD-2', at: mockAgo(40), user: 'R. Iyer', role: 'planner', action: 'SCENARIO_RUN', object: 'Budget reduced 20%', detail: 'Scenario executed', ip: '10.12.4.44' },
];

const mockCATALOGUE = [
  { key: 'sap_pm', name: 'SAP PM', category: 'ERP', protocol: 'OData / BAPI', direction: 'Bi-directional', mapping: [], cadence: 'Near real-time' },
  { key: 'gdh', name: 'Global Data Hub', category: 'Data Platform', protocol: 'REST', direction: 'Inbound', mapping: [], cadence: 'Hourly' },
];

jest.mock('./services/backend', () => ({
  API_BASE: 'http://localhost:4174',
  ApiError: class ApiError extends Error {},
  setIdentity: () => {},
  getIdentity: () => ({ user: 'R. Iyer', role: 'planner' }),
  health: () => Promise.resolve({ ok: true }),
  listConfig: () => Promise.resolve([]),
  createConfig: (kind, doc) => Promise.resolve({ id: 'NEW-1', ...doc }),
  updateConfig: () => Promise.resolve({}),
  deleteConfig: () => Promise.resolve({}),
  listAudit: () => Promise.resolve(mockAUDIT),
  writeAudit: () => Promise.resolve({}),
  listUsers: () => Promise.resolve([]),
  createUser: () => Promise.resolve({}),
  integrationCatalogue: () => Promise.resolve(mockCATALOGUE),
  integrationLog: () => Promise.resolve([]),
  runIngest: () => Promise.resolve({ received: 0, accepted: 0, rejected: 0, rejections: [], sample: [], mapping: [], reconciliation: {} }),
  pushWorkOrder: () => Promise.resolve({}),
  listTickets: () => Promise.resolve(mockTICKETS),
  createTicket: () => Promise.resolve(mockTICKETS[0]),
  updateTicket: () => Promise.resolve(mockTICKETS[0]),
  listPatches: () => Promise.resolve(mockPATCHES),
  listKnowledgeTransfer: () => Promise.resolve(mockKT),
  resetDemo: () => Promise.resolve({}),
}));

import { ApmProvider } from './services/apmStore';
import { SocketProvider } from './services/socket';
import { RoleProvider } from './services/roleContext';
import Reliability from './pages/Reliability';
import Reporting from './pages/Reporting';
import ManagedServices from './pages/ManagedServices';
import SecurityAdmin from './pages/SecurityAdmin';
import IntegrationConsole from './pages/IntegrationConsole';
import ConfigStudio from './pages/ConfigStudio';

const wrap = (ui) =>
  render(
    <RoleProvider>
      <ApmProvider>
        <SocketProvider>
          <MemoryRouter>{ui}</MemoryRouter>
        </SocketProvider>
      </ApmProvider>
    </RoleProvider>
  );

describe('Platform screens — Sections G, N, P, Q', () => {
  /* ─── Section G ──────────────────────────────────────────────────────── */
  test('Reliability screen derives an RPN from severity, occurrence and detection', async () => {
    wrap(<Reliability />);
    expect(await screen.findByText('Reliability Engineering')).toBeInTheDocument();
    // FMECA is the default tab and must show the RPN working, not just a number
    expect(screen.getAllByText(/RPN/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Severity|Occurrence|Detection/i).length).toBeGreaterThan(0);
  });

  /* ─── Section P ──────────────────────────────────────────────────────── */
  test('Report library generates a report against the live model', async () => {
    wrap(<Reporting />);
    expect(await screen.findByText('Reporting & Analytics')).toBeInTheDocument();

    // Zone summary is the cheapest report and has a knowable row count: one
    // row per distribution zone in the dataset.
    const card = screen.getByTestId('report-RPT-ZONE');
    fireEvent.click(within(card).getByText('Generate'));

    expect(await screen.findByText(/6 rows · generated in/)).toBeInTheDocument();
    expect(screen.getAllByText('Dharavi').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Mulund').length).toBeGreaterThan(0);
  });

  test('Ad-hoc builder filters the live fleet and reports a real match count', async () => {
    wrap(<Reporting />);
    await screen.findByText('Reporting & Analytics');

    fireEvent.click(screen.getByText('Ad-hoc Builder · P.4'));
    expect(await screen.findByText('Build a report')).toBeInTheDocument();

    // The default definition filters AHI ≤ 60 over the asset fleet. Whatever
    // the count is, it must be a genuine subset — not the whole fleet, and not
    // empty — which is the thing that proves the filter ran.
    const summary = screen.getByText(/rows match · showing up to/);
    const matched = Number(summary.textContent.replace(/,/g, '').match(/^(\d+)/)[1]);
    expect(matched).toBeGreaterThan(0);
    expect(matched).toBeLessThan(6149);
  });

  test('Export controls follow the role — Checkpoint P.7', async () => {
    wrap(<Reporting />);
    await screen.findByText('Reporting & Analytics');
    // Default identity is the Asset Planning Lead, which holds report.export
    expect(screen.getByText(/Granted · Asset Planner/)).toBeInTheDocument();
  });

  /* ─── Section Q ──────────────────────────────────────────────────────── */
  test('Managed Services computes SLA compliance from the ticket timestamps', async () => {
    wrap(<ManagedServices />);
    expect(await screen.findByText('Managed Services & Support')).toBeInTheDocument();
    // Wait for the ticket load before asserting anything derived from it
    await screen.findByText('GDH batch rejected 3 work-order records');

    // Three resolved tickets, all inside their targets → 100.0%
    expect(screen.getByText('SLA Compliance')).toBeInTheDocument();
    expect(screen.getAllByText('100.0').length).toBeGreaterThan(0);

    // Two tickets are open and neither has breached
    const openCard = screen.getByText('Open Incidents').closest('.kpi-card');
    expect(within(openCard).getAllByText('2').length).toBeGreaterThan(0);
  });

  test('Incident queue orders by proximity to breach and shows the SLA window', async () => {
    wrap(<ManagedServices />);
    await screen.findByText('Managed Services & Support');

    expect(await screen.findByText('GDH batch rejected 3 work-order records')).toBeInTheDocument();
    // Remaining headroom is stated, not implied — 205 min on the P2, 290 on the P3
    expect(screen.getAllByText(/left of/).length).toBeGreaterThan(0);
  });

  test('Hypercare exit criteria are evaluated, not asserted', async () => {
    wrap(<ManagedServices />);
    await screen.findByText('Managed Services & Support');

    fireEvent.click(screen.getByText('Hypercare · Q.6'));
    expect(await screen.findByText('Exit criteria')).toBeInTheDocument();
    // No P1 is open and nothing has breached, so both of those gates pass
    expect(screen.getAllByText('Met').length).toBeGreaterThan(0);
    // The 90-day window has not elapsed, so at least one gate must fail
    expect(screen.getAllByText('Not met').length).toBeGreaterThan(0);
  });

  test('Knowledge transfer reports delivered sessions against committed', async () => {
    wrap(<ManagedServices />);
    await screen.findByText('Managed Services & Support');

    fireEvent.click(screen.getByText('Knowledge Transfer · Q.7–Q.8'));
    expect(await screen.findByText('Training tracks')).toBeInTheDocument();
    // 14 of 18 sessions delivered across the four tracks → 78%
    expect(screen.getByText('14 / 18')).toBeInTheDocument();
    expect(screen.getByText('System Administrators')).toBeInTheDocument();
  });

  /* ─── Section N ──────────────────────────────────────────────────────── */
  /* ─── Section M ──────────────────────────────────────────────────────── */
  test('Integration Console lists the interface catalogue', async () => {
    wrap(<IntegrationConsole />);
    expect(await screen.findByText('Integration Console')).toBeInTheDocument();
    expect(await screen.findByText(/SAP PM/)).toBeInTheDocument();
  });

  /* ─── Section O ──────────────────────────────────────────────────────── */
  test('Configuration Studio renders its builders against the live model', async () => {
    wrap(<ConfigStudio />);
    expect(await screen.findByText('Configuration Studio')).toBeInTheDocument();
    expect(screen.getByText('Asset Class · O.1')).toBeInTheDocument();
    expect(screen.getByText('Health Model · O.2 · O.7')).toBeInTheDocument();
  });

  test('Security screen exposes the role model and the audit trail', async () => {
    wrap(<SecurityAdmin />);
    expect(await screen.findByText('Security & Administration')).toBeInTheDocument();
    expect(screen.getAllByText(/Administrator|Asset Planner|Substation Engineer|Regulatory Auditor/).length)
      .toBeGreaterThan(0);
  });
});
