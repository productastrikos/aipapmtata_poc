import React from 'react';
import { acknowledgeAlert } from '../services/api';

const typeColors = {
  critical: { bg: 'bg-red-500/10', border: 'border-red-500/30', text: 'text-red-400', dot: 'bg-red-500' },
  warning: { bg: 'bg-yellow-500/10', border: 'border-yellow-500/30', text: 'text-yellow-400', dot: 'bg-yellow-500' },
  info: { bg: 'bg-blue-500/10', border: 'border-blue-500/30', text: 'text-blue-400', dot: 'bg-blue-500' },
};

function dedupeAlerts(list = []) {
  const seen = new Set();
  return list.filter((alert) => {
    const key = [
      alert.assetId || '',
      alert.category || '',
      alert.title || '',
      alert.message || '',
      alert.zone || '',
    ].join('|').toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export default function AlertPanel({ alerts = [], onClose }) {
  const handleAcknowledge = async (alertId) => {
    try { await acknowledgeAlert(alertId); } catch (e) { console.error(e); }
  };

  const uniqueAlerts = dedupeAlerts(alerts);
  const activeAlerts = uniqueAlerts.filter(a => !a.acknowledged);

  const grouped = {
    critical: activeAlerts.filter(a => a.type === 'critical'),
    warning: activeAlerts.filter(a => a.type === 'warning'),
    info: activeAlerts.filter(a => a.type === 'info'),
  };

  const timeSince = (dateStr) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return `${Math.floor(diff / 86400000)}d ago`;
  };

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 py-3 border-b border-app-border flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-white">Real-Time Alerts</h3>
          <p className="text-xs text-slate-400">{activeAlerts.length} active</p>
        </div>
        <button onClick={onClose} className="text-slate-400 hover:text-white">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {['critical', 'warning', 'info'].map(type => (
          grouped[type]?.length > 0 && (
            <div key={type}>
              <div className={`text-[10px] font-semibold uppercase tracking-wider mb-1.5 ${typeColors[type].text}`}>
                {type} ({grouped[type].length})
              </div>
              {grouped[type].slice(0, 15).map(alert => (
                <div key={alert.alertId} className={`${typeColors[type].bg} border ${typeColors[type].border} rounded-lg p-2.5 mb-1.5`}>
                  <div className="flex items-start space-x-2">
                    <div className={`w-2 h-2 rounded-full mt-1 shrink-0 ${typeColors[type].dot} ${type === 'critical' ? 'animate-pulse' : ''}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-white truncate">{alert.title}</p>
                      <p className="text-[11px] text-slate-300 mt-0.5 line-clamp-2">{alert.message}</p>
                      <div className="flex items-center justify-between mt-1.5">
                        <span className="text-[10px] text-slate-400">{timeSince(alert.createdAt)}</span>
                        <button
                          onClick={() => handleAcknowledge(alert.alertId)}
                          className="text-[10px] text-cyan-400 hover:text-cyan-300 font-medium"
                        >
                          Acknowledge
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )
        ))}

        {activeAlerts.length === 0 && (
          <div className="text-center text-slate-400 text-sm py-8">
            No active alerts
          </div>
        )}
      </div>
    </div>
  );
}
