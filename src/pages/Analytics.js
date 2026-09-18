import React, { useState, useEffect, useMemo } from 'react';
import { Line, Doughnut, Bar } from 'react-chartjs-2';
import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement,
  LineElement, BarElement, ArcElement, Tooltip, Legend, Filler,
} from 'chart.js';
import KPICard, {
  IcoLeaf, IcoTrendUp, IcoShield, IcoGlobe,
  IcoBarChart, IcoCheck, IcoHourglass,
  IcoBolt, IcoSignal, IcoThermometer,
} from '../components/KPICard';
import { getChartTokens, chartTooltip, chartScales, ChartTimeframeControl, TIMEFRAME_OPTIONS, getTimeframeOption, buildTimeframeLabels, resampleSeries } from '../components/chartUtils';
import ZoneFilterBar from '../components/ZoneFilterBar';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, ArcElement, Tooltip, Legend, Filler);

// ── Analytics (Reports) data ──────────────────────────────────────────────────
const METRIC_A = [62,65,68,66,71,74,73,78,80,82,81,84];
const METRIC_B = [38,36,34,37,33,31,30,27,25,23,24,21];

const BREAKDOWN = {
  labels: ['Category A','Category B','Category C','Category D','Other'],
  data:   [38,24,18,12,8],
  colors: ['#10b981','#3b82f6','#8b5cf6','#f59e0b','#64748b'],
};

const INITIATIVES = [
  { name:'Initiative Alpha', progress:82, status:'on-track',  target:'90%', due:'Q3 2026' },
  { name:'Initiative Beta',  progress:61, status:'at-risk',   target:'75%', due:'Q2 2026' },
  { name:'Initiative Gamma', progress:95, status:'completed', target:'90%', due:'Q1 2026' },
  { name:'Initiative Delta', progress:44, status:'at-risk',   target:'70%', due:'Q4 2026' },
];
const INIT_STATUS = {
  'on-track':  { label:'On Track',  text:'text-emerald-400', bar:'bg-emerald-500' },
  'at-risk':   { label:'At Risk',   text:'text-amber-400',   bar:'bg-amber-500'   },
  'completed': { label:'Completed', text:'text-blue-400',    bar:'bg-blue-500'    },
};

// ── Workflow data ─────────────────────────────────────────────────────────────
const STAGES = [
  { id:'STG-1', name:'Intake',     items:240, throughput:95, avgTime:'8 min',  status:'normal'    },
  { id:'STG-2', name:'Validation', items:228, throughput:88, avgTime:'12 min', status:'normal'    },
  { id:'STG-3', name:'Processing', items:195, throughput:72, avgTime:'22 min', status:'attention' },
  { id:'STG-4', name:'Review',     items:150, throughput:91, avgTime:'15 min', status:'normal'    },
  { id:'STG-5', name:'Output',     items:142, throughput:98, avgTime:'5 min',  status:'normal'    },
];
const STAGE_META = {
  normal:    { dot:'bg-emerald-400', text:'text-emerald-400', label:'Normal'    },
  attention: { dot:'bg-amber-400',   text:'text-amber-400',   label:'Attention' },
  critical:  { dot:'bg-red-400',     text:'text-red-400',     label:'Critical'  },
};

// ── Monitor data ──────────────────────────────────────────────────────────────
const UNITS = [
  { id:'UNIT-01', name:'Unit 1', status:'online',  output:42, capacity:50, uptime:99.1, temp:82 },
  { id:'UNIT-02', name:'Unit 2', status:'online',  output:38, capacity:50, uptime:97.4, temp:79 },
  { id:'UNIT-03', name:'Unit 3', status:'warning', output:21, capacity:50, uptime:88.2, temp:94 },
  { id:'UNIT-04', name:'Unit 4', status:'offline', output:0,  capacity:50, uptime:0,    temp:22 },
];
const UNIT_META = {
  online:  { label:'Online',  dot:'bg-emerald-400 animate-pulse', text:'text-emerald-400' },
  warning: { label:'Warning', dot:'bg-amber-400',                 text:'text-amber-400'   },
  offline: { label:'Offline', dot:'bg-red-400',                   text:'text-red-400'     },
};

