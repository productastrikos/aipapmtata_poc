import React, { useState, useMemo } from 'react';
import { Bar } from 'react-chartjs-2';
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Tooltip, Legend } from 'chart.js';
import KPICard, {
  IcoCoverage, IcoCheck, IcoAlert, IcoCalendar,
  IcoTruck, IcoWrench,
  IcoBox, IcoDollar, IcoTrendUp,
} from '../components/KPICard';
import { getChartTokens, chartTooltip, chartScales, ChartTimeframeControl, TIMEFRAME_OPTIONS, getTimeframeOption, buildTimeframeLabels, resampleSeries } from '../components/chartUtils';
import ZoneFilterBar from '../components/ZoneFilterBar';

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

// ── RECORDS data ──────────────────────────────────────────────────────────────
const RECORDS = [
  { id:'REC-001', name:'Alpha Initiative',  category:'Category A', status:'completed',   priority:'high',   assignee:'Alex Johnson',  updated:'2 hr ago'   },
  { id:'REC-002', name:'Beta Rollout',       category:'Category B', status:'in-progress', priority:'medium', assignee:'Sam Chen',       updated:'45 min ago' },
  { id:'REC-003', name:'Gamma Review',       category:'Category A', status:'pending',     priority:'low',    assignee:'Jordan Lee',     updated:'3 hr ago'   },
  { id:'REC-004', name:'Delta Audit',        category:'Category C', status:'critical',    priority:'high',   assignee:'Morgan Davis',   updated:'18 min ago' },
  { id:'REC-005', name:'Epsilon Check',      category:'Category B', status:'completed',   priority:'medium', assignee:'Riley Smith',    updated:'5 hr ago'   },
  { id:'REC-006', name:'Zeta Compliance',    category:'Category C', status:'in-progress', priority:'high',   assignee:'Casey Wilson',   updated:'1 hr ago'   },
  { id:'REC-007', name:'Eta Assessment',     category:'Category A', status:'pending',     priority:'low',    assignee:'Drew Martinez',  updated:'7 hr ago'   },
  { id:'REC-008', name:'Theta Pipeline',     category:'Category B', status:'completed',   priority:'medium', assignee:'Taylor Brown',   updated:'4 hr ago'   },
];
const REC_STATUS = {
  completed:    { label:'Completed',   bg:'bg-emerald-500/15', text:'text-emerald-400', border:'border-emerald-500/30' },
  'in-progress':{ label:'In Progress', bg:'bg-blue-500/15',    text:'text-blue-400',    border:'border-blue-500/30'    },
  pending:      { label:'Pending',     bg:'bg-amber-500/15',   text:'text-amber-400',   border:'border-amber-500/30'   },
  critical:     { label:'Critical',    bg:'bg-red-500/15',     text:'text-red-400',     border:'border-red-500/30'     },
};
const REC_PRIORITY = {
  high:   { label:'High',   color:'text-red-400'   },
  medium: { label:'Medium', color:'text-amber-400' },
  low:    { label:'Low',    color:'text-slate-400' },
};

// ── ASSETS data ───────────────────────────────────────────────────────────────
const ASSETS = [
  { id:'AST-001', name:'Unit Alpha-1',   type:'Type A', status:'active',      location:'Region 1', utilization:84, lastSeen:'2 min ago'  },
  { id:'AST-002', name:'Unit Beta-2',    type:'Type B', status:'maintenance', location:'Depot',    utilization:0,  lastSeen:'3 hr ago'   },
  { id:'AST-003', name:'Unit Gamma-3',   type:'Type A', status:'active',      location:'Region 2', utilization:71, lastSeen:'Just now'   },
  { id:'AST-004', name:'Unit Delta-4',   type:'Type C', status:'idle',        location:'Region 3', utilization:0,  lastSeen:'45 min ago' },
  { id:'AST-005', name:'Unit Epsilon-5', type:'Type B', status:'active',      location:'Region 1', utilization:92, lastSeen:'5 min ago'  },
  { id:'AST-006', name:'Unit Zeta-6',    type:'Type A', status:'offline',     location:'Unknown',  utilization:0,  lastSeen:'1 day ago'  },
  { id:'AST-007', name:'Unit Eta-7',     type:'Type C', status:'active',      location:'Region 4', utilization:63, lastSeen:'12 min ago' },
  { id:'AST-008', name:'Unit Theta-8',   type:'Type B', status:'maintenance', location:'Depot',    utilization:0,  lastSeen:'6 hr ago'   },
];
const AST_STATUS = {
  active:      { label:'Active',      bg:'bg-emerald-500/15', text:'text-emerald-400', border:'border-emerald-500/30', dot:'bg-emerald-400' },
  idle:        { label:'Idle',        bg:'bg-slate-500/15',   text:'text-slate-400',   border:'border-slate-500/30',   dot:'bg-slate-400'   },
  maintenance: { label:'Maintenance', bg:'bg-amber-500/15',   text:'text-amber-400',   border:'border-amber-500/30',   dot:'bg-amber-400'   },
  offline:     { label:'Offline',     bg:'bg-red-500/15',     text:'text-red-400',     border:'border-red-500/30',     dot:'bg-red-400'     },
};

