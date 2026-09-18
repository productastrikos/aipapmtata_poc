import React, { useState } from 'react';
import { Bar } from 'react-chartjs-2';
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Tooltip, Legend } from 'chart.js';
import KPICard, { IcoPeople, IcoCheck, IcoHourglass, IcoPhone } from '../components/KPICard';
import { getChartTokens, chartTooltip, chartScales } from '../components/chartUtils';

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

const REQUESTS = [
  { id: 'SRQ-001', subject: 'Billing Inquiry',        category: 'Billing',  status: 'open',       priority: 'high',   user: 'J. Anderson',   created: '15 min ago' },
  { id: 'SRQ-002', subject: 'Account Access Issue',   category: 'Support',  status: 'in-progress',priority: 'medium', user: 'P. Martinez',   created: '1 hr ago'   },
  { id: 'SRQ-003', subject: 'Feature Request',        category: 'Feedback', status: 'resolved',   priority: 'low',    user: 'T. Williams',   created: '3 hr ago'   },
  { id: 'SRQ-004', subject: 'Data Export Problem',    category: 'Support',  status: 'open',       priority: 'high',   user: 'C. Johnson',    created: '30 min ago' },
  { id: 'SRQ-005', subject: 'Payment Failed',         category: 'Billing',  status: 'in-progress',priority: 'high',   user: 'S. Davis',      created: '2 hr ago'   },
  { id: 'SRQ-006', subject: 'Onboarding Help',        category: 'Support',  status: 'resolved',   priority: 'low',    user: 'M. Brown',      created: '5 hr ago'   },
  { id: 'SRQ-007', subject: 'Report Generation Bug',  category: 'Support',  status: 'open',       priority: 'medium', user: 'R. Wilson',     created: '45 min ago' },
  { id: 'SRQ-008', subject: 'Positive Feedback',      category: 'Feedback', status: 'resolved',   priority: 'low',    user: 'L. Taylor',     created: '1 day ago'  },
  { id: 'SRQ-009', subject: 'API Integration Help',   category: 'Support',  status: 'in-progress',priority: 'medium', user: 'K. Harris',     created: '4 hr ago'   },
  { id: 'SRQ-010', subject: 'Invoice Dispute',        category: 'Billing',  status: 'open',       priority: 'high',   user: 'B. Clark',      created: '20 min ago' },
];

const STATUS_META = {
  open:          { label: 'Open',        bg: 'bg-red-500/15',    text: 'text-red-400',    border: 'border-red-500/30'    },
  'in-progress': { label: 'In Progress', bg: 'bg-blue-500/15',   text: 'text-blue-400',   border: 'border-blue-500/30'   },
  resolved:      { label: 'Resolved',    bg: 'bg-emerald-500/15',text: 'text-emerald-400',border: 'border-emerald-500/30' },
};

const PRIORITY_META = {
  high:   { label: 'High',   color: 'text-red-400'   },
  medium: { label: 'Medium', color: 'text-amber-400' },
  low:    { label: 'Low',    color: 'text-slate-400' },
};

const TABS = ['All Requests', 'Open', 'In Progress', 'Resolved'];

