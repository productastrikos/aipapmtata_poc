import React, { useContext, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { DataContext } from '../services/socket';
import KPIDetailModal from '../components/KPIDetailModal';
import KPICard, { IcoCoverage, IcoAlert, IcoRoute, IcoTrash, IcoRecycle, IcoBarChart } from '../components/KPICard';
import ZoneFilterBar from '../components/ZoneFilterBar';
import { ChartTimeframeControl, TIMEFRAME_OPTIONS, getTimeframeOption, buildTimeframeLabels, resampleSeries, CHART_PALETTES, getChartTokens, chartTooltip, chartScales, getCSSVar } from '../components/chartUtils';
import { Line, Doughnut, Bar } from 'react-chartjs-2';
import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement,
  BarElement, ArcElement, Tooltip, Legend, Filler
} from 'chart.js';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, ArcElement, Tooltip, Legend, Filler);

// ── Custom chart plugin: full-width threshold lines ──────────────────────────
const fullWidthLinePlugin = {
  id: 'fullWidthLines',
  afterDatasetsDraw(chart) {
    const lines = chart.options.fullWidthLines;
    if (!lines || !lines.length) return;
    const { ctx, chartArea: { left, right }, scales } = chart;
    const yScale = scales.y;
    if (!yScale) return;
    ctx.save();
    lines.forEach(({ value, color, dash, width }) => {
      const yPos = yScale.getPixelForValue(value);
      ctx.beginPath();
      ctx.moveTo(left, yPos);
      ctx.lineTo(right, yPos);
      ctx.strokeStyle = color || 'rgba(255,255,255,0.3)';
      ctx.lineWidth = width || 1.5;
      ctx.setLineDash(dash || [4, 3]);
      ctx.stroke();
    });
    ctx.setLineDash([]);
    ctx.restore();
  },
};
ChartJS.register(fullWidthLinePlugin);

// ── Segment data ─────────────────────────────────────────────────────────────
const SEGMENT_GROUP_MAP = {
  'Seg A': ['S1'],
  'Seg B': ['S2'],
  'Seg C': ['S3'],
  'Seg D': ['S4'],
  'Seg E': ['S5'],
};

const SEGMENT_DATA = [
  { segmentId:'S1', name:'Segment A – North',   groups:['Group A1','Group A2','Group A3'], utilization:62.4, status:'normal',    processedToday:1012, exceptions:18 },
  { segmentId:'S2', name:'Segment B – East',    groups:['Group B1','Group B2','Group B3'], utilization:71.2, status:'attention', processedToday:812,  exceptions:34 },
  { segmentId:'S3', name:'Segment C – Central', groups:['Group C1','Group C2','Group C3'], utilization:54.8, status:'normal',    processedToday:818,  exceptions:12 },
  { segmentId:'S4', name:'Segment D – West',    groups:['Group D1','Group D2','Group D3'], utilization:66.8, status:'attention', processedToday:804,  exceptions:21 },
  { segmentId:'S5', name:'Segment E – South',   groups:['Group E1','Group E2','Group E3'], utilization:83.6, status:'attention', processedToday:984,  exceptions:38 },
];
const SEGMENT_TOTAL_PTS = SEGMENT_DATA.reduce((s, z) => s + z.processedToday, 0);

function dedupeAlerts(list = []) {
  const seen = new Set();
  return list.filter((alert) => {
    const key = [alert.assetId || '', alert.category || '', alert.title || '', alert.message || '', alert.zone || ''].join('|').toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function makeChartDefaults() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false }, tooltip: chartTooltip({ titleFont: { size: 11 }, bodyFont: { size: 10 } }) },
    scales: chartScales(),
  };
}

const ACTIVITY_PROFILE        = [18,12,8,5,10,42,78,91,95,89,82,74,61,58,72,88,86,79,62,44,38,31,24,19];
const PRIMARY_SERIES_PROFILE  = [4,3,3,2,3,8,16,22,25,26,24,22,19,18,21,24,23,19,13,10,8,7,6,5];
const SECONDARY_SERIES_PROFILE= [2,1,1,1,1,3,6,8,9,9,8,8,7,7,8,9,8,7,5,4,3,2,2,2];

