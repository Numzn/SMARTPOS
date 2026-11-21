import { useConnectivity } from './useConnectivity';

// "Online" here means OUR SERVER is reachable, not merely that the PC has a
// network connection (navigator.onLine can say "online" while the server is
// down, which is exactly the case a till cares about). Only a confirmed
// OFFLINE is reported as offline; a single missed beat (DEGRADED) is not.
// See lib/connectivity.js.
export function useOnlineStatus() {
  return useConnectivity().status !== 'OFFLINE';
}