// ── INVENTORY data ────────────────────────────────────────────────────────────
const INVENTORY = [
  { id:'INV-001', name:'Storage A', category:'Type Alpha', capacity:500, used:342, status:'normal',   dailyIn:18, updated:'10 min ago' },
  { id:'INV-002', name:'Storage B', category:'Type Beta',  capacity:300, used:278, status:'warning',  dailyIn:24, updated:'25 min ago' },
  { id:'INV-003', name:'Storage C', category:'Type Alpha', capacity:400, used:161, status:'normal',   dailyIn:12, updated:'5 min ago'  },
  { id:'INV-004', name:'Storage D', category:'Type Gamma', capacity:200, used:187, status:'critical', dailyIn:31, updated:'2 min ago'  },
  { id:'INV-005', name:'Storage E', category:'Type Beta',  capacity:600, used:220, status:'normal',   dailyIn:9,  updated:'1 hr ago'   },
];
const INV_STATUS = {
  normal:   { label:'Normal',   text:'text-emerald-400', bg:'bg-emerald-500/15', border:'border-emerald-500/30', bar:'bg-emerald-500' },
  warning:  { label:'Warning',  text:'text-amber-400',   bg:'bg-amber-500/15',   border:'border-amber-500/30',   bar:'bg-amber-500'   },
  critical: { label:'Critical', text:'text-red-400',     bg:'bg-red-500/15',     border:'border-red-500/30',     bar:'bg-red-500'     },
};

// ── Tab switcher ──────────────────────────────────────────────────────────────
const TABS = ['Records', 'Assets', 'Inventory'];