// ── MiniChart ─────────────────────────────────────────────────────────────────
function MiniChart({ title, subtitle, type, data, height = 120, showLegend = false, yMax, yLabel, thresholds, onInfo, timeframes, defaultTimeframe }) {
  const ChartComp = type === 'doughnut' ? Doughnut : type === 'bar' ? Bar : Line;
  const [selectedTimeframe, setSelectedTimeframe] = useState(defaultTimeframe || timeframes?.[0]?.value);
  const isLight = typeof document !== 'undefined' && document.body?.dataset?.theme === 'light';
  const activeFrame = timeframes ? getTimeframeOption(timeframes, selectedTimeframe) : null;
  const displayData = useMemo(() => {
    if (!activeFrame || type === 'doughnut') return data;
    return {
      labels: buildTimeframeLabels(activeFrame.value, activeFrame.points),
      datasets: data.datasets.map((ds) => ({
        ...ds,
        data: resampleSeries(
          activeFrame.dataWindow ? ds.data.slice(-activeFrame.dataWindow) : ds.data,
          activeFrame.points
        ),
      })),
    };
  }, [activeFrame, data, type]);

  const chartDataWithThresholds = useMemo(() => {
    if (type === 'doughnut' || type === 'bar' || !thresholds) return displayData;
    const nLabels = displayData.labels?.length || 24;
    const extra = [];
    const t = getChartTokens();
    if (thresholds.normalLine != null) extra.push({ label: '–– Normal', data: Array(nLabels).fill(thresholds.normalLine), borderColor: t.successBar, borderWidth: 1.5, borderDash: [6, 4], pointRadius: 0, fill: false, tension: 0, order: 10 });
    if (thresholds.warningLine != null) extra.push({ label: '–– Warning', data: Array(nLabels).fill(thresholds.warningLine), borderColor: t.warningBar, borderWidth: 1.5, borderDash: [4, 3], pointRadius: 0, fill: false, tension: 0, order: 10 });
    if (thresholds.criticalLine != null) extra.push({ label: '–– Critical', data: Array(nLabels).fill(thresholds.criticalLine), borderColor: t.dangerBar, borderWidth: 1.5, borderDash: [3, 3], pointRadius: 0, fill: false, tension: 0, order: 10 });
    return { ...displayData, datasets: [...displayData.datasets, ...extra] };
  }, [displayData, type, thresholds, isLight]); // eslint-disable-line react-hooks/exhaustive-deps

  const legendCfg = showLegend ? {
    display: true, position: type === 'doughnut' ? 'right' : 'top',
    labels: { color: getChartTokens().legendColor, font: { size: 10 }, boxWidth: 10, usePointStyle: true, padding: 10, filter: (item) => !item.text.startsWith('––') },
  } : { display: false };

  const doughnutTooltip = { ...chartTooltip(), callbacks: { label: (ctx) => { const total = ctx.dataset.data.reduce((a, b) => a + b, 0); const pct = total > 0 ? ((ctx.parsed / total) * 100).toFixed(1) : '0.0'; return ` ${ctx.label}: ${pct}%`; } } };
  const cd = makeChartDefaults();
  const tOpts = getChartTokens();
  const opts = type === 'doughnut' ? { responsive: true, maintainAspectRatio: false, plugins: { legend: legendCfg, tooltip: doughnutTooltip }, cutout: '65%' } : {
    ...cd,
    plugins: { ...cd.plugins, legend: legendCfg },
    ...(type === 'bar' && thresholds ? { fullWidthLines: [...(thresholds.normalLine != null ? [{ value: thresholds.normalLine, color: tOpts.successBar, dash: [6, 4] }] : []), ...(thresholds.warningLine != null ? [{ value: thresholds.warningLine, color: tOpts.warningBar, dash: [4, 3] }] : []), ...(thresholds.criticalLine != null ? [{ value: thresholds.criticalLine, color: tOpts.dangerBar, dash: [3, 3] }] : [])] } : {}),
    scales: { x: { ...cd.scales.x }, y: { ...cd.scales.y, ...(yMax ? { max: yMax } : {}), ...(yLabel ? { title: { display: true, text: yLabel, color: getCSSVar('--app-text-faint'), font: { size: 8 } } } : {}) } },
  };

  return (
    <div className="bg-app-panel border border-app-border rounded-lg p-3 relative">
      <div className="flex items-center gap-1 mb-0.5">
        <h4 className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider flex-1">{title}</h4>
        <ChartTimeframeControl options={timeframes} value={activeFrame?.value} onChange={setSelectedTimeframe} />
        <button onClick={() => onInfo && onInfo({ title, subtitle, type, data: displayData, yMax, yLabel, showLegend, thresholds, timeframes, selectedTimeframe: activeFrame?.value })} className="w-4 h-4 rounded-full bg-slate-800 border border-slate-700 text-slate-500 hover:text-slate-300 hover:border-slate-500 flex items-center justify-center text-[9px] transition-colors shrink-0" title="Open chart details">ℹ</button>
      </div>
      {subtitle && <p className="text-[9px] text-slate-400 mt-0 mb-2 leading-snug">{subtitle}</p>}
      {!subtitle && <div className="mb-2" />}
      <div style={{ height }}>
        <ChartComp data={type === 'doughnut' ? displayData : chartDataWithThresholds} options={opts} />
      </div>
    </div>
  );
}

