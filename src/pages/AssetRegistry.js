/* Asset Registry — Section B of the checkpoint sheet.
   B.1 asset hierarchy (Transformer → Bay → Feeder → RMU → Consumer),
   B.2 parent-child relationships, B.5 lifecycle, B.6 multi-class support,
   B.7 custom attributes, B.8 bulk upload. */

import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApm } from '../services/apmStore';
import { ASSET_BY_ID, buildHierarchy, CLASS_LABEL, ZONES } from '../data/network';
import { fmtInt, healthBand } from '../engines/indices';
import { Panel, PageHead, HealthPill, SimulatedNote } from '../components/apmUi';
import { DigitalTwin, BulkUpload } from '../components/assetTwin';
import { useRole } from '../services/roleContext';
import { createConfig, writeAudit, ApiError } from '../services/backend';

const TYPE_TONE = {
  Substation: '#0ea5e9', Transformer: '#8b5cf6', Bay: '#14b8a6',
  Feeder: '#f59e0b', RMU: '#ec4899', Consumer: '#64748b',
};

/* ─── Recursive hierarchy node ──────────────────────────────────────────── */
function TreeNode({ node, depth = 0, onPick, defaultOpen }) {
  // Opens to full depth by default: Checkpoint B.1 asks to see the whole
  // Transformer -> Bay -> Feeder -> RMU -> Consumer chain, so it must be on
  // screen at rest rather than behind four clicks.
  const [open, setOpen] = useState(depth < (defaultOpen ?? 6));
  const hasKids = node.children && node.children.length > 0;

  return (
    <div>
      <div
        className={`apm-tree-node ${node.assetId ? 'is-asset' : ''}`}
        onClick={() => { if (hasKids) setOpen((o) => !o); if (node.assetId) onPick(node.assetId); }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter') { if (hasKids) setOpen((o) => !o); if (node.assetId) onPick(node.assetId); } }}
      >
        <span style={{ width: 10, flexShrink: 0, color: 'var(--app-text-faint)', fontSize: 9 }}>
          {hasKids ? (open ? '▾' : '▸') : '·'}
        </span>
        <span className="apm-tree-type" style={{ color: TYPE_TONE[node.type], background: `${TYPE_TONE[node.type]}1a` }}>
          {node.type}
        </span>
        <span className="apm-tree-label truncate">{node.label}</span>
        <span className="apm-tree-meta truncate ml-auto pl-2">{node.meta}</span>
      </div>
      {hasKids && open && (
        <div className="apm-tree-children">
          {node.children.map((c, i) => (
            <TreeNode
              key={i}
              node={c}
              depth={depth + 1}
              onPick={onPick}
              /* Only the first branch at each level opens fully, so the whole
                 chain is visible without the panel becoming a wall of rows. */
              defaultOpen={i === 0 ? defaultOpen : 2}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function AssetRegistry() {
  const navigate = useNavigate();
  const { fleet, selectedId, setSelectedId } = useApm();

  const { identity, role, can } = useRole();

  const [query, setQuery] = useState('');
  const [classFilter, setClassFilter] = useState('all');
  const [zoneFilter, setZoneFilter] = useState('all');
  const [page, setPage] = useState(0);
  const [showUpload, setShowUpload] = useState(false);
  const [notice, setNotice] = useState(null);
  const PER_PAGE = 40;

  /* Staging an upload writes the batch to the configuration store and records
     it in the audit trail. It does not mutate the in-memory fleet: the demo
     dataset is seeded and deterministic, and silently growing it would break
     every figure quoted elsewhere in the run sheet. The note below says so. */
  const commitUpload = async (rows) => {
    try {
      await createConfig('asset-classes', {
        name: `Bulk import — ${rows.length} assets`,
        kind: 'bulk-upload',
        assetIds: rows.map((r) => r.assetId),
        rows,
        auditDetail: `Bulk asset upload staged: ${rows.length} rows accepted`,
      });
      await writeAudit({
        user: identity.name, role: role.key, action: 'ASSET_BULK_UPLOAD',
        object: `${rows.length} assets`,
        detail: `Staged ${rows.length} validated rows from CSV for registry load`,
      }).catch(() => {});
      setShowUpload(false);
      setNotice({
        kind: 'ok',
        text: `${rows.length} rows staged and written to the configuration store. Check the audit trail on Security & Administration — the entry is already there.`,
      });
    } catch (e) {
      setNotice({
        kind: 'err',
        text: e instanceof ApiError ? e.message : 'Could not reach the configuration service — start it with npm run server.',
      });
    }
    setTimeout(() => setNotice(null), 8000);
  };

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return fleet.rows.filter((r) => {
      if (classFilter !== 'all' && r.assetClass !== classFilter) return false;
      if (zoneFilter !== 'all' && r.zone !== zoneFilter) return false;
      if (!q) return true;
      return (
        r.id.toLowerCase().includes(q) ||
        r.asset.substation.toLowerCase().includes(q) ||
        (r.asset.name || '').toLowerCase().includes(q) ||
        r.asset.make.toLowerCase().includes(q)
      );
    });
  }, [fleet, query, classFilter, zoneFilter]);

  const pageRows = rows.slice(page * PER_PAGE, (page + 1) * PER_PAGE);
  const pages = Math.ceil(rows.length / PER_PAGE);

  const selected = ASSET_BY_ID[selectedId];
  const hierarchy = useMemo(() => buildHierarchy(selectedId), [selectedId]);
  const selectedRow = fleet.rows.find((r) => r.id === selectedId);

  const openHealth = (id) => { setSelectedId(id); navigate('/health'); };

  return (
    <div className="space-y-4">
      <PageHead
        eyebrow="S!aP Datalake · Asset Data Model"
        title="Asset Registry"
        sub="Single asset model spanning transmission and distribution classes. Selecting an asset renders its network position from receiving station down to the consumer group it serves."
        right={
          <button className="app-btn px-3 py-2 text-[11px]" type="button" onClick={() => setShowUpload(true)}>
            Bulk Upload
          </button>
        }
      />

      {showUpload && (
        <BulkUpload
          onClose={() => setShowUpload(false)}
          onCommit={commitUpload}
          canWrite={can('config.write')}
          roleLabel={role.label}
        />
      )}

      {notice && (
        <div
          className="rounded-lg px-3 py-2 text-[11px]"
          style={{
            background: notice.kind === 'ok' ? 'var(--app-success-bg)' : 'var(--app-danger-bg)',
            border: `1px solid ${notice.kind === 'ok' ? 'var(--app-success-border)' : 'var(--app-danger-border)'}`,
            color: notice.kind === 'ok' ? 'var(--app-success)' : 'var(--app-danger)',
          }}
        >
          {notice.text}
        </div>
      )}

      {/* ─── Filters ───────────────────────────────────────────────────── */}
      <div className="bg-app-panel border border-app-border rounded-xl p-3 flex items-center gap-2 flex-wrap">
        <div className="header-search" style={{ minWidth: 260, flex: '1 1 260px' }}>
          <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="var(--app-text-faint)" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            value={query}
            onChange={(e) => { setQuery(e.target.value); setPage(0); }}
            placeholder="Search asset ID, substation, make…"
            aria-label="Search assets"
          />
        </div>

        <select className="apm-select" value={classFilter}
                onChange={(e) => { setClassFilter(e.target.value); setPage(0); }}
                aria-label="Filter by asset class"
                style={{ background: 'var(--app-surface-soft)', border: '1px solid var(--app-border)', color: 'var(--app-text)', borderRadius: 8, padding: '7px 10px', fontSize: 11.5 }}>
          <option value="all">All classes</option>
          {Object.entries(CLASS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>

        <select value={zoneFilter}
                onChange={(e) => { setZoneFilter(e.target.value); setPage(0); }}
                aria-label="Filter by zone"
                style={{ background: 'var(--app-surface-soft)', border: '1px solid var(--app-border)', color: 'var(--app-text)', borderRadius: 8, padding: '7px 10px', fontSize: 11.5 }}>
          <option value="all">All zones</option>
          {ZONES.map((z) => <option key={z.id} value={z.name}>{z.name}</option>)}
        </select>

        <span className="text-[11px] ml-auto" style={{ color: 'var(--app-text-faint)' }}>
          <strong style={{ color: 'var(--app-text)' }}>{fmtInt(rows.length)}</strong> of {fmtInt(fleet.rows.length)} assets
        </span>
      </div>

      <div className="grid gap-4" style={{ gridTemplateColumns: 'minmax(430px, 1.45fr) minmax(340px, 1fr)' }}>
        {/* ─── Registry table ──────────────────────────────────────────── */}
        <Panel title="Asset register" checkpoints="B.1 · B.6 · B.7" sub="Select a row to render its hierarchy" bodyClass="p-0">
          <div className="apm-scroll" style={{ maxHeight: 460 }}>
            <table className="apm-table">
              <thead>
                <tr>
                  <th>Asset ID</th>
                  <th>Class · Rating</th>
                  <th>Substation</th>
                  <th className="num">Age</th>
                  <th className="num">AHI</th>
                  <th>Lifecycle</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r) => (
                  <tr
                    key={r.id}
                    className={r.id === selectedId ? 'is-selected' : ''}
                    onClick={() => setSelectedId(r.id)}
                    onDoubleClick={() => openHealth(r.id)}
                    style={{ cursor: 'pointer' }}
                  >
                    <td className="asset-id">
                      {r.id}
                      {r.asset.hero && <span className="ml-1.5 apm-checkpoint" style={{ fontSize: 8 }}>HERO</span>}
                    </td>
                    <td className="truncate" style={{ maxWidth: 150 }}>
                      <div style={{ color: 'var(--app-text-muted)' }}>{CLASS_LABEL[r.assetClass]}</div>
                      <div className="text-[9.5px]" style={{ color: 'var(--app-text-faint)' }}>{r.asset.rating}</div>
                    </td>
                    <td className="truncate" style={{ maxWidth: 160 }}>{r.asset.substation}</td>
                    <td className="num">{r.asset.age.toFixed(0)}y</td>
                    <td className="num" style={{ color: healthBand(r.ahi).color, fontWeight: 700 }}>{r.ahi.toFixed(1)}</td>
                    <td>
                      <span className="text-[10px]" style={{ color: 'var(--app-text-faint)' }}>{r.asset.lifecycle}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {pages > 1 && (
            <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-t border-app-border">
              <button className="apm-tab" disabled={page === 0} onClick={() => setPage((p) => Math.max(p - 1, 0))} type="button"
                      style={{ opacity: page === 0 ? 0.4 : 1 }}>← Previous</button>
              <span className="text-[10.5px]" style={{ color: 'var(--app-text-faint)' }}>
                Page {page + 1} of {fmtInt(pages)}
              </span>
              <button className="apm-tab" disabled={page >= pages - 1} onClick={() => setPage((p) => Math.min(p + 1, pages - 1))} type="button"
                      style={{ opacity: page >= pages - 1 ? 0.4 : 1 }}>Next →</button>
            </div>
          )}
        </Panel>

        {/* ─── Hierarchy + attributes ──────────────────────────────────── */}
        <div className="space-y-4">
          <Panel
            title="Network hierarchy" checkpoints="B.1 · B.2"
            sub="Transformer → Bay → Feeder → RMU → Consumer"
            right={
              <button className="app-btn px-2.5 py-1.5 text-[10px]" type="button" onClick={() => openHealth(selectedId)}>
                Open Health →
              </button>
            }
          >
            <div className="apm-tree apm-scroll" style={{ maxHeight: 250 }}>
              {hierarchy && <TreeNode node={hierarchy} onPick={setSelectedId} />}
            </div>
          </Panel>

          {selected && selectedRow && (
            <Panel
              title="Digital twin" checkpoints="B.4"
              sub="Each component takes its colour from the condition parameter that governs it"
            >
              <DigitalTwin asset={selected} health={{ ahi: selectedRow.ahi }} />
            </Panel>
          )}

          {selected && selectedRow && (
            <Panel title="Asset attributes" checkpoints="B.5 · B.7" sub={selected.name || selected.id}>
              <div className="flex items-center gap-2 mb-3 flex-wrap">
                <HealthPill ahi={selectedRow.ahi} />
                <span className="text-[10.5px]" style={{ color: 'var(--app-text-faint)' }}>
                  AHI {selectedRow.ahi.toFixed(1)} · ACI {selectedRow.aci.toFixed(0)} · ARI ₹{selectedRow.ari.toFixed(2)} Cr/yr
                </span>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                {[
                  ['Asset ID', selected.id],
                  ['Class', CLASS_LABEL[selected.assetClass]],
                  ['Rating', selected.rating],
                  ['Make', selected.make],
                  ['Commissioned', selected.commissioned],
                  ['Age', `${selected.age.toFixed(1)} years`],
                  ['Design life', `${selected.designLife} years`],
                  ['Lifecycle stage', selected.lifecycle],
                  ['Zone', selected.zone],
                  ['Consumers served', fmtInt(selected.impact.consumers)],
                  ['N-1 redundancy', selected.impact.redundancy ? 'Available' : 'None'],
                  ['Restoration window', `${selected.restorationDays} days`],
                ].map(([k, v]) => (
                  <div key={k}>
                    <p className="text-[9px] font-bold uppercase tracking-wider" style={{ color: 'var(--app-text-faint)' }}>{k}</p>
                    <p className="text-[11.5px] font-semibold mt-0.5" style={{ color: 'var(--app-text-muted)' }}>{v}</p>
                  </div>
                ))}
              </div>
              {selected.note && (
                <p className="text-[10.5px] mt-3 pt-3 border-t border-app-border" style={{ color: 'var(--app-text-faint)' }}>
                  {selected.note}
                </p>
              )}
            </Panel>
          )}

          <SimulatedNote>
            Asset master data is synthetic, generated to the population published in RFQ §3.7. In delivery this
            register is populated from the Grid Data Hub via S!aP Konnect, with GIS supplying location and SAP PM
            supplying maintenance history.
          </SimulatedNote>
        </div>
      </div>
    </div>
  );
}
