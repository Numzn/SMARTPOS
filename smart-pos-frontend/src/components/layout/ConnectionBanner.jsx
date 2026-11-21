import { WifiOff, RefreshCw } from 'lucide-react';
import { useConnectivity } from '../../hooks/useConnectivity';
import { useAuth } from '../../contexts/AuthContext';
import { checkConnectivityNow } from '../../lib/connectivity';

function formatSince(ts) {
  try {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

/**
 * Always-visible, non-blocking connection notice. Says plainly what is true:
 * whether the server can be reached, what that means for selling right now, and
 * that the cart on this till is kept. Renders nothing while everything is fine.
 *
 * Phase 1 deliberately does NOT claim offline selling: completing a sale still
 * needs the server, so the banner says so rather than implying otherwise.
 */
export default function ConnectionBanner() {
  const { status, since } = useConnectivity();
  const { offlineSession } = useAuth();

  if (status !== 'OFFLINE' && status !== 'DEGRADED' && !offlineSession) return null;

  const offline = status === 'OFFLINE';
  const tone = offline ? 'bg-red-50 border-red-200 text-red-800' : 'bg-amber-50 border-amber-200 text-amber-900';

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="connection-banner"
      className={`flex items-center gap-3 px-4 py-2 border-b text-sm ${tone}`}
    >
      <WifiOff className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
      <div className="flex-1 min-w-0">
        {offline ? (
          <>
            <strong>Can&apos;t reach the server</strong>
            {since ? ` since ${formatSince(since)}` : ''}. Sales can&apos;t be completed until it&apos;s back. Your current cart is kept on
            this till.
          </>
        ) : status === 'DEGRADED' ? (
          <>
            <strong>Connection is unstable.</strong> Retrying automatically.
          </>
        ) : (
          <>
            <strong>Using your saved sign-in.</strong> It will be re-checked as soon as the server answers.
          </>
        )}
        {offline && offlineSession && ' You are using your saved sign-in; it will be re-checked when the server answers.'}
      </div>
      <button
        type="button"
        onClick={() => checkConnectivityNow()}
        className="btn-secondary px-2 py-1 text-xs flex-shrink-0"
        aria-label="Check the connection now"
      >
        <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
        Retry now
      </button>
    </div>
  );
}
