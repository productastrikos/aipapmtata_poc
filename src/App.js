import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { SocketProvider } from './services/socket';
import { ApmProvider } from './services/apmStore';
import { RoleProvider } from './services/roleContext';
import { Chart as ChartJS } from 'chart.js';

import Layout from './components/Layout';
import CommandCentre from './pages/CommandCentre';
import AssetRegistry from './pages/AssetRegistry';
import HealthWorkbench from './pages/HealthWorkbench';
import RiskCockpit from './pages/RiskCockpit';
import InvestmentPlanning from './pages/InvestmentPlanning';
import NetworkMap from './pages/NetworkMap';
import Reliability from './pages/Reliability';
import ModelGovernance from './pages/ModelGovernance';
import IntegrationConsole from './pages/IntegrationConsole';
import SecurityAdmin from './pages/SecurityAdmin';
import ConfigStudio from './pages/ConfigStudio';
import Reporting from './pages/Reporting';
import ManagedServices from './pages/ManagedServices';

// Global Chart.js defaults — ensure tooltips appear on hover for all charts
ChartJS.defaults.interaction.mode = 'index';
ChartJS.defaults.interaction.intersect = false;
ChartJS.defaults.plugins.tooltip.enabled = true;

const DEMO_USER = { fullName: 'Asset Planning Lead', role: 'planner' };

function App() {
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem('app_theme');
    if (saved === 'light' || saved === 'dark') return saved;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  });

  useEffect(() => {
    document.body.dataset.theme = theme;
    localStorage.setItem('app_theme', theme);
  }, [theme]);

  const handleThemeToggle = () => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));

  return (
    <RoleProvider>
      <ApmProvider>
        <SocketProvider>
          <Router>
            <Layout user={DEMO_USER} theme={theme} onThemeToggle={handleThemeToggle}>
              <Routes>
                <Route path="/"            element={<CommandCentre />} />
                <Route path="/registry"    element={<AssetRegistry />} />
                <Route path="/health"      element={<HealthWorkbench />} />
                <Route path="/risk"        element={<RiskCockpit />} />
                <Route path="/reliability" element={<Reliability />} />
                <Route path="/models"      element={<ModelGovernance />} />
                <Route path="/map"         element={<NetworkMap />} />
                <Route path="/investment"  element={<InvestmentPlanning />} />
                <Route path="/reporting"   element={<Reporting />} />
                <Route path="/integration" element={<IntegrationConsole />} />
                <Route path="/configure"   element={<ConfigStudio />} />
                <Route path="/security"    element={<SecurityAdmin />} />
                <Route path="/services"    element={<ManagedServices />} />
                <Route path="*"            element={<Navigate to="/" />} />
              </Routes>
            </Layout>
          </Router>
        </SocketProvider>
      </ApmProvider>
    </RoleProvider>
  );
}

export default App;
