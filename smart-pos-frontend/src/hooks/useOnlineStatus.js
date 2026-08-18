import { useEffect, useState } from 'react';

// Real connectivity signal (navigator.onLine + the browser's online/offline
// events) — replaces what used to be a hardcoded 'connected' constant on
// the Cashier screen that could never actually change. A status icon that's
// permanently green regardless of reality defeats the point of having one.
export function useOnlineStatus() {
  const [online, setOnline] = useState(() => (typeof navigator !== 'undefined' ? navigator.onLine : true));

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return online;
}
