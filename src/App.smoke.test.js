/* Runtime smoke test — renders every screen and asserts the numbers that the
   demo run sheet depends on actually reach the DOM.

   Charts and the map are mocked: jsdom has no canvas or layout engine, and
   neither carries logic worth testing. Everything else renders for real,
   through the real engines and the real dataset. */

import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

jest.mock('react-chartjs-2', () => ({
  Line: () => <div data-testid="chart-line" />,
  Bar: () => <div data-testid="chart-bar" />,
  Doughnut: () => <div data-testid="chart-doughnut" />,
}));

jest.mock('react-leaflet', () => ({
  MapContainer: ({ children }) => <div data-testid="map">{children}</div>,
  TileLayer: () => null,
  CircleMarker: ({ children }) => <div>{children}</div>,
  Popup: ({ children }) => <div>{children}</div>,
  Circle: () => null,
  LayerGroup: ({ children }) => <div>{children}</div>,
}));

import { ApmProvider } from './services/apmStore';
import { RoleProvider } from './services/roleContext';
import { SocketProvider } from './services/socket';
import Layout from './components/Layout';
import CommandCentre from './pages/CommandCentre';
import AssetRegistry from './pages/AssetRegistry';
import HealthWorkbench from './pages/HealthWorkbench';
import RiskCockpit from './pages/RiskCockpit';
import InvestmentPlanning from './pages/InvestmentPlanning';
import NetworkMap from './pages/NetworkMap';

/* Provider order mirrors App.js exactly. Screens read role from context to
   decide what they may write, so a wrapper that omits RoleProvider tests a
   composition the app never renders. */
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

