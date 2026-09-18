import React, { useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Circle } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import KPICard, { IcoGlobe, IcoPin, IcoSignal, IcoAlert } from '../components/KPICard';

// Fix Leaflet default marker icon paths (broken by webpack)
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

// Sample map markers — replace with your own data / coordinates
const MAP_POINTS = [
  { id: 'PT-001', label: 'Site Alpha',   lat: 51.505,  lng: -0.09,  status: 'active',  type: 'site',   value: 84 },
  { id: 'PT-002', label: 'Site Beta',    lat: 51.515,  lng: -0.10,  status: 'warning', type: 'site',   value: 62 },
  { id: 'PT-003', label: 'Site Gamma',   lat: 51.495,  lng: -0.08,  status: 'active',  type: 'site',   value: 91 },
  { id: 'PT-004', label: 'Node Delta',   lat: 51.510,  lng: -0.075, status: 'active',  type: 'node',   value: 78 },
  { id: 'PT-005', label: 'Node Epsilon', lat: 51.500,  lng: -0.105, status: 'offline', type: 'node',   value: 0  },
  { id: 'PT-006', label: 'Hub Zeta',     lat: 51.508,  lng: -0.095, status: 'active',  type: 'hub',    value: 55 },
];

const STATUS_COLOR = {
  active:  '#10b981',
  warning: '#f59e0b',
  offline: '#ef4444',
};

const LAYERS = ['Sites', 'Nodes', 'Hubs', 'Coverage'];

export default function MapView() {
  const [activeLayers, setActiveLayers] = useState(['Sites', 'Nodes', 'Hubs', 'Coverage']);
  const [selectedPoint, setSelectedPoint] = useState(null);

  const toggleLayer = (layer) =>
    setActiveLayers(prev => prev.includes(layer) ? prev.filter(l => l !== layer) : [...prev, layer]);

  const visiblePoints = MAP_POINTS.filter(p => {
    if (p.type === 'site' && !activeLayers.includes('Sites')) return false;
    if (p.type === 'node' && !activeLayers.includes('Nodes')) return false;
    if (p.type === 'hub'  && !activeLayers.includes('Hubs'))  return false;
    return true;
  });

  const counts = {
    total:   MAP_POINTS.length,
    active:  MAP_POINTS.filter(p => p.status === 'active').length,
    warning: MAP_POINTS.filter(p => p.status === 'warning').length,
    offline: MAP_POINTS.filter(p => p.status === 'offline').length,
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-lg font-bold" style={{ color: 'var(--app-text)' }}>Map View</h1>
        <p className="text-xs mt-0.5" style={{ color: 'var(--app-text-faint)' }}>Live geographic overview of all sites, nodes, and coverage zones</p>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard label="Total Points"   value={counts.total}   icon={<IcoGlobe />}  color="text-blue-400"    />
        <KPICard label="Active"         value={counts.active}  icon={<IcoSignal />} color="text-emerald-400" />
        <KPICard label="Warnings"       value={counts.warning} icon={<IcoPin />}    rag={counts.warning > 0 ? 'warning' : 'normal'} />
        <KPICard label="Offline"        value={counts.offline} icon={<IcoAlert />}  rag={counts.offline > 0 ? 'critical' : 'normal'} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Layer controls */}
        <div className="bg-app-panel border border-app-border rounded-xl p-4 space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--app-text-faint)' }}>Map Layers</h3>
          {LAYERS.map(layer => (
            <label key={layer} className="flex items-center gap-3 cursor-pointer group">
              <div
                onClick={() => toggleLayer(layer)}
                className="w-9 h-5 rounded-full transition-colors flex items-center px-0.5"
                style={{
                  background: activeLayers.includes(layer) ? 'var(--app-accent)' : 'var(--app-surface)',
                  border: '1px solid var(--app-border)',
                }}
              >
                <div
                  className="w-4 h-4 rounded-full bg-white transition-transform"
                  style={{ transform: activeLayers.includes(layer) ? 'translateX(16px)' : 'translateX(0)' }}
                />
              </div>
              <span className="text-xs font-medium" style={{ color: 'var(--app-text)' }}>{layer}</span>
            </label>
          ))}

          <div className="pt-3 border-t border-app-border space-y-2">
            <h4 className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--app-text-faint)' }}>Legend</h4>
            {Object.entries(STATUS_COLOR).map(([status, color]) => (
              <div key={status} className="flex items-center gap-2 text-xs capitalize">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: color }} />
                <span style={{ color: 'var(--app-text-faint)' }}>{status}</span>
              </div>
            ))}
          </div>

          {selectedPoint && (
            <div className="pt-3 border-t border-app-border">
              <h4 className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--app-text-faint)' }}>Selected</h4>
              <div className="space-y-1 text-xs">
                <p className="font-semibold" style={{ color: 'var(--app-text)' }}>{selectedPoint.label}</p>
                <p style={{ color: 'var(--app-text-faint)' }}>{selectedPoint.id} · {selectedPoint.type}</p>
                <p style={{ color: STATUS_COLOR[selectedPoint.status] }} className="capitalize font-semibold">{selectedPoint.status}</p>
                {selectedPoint.value > 0 && <p style={{ color: 'var(--app-text-faint)' }}>Value: {selectedPoint.value}%</p>}
              </div>
              <button
                onClick={() => setSelectedPoint(null)}
                className="mt-2 text-[10px]"
                style={{ color: 'var(--app-text-faint)' }}
              >Clear</button>
            </div>
          )}
        </div>

        {/* Map */}
        <div className="lg:col-span-3 rounded-xl overflow-hidden border border-app-border" style={{ height: 480 }}>
          <MapContainer
            center={[51.505, -0.09]}
            zoom={13}
            style={{ height: '100%', width: '100%' }}
            zoomControl={true}
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            {visiblePoints.map(pt => (
              <Marker
                key={pt.id}
                position={[pt.lat, pt.lng]}
                eventHandlers={{ click: () => setSelectedPoint(pt) }}
              >
                <Popup>
                  <div style={{ minWidth: 140 }}>
                    <strong>{pt.label}</strong><br />
                    <span style={{ color: STATUS_COLOR[pt.status] }}>{pt.status}</span><br />
                    {pt.value > 0 && <span>Value: {pt.value}%</span>}
                  </div>
                </Popup>
              </Marker>
            ))}
            {activeLayers.includes('Coverage') && visiblePoints.filter(p => p.status === 'active').map(pt => (
              <Circle
                key={`cov-${pt.id}`}
                center={[pt.lat, pt.lng]}
                radius={300}
                pathOptions={{ color: STATUS_COLOR[pt.status], fillColor: STATUS_COLOR[pt.status], fillOpacity: 0.05, weight: 1 }}
              />
            ))}
          </MapContainer>
        </div>
      </div>
    </div>
  );
}
