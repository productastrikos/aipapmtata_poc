/* ═══════════════════════════════════════════════════════════════════════════
   Role-based access control (Section N)
   ───────────────────────────────────────────────────────────────────────────
   A demo affordance, not authentication. The delivery build takes identity
   from TPCL's Active Directory over SSO with MFA, and the audit trail then
   carries the real principal. What this provides for the demonstration is the
   thing Checkpoint N.4 actually tests: switch role, and what you are permitted
   to do visibly changes — including server-side, because the backend checks
   the role on every write rather than trusting the UI to hide a button.
   ═══════════════════════════════════════════════════════════════════════════ */

import React, { createContext, useContext, useState, useCallback, useEffect, useMemo } from 'react';
import { setIdentity } from './backend';

const RoleContext = createContext(null);
export const useRole = () => useContext(RoleContext);

/* Permissions are additive per role. The backend enforces the write boundary
   independently — see WRITE_ROLES in server/index.js. */
export const ROLES = {
  admin: {
    key: 'admin',
    label: 'Administrator',
    description: 'Full platform configuration, user administration, integration binding',
    permissions: ['config.read', 'config.write', 'user.admin', 'integration.run', 'report.export', 'incident.write', 'audit.read'],
  },
  planner: {
    key: 'planner',
    label: 'Asset Planner',
    description: 'Investment planning, scenario modelling, reporting. No user administration',
    permissions: ['config.read', 'config.write', 'integration.run', 'report.export', 'incident.write', 'audit.read'],
  },
  engineer: {
    key: 'engineer',
    label: 'Substation Engineer',
    description: 'Condition monitoring, work orders, incident reporting. No investment authority',
    permissions: ['config.read', 'integration.run', 'workorder.raise', 'incident.write'],
  },
  auditor: {
    key: 'auditor',
    label: 'Regulatory Auditor',
    description: 'Read-only across the platform, with full audit-trail and report access',
    permissions: ['config.read', 'report.export', 'audit.read'],
  },
};

export const DEMO_IDENTITIES = [
  { id: 'U-001', name: 'A. Deshpande', role: 'admin',    title: 'Platform Administrator' },
  { id: 'U-002', name: 'R. Iyer',      role: 'planner',  title: 'Asset Planning Lead' },
  { id: 'U-003', name: 'S. Kulkarni',  role: 'engineer', title: 'Substation Engineer' },
  { id: 'U-004', name: 'M. Rao',       role: 'auditor',  title: 'Regulatory Analyst' },
];

const STORAGE_KEY = 'apm_demo_identity';

export function RoleProvider({ children }) {
  const [identity, setLocalIdentity] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && ROLES[parsed.role]) return parsed;
      }
    } catch (e) { /* private mode, cleared storage — fall through */ }
    return DEMO_IDENTITIES[1]; // Asset Planning Lead
  });

  /* Keep the API client in step so every backend write is attributed and
     authorised against the role currently selected. */
  useEffect(() => {
    setIdentity({ user: identity.name, role: identity.role });
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(identity)); } catch (e) { /* non-fatal */ }
  }, [identity]);

  const switchIdentity = useCallback((next) => {
    const found = DEMO_IDENTITIES.find((d) => d.id === next || d.name === next) || next;
    if (found && ROLES[found.role]) setLocalIdentity(found);
  }, []);

  const value = useMemo(() => {
    const role = ROLES[identity.role] || ROLES.auditor;
    return {
      identity,
      role,
      roleKey: role.key,
      switchIdentity,
      can: (permission) => role.permissions.includes(permission),
      readOnly: !role.permissions.includes('config.write'),
    };
  }, [identity, switchIdentity]);

  return <RoleContext.Provider value={value}>{children}</RoleContext.Provider>;
}
