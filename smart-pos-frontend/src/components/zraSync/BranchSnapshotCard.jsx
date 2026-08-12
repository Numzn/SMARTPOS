import { useEffect, useState } from 'react';
import { fetchBranches } from '../../api/branchesApi';
import { syncBranches } from '../../api/vsdcApi';

function formatDateTime(value) {
  if (!value) return 'Never';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return 'Never';
  return d.toLocaleString();
}

export default function BranchSnapshotCard({ canSync }) {
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState(null);
  const [syncSuccess, setSyncSuccess] = useState(null);

  const load = () => {
    setLoading(true);
    setLoadError(null);
    fetchBranches()
      .then((res) => setBranches(res?.branches || []))
      .catch((err) => setLoadError(err?.message || 'Failed to load branches'))
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
      const result = await syncBranches();
      setSyncSuccess(
        result.message ||
          `Synced ${result.count ?? 0} branch(es) from ZRA, matched ${result.matched ?? 0} locally`
      );
      load();
    } catch (err) {
      setSyncError(err?.message || 'Failed to sync branches');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-sm p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-medium text-gray-900">🏢 Branch Registration</h3>
        {canSync && (
          <button
            type="button"
            onClick={handleSync}
            disabled={syncing || loading}
            className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            {syncing ? 'Syncing…' : 'Sync now'}
          </button>
        )}
      </div>

      {loading && <p className="text-sm text-gray-500">Loading…</p>}
      {!loading && loadError && <p className="text-sm text-red-600">⚠️ {loadError}</p>}

      {!loading && !loadError && branches.length === 0 && (
        <p className="text-sm text-gray-500">No branches found.</p>
      )}

      {!loading && !loadError && branches.length > 0 && (
        <div className="space-y-3">
          {branches.map((branch) => {
            const snapshot = branch.zraBranchSnapshot;
            return (
              <div key={branch.id} className="border border-gray-200 rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium text-gray-900">{branch.name}</span>
                  <span className="text-xs text-gray-500">bhfId: {branch.bhfId}</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                  <div>
                    <p className="font-medium text-gray-500 mb-1">Local (operational)</p>
                    <dl className="space-y-0.5 text-gray-700">
                      <div className="flex justify-between"><dt>Name</dt><dd>{branch.name || '—'}</dd></div>
                      <div className="flex justify-between"><dt>Province</dt><dd>{branch.province || '—'}</dd></div>
                      <div className="flex justify-between"><dt>District</dt><dd>{branch.district || '—'}</dd></div>
                      <div className="flex justify-between"><dt>Address</dt><dd className="truncate max-w-[60%]">{branch.address || '—'}</dd></div>
                      <div className="flex justify-between"><dt>Manager</dt><dd>{branch.managerName || '—'}</dd></div>
                    </dl>
                  </div>
                  <div>
                    <p className="font-medium text-gray-500 mb-1">ZRA snapshot</p>
                    {snapshot ? (
                      <dl className="space-y-0.5 text-gray-700">
                        <div className="flex justify-between"><dt>Name</dt><dd>{snapshot.bhfNm ?? '—'}</dd></div>
                        <div className="flex justify-between"><dt>Province</dt><dd>{snapshot.prvncNm ?? '—'}</dd></div>
                        <div className="flex justify-between"><dt>District</dt><dd>{snapshot.dstrtNm ?? '—'}</dd></div>
                        <div className="flex justify-between"><dt>Sector</dt><dd>{snapshot.sctrNm ?? '—'}</dd></div>
                        <div className="flex justify-between"><dt>Location</dt><dd className="truncate max-w-[60%]">{snapshot.locDesc ?? '—'}</dd></div>
                        <div className="flex justify-between"><dt>Manager</dt><dd>{snapshot.mgrNm ?? '—'}</dd></div>
                        <div className="flex justify-between"><dt>Manager Tel</dt><dd>{snapshot.mgrTelNo ?? '—'}</dd></div>
                        <div className="flex justify-between"><dt>Manager Email</dt><dd className="truncate max-w-[60%]">{snapshot.mgrEmail ?? '—'}</dd></div>
                        <div className="flex justify-between"><dt>Status</dt><dd>{snapshot.bhfSttsCd ?? '—'}</dd></div>
                        <div className="flex justify-between"><dt>HQ</dt><dd>{snapshot.hqYn ?? '—'}</dd></div>
                      </dl>
                    ) : (
                      <p className="text-gray-500 italic">Not yet synced</p>
                    )}
                    <p className="text-gray-400 mt-1">
                      Last synced: {formatDateTime(branch.zraSnapshotSyncedAt)}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {syncError && <p className="text-sm text-red-600 mt-3">⚠️ {syncError}</p>}
      {syncSuccess && !syncError && <p className="text-sm text-green-700 mt-3">{syncSuccess}</p>}
    </div>
  );
}