// ── Records tab ───────────────────────────────────────────────────────────────
function RecordsTab() {
  const [search, setSearch]       = useState('');
  const [statusFilter, setFilter] = useState('all');
  const [selectedKPI, setSelectedKPI] = useState(null);
  const [timeframe, setTimeframe] = useState('7D');
  const tokens = getChartTokens();
  const activeFrame = getTimeframeOption(TIMEFRAME_OPTIONS.ops, timeframe);
  const DAILY_BASE = [3,2,1,2,4,3,2,5,4,3,2,3,4,3,2,3,4,5,3,2,4,3,2,3,4,3,2,3,2,3];
  const chartData = useMemo(() => {
    const labels = buildTimeframeLabels(activeFrame.value, activeFrame.points);
    const cats = ['Category A', 'Category B', 'Category C'];
    const weights = [0.4, 0.35, 0.25];
    return {
      labels,
      datasets: cats.map((cat, ci) => ({
        label: cat,
        data: resampleSeries(DAILY_BASE.map(v => Math.round(v * weights[ci])), activeFrame.points),
        backgroundColor: [tokens.successBar, 'rgba(59,130,246,0.8)', tokens.warningBar][ci],
        borderRadius: 4,
      })),
    }; // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeframe]);

  const filtered = RECORDS.filter(r => {
    const matchSearch = !search || r.name.toLowerCase().includes(search.toLowerCase()) || r.assignee.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === 'all' || r.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const counts = {
    total:     RECORDS.length,
    completed: RECORDS.filter(r => r.status === 'completed').length,
    pending:   RECORDS.filter(r => r.status === 'pending' || r.status === 'in-progress').length,
    critical:  RECORDS.filter(r => r.status === 'critical').length,
  };

  const chartOpts = {
    responsive:true, maintainAspectRatio:false,
    plugins:{ legend:{ display:true, labels:{ color:tokens.legendColor, font:{size:10}, boxWidth:10 } }, tooltip:chartTooltip() },
    scales: chartScales(),
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard label="Total Records"       value={counts.total}     icon={<IcoCoverage />} color="text-blue-400"    onClick={() => setSelectedKPI('total')}     />
        <KPICard label="Completed"           value={counts.completed} icon={<IcoCheck />}    color="text-emerald-400" trend={5.2} onClick={() => setSelectedKPI('completed')} />
        <KPICard label="In Progress/Pending" value={counts.pending}   icon={<IcoCalendar />} color="text-amber-400"                onClick={() => setSelectedKPI('pending')}   />
        <KPICard label="Critical"            value={counts.critical}  icon={<IcoAlert />}    rag="critical"                        onClick={() => setSelectedKPI('critical')}  />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-app-panel border border-app-border rounded-lg p-3 relative">
          <div className="flex items-center gap-1 mb-0.5">
            <h4 className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider flex-1">Activity by Category</h4>
            <ChartTimeframeControl options={TIMEFRAME_OPTIONS.ops} value={timeframe} onChange={setTimeframe} />
          </div>
          <div className="mb-2" />
          <div style={{ height:200 }}><Bar data={chartData} options={chartOpts} /></div>
        </div>
        <div className="lg:col-span-2 bg-app-panel border border-app-border rounded-xl overflow-hidden">
          <div className="flex items-center gap-3 px-4 py-3 border-b border-app-border">
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search records…" className="flex-1 bg-transparent text-xs outline-none" style={{ color:'var(--app-text)' }} />
            <select value={statusFilter} onChange={e => setFilter(e.target.value)} className="text-xs rounded px-2 py-1 outline-none" style={{ background:'var(--app-surface)', border:'1px solid var(--app-border)', color:'var(--app-text)' }}>
              <option value="all">All Status</option>
              <option value="completed">Completed</option>
              <option value="in-progress">In Progress</option>
              <option value="pending">Pending</option>
              <option value="critical">Critical</option>
            </select>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-app-border">
                  {['ID','Name','Category','Status','Priority','Assignee','Updated'].map(h => (
                    <th key={h} className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider" style={{ color:'var(--app-text-faint)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(rec => {
                  const sm = REC_STATUS[rec.status] || REC_STATUS.pending;
                  const pm = REC_PRIORITY[rec.priority] || REC_PRIORITY.medium;
                  return (
                    <tr key={rec.id} className="border-b border-app-border/50 hover:bg-white/[0.02] transition-colors">
                      <td className="px-3 py-2.5 font-mono text-[10px]" style={{ color:'var(--app-text-faint)' }}>{rec.id}</td>
                      <td className="px-3 py-2.5 font-medium" style={{ color:'var(--app-text)' }}>{rec.name}</td>
                      <td className="px-3 py-2.5" style={{ color:'var(--app-text-faint)' }}>{rec.category}</td>
                      <td className="px-3 py-2.5"><span className={`inline-flex px-2 py-0.5 rounded border text-[10px] font-semibold ${sm.bg} ${sm.text} ${sm.border}`}>{sm.label}</span></td>
                      <td className={`px-3 py-2.5 text-[10px] font-semibold ${pm.color}`}>{pm.label}</td>
                      <td className="px-3 py-2.5" style={{ color:'var(--app-text-faint)' }}>{rec.assignee}</td>
                      <td className="px-3 py-2.5" style={{ color:'var(--app-text-faint)' }}>{rec.updated}</td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr><td colSpan={7} className="px-3 py-8 text-center text-xs" style={{ color:'var(--app-text-faint)' }}>No records match the current filter.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      {selectedKPI && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50" onClick={() => setSelectedKPI(null)}>
          <div className="bg-app-panel border border-app-border rounded-xl p-6 w-full max-w-sm shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold" style={{ color:'var(--app-text)' }}>KPI Detail — {selectedKPI}</h3>
              <button onClick={() => setSelectedKPI(null)} className="text-slate-500 hover:text-white text-xl leading-none">×</button>
            </div>
            <p className="text-xs leading-relaxed" style={{ color:'var(--app-text-faint)' }}>
              Replace this modal with a detailed breakdown for the <strong style={{ color:'var(--app-text)' }}>{selectedKPI}</strong> KPI.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Assets tab ────────────────────────────────────────────────────────────────
function AssetsTab() {
  const [activeTab, setActiveTab]       = useState('Overview');
  const [selectedAsset, setSelectedAsset] = useState(null);
  const [timeframe, setTimeframe] = useState('24H');
  const tokens = getChartTokens();

  const counts = {
    total:       ASSETS.length,
    active:      ASSETS.filter(a => a.status === 'active').length,
    maintenance: ASSETS.filter(a => a.status === 'maintenance').length,
    offline:     ASSETS.filter(a => a.status === 'offline').length,
  };

  const activeAssets = ASSETS.filter(a => a.status === 'active');
  const utilData = {
    labels: activeAssets.map(a => a.id),
    datasets: [{ label:'Utilization %', data: activeAssets.map(a => a.utilization), backgroundColor: activeAssets.map(a => a.utilization > 85 ? tokens.dangerBar : a.utilization > 60 ? tokens.warningBar : tokens.successBar), borderRadius:4 }],
  };
  const utilOpts = {
    responsive:true, maintainAspectRatio:false,
    plugins:{ legend:{ display:false }, tooltip:chartTooltip() },
    scales:{ ...chartScales(), y:{ ...chartScales().y, max:100 } },
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard label="Total Assets"   value={counts.total}       icon={<IcoTruck />}  color="text-blue-400"    />
        <KPICard label="Active"         value={counts.active}      icon={<IcoCheck />}  color="text-emerald-400" trend={2.1} />
        <KPICard label="In Maintenance" value={counts.maintenance} icon={<IcoWrench />} color="text-amber-400"   />
        <KPICard label="Offline"        value={counts.offline}     icon={<IcoAlert />}  rag={counts.offline > 0 ? 'critical' : 'normal'} />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-app-panel border border-app-border rounded-lg p-3 relative">
          <div className="flex items-center gap-1 mb-0.5">
            <h4 className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider flex-1">Active Asset Utilization</h4>
            <ChartTimeframeControl options={TIMEFRAME_OPTIONS.realtime} value={timeframe} onChange={setTimeframe} />
          </div>
          <div className="mb-2" />
          <div style={{ height:220 }}><Bar data={utilData} options={utilOpts} /></div>
        </div>
        <div className="lg:col-span-2 bg-app-panel border border-app-border rounded-xl overflow-hidden">
          <div className="flex border-b border-app-border">
            {['Overview','Maintenance','Assignments'].map(tab => (
              <button key={tab} onClick={() => setActiveTab(tab)} className="px-4 py-3 text-xs font-semibold transition-colors"
                style={{ color: activeTab === tab ? 'var(--app-accent)' : 'var(--app-text-faint)', borderBottom: activeTab === tab ? '2px solid var(--app-accent)' : '2px solid transparent' }}>
                {tab}
              </button>
            ))}
          </div>
          {activeTab === 'Overview' ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-app-border">
                    {['ID','Name','Type','Status','Location','Utilization','Last Seen'].map(h => (
                      <th key={h} className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider" style={{ color:'var(--app-text-faint)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ASSETS.map(asset => {
                    const sm = AST_STATUS[asset.status];
                    return (
                      <tr key={asset.id} className="border-b border-app-border/50 hover:bg-white/[0.02] transition-colors cursor-pointer" onClick={() => setSelectedAsset(asset)}>
                        <td className="px-3 py-2.5 font-mono text-[10px]" style={{ color:'var(--app-text-faint)' }}>{asset.id}</td>
                        <td className="px-3 py-2.5 font-medium" style={{ color:'var(--app-text)' }}>{asset.name}</td>
                        <td className="px-3 py-2.5" style={{ color:'var(--app-text-faint)' }}>{asset.type}</td>
                        <td className="px-3 py-2.5">
                          <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded border text-[10px] font-semibold ${sm.bg} ${sm.text} ${sm.border}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${sm.dot}`} />{sm.label}
                          </span>
                        </td>
                        <td className="px-3 py-2.5" style={{ color:'var(--app-text-faint)' }}>{asset.location}</td>
                        <td className="px-3 py-2.5">
                          {asset.utilization > 0 ? (
                            <div className="flex items-center gap-2">
                              <div className="w-16 h-1.5 bg-white/5 rounded-full overflow-hidden">
                                <div className={`h-full rounded-full ${asset.utilization > 85 ? 'bg-red-500' : asset.utilization > 60 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width:`${asset.utilization}%` }} />
                              </div>
                              <span style={{ color:'var(--app-text-faint)' }}>{asset.utilization}%</span>
                            </div>
                          ) : <span style={{ color:'var(--app-text-faint)' }}>—</span>}
                        </td>
                        <td className="px-3 py-2.5" style={{ color:'var(--app-text-faint)' }}>{asset.lastSeen}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-8 text-center">
              <p className="text-xs" style={{ color:'var(--app-text-faint)' }}>
                <strong style={{ color:'var(--app-text)' }}>{activeTab}</strong> — replace with your own content.
              </p>
            </div>
          )}
        </div>
      </div>
      {selectedAsset && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50" onClick={() => setSelectedAsset(null)}>
          <div className="bg-app-panel border border-app-border rounded-xl p-6 w-full max-w-md shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color:'var(--app-text-faint)' }}>{selectedAsset.id}</p>
                <h3 className="text-sm font-bold mt-0.5" style={{ color:'var(--app-text)' }}>{selectedAsset.name}</h3>
              </div>
              <button onClick={() => setSelectedAsset(null)} className="text-slate-500 hover:text-white text-xl leading-none">×</button>
            </div>
            <div className="grid grid-cols-2 gap-3 text-xs">
              {[{ label:'Type', value:selectedAsset.type }, { label:'Status', value:AST_STATUS[selectedAsset.status]?.label }, { label:'Location', value:selectedAsset.location }, { label:'Utilization', value:selectedAsset.utilization > 0 ? `${selectedAsset.utilization}%` : 'N/A' }, { label:'Last Seen', value:selectedAsset.lastSeen }].map(({ label, value }) => (
                <div key={label} className="bg-white/[0.03] rounded-lg p-3">
                  <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color:'var(--app-text-faint)' }}>{label}</p>
                  <p className="font-semibold" style={{ color:'var(--app-text)' }}>{value}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Inventory tab ─────────────────────────────────────────────────────────────
function InventoryTab() {
  const [sortBy, setSortBy]       = useState('capacity');
  const [filterStatus, setFilter] = useState('all');

  const totalCap  = INVENTORY.reduce((s, i) => s + i.capacity, 0);
  const totalUsed = INVENTORY.reduce((s, i) => s + i.used, 0);
  const avgPct    = totalCap > 0 ? ((totalUsed / totalCap) * 100).toFixed(1) : 0;
  const totalIn   = INVENTORY.reduce((s, i) => s + i.dailyIn, 0);
  const critCount = INVENTORY.filter(i => i.status === 'critical').length;

  const sorted = [...INVENTORY]
    .filter(i => filterStatus === 'all' || i.status === filterStatus)
    .sort((a, b) => {
      if (sortBy === 'capacity') return b.capacity - a.capacity;
      if (sortBy === 'used')     return (b.used / b.capacity) - (a.used / a.capacity);
      if (sortBy === 'daily')    return b.dailyIn - a.dailyIn;
      return 0;
    });

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard label="Avg Capacity Used"  value={avgPct}           unit="%" icon={<IcoBox />}     color="text-blue-400"    trend={1.2} />
        <KPICard label="Total Daily Intake" value={totalIn}          unit=" units" icon={<IcoTrendUp />} color="text-emerald-400" />
        <KPICard label="Total Locations"    value={INVENTORY.length}             icon={<IcoDollar />}  color="text-slate-400"   />
        <KPICard label="Critical"           value={critCount}                    icon={<IcoAlert />}   rag={critCount > 0 ? 'critical' : 'normal'} />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs" style={{ color:'var(--app-text-faint)' }}>Filter:</span>
          {['all','normal','warning','critical'].map(s => (
            <button key={s} onClick={() => setFilter(s)} className="px-3 py-1 rounded text-xs font-semibold transition-all capitalize"
              style={{ background: filterStatus === s ? 'var(--app-accent-bg)' : 'transparent', border:`1px solid ${filterStatus === s ? 'var(--app-accent-border)' : 'var(--app-border)'}`, color: filterStatus === s ? 'var(--app-accent)' : 'var(--app-text-faint)' }}>
              {s}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 ml-auto">
          <span className="text-xs" style={{ color:'var(--app-text-faint)' }}>Sort:</span>
          <select value={sortBy} onChange={e => setSortBy(e.target.value)} className="text-xs rounded px-2 py-1 outline-none"
            style={{ background:'var(--app-surface)', border:'1px solid var(--app-border)', color:'var(--app-text)' }}>
            <option value="capacity">Capacity</option>
            <option value="used">% Used</option>
            <option value="daily">Daily Intake</option>
          </select>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {sorted.map(inv => {
          const sm  = INV_STATUS[inv.status];
          const pct = inv.capacity > 0 ? (inv.used / inv.capacity) * 100 : 0;
          return (
            <div key={inv.id} className="bg-app-panel border border-app-border rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color:'var(--app-text-faint)' }}>{inv.id} · {inv.category}</p>
                  <p className="text-sm font-bold mt-0.5" style={{ color:'var(--app-text)' }}>{inv.name}</p>
                </div>
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${sm.bg} ${sm.text} ${sm.border}`}>{sm.label}</span>
              </div>
              <div className="mb-3">
                <div className="flex justify-between text-xs mb-1">
                  <span style={{ color:'var(--app-text-faint)' }}>Capacity Used</span>
                  <span className={`font-semibold ${sm.text}`}>{pct.toFixed(1)}%</span>
                </div>
                <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full transition-all ${sm.bar}`} style={{ width:`${pct}%` }} />
                </div>
                <div className="flex justify-between text-[10px] mt-1" style={{ color:'var(--app-text-faint)' }}>
                  <span>{inv.used.toLocaleString()} used</span>
                  <span>{inv.capacity.toLocaleString()} total</span>
                </div>
              </div>
              <div className="flex items-center justify-between text-xs pt-2 border-t border-app-border">
                <div>
                  <span style={{ color:'var(--app-text-faint)' }}>Daily In: </span>
                  <span className="font-semibold" style={{ color:'var(--app-text)' }}>{inv.dailyIn} units</span>
                </div>
                <span style={{ color:'var(--app-text-faint)' }}>{inv.updated}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────
export default function Operations() {
  const [tab, setTab] = useState('Records');
  const [zone, setZone] = useState('all');
  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-lg font-bold" style={{ color:'var(--app-text)' }}>Operations</h1>
          <p className="text-xs mt-0.5" style={{ color:'var(--app-text-faint)' }}>Records, assets, and inventory management</p>
        </div>
        <div className="flex gap-1 bg-app-panel border border-app-border rounded-lg p-1">
          {TABS.map(t => (
            <button key={t} onClick={() => setTab(t)} className="px-4 py-1.5 rounded text-xs font-semibold transition-all"
              style={{ background: tab === t ? 'var(--app-accent-bg)' : 'transparent', color: tab === t ? 'var(--app-accent)' : 'var(--app-text-faint)', border: `1px solid ${tab === t ? 'var(--app-accent-border)' : 'transparent'}` }}>
              {t}
            </button>
          ))}
        </div>
      </div>
      <ZoneFilterBar value={zone} onChange={setZone} />
      {tab === 'Records'   && <RecordsTab />}
      {tab === 'Assets'    && <AssetsTab />}
      {tab === 'Inventory' && <InventoryTab />}
    </div>
  );
}