describe('APM/AIP demo screens', () => {
  test('Command Centre renders fleet aggregates', () => {
    wrap(<CommandCentre />);
    expect(screen.getByText('Command Centre')).toBeInTheDocument();
    expect(screen.getByText('Mean Fleet Health Index')).toBeInTheDocument();
    expect(screen.getByText(/6,149 assets scored/)).toBeInTheDocument();
    // Risk register renders and is populated
    expect(screen.getByText('Highest-risk assets')).toBeInTheDocument();
    expect(screen.getAllByText(/^(TR|TX|CB|RMU)-/).length).toBeGreaterThan(5);
  });

  test('Asset Registry renders the hierarchy chain', () => {
    wrap(<AssetRegistry />);
    expect(screen.getByText('Asset Registry')).toBeInTheDocument();
    // Transformer -> Bay -> Feeder -> RMU -> Consumer (Checkpoint B.1)
    ['Substation', 'Transformer', 'Bay', 'Feeder', 'RMU', 'Consumer'].forEach((t) => {
      expect(screen.getAllByText(t).length).toBeGreaterThan(0);
    });
    expect(screen.getByText('Bulk Upload')).toBeInTheDocument();
  });

  test('Health Workbench shows the hero AHI and its dominant deduction', () => {
    wrap(<HealthWorkbench />);
    expect(screen.getAllByText(/TR-DSS-014/).length).toBeGreaterThan(0);
    expect(screen.getByText('62.8')).toBeInTheDocument();        // computed AHI
    expect(screen.getByText('DGA')).toBeInTheDocument();          // top deduction
    expect(screen.getByText(/Acetylene/)).toBeInTheDocument();    // anomaly story
  });

  test('editing a health weight moves the score — Checkpoint C.7', () => {
    wrap(<HealthWorkbench />);
    expect(screen.getByText('62.8')).toBeInTheDocument();

    const dga = screen.getByLabelText('Dissolved Gas Analysis weight');
    fireEvent.change(dga, { target: { value: '0.45' } });

    // Score must change, and the UI must flag the model as edited
    expect(screen.queryByText('62.8')).not.toBeInTheDocument();
    expect(screen.getByText('60.6')).toBeInTheDocument();
    expect(screen.getByText('Recomputed from edited model')).toBeInTheDocument();
  });

  test('criticality tab separates two assets of identical health — Checkpoint D.2', () => {
    wrap(<HealthWorkbench />);
    fireEvent.click(screen.getByText(/Criticality · Section D/));

    expect(screen.getAllByText(/Bandra RS — Transformer 1/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Mulund CSS 22 — Transformer 1/).length).toBeGreaterThan(0);
    // Identical health, separated criticality
    expect(screen.getAllByText('62.8').length).toBe(2);
    expect(screen.getByText('94')).toBeInTheDocument();
    expect(screen.getByText('28')).toBeInTheDocument();
  });

  test('predictive tab produces a bounded RUL with confidence — Section F', () => {
    wrap(<HealthWorkbench />);
    fireEvent.click(screen.getByText(/Predictive & XAI · Section F/));
    expect(screen.getByText('7.4')).toBeInTheDocument();     // RUL years
    expect(screen.getByText('93%')).toBeInTheDocument();     // confidence
    // Confidence band must be present and bracket the point estimate
    const band = screen.getByText((_, el) =>
      /^Range\s+\d+\.\d\s+–\s+\d+\.\d\s+years$/.test((el?.textContent || '').trim())
    );
    const [lo, hi] = (band.textContent.match(/\d+\.\d/g) || []).map(Number);
    expect(lo).toBeLessThan(7.4);
    expect(hi).toBeGreaterThan(7.4);
  });

  test('Risk Cockpit shows ARI = PoF x CoF with the working visible', () => {
    wrap(<RiskCockpit />);
    expect(screen.getByText('Risk Cockpit')).toBeInTheDocument();
    expect(screen.getByText(/Risk calculation — TR-DSS-014/)).toBeInTheDocument();
    expect(screen.getByText('5.47%')).toBeInTheDocument();          // PoF term
    expect(screen.getAllByText('₹16.03 Cr').length).toBeGreaterThan(0); // CoF term
    expect(screen.getByText('₹0.88 Cr per year')).toBeInTheDocument(); // product
    // Weibull inputs must be on screen, not just the answer
    expect(screen.getByText('Shape parameter β')).toBeInTheDocument();
    expect(screen.getByText('Characteristic life η')).toBeInTheDocument();
  });

  test('Investment Planning optimises against the derived budget', () => {
    wrap(<InvestmentPlanning />);
    expect(screen.getByText('Investment Planning')).toBeInTheDocument();
    expect(screen.getAllByText('₹130 Cr').length).toBeGreaterThan(0); // derived FY27 budget
    expect(
      within(screen.getAllByText('Projects Funded')[0].closest('.kpi-card')).getByText('270')
    ).toBeInTheDocument();
  });

  test('cutting the budget 20% defers projects — Checkpoint J.2', () => {
    wrap(<InvestmentPlanning />);
    // 'Projects funded' also labels a row in the comparison table on the
    // Scenario tab, so always scope to the first match: the stat tile.
    const fundedTile = () => screen.getAllByText('Projects Funded')[0].closest('.kpi-card');
    expect(within(fundedTile()).getByText('270')).toBeInTheDocument();

    fireEvent.click(screen.getByText(/Scenario Lab · Section J/));
    fireEvent.click(screen.getByText('Budget reduced 20%'));

    // Funded count falls, budget follows the scenario
    expect(within(fundedTile()).queryByText('270')).not.toBeInTheDocument();
    expect(within(fundedTile()).getByText('209')).toBeInTheDocument();
    expect(screen.getAllByText('₹104 Cr').length).toBeGreaterThan(0);
  });

  test('Regulatory tab derives an ARR, tariff and wheeling impact — Section K', () => {
    wrap(<InvestmentPlanning />);
    fireEvent.click(screen.getByText(/Regulatory & ARR · Section K/));
    expect(screen.getByText('Total ARR impact')).toBeInTheDocument();
    // Both the tariff formula and the wheeling formula (Checkpoint K.3) end in paise/kWh
    expect(screen.getAllByText(/paise \/ kWh/).length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText(/Wheeling impact/).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Export Justification Pack')).toBeInTheDocument();
  });

  /* ── KPI drill-down: the template's KPICard -> KPIDetailModal pairing ── */
  test('KPI cards open the shared detail modal — Command Centre', () => {
    wrap(<CommandCentre />);
    const card = screen.getAllByText('Mean Fleet Health Index')[0].closest('.kpi-card');
    fireEvent.click(within(card).getByText('VIEW DETAILS'));

    // Modal chrome from the template component
    expect(screen.getByText('Definition')).toBeInTheDocument();
    expect(screen.getByText('YTD Avg')).toBeInTheDocument();
    expect(screen.getByText('30-Day Avg')).toBeInTheDocument();
    expect(screen.getAllByText('Mean Fleet Health Index').length).toBeGreaterThan(1);
  });

  test('KPI cards open the shared detail modal — Investment Planning', () => {
    wrap(<InvestmentPlanning />);
    const card = screen.getAllByText('Risk Retired')[0].closest('.kpi-card');
    fireEvent.click(within(card).getByText('VIEW DETAILS'));
    expect(screen.getByText('Definition')).toBeInTheDocument();
    expect(screen.getByText('Target')).toBeInTheDocument();
  });

  test('Network Map renders plotted assets', () => {
    wrap(<NetworkMap />);
    expect(screen.getByTestId('map')).toBeInTheDocument();
    expect(screen.getByText('Network Map')).toBeInTheDocument();
    expect(screen.getByText('Assets plotted')).toBeInTheDocument();
  });

  test('Layout navigation exposes both APM and AIP in one shell', () => {
    wrap(
      <Layout user={{ fullName: 'Test' }} theme="dark" onThemeToggle={() => {}}>
        <CommandCentre />
      </Layout>
    );
    // Checkpoint A.2 — both modules reachable from a single navigation
    expect(screen.getByText('Asset Performance')).toBeInTheDocument();
    expect(screen.getAllByText(/Investment/).length).toBeGreaterThan(0);
    expect(screen.getByText('Health Workbench')).toBeInTheDocument();
    expect(screen.getByText('Risk Cockpit')).toBeInTheDocument();
  });
});
