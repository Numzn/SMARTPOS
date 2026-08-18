import { useEffect, useState } from 'react';
import { fetchVsdcStatus } from '../api/cashierApi';

// Lifted out of CashierDashboard, where this poll used to live entirely
// local to /cashier — meaning it reset to 'checking' every time that route
// unmounted and remounted. MainLayout owns it now (one poller for the whole
// authenticated session) and hands the value down to the sidebar footer and
// to CashierDashboard via Outlet context, so status stays live on every
// route. `enabled` follows the same gate as useShiftInitialization/
// useEndShiftFlow — every role holds zra:status today, but this avoids a
// needless call for one that doesn't.
export function useZraStatus({ enabled }) {
  const [zraStatus, setZraStatus] = useState('checking');

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;

    const loadVsdc = async () => {
      try {
        const status = await fetchVsdcStatus();
        if (!cancelled) {
          setZraStatus(status.initialized ? 'connected' : 'not initialized');
        }
      } catch (err) {
        if (cancelled) return;
        // Distinguish "we aren't allowed to look" from "the fiscal service is
        // down" — reporting a 401/403 as offline would tell the whole app ZRA
        // had failed when it was healthy.
        setZraStatus(err?.status === 403 || err?.status === 401 ? 'status unavailable' : 'offline');
      }
    };

    loadVsdc();
    const interval = setInterval(loadVsdc, 30000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [enabled]);

  return zraStatus;
}