function makeSeries(base, variance, length = 24) {
  return Array.from({ length }, (_, i) =>
    +(base + (Math.sin(i * 0.4) * variance + (Math.random() - 0.5) * variance * 0.5)).toFixed(1)
  );
}

// ── Tabs ──────────────────────────────────────────────────────────────────────
const TABS = ['Analytics', 'Workflow', 'Monitor'];

// ── Analytics tab ─────────────────────────────────────────────────────────────
function AnalyticsTab() {
  const [activeMetric, setActiveMetric] = useState('trend');
  const [timeframe, setTimeframe] = useState('7D');
  const tokens = getChartTokens();
  const activeFrame = getTimeframeOption(TIMEFRAME_OPTIONS.trend, timeframe);

  const trendData = useMemo(() => ({
    labels: buildTimeframeLabels(activeFrame.value, activeFrame.points),
    datasets: [
      { label:'Metric A', data:resampleSeries(METRIC_A, activeFrame.points), borderColor:'rgba(16,185,129,0.9)', backgroundColor:'rgba(16,185,129,0.06)', borderWidth:2, pointRadius:0, fill:true, tension:0.4 },
      { label:'Metric B', data:resampleSeries(METRIC_B, activeFrame.points), borderColor:'rgba(239,68,68,0.8)',  backgroundColor:'rgba(239,68,68,0.04)', borderWidth:2, pointRadius:0, fill:true, tension:0.4 },
      { label:'Target',   data:Array(activeFrame.points).fill(85),           borderColor:tokens.warningBar, borderWidth:1.5, borderDash:[4,3], pointRadius:0, fill:false, tension:0 },
    ], // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [timeframe]);
  const trendOpts = {
    responsive:true, maintainAspectRatio:false,
    plugins:{
      legend:{ display:true, labels:{ color:tokens.legendColor, font:{size:10}, boxWidth:10, filter:i => !i.text.startsWith('Target') } },
      tooltip:chartTooltip(),
    },
    scales:{ ...chartScales(), y:{ ...chartScales().y, max:100 } },
  };
  const donutData = {
    labels: BREAKDOWN.labels,
    datasets: [{ data:BREAKDOWN.data, backgroundColor:BREAKDOWN.colors, borderWidth:0, hoverOffset:4 }],
  };
  const donutOpts = {
    responsive:true, maintainAspectRatio:false,
    plugins:{
      legend:{ display:true, position:'right', labels:{ color:tokens.legendColor, font:{size:10}, boxWidth:10 } },
      tooltip:chartTooltip(),
    },
    cutout:'65%',
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard label="Overall Score"      value={84}    unit=" / 100" icon={<IcoLeaf />}    color="text-emerald-400" trend={6.2} />
        <KPICard label="YoY Improvement"    value={12.4}  unit="%"      icon={<IcoTrendUp />} color="text-blue-400"    />
        <KPICard label="Target Gap"         value={1}     unit=" pts"   icon={<IcoShield />}  color="text-amber-400"   />
        <KPICard label="Active Initiatives" value={INITIATIVES.filter(i => i.status !== 'completed').length} icon={<IcoGlobe />} color="text-indigo-400" />
      </div>
      <div className="flex gap-2">
        {[{ key:'trend', label:'Trend' }, { key:'breakdown', label:'Breakdown' }].map(m => (
          <button key={m.key} onClick={() => setActiveMetric(m.key)} className="px-3 py-1.5 text-xs font-semibold rounded transition-all"
            style={{ background: activeMetric === m.key ? 'var(--app-accent-bg)' : 'transparent', border:`1px solid ${activeMetric === m.key ? 'var(--app-accent-border)' : 'var(--app-border)'}`, color: activeMetric === m.key ? 'var(--app-accent)' : 'var(--app-text-faint)' }}>
            {m.label}
          </button>
        ))}
      </div>
      <div className="bg-app-panel border border-app-border rounded-lg p-3 relative">
        <div className="flex items-center gap-1 mb-0.5">
          <h4 className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider flex-1">
            {activeMetric === 'trend' ? 'Performance Trend' : 'Category Breakdown'}
          </h4>
          {activeMetric === 'trend' && <ChartTimeframeControl options={TIMEFRAME_OPTIONS.trend} value={timeframe} onChange={setTimeframe} />}
        </div>
        <div className="mb-2" />
        <div style={{ height:220 }}>
          {activeMetric === 'trend'     && <Line data={trendData} options={trendOpts} />}
          {activeMetric === 'breakdown' && <Doughnut data={donutData} options={donutOpts} />}
        </div>
      </div>
      <div className="bg-app-panel border border-app-border rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-app-border">
          <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color:'var(--app-text-faint)' }}>Initiative Tracker</h3>
        </div>
        <div className="divide-y divide-app-border">
          {INITIATIVES.map(init => {
            const sm = INIT_STATUS[init.status];
            return (
              <div key={init.name} className="flex items-center gap-4 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1.5">
                    <p className="text-xs font-medium" style={{ color:'var(--app-text)' }}>{init.name}</p>
                    <span className={`text-[10px] font-semibold ${sm.text}`}>{sm.label}</span>
                  </div>
                  <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${sm.bar}`} style={{ width:`${init.progress}%` }} />
                  </div>
                </div>
                <div className="text-right shrink-0 w-28 text-[10px]" style={{ color:'var(--app-text-faint)' }}>
                  <div>{init.progress}% / Target {init.target}</div>
                  <div>Due {init.due}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Workflow tab ──────────────────────────────────────────────────────────────
function WorkflowTab() {
  const [view, setView] = useState('pipeline');
  const [timeframe, setTimeframe] = useState('24H');
  const tokens = getChartTokens();

  const totalIn  = STAGES[0].items;
  const totalOut = STAGES[STAGES.length - 1].items;
  const backlog  = totalIn - totalOut;
  const avgThroughput = (STAGES.reduce((s, st) => s + st.throughput, 0) / STAGES.length).toFixed(0);

  const barData = {
    labels: STAGES.map(s => s.name),
    datasets: [{
      label:'Items',
      data: STAGES.map(s => s.items),
      backgroundColor: STAGES.map(s => s.status === 'critical' ? tokens.dangerBar : s.status === 'attention' ? tokens.warningBar : tokens.successBar),
      borderRadius:4,
    }],
  };
  const barOpts = {
    responsive:true, maintainAspectRatio:false,
    plugins:{ legend:{ display:false }, tooltip:chartTooltip() },
    scales:chartScales(),
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard label="Items In"       value={totalIn}       icon={<IcoBarChart />}  color="text-blue-400"    />
        <KPICard label="Items Out"      value={totalOut}      icon={<IcoCheck />}     color="text-emerald-400" trend={4.1} />
        <KPICard label="Backlog"        value={backlog}       icon={<IcoHourglass />} color="text-amber-400"   />
        <KPICard label="Avg Throughput" value={avgThroughput} unit="%" icon={<IcoShield />} rag={+avgThroughput < 80 ? 'warning' : 'normal'} />
      </div>
      <div className="flex gap-2">
        {['pipeline','chart'].map(v => (
          <button key={v} onClick={() => setView(v)} className="px-3 py-1.5 text-xs font-semibold rounded transition-all capitalize"
            style={{ background: view === v ? 'var(--app-accent-bg)' : 'transparent', border:`1px solid ${view === v ? 'var(--app-accent-border)' : 'var(--app-border)'}`, color: view === v ? 'var(--app-accent)' : 'var(--app-text-faint)' }}>
            {v === 'pipeline' ? 'Pipeline View' : 'Chart View'}
          </button>
        ))}
      </div>
      {view === 'pipeline' && (
        <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          {STAGES.map((stage, idx) => {
            const sm  = STAGE_META[stage.status];
            const pct = totalIn > 0 ? (stage.items / totalIn) * 100 : 0;
            return (
              <div key={stage.id} className="bg-app-panel border border-app-border rounded-xl p-4 relative">
                {idx < STAGES.length - 1 && (
                  <div className="hidden lg:block absolute -right-4 top-1/2 -translate-y-1/2 z-10 text-slate-600 text-lg">›</div>
                )}
                <div className="flex items-center justify-between mb-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color:'var(--app-text-faint)' }}>{stage.id}</p>
                  <span className={`flex items-center gap-1 text-[10px] font-semibold ${sm.text}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${sm.dot}`} />{sm.label}
                  </span>
                </div>
                <p className="text-sm font-bold mb-3" style={{ color:'var(--app-text)' }}>{stage.name}</p>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span style={{ color:'var(--app-text-faint)' }}>Items</span>
                    <span className="font-semibold" style={{ color:'var(--app-text)' }}>{stage.items}</span>
                  </div>
                  <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${sm.dot.replace(' animate-pulse','')}`} style={{ width:`${pct}%` }} />
                  </div>
                  <div className="flex justify-between">
                    <span style={{ color:'var(--app-text-faint)' }}>Throughput</span>
                    <span style={{ color:'var(--app-text)' }}>{stage.throughput}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span style={{ color:'var(--app-text-faint)' }}>Avg Time</span>
                    <span style={{ color:'var(--app-text)' }}>{stage.avgTime}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {view === 'chart' && (
        <div className="bg-app-panel border border-app-border rounded-lg p-3 relative">
          <div className="flex items-center gap-1 mb-0.5">
            <h4 className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider flex-1">Items per Stage</h4>
            <ChartTimeframeControl options={TIMEFRAME_OPTIONS.realtime} value={timeframe} onChange={setTimeframe} />
          </div>
          <div className="mb-2" />
          <div style={{ height:240 }}><Bar data={barData} options={barOpts} /></div>
        </div>
      )}
    </div>
  );
}

// ── Monitor tab ───────────────────────────────────────────────────────────────
function MonitorTab() {
  const [tick, setTick] = useState(0);
  const [timeframe, setTimeframe] = useState('24H');
  const tokens = getChartTokens();
  const activeFrame = getTimeframeOption(TIMEFRAME_OPTIONS.realtime, timeframe);

  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 5000);
    return () => clearInterval(id);
  }, []);

  const totalOutput  = UNITS.reduce((s, u) => s + u.output, 0);
  const onlineUnits  = UNITS.filter(u => u.status === 'online').length;
  const avgUptime    = (UNITS.filter(u => u.uptime > 0).reduce((s, u) => s + u.uptime, 0) / Math.max(onlineUnits, 1)).toFixed(1);
  const warningUnits = UNITS.filter(u => u.status === 'warning').length;

  const labels = Array.from({ length: activeFrame.points }, (_, i) => `${i}:00`);
  const lineData = {
    labels,
    datasets: [
      { label:'Total Output', data:makeSeries(totalOutput, 8, activeFrame.points), borderColor:'rgba(99,102,241,0.9)', backgroundColor:'rgba(99,102,241,0.08)', borderWidth:2, pointRadius:0, fill:true, tension:0.4 },
      { label:'Capacity', data:Array(activeFrame.points).fill(UNITS.reduce((s, u) => s + u.capacity, 0)), borderColor:tokens.warningBar, borderWidth:1.5, borderDash:[4,3], pointRadius:0, fill:false, tension:0 },
    ],
  };
  const lineOpts = {
    responsive:true, maintainAspectRatio:false,
    plugins:{ legend:{ display:true, labels:{ color:tokens.legendColor, font:{size:10}, boxWidth:10 } }, tooltip:chartTooltip() },
    scales:chartScales(),
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 flex-1">
          <KPICard label="Total Output" value={totalOutput} unit=" units"              icon={<IcoBolt />}        color="text-indigo-400"  trend={3.4} />
          <KPICard label="Online Units" value={`${onlineUnits}/${UNITS.length}`}       icon={<IcoCheck />}       color="text-emerald-400" />
          <KPICard label="Avg Uptime"   value={avgUptime}   unit="%"                   icon={<IcoSignal />}      color="text-blue-400"    />
          <KPICard label="Warnings"     value={warningUnits}                           icon={<IcoThermometer />} rag={warningUnits > 0 ? 'warning' : 'normal'} />
        </div>
        <span className="text-[10px] px-2.5 py-1 rounded-full font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 shrink-0">● LIVE</span>
      </div>
      <div className="bg-app-panel border border-app-border rounded-lg p-3 relative">
        <div className="flex items-center gap-1 mb-0.5">
          <h4 className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider flex-1">Output vs Capacity</h4>
          <ChartTimeframeControl options={TIMEFRAME_OPTIONS.realtime} value={timeframe} onChange={setTimeframe} />
        </div>
        <div className="mb-2" />
        <div style={{ height:200 }}><Line key={tick} data={lineData} options={lineOpts} /></div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {UNITS.map(unit => {
          const sm = UNIT_META[unit.status];
          const fillPct = unit.capacity > 0 ? (unit.output / unit.capacity) * 100 : 0;
          return (
            <div key={unit.id} className="bg-app-panel border border-app-border rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color:'var(--app-text-faint)' }}>{unit.id}</p>
                  <p className="text-sm font-bold mt-0.5" style={{ color:'var(--app-text)' }}>{unit.name}</p>
                </div>
                <span className={`flex items-center gap-1.5 text-[10px] font-semibold ${sm.text}`}>
                  <span className={`w-2 h-2 rounded-full ${sm.dot}`} />{sm.label}
                </span>
              </div>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between">
                  <span style={{ color:'var(--app-text-faint)' }}>Output</span>
                  <span style={{ color:'var(--app-text)' }}>{unit.output} / {unit.capacity}</span>
                </div>
                <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${fillPct > 80 ? 'bg-red-500' : fillPct > 60 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width:`${fillPct}%` }} />
                </div>
                <div className="flex justify-between pt-1">
                  <span style={{ color:'var(--app-text-faint)' }}>Uptime</span>
                  <span style={{ color:'var(--app-text)' }}>{unit.uptime > 0 ? `${unit.uptime}%` : '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color:'var(--app-text-faint)' }}>Temperature</span>
                  <span className={unit.temp > 90 ? 'text-red-400' : unit.temp > 80 ? 'text-amber-400' : 'text-emerald-400'}>
                    {unit.temp > 0 ? `${unit.temp}°` : '—'}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────
export default function AnalyticsPage() {
  const [tab, setTab] = useState('Analytics');
  const [zone, setZone] = useState('all');
  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-lg font-bold" style={{ color:'var(--app-text)' }}>Analytics</h1>
          <p className="text-xs mt-0.5" style={{ color:'var(--app-text-faint)' }}>Performance reporting, workflow pipeline, and live system monitoring</p>
        </div>
        <div className="flex gap-1 bg-app-panel border border-app-border rounded-lg p-1">
          {TABS.map(t => (
            <button key={t} onClick={() => setTab(t)} className="px-4 py-1.5 rounded text-xs font-semibold transition-all"
              style={{ background: tab === t ? 'var(--app-accent-bg)' : 'transparent', color: tab === t ? 'var(--app-accent)' : 'var(--app-text-faint)', border:`1px solid ${tab === t ? 'var(--app-accent-border)' : 'transparent'}` }}>
              {t}
            </button>
          ))}
        </div>
      </div>
      <ZoneFilterBar value={zone} onChange={setZone} />
      {tab === 'Analytics' && <AnalyticsTab />}
      {tab === 'Workflow'  && <WorkflowTab />}
      {tab === 'Monitor'   && <MonitorTab />}
    </div>
  );
}
