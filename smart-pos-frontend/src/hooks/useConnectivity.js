import { useSyncExternalStore } from 'react';
import { getConnectivity, subscribeConnectivity } from '../lib/connectivity';

/** { status: 'UNKNOWN'|'ONLINE'|'DEGRADED'|'OFFLINE', since, lastOkAt, consecutiveFailures } */
export function useConnectivity() {
  return useSyncExternalStore(subscribeConnectivity, getConnectivity, getConnectivity);
}
