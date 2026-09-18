import React, { createContext, useContext } from 'react';
import { useApm } from './apmStore';

const SocketContext = createContext(null);
export const DataContext = createContext(null);

/* Alerts and the S!a advisory feed are DERIVED from live engine output in
   apmStore — see src/engines/advisories.js. This provider exists so the
   existing Layout / AlertPanel / AdvisoryPanel components keep their
   interface while the content behind them became real.

   Replace with the S!aP Konnect websocket feed when streaming lands; the
   consuming components read only from this context. */
export function SocketProvider({ children }) {
  const { alerts, advisories, fleet, summary } = useApm();

  const dataValue = {
    alerts,
    advisories,
    assetsScored: summary.count,
    lastUpdate: new Date(),
    connected: false,
    computeMs: fleet.computeMs,
    requestData: () => {},
  };

  return (
    <SocketContext.Provider value={null}>
      <DataContext.Provider value={dataValue}>
        {children}
      </DataContext.Provider>
    </SocketContext.Provider>
  );
}

export const useSocket = () => useContext(SocketContext);
export const useData = () => useContext(DataContext);
