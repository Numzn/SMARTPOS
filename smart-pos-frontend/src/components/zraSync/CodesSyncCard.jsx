import { useEffect, useState } from 'react';
import { ClipboardList, AlertTriangle } from 'lucide-react';
import { fetchCodesStatus, syncCodes } from '../../api/vsdcApi';

function formatDateTime(value) {
  if (!value) return 'Never';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return 'Never';
  return d.toLocaleString();
}

export default function CodesSyncCard({ canSync }) {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState(null);
  const [syncSuccess, setSyncSuccess] = useState(null);

  const load = () => {
    setLoading(true);
    setLoadError(null);
    fetchCodesStatus()
      .then(setStatus)
      .catch((err) => setLoadError(err?.message || 'Failed to load codes status'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const handleSync = async () => {
    setSyncing(true);
    setSyncError(null);
    setSyncSuccess(null);
    try {
      const result = await syncCodes();
      setSyncSuccess(result.message || 'Codes sync completed');
      load();
    } catch (err) {
      setSyncError(err?.message || 'Failed to sync codes');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="panel">
      <div className="panel-header flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ClipboardList className="w-4 h-4 text-gray-500" strokeWidth={1.5} />
          <h3 className="text-sm font-semibold text-gray-900">Code Lists</h3>
        </div>
        {canSync && (
          <button type="button" onClick={handleSync} disabled={syncing || loading} className="btn btn-primary !px-3 !py-1.5">
            {syncing ? 'Syncing…' : 'Sync now'}
          </button>
        )}
      </div>
      <div className="panel-body">

      {loading && <p className="text-sm text-gray-500">Loading…</p>}
      {!loading && loadError && (
        <p className="text-sm text-red-600 flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5" strokeWidth={1.75} />
          {loadError}
        </p>
      )}

      {!loading && !loadError && status && (
        <div className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
              <span className="text-sm text-gray-700">Standard Codes</span>
              <span className="text-sm text-gray-900">{status.standard.count}</span>
            </div>
            <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
              <span className="text-sm text-gray-700">Classification Codes</span>
              <span className="text-sm text-gray-900">{status.classification.count}</span>
            </div>
            <div className="flex justify-between items-center p-3 bg-blue-50 rounded-lg">
              <span className="text-sm text-gray-700">Last Synced</span>
              <span className="text-sm text-blue-600 font-medium">
                {formatDateTime(status.standard.lastSyncedAt || status.classification.lastSyncedAt)}
              </span>
            </div>
          </div>

          {status.standard.byClass?.length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-500 mb-1">By class</p>
              <ul className="text-xs text-gray-600 space-y-1">
                {status.standard.byClass.map((g) => (
                  <li key={g.codeClass} className="flex justify-between">
                    <span className="font-mono">{g.codeClass}</span>
                    <span>
                      {g.count} · {formatDateTime(g.lastSyncedAt)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {syncError && (
        <p className="text-sm text-red-600 mt-3 flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5" strokeWidth={1.75} />
          {syncError}
        </p>
      )}
      {syncSuccess && !syncError && <p className="text-sm text-green-700 mt-3">{syncSuccess}</p>}
      </div>
    </div>
  );
}