// ── OverviewPanel ─────────────────────────────────────────────────────────────
function OverviewPanel() {
  const tOpts = getChartTokens();
  const overviewData = {
    labels: ['Seg A','Seg B','Seg C','Seg D','Seg E'],
    datasets: [{ label: 'Utilization %', data: [62.4, 71.2, 54.8, 66.8, 83.6], backgroundColor: ['#10b981','#f59e0b','#10b981','#f59e0b','#ef4444'], borderRadius: 4 }]
  };
  const opts = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: false }, tooltip: chartTooltip() },
    fullWidthLines: [{ value: 80, color: tOpts.dangerBar, dash: [4, 3] }, { value: 65, color: tOpts.warningBar, dash: [4, 3] }],
    scales: { x: { ...chartScales().x }, y: { ...chartScales().y, max: 100 } },
  };
  return (
    <div className="bg-app-panel border border-app-border rounded-xl overflow-hidden flex flex-col" style={{ height: 460 }}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-app-border shrink-0">
        <h3 className="text-sm font-bold text-white">Segment Overview</h3>
        <span className="text-[10px] text-slate-500 bg-slate-800 border border-slate-700 px-2 py-0.5 rounded">Live</span>
      </div>
      <div className="flex-1 p-4 grid grid-cols-1 gap-4">
        <div style={{ height: 200 }}>
          <Bar data={overviewData} options={opts} />
        </div>
        <div className="grid grid-cols-5 gap-2">
          {SEGMENT_DATA.map(seg => {
            const color = seg.utilization > 80 ? 'text-red-400 bg-red-500/10 border-red-500/30' : seg.utilization > 65 ? 'text-amber-400 bg-amber-500/10 border-amber-500/30' : 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30';
            return (
              <div key={seg.segmentId} className={`border rounded-lg p-2 text-center ${color}`}>
                <p className="text-xs font-bold">{seg.utilization.toFixed(0)}%</p>
                <p className="text-[9px] text-slate-400 mt-0.5">{seg.segmentId}</p>
              </div>
            );
          })}
        </div>
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: 'Total Processed', value: SEGMENT_TOTAL_PTS.toLocaleString(), color: 'text-blue-400' },
            { label: 'Total Exceptions', value: SEGMENT_DATA.reduce((s,z)=>s+z.exceptions,0), color: 'text-amber-400' },
            { label: 'Avg Utilization', value: (SEGMENT_DATA.reduce((s,z)=>s+z.utilization,0)/SEGMENT_DATA.length).toFixed(1)+'%', color: 'text-emerald-400' },
          ].map(item => (
            <div key={item.label} className="bg-white/[0.03] border border-white/[0.06] rounded-lg p-3 text-center">
              <p className={`text-sm font-bold ${item.color}`}>{item.value}</p>
              <p className="text-[10px] text-slate-500 mt-0.5">{item.label}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── SegmentStatusRow ──────────────────────────────────────────────────────────
function SegmentStatusRow({ segment }) {
  const util = segment.utilization || 0;
  const utilColor = util > 85 ? 'bg-red-500' : util > 65 ? 'bg-yellow-500' : 'bg-emerald-500';
  const total = segment.processedToday + segment.exceptions;
  const performance = total > 0 ? (segment.processedToday / total * 100).toFixed(1) : '0.0';
  const perfColor = parseFloat(performance) >= 95 ? 'text-emerald-400' : parseFloat(performance) >= 80 ? 'text-amber-400' : 'text-red-400';
  return (
    <div className="px-3 py-2 hover:bg-white/[0.02] rounded border-b border-white/[0.03] last:border-0">
      <div className="flex items-center gap-2 mb-1.5">
        <div className="w-36 text-xs text-slate-300 font-medium truncate">{segment.name}</div>
        <div className="flex-1">
          <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
            <div className={`h-full rounded-full ${utilColor} transition-all`} style={{ width: `${util}%` }} />
          </div>
        </div>
        <div className="text-[10px] text-slate-500 w-16 text-right shrink-0">{util.toFixed(0)}% util.</div>
      </div>
      <div className="flex items-center justify-between">
        <div className="flex gap-1 flex-wrap">
          {(segment.groups || []).map(g => (
            <span key={g} className="text-[9px] px-1.5 py-0.5 bg-white/[0.04] border border-white/[0.06] rounded text-slate-500">{g}</span>
          ))}
        </div>
        <div className="flex items-center gap-3 text-[10px] shrink-0 ml-2">
          <span className={`font-semibold ${perfColor}`}>{performance}% perf.</span>
          <span className="text-slate-500">✓ {segment.processedToday} units</span>
          <span className="text-red-500/70">✗ {segment.exceptions} excl.</span>
        </div>
      </div>
    </div>
  );
}

// ── GraphInfoPanel (slide-in detail) ─────────────────────────────────────────
function GraphInfoPanel({ chart, onClose }) {
  const isLight = typeof document !== 'undefined' && document.body?.dataset?.theme === 'light';
  const doughnutTooltip = useMemo(() => ({ ...chartTooltip(), callbacks: { label: (ctx) => { const total = ctx.dataset.data.reduce((a, b) => a + b, 0); const pct = total > 0 ? ((ctx.parsed / total) * 100).toFixed(1) : '0.0'; return ` ${ctx.label}: ${pct}%`; } } }), [isLight]); // eslint-disable-line react-hooks/exhaustive-deps
  const displayData = useMemo(() => {
    if (!chart || chart.type === 'doughnut' || chart.type === 'bar' || !chart.thresholds) return chart?.data;
    const nLabels = chart.data.labels?.length || 24;
    const extra = [];
    const t = getChartTokens();
    if (chart.thresholds.normalLine != null) extra.push({ label: '–– Normal', data: Array(nLabels).fill(chart.thresholds.normalLine), borderColor: t.successBar, borderWidth: 1.5, borderDash: [6, 4], pointRadius: 0, fill: false, tension: 0, order: 10 });
    if (chart.thresholds.warningLine != null) extra.push({ label: '–– Warning', data: Array(nLabels).fill(chart.thresholds.warningLine), borderColor: t.warningBar, borderWidth: 1.5, borderDash: [4, 3], pointRadius: 0, fill: false, tension: 0, order: 10 });
    if (chart.thresholds.criticalLine != null) extra.push({ label: '–– Critical', data: Array(nLabels).fill(chart.thresholds.criticalLine), borderColor: t.dangerBar, borderWidth: 1.5, borderDash: [3, 3], pointRadius: 0, fill: false, tension: 0, order: 10 });
    return { ...chart.data, datasets: [...chart.data.datasets, ...extra] };
  }, [chart, isLight]); // eslint-disable-line react-hooks/exhaustive-deps
  const opts = useMemo(() => {
    if (!chart) return {};
    const cd = makeChartDefaults();
    const t  = getChartTokens();
    const legendCfg = chart.showLegend ? { display: true, position: chart.type === 'doughnut' ? 'right' : 'top', labels: { color: t.legendColor, font: { size: 9 }, boxWidth: 8, usePointStyle: true, padding: 6, filter: (item) => !item.text.startsWith('––') } } : { display: false };
    if (chart.type === 'doughnut') return { responsive: true, maintainAspectRatio: false, plugins: { legend: legendCfg, tooltip: doughnutTooltip }, cutout: '65%' };
    return {
      ...cd, plugins: { ...cd.plugins, legend: legendCfg },
      ...(chart.type === 'bar' && chart.thresholds ? { fullWidthLines: [...(chart.thresholds.normalLine != null ? [{ value: chart.thresholds.normalLine, color: t.successBar, dash: [6, 4] }] : []), ...(chart.thresholds.warningLine != null ? [{ value: chart.thresholds.warningLine, color: t.warningBar, dash: [4, 3] }] : []), ...(chart.thresholds.criticalLine != null ? [{ value: chart.thresholds.criticalLine, color: t.dangerBar, dash: [3, 3] }] : [])] } : {}),
      scales: { x: { ...cd.scales.x }, y: { ...cd.scales.y, ...(chart.yMax ? { max: chart.yMax } : {}), ...(chart.yLabel ? { title: { display: true, text: chart.yLabel, color: t.tickColor, font: { size: 9 } } } : {}) } },
    };
  }, [chart, doughnutTooltip, isLight]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!chart) return null;
  const ChartComp = chart.type === 'doughnut' ? Doughnut : chart.type === 'bar' ? Bar : Line;
  const LEVEL_COLORS = {
    emerald: { box: 'bg-emerald-500/[0.06] border-emerald-500/25', label: 'text-emerald-400', dash: 'border-emerald-500' },
    amber:   { box: 'bg-amber-500/[0.06] border-amber-500/25',     label: 'text-amber-400',   dash: 'border-amber-500'   },
    red:     { box: 'bg-red-500/[0.06] border-red-500/25',         label: 'text-red-400',     dash: 'border-red-500'     },
  };
  const indicators = [];
  if (chart.thresholds) {
    const { normalLine, warningLine, criticalLine, normalDesc, warningDesc, criticalDesc, unit = '%' } = chart.thresholds;
    if (normalLine != null || normalDesc)     indicators.push({ level: 'Normal',   color: 'emerald', desc: normalDesc   || `≥ ${normalLine}${unit}`   });
    if (warningLine != null || warningDesc)   indicators.push({ level: 'Warning',  color: 'amber',   desc: warningDesc  || `≥ ${warningLine}${unit}`  });
    if (criticalLine != null || criticalDesc) indicators.push({ level: 'Critical', color: 'red',     desc: criticalDesc || `≥ ${criticalLine}${unit}` });
  }
  return (
    <div className="fixed inset-0 z-[1000] flex items-stretch justify-end" onClick={onClose}>
      <div className="relative border-l border-app-border w-full max-w-sm flex flex-col shadow-2xl" style={{ background: 'var(--app-bg)', boxShadow: '-4px 0 32px rgba(0,0,0,0.45)' }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-app-border shrink-0">
          <div><p className="text-[9px] font-bold text-white uppercase tracking-widest mb-0.5">Chart Details</p><h2 className="text-sm font-bold text-white leading-tight">{chart.title}</h2></div>
          <button onClick={onClose} className="w-6 h-6 rounded-full flex items-center justify-center text-slate-500 hover:text-white hover:bg-white/[0.06] transition-colors text-lg leading-none">×</button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {chart.subtitle && (<div><p className="text-[9px] font-bold text-white uppercase tracking-wider mb-2">About This Chart</p><p className="text-xs text-slate-300 leading-relaxed">{chart.subtitle}</p></div>)}
          <div><p className="text-[9px] font-bold text-white uppercase tracking-wider mb-2">Chart Preview</p><div className="bg-app-panel border border-app-border rounded-lg p-3" style={{ height: 220 }}><ChartComp data={chart.type === 'doughnut' ? chart.data : displayData} options={opts} /></div></div>
          {indicators.length > 0 && (<div><p className="text-[9px] font-bold text-white uppercase tracking-wider mb-2">Level Indicators</p><div className="space-y-2">{indicators.map(({ level, color, desc }) => { const s = LEVEL_COLORS[color]; return (<div key={level} className={`flex items-start gap-3 border rounded-lg p-3 ${s.box}`}><div className={`w-6 mt-1.5 border-t-2 border-dashed shrink-0 ${s.dash}`} /><div><span className={`text-[10px] font-bold uppercase ${s.label}`}>{level}</span><p className="text-[10px] text-slate-400 mt-0.5 leading-snug">{desc}</p></div></div>); })}</div></div>)}
        </div>
      </div>
    </div>
  );
}

// ── Dashboard (main export) ───────────────────────────────────────────────────
export default function Dashboard() {
  const { kpis, alerts, binsSummary } = useContext(DataContext);
  const [timeRange] = useState('24h');
  const [selectedKPIDetail, setSelectedKPIDetail] = useState(null);
  const [selectedChartInfo, setSelectedChartInfo] = useState(null);
  const [segmentFilter, setSegmentFilter] = useState('all');
  const isLight = typeof document !== 'undefined' && document.body?.dataset?.theme === 'light';

  const k = useMemo(() => kpis || {}, [kpis]);
  const bins = binsSummary || {};

  const filteredSegments = useMemo(() => {
    if (segmentFilter === 'all') return SEGMENT_DATA;
    const targetId = SEGMENT_GROUP_MAP[segmentFilter]?.[0];
    return SEGMENT_DATA.filter(s => s.segmentId === targetId);
  }, [segmentFilter]);

  const filteredAlerts = useMemo(() => {
    const uniqueAlerts = dedupeAlerts(alerts || []);
    if (segmentFilter === 'all') return uniqueAlerts;
    const ids = SEGMENT_GROUP_MAP[segmentFilter] || [];
    return uniqueAlerts.filter(a => !a.zone || ids.includes(a.zone));
  }, [alerts, segmentFilter]);

  const segmentKPIs = useMemo(() => {
    if (segmentFilter === 'all') return null;
    const seg = filteredSegments[0];
    if (!seg) return null;
    const totalPts = seg.processedToday + seg.exceptions;
    const perfRate = +(seg.processedToday / totalPts * 100).toFixed(1);
    const exceptPct = +(seg.exceptions / totalPts * 100).toFixed(1);
    const segVolume = Math.round((seg.processedToday / SEGMENT_TOTAL_PTS) * (k.dailyCollectionTons || 1325));
    return { ...k, collectionCoverage: perfRate, coverageTrend: +(perfRate - (k.collectionCoverage || 96.2)).toFixed(1), missedCollections: exceptPct, missedTrend: +(exceptPct - (k.missedCollections || 1.8)).toFixed(1), missedPoints: seg.exceptions, overdueAlerts: filteredAlerts.filter(a => a.status === 'active' || a.status === 'critical').length, dailyCollectionTons: segVolume, collectionRate: perfRate, zonesServed: 1, groupCount: seg.groups.length, avgUtilization: seg.utilization };
  }, [segmentFilter, filteredSegments, filteredAlerts, k]);

  const kz = segmentKPIs || k;
  const showKPIDetail = (data) => setSelectedKPIDetail(segmentFilter === 'all' ? data : { ...data, analysis: undefined });

  const activityTrendData = useMemo(() => {
    const scale = segmentKPIs ? (segmentKPIs.collectionCoverage / (k.collectionCoverage || 96.2)) : 1;
    return {
      labels: Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2,'0')}:00`),
      datasets: [{ label: 'Activity Rate %', data: (k.historicalCollection || ACTIVITY_PROFILE).map(v => Math.min(100, Math.round(v * scale))), borderColor: CHART_PALETTES.area.blue.border, backgroundColor: CHART_PALETTES.area.blue.fill, fill: true, tension: 0.4, pointRadius: 0, borderWidth: 1.5 }]
    };
  }, [k.historicalCollection, k.collectionCoverage, segmentKPIs, isLight]); // eslint-disable-line react-hooks/exhaustive-deps

  const categoryBreakdownData = useMemo(() => ({
    labels: ['Category A', 'Category B', 'Category C', 'Category D', 'Category E', 'Category F', 'Other'],
    datasets: [{ data: k.composition || [38, 22, 16, 10, 7, 4, 3], backgroundColor: ['#0ea5e9', '#f97316', '#ec4899', '#06b6d4', '#a3e635', '#6366f1', '#94a3b8'], borderWidth: 0 }]
  }), [k.composition, isLight]); // eslint-disable-line react-hooks/exhaustive-deps

  const segmentComparisonData = useMemo(() => {
    const segs = segmentFilter === 'all' ? SEGMENT_DATA : filteredSegments;
    return {
      labels: segs.map(s => s.name.split('–').pop().trim().split(' ').slice(0, 2).join(' ')),
      datasets: [{ label: 'Utilization %', data: segs.map(s => s.utilization), backgroundColor: (() => { const t = getChartTokens(); return segs.map(s => s.utilization > 75 ? t.dangerBar : s.utilization > 60 ? t.warningBar : t.successBar); })(), borderRadius: 4 }]
    };
  }, [segmentFilter, filteredSegments, isLight]); // eslint-disable-line react-hooks/exhaustive-deps

  const resourceActivityData = useMemo(() => ({
    labels: Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2,'0')}:00`),
    datasets: [
      { label: 'Active',    data: PRIMARY_SERIES_PROFILE,   borderColor: CHART_PALETTES.area.blue.border, backgroundColor: CHART_PALETTES.area.blue.fill, fill: true, tension: 0.4, pointRadius: 0, borderWidth: 1.5 },
      { label: 'Returning', data: SECONDARY_SERIES_PROFILE, borderColor: CHART_PALETTES.area.pink.border, backgroundColor: CHART_PALETTES.area.pink.fill, fill: true, tension: 0.4, pointRadius: 0, borderWidth: 1.5 },
    ]
  }), []);

  // Generic recent activity feed
  const recentActivity = [
    { text: 'Segment A performance target reached (98.2%)', time: '4 min ago', dot: '#10b981' },
    { text: 'Advisory ADV-001 acknowledged by operator', time: '12 min ago', dot: '#8b5cf6' },
    { text: 'Unit AST-003 returned to active status', time: '28 min ago', dot: '#3b82f6' },
    { text: 'Segment D scheduled maintenance completed', time: '1 hr ago', dot: '#f59e0b' },
    { text: 'New service request SRQ-010 — high priority', time: '2 hr ago', dot: '#ef4444' },
  ];

  return (
    <>
      {selectedKPIDetail && <KPIDetailModal kpi={selectedKPIDetail} onClose={() => setSelectedKPIDetail(null)} showAnalysis={segmentFilter === 'all'} />}
      {selectedChartInfo && <GraphInfoPanel chart={selectedChartInfo} onClose={() => setSelectedChartInfo(null)} />}
      <div className="h-full overflow-y-auto p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-white tracking-tight">Operations Dashboard</h1>
          <ZoneFilterBar value={segmentFilter} onChange={setSegmentFilter} />
        </div>

        {segmentFilter !== 'all' && filteredSegments.length > 0 && (() => {
          const seg = filteredSegments[0];
          return (
            <div className="flex items-center gap-3 bg-app-panel border border-app-border rounded-lg px-4 py-2">
              <span className="text-xs font-semibold text-white">{seg.name}</span>
              <span className="text-[11px] text-slate-400">Groups: <span className="text-slate-300">{seg.groups?.join(' · ')}</span></span>
              <span className="ml-auto text-[10px] text-slate-600 italic">Segment-scoped — KPIs and alerts reflect this segment only</span>
            </div>
          );
        })()}

        {/* KPI cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {(() => { const col = (kz.collectionCoverage || 96.2) >= 95 ? 'text-emerald-400' : (kz.collectionCoverage || 96.2) >= 85 ? 'text-amber-400' : 'text-red-400'; return (
            <KPICard icon={<IcoCoverage />} label="Performance Rate" value={`${(kz.collectionCoverage || 96.2).toFixed(1)}%`} trend={kz.coverageTrend || 1.1} color={col}
              subValues={[{ label: 'Exceptions', value: `${(kz.missedCollections || 1.8).toFixed(1)}%` }, { label: segmentFilter === 'all' ? 'Segments' : 'Groups', value: segmentFilter === 'all' ? `${kz.zonesServed || 5}/5` : `${kz.groupCount || 3}` }]}
              onClick={() => showKPIDetail({ icon: <IcoCoverage />, label: 'Performance Rate', value: (kz.collectionCoverage || 96.2).toFixed(1), unit: '%', trend: kz.coverageTrend || 1.1, color: col, thresholds: { green: 95, amber: 85 }, inverted: false, definition: 'Percentage of scheduled operations completed successfully. Replace this definition with a description of your own metric.', subValues: [{ label: 'Units Processed', value: kz.rfidScans || '4,430' }, { label: 'Exceptions', value: kz.missedPoints || 83 }, { label: 'At-Risk Groups', value: 1 }, { label: 'Target', value: '≥95% daily' }], target: '95%+ daily performance rate' })} />
          ); })()}
          {(() => { const col = (kz.missedCollections || 1.8) <= 2 ? 'text-emerald-400' : (kz.missedCollections || 1.8) <= 5 ? 'text-amber-400' : 'text-red-400'; return (
            <KPICard icon={<IcoAlert />} label="Exception Rate" value={`${(kz.missedCollections || 1.8).toFixed(1)}%`} trend={-(kz.missedTrend || -0.6)} color={col}
              subValues={[{ label: 'Count', value: kz.missedPoints || 83 }, { label: 'Alerts', value: kz.overdueAlerts || 2 }]}
              onClick={() => showKPIDetail({ icon: <IcoAlert />, label: 'Exception Rate', value: (kz.missedCollections || 1.8).toFixed(1), unit: '%', trend: -(kz.missedTrend || -0.6), color: col, thresholds: { green: 2, amber: 5 }, inverted: true, definition: 'Percentage of operations resulting in exceptions. Replace with your own exception metric definition.', subValues: [{ label: 'Open Issues', value: kz.missedPoints || 83 }, { label: 'Active Alerts', value: kz.overdueAlerts || 2 }, { label: 'Avg Delay', value: '18 min' }, { label: 'Auto-Assigned', value: '3 tasks' }], target: '<2% exception rate' })} />
          ); })()}
          {(() => { const col = (k.routeSavings || 22.4) >= 20 ? 'text-emerald-400' : 'text-amber-400'; return (
            <KPICard icon={<IcoRoute />} label="Efficiency Savings" value={`${(k.routeSavings || 22.4).toFixed(1)}%`} trend={k.routeTrend || 2.3} color={col}
              subValues={[{ label: 'Cost Saved', value: `$${(k.fuelSaved || 54).toFixed(0)}k` }, { label: 'Time Saved', value: `${k.kmSaved || 386} hrs` }]}
              onClick={() => showKPIDetail({ icon: <IcoRoute />, label: 'Efficiency Savings', value: (k.routeSavings || 22.4).toFixed(1), unit: '%', trend: k.routeTrend || 2.3, color: col, thresholds: { green: 20, amber: 10 }, inverted: false, definition: 'Reduction in operational cost vs unoptimised baseline. Replace with your own efficiency metric.', subValues: [{ label: 'Cost Saved', value: `$${(k.fuelSaved || 54).toFixed(0)}k` }, { label: 'Time Saved', value: `${k.kmSaved || 386} hrs` }, { label: 'Optimised Units', value: 21 }, { label: 'Emissions Avoided', value: '412 kg CO₂' }], target: '20%+ cost reduction' })} />
          ); })()}
          {(() => { const col = (kz.collectionRate || 96.2) >= 95 ? 'text-emerald-400' : (kz.collectionRate || 96.2) >= 80 ? 'text-amber-400' : 'text-red-400'; return (
            <KPICard icon={<IcoTrash />} label="Daily Volume" value={(kz.dailyCollectionTons ?? 1325).toFixed(0)} unit=" units/day" trend={kz.collectionTrend || 3.2} color={col}
              subValues={[{ label: 'Target', value: '1,400' }, { label: 'Rate', value: `${(kz.collectionRate || 96.2).toFixed(0)}%` }]}
              onClick={() => showKPIDetail({ icon: <IcoTrash />, label: 'Daily Volume', value: (kz.dailyCollectionTons ?? 1325).toFixed(0), unit: 'units/day', trend: kz.collectionTrend || 3.2, color: col, thresholds: { green: 1200, amber: 900 }, inverted: false, definition: 'Total units processed daily. Replace with your own volumetric metric.', subValues: [{ label: 'Target', value: '1,400/day' }, { label: 'Rate', value: `${(kz.collectionRate || 96.2).toFixed(0)}%` }, { label: 'Confirmations', value: '142' }, { label: 'Avg/Resource', value: '28.4' }], target: '1,400 units/day' })} />
          ); })()}
          {(() => { const col = (k.recyclingRate || 31.4) >= 30 ? 'text-emerald-400' : 'text-amber-400'; return (
            <KPICard icon={<IcoRecycle />} label="Quality Score" value={`${(k.recyclingRate || 31.4).toFixed(1)}%`} trend={k.recyclingTrend || 1.8} color={col}
              subValues={[{ label: 'Passed', value: '416 units' }, { label: 'Value', value: '$3.2k' }]}
              onClick={() => showKPIDetail({ icon: <IcoRecycle />, label: 'Quality Score', value: (k.recyclingRate || 31.4).toFixed(1), unit: '%', trend: k.recyclingTrend || 1.8, color: col, thresholds: { green: 30, amber: 15 }, inverted: false, definition: 'Percentage of processed units meeting quality criteria. Replace with your own quality metric.', subValues: [{ label: 'Units Passed', value: '416' }, { label: 'Redirected', value: '112 units' }, { label: 'Value', value: '$3.2k' }, { label: 'Diverted', value: '528 units' }], target: '30%+ quality rate' })} />
          ); })()}
          {(() => { const col = (bins.overflowPct || 0.7) <= 2 ? 'text-emerald-400' : 'text-red-400'; return (
            <KPICard icon={<IcoBarChart />} label="Threshold Breaches" value={`${(bins.overflowPct || 0.7).toFixed(1)}%`} trend={-(k.overflowTrend || -0.3)} color={col}
              subValues={[{ label: 'Units', value: `${bins.overflow || 3}/${bins.total || 445}` }, { label: 'Near-Threshold', value: bins.needsCollection || 22 }]}
              onClick={() => showKPIDetail({ icon: <IcoBarChart />, label: 'Threshold Breaches', value: (bins.overflowPct || 0.7).toFixed(1), unit: '%', trend: -(k.overflowTrend || -0.3), color: col, thresholds: { green: 2, amber: 5 }, inverted: true, definition: 'Percentage of monitored units above configured threshold. Target <2%. Replace with your own threshold metric.', subValues: [{ label: 'Breaching', value: `${bins.overflow || 3}` }, { label: 'Total Monitored', value: bins.total || 445 }, { label: 'Near-Threshold', value: bins.needsCollection || 22 }, { label: 'Sensor Uptime', value: '99.4%' }], target: '<2% threshold breaches' })} />
          ); })()}
        </div>

        {/* Segment Overview + charts */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-2.5">
          <div className="lg:col-span-3"><OverviewPanel /></div>
          <div className="lg:col-span-2 flex flex-col gap-2.5">
            <MiniChart title="Activity Trend" subtitle="Hourly activity rate — % of scheduled operations completed per hour. Highlights shift gaps and peak demand windows." type="line" data={activityTrendData} height={155} yMax={100} yLabel="Activity %" timeframes={TIMEFRAME_OPTIONS.intradayOps} defaultTimeframe="24H" thresholds={{ normalLine: 80, warningLine: 60, normalDesc: '≥ 80% — on target', warningDesc: '60–80% — below target', criticalDesc: '< 60% — escalate now', unit: '%' }} onInfo={setSelectedChartInfo} />
            <MiniChart title="Category Breakdown" subtitle="Distribution of processed units by category. Guides prioritisation and downstream allocation." type="doughnut" data={categoryBreakdownData} height={155} showLegend thresholds={{ normalDesc: 'Category A 35–45% → optimal', warningDesc: 'Category B >25% → backlog risk', criticalDesc: 'Category F >5% → review', unit: '' }} onInfo={setSelectedChartInfo} />
          </div>
        </div>

        {/* Segment Utilization + Resource Activity */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
          <MiniChart title="Segment Utilization" subtitle="Avg utilization per segment. Red bars exceed 75% and require priority resource allocation." type="bar" data={segmentComparisonData} height={140} yMax={100} yLabel="Utilization %" thresholds={{ warningLine: 65, criticalLine: 85, normalDesc: '< 65% — capacity safe', warningDesc: '65–85% — schedule soon', criticalDesc: '> 85% — overflow risk', unit: '%' }} onInfo={setSelectedChartInfo} />
          <MiniChart title="Resource Activity" subtitle="Active vs returning resources across the day. Peaks indicate shift start and handover windows." type="line" data={resourceActivityData} height={140} showLegend yLabel="Resources" timeframes={TIMEFRAME_OPTIONS.intradayOps} defaultTimeframe="24H" thresholds={{ normalLine: 25, warningLine: 15, normalDesc: '> 25 — full capacity', warningDesc: '15–25 — reduced capacity', criticalDesc: '< 15 — critical shortage', unit: ' resources' }} onInfo={setSelectedChartInfo} />
        </div>

        {/* Segment Table + Activity Feed */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-2.5">
          <div className="lg:col-span-2 bg-app-panel border border-app-border rounded-lg overflow-hidden">
            <div className="px-4 py-2.5 border-b border-app-border flex items-center justify-between">
              <h3 className="text-xs font-semibold text-white">Segment Performance</h3>
              <span className="text-[10px] text-slate-500">{timeRange}</span>
            </div>
            <div className="py-1 max-h-72 overflow-y-auto">
              {filteredSegments.map((seg, i) => <SegmentStatusRow key={seg.segmentId || i} segment={seg} />)}
              {filteredSegments.length === 0 && <div className="text-center text-slate-600 text-xs py-6">No segment data for selected filter</div>}
            </div>
          </div>
          <div className="bg-app-panel border border-app-border rounded-lg overflow-hidden">
            <div className="px-4 py-2.5 border-b border-app-border"><h3 className="text-xs font-semibold text-white">Activity Feed</h3></div>
            <div className="p-3 space-y-2 max-h-72 overflow-y-auto">
              {(filteredAlerts.length > 0 ? filteredAlerts.slice(0, 5).map(alert => ({
                text: alert.title + (alert.message ? ' — ' + alert.message.slice(0, 60) + (alert.message.length > 60 ? '…' : '') : ''),
                time: (() => { const diff = Date.now() - new Date(alert.createdAt).getTime(); if (diff < 60000) return 'Just now'; if (diff < 3600000) return `${Math.floor(diff/60000)}m ago`; return `${Math.floor(diff/3600000)}h ago`; })(),
                dot: alert.type === 'critical' ? '#ef4444' : alert.type === 'warning' ? '#f59e0b' : '#3b82f6',
              })) : recentActivity).map((item, i) => (
                <div key={i} className="flex items-start gap-2.5 text-[11px]">
                  <div className="w-1.5 h-1.5 rounded-full shrink-0 mt-1.5" style={{ background: item.dot }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-slate-300 leading-snug truncate">{item.text}</p>
                    <p className="text-slate-600 text-[10px] mt-0.5">{item.time}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Digital Twin Preview */}
        <DigitalTwinPreview />
      </div>
    </>
  );
}

function DigitalTwinPreview() {
  const navigate = useNavigate();
  return (
    <div className="bg-app-panel border border-app-border rounded-lg overflow-hidden">
      <div className="px-4 py-2.5 border-b border-app-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-violet-400 animate-pulse" />
          <h3 className="text-xs font-semibold text-white">Digital Twin</h3>
        </div>
        <button
          onClick={() => navigate('/map')}
          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[11px] font-semibold bg-blue-500 text-white hover:bg-blue-600 transition-colors shadow-sm"
        >
          Open Digital Twin
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
      <div className="relative flex items-center justify-center overflow-hidden" style={{ height: 200, background: '#0a0a18' }}>
        {/* grid */}
        <svg className="absolute inset-0 w-full h-full" style={{ opacity: 0.18, color: '#8b5cf6' }} aria-hidden="true">
          <defs>
            <pattern id="dt-grid" width="30" height="30" patternUnits="userSpaceOnUse">
              <path d="M 30 0 L 0 0 0 30" fill="none" stroke="currentColor" strokeWidth="0.5" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#dt-grid)" />
        </svg>
        {/* content */}
        <div className="relative flex flex-col items-center gap-3">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ background: 'rgba(139,92,246,0.18)', border: '1px solid rgba(139,92,246,0.40)' }}>
            <svg className="w-8 h-8" style={{ color: '#a78bfa' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
            </svg>
          </div>
          <div className="text-center">
            <p className="text-xs font-semibold" style={{ color: '#c4b5fd' }}>Digital Twin Preview</p>
            <p className="text-[10px] mt-0.5" style={{ color: '#475569' }}>Interactive environment &bull; Click to explore</p>
          </div>
          <div className="flex gap-6 text-center">
            <div><p className="text-sm font-bold text-white">6</p><p className="text-[9px]" style={{ color: '#475569' }}>Active Nodes</p></div>
            <div><p className="text-sm font-bold" style={{ color: '#34d399' }}>99.4%</p><p className="text-[9px]" style={{ color: '#475569' }}>Uptime</p></div>
            <div><p className="text-sm font-bold" style={{ color: '#a78bfa' }}>Live</p><p className="text-[9px]" style={{ color: '#475569' }}>Feed</p></div>
          </div>
        </div>
      </div>
    </div>
  );
}
