import { useEffect, useState } from 'react';
import { Satellite, AlertTriangle } from 'lucide-react';
import { fetchDeviceStatus, initializeDevice } from '../../api/vsdcApi';

function formatDateTime(value) {
  if (!value) return 'Never';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return 'Never';
  return d.toLocaleString();
}

export default function DeviceStatusCard({ canSync }) {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [initializing, setInitializing] = useState(false);
  const [initError, setInitError] = useState(null);
  const [initSuccess, setInitSuccess] = useState(false);

  const load = () => {
    setLoading(true);
    setLoadError(null);
    fetchDeviceStatus()
      .then(setStatus)
      .catch((err) => setLoadError(err?.message || 'Failed to load device status'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const handleInitialize = async () => {
    setInitializing(true);
    setInitError(null);
    setInitSuccess(false);
    try {
      await initializeDevice();
      setInitSuccess(true);
      load();
    } catch (err) {
      setInitError(err?.message || 'Failed to initialize device');
    } finally {
      setInitializing(false);
    }
  };

  return (
    <div className="panel">
      <div className="panel-header flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Satellite className="w-4 h-4 text-gray-500" strokeWidth={1.5} />
          <h3 className="text-sm font-semibold text-gray-900">Device Initialisation</h3>
        </div>
        {canSync && (
          <button type="button" onClick={handleInitialize} disabled={initializing || loading} className="btn btn-primary !px-3 !py-1.5">
            {initializing ? 'Initializing…' : 'Initialize'}
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
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
            <span className="text-sm text-gray-700">Initialized</span>
            <span
              className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                status.initialized ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
              }`}
            >
              {status.initialized ? 'Yes' : 'No'}
            </span>
          </div>
          <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
            <span className="text-sm text-gray-700">Last Initialized</span>
            <span className="text-sm text-gray-900">{formatDateTime(status.lastInitializedAt)}</span>
          </div>
          <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
            <span className="text-sm text-gray-700">Device Serial</span>
            <span className="text-sm text-gray-900 font-mono">{status.dvcSrlNo || '—'}</span>
          </div>
          <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
            <span className="text-sm text-gray-700">SDC ID</span>
            <span className="text-sm text-gray-900 font-mono">{status.sdicId || '—'}</span>
          </div>
          <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
            <span className="text-sm text-gray-700">MRC No</span>
            <span className="text-sm text-gray-900 font-mono">{status.mrcNo || '—'}</span>
          </div>
        </div>
      )}

      {initError && (
        <p className="text-sm text-red-600 mt-3 flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5" strokeWidth={1.75} />
          {initError}
        </p>
      )}
      {initSuccess && !initError && (
        <p className="text-sm text-green-700 mt-3">Device initialized successfully.</p>
      )}
      </div>
    </div>
  );
}