export default function Services() {
  const [activeTab, setActiveTab]    = useState('All Requests');
  const [selectedReq, setSelectedReq] = useState(null);
  const tokens = getChartTokens();

  const counts = {
    total:       REQUESTS.length,
    open:        REQUESTS.filter(r => r.status === 'open').length,
    inProgress:  REQUESTS.filter(r => r.status === 'in-progress').length,
    resolved:    REQUESTS.filter(r => r.status === 'resolved').length,
  };

  const filtered = REQUESTS.filter(r => {
    if (activeTab === 'Open')        return r.status === 'open';
    if (activeTab === 'In Progress') return r.status === 'in-progress';
    if (activeTab === 'Resolved')    return r.status === 'resolved';
    return true;
  });

  const cats = ['Billing', 'Support', 'Feedback'];
  const barData = {
    labels: cats,
    datasets: [
      { label: 'Open',        data: cats.map(c => REQUESTS.filter(r => r.category === c && r.status === 'open').length),        backgroundColor: tokens.dangerBar,              borderRadius: 4 },
      { label: 'In Progress', data: cats.map(c => REQUESTS.filter(r => r.category === c && r.status === 'in-progress').length), backgroundColor: 'rgba(59,130,246,0.8)',         borderRadius: 4 },
      { label: 'Resolved',    data: cats.map(c => REQUESTS.filter(r => r.category === c && r.status === 'resolved').length),    backgroundColor: tokens.successBar,              borderRadius: 4 },
    ],
  };
  const barOpts = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: true, labels: { color: tokens.legendColor, font: { size: 10 }, boxWidth: 10 } },
      tooltip: chartTooltip(),
    },
    scales: chartScales(),
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-lg font-bold" style={{ color: 'var(--app-text)' }}>User Services</h1>
        <p className="text-xs mt-0.5" style={{ color: 'var(--app-text-faint)' }}>Manage service requests, support tickets, and user feedback</p>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard label="Total Requests"  value={counts.total}      icon={<IcoPeople />}  color="text-blue-400"    />
        <KPICard label="Open"            value={counts.open}       icon={<IcoPhone />}   rag={counts.open > 5 ? 'warning' : 'normal'} />
        <KPICard label="In Progress"     value={counts.inProgress} icon={<IcoHourglass />} color="text-amber-400" />
        <KPICard label="Resolved Today"  value={counts.resolved}   icon={<IcoCheck />}   color="text-emerald-400" trend={8.3} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Chart */}
        <div className="bg-app-panel border border-app-border rounded-xl p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--app-text-faint)' }}>Requests by Category</h3>
          <div style={{ height: 200 }}>
            <Bar data={barData} options={barOpts} />
          </div>
        </div>

        {/* Requests table */}
        <div className="lg:col-span-2 bg-app-panel border border-app-border rounded-xl overflow-hidden">
          <div className="flex border-b border-app-border overflow-x-auto">
            {TABS.map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className="px-4 py-3 text-xs font-semibold whitespace-nowrap transition-colors shrink-0"
                style={{
                  color: activeTab === tab ? 'var(--app-accent)' : 'var(--app-text-faint)',
                  borderBottom: activeTab === tab ? '2px solid var(--app-accent)' : '2px solid transparent',
                }}
              >{tab}</button>
            ))}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-app-border">
                  {['ID','Subject','Category','Status','Priority','User','Created'].map(h => (
                    <th key={h} className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--app-text-faint)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(req => {
                  const sm = STATUS_META[req.status];
                  const pm = PRIORITY_META[req.priority];
                  return (
                    <tr
                      key={req.id}
                      className="border-b border-app-border/50 hover:bg-white/[0.02] transition-colors cursor-pointer"
                      onClick={() => setSelectedReq(req)}
                    >
                      <td className="px-3 py-2.5 font-mono text-[10px]" style={{ color: 'var(--app-text-faint)' }}>{req.id}</td>
                      <td className="px-3 py-2.5 font-medium max-w-[180px] truncate" style={{ color: 'var(--app-text)' }}>{req.subject}</td>
                      <td className="px-3 py-2.5" style={{ color: 'var(--app-text-faint)' }}>{req.category}</td>
                      <td className="px-3 py-2.5">
                        <span className={`inline-flex px-2 py-0.5 rounded border text-[10px] font-semibold ${sm.bg} ${sm.text} ${sm.border}`}>{sm.label}</span>
                      </td>
                      <td className={`px-3 py-2.5 text-[10px] font-semibold ${pm.color}`}>{pm.label}</td>
                      <td className="px-3 py-2.5" style={{ color: 'var(--app-text-faint)' }}>{req.user}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap" style={{ color: 'var(--app-text-faint)' }}>{req.created}</td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr><td colSpan={7} className="px-3 py-8 text-center text-xs" style={{ color: 'var(--app-text-faint)' }}>No requests in this category.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Request detail modal */}
      {selectedReq && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50" onClick={() => setSelectedReq(null)}>
          <div className="bg-app-panel border border-app-border rounded-xl p-6 w-full max-w-md shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--app-text-faint)' }}>{selectedReq.id}</p>
                <h3 className="text-sm font-bold mt-0.5" style={{ color: 'var(--app-text)' }}>{selectedReq.subject}</h3>
              </div>
              <button onClick={() => setSelectedReq(null)} className="text-slate-500 hover:text-white text-xl leading-none">×</button>
            </div>
            <div className="grid grid-cols-2 gap-3 text-xs mb-4">
              {[
                { label: 'Category', value: selectedReq.category },
                { label: 'Status',   value: STATUS_META[selectedReq.status]?.label },
                { label: 'Priority', value: PRIORITY_META[selectedReq.priority]?.label },
                { label: 'User',     value: selectedReq.user },
                { label: 'Created',  value: selectedReq.created },
              ].map(({ label, value }) => (
                <div key={label} className="bg-white/[0.03] rounded-lg p-3">
                  <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--app-text-faint)' }}>{label}</p>
                  <p className="font-semibold" style={{ color: 'var(--app-text)' }}>{value}</p>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <button
                className="flex-1 py-2 rounded-lg text-xs font-semibold transition-all"
                style={{ background: 'var(--app-accent-bg)', border: '1px solid var(--app-accent-border)', color: 'var(--app-accent)' }}
                onClick={() => setSelectedReq(null)}
              >Mark Resolved</button>
              <button
                className="flex-1 py-2 rounded-lg text-xs font-semibold transition-all"
                style={{ background: 'transparent', border: '1px solid var(--app-border)', color: 'var(--app-text-faint)' }}
                onClick={() => setSelectedReq(null)}
              >Reassign</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
