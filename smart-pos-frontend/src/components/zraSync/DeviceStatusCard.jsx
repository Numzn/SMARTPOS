import { useEffect, useState } from 'react';
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
    <div className="bg-white rounded-lg shadow-sm p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-medium text-gray-900">📡 Device Initialisation</h3>
        {canSync && (
          <button
            type="button"
            onClick={handleInitialize}
            disabled={initializing || loading}
            className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            {initializing ? 'Initializing…' : 'Initialize'}
          </button>
        )}
      </div>

      {loading && <p className="text-sm text-gray-500">Loading…</p>}
      {!loading && loadError && <p className="text-sm text-red-600">⚠️ {loadError}</p>}

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

      {initError && <p className="text-sm text-red-600 mt-3">⚠️ {initError}</p>}
      {initSuccess && !initError && (
        <p className="text-sm text-green-700 mt-3">Device initialized successfully.</p>
      )}
    </div>
  );
}
