import { usePermissions } from '../hooks/usePermissions';
import DeviceStatusCard from '../components/zraSync/DeviceStatusCard';
import CodesSyncCard from '../components/zraSync/CodesSyncCard';
import BranchSnapshotCard from '../components/zraSync/BranchSnapshotCard';

export default function ZraSyncPage() {
  const { canAccess } = usePermissions();
  // Page access is zra:read (viewZRAPage) — the operational/administrative
  // tier. zra:status (viewZRAStatus) is deliberately NOT enough to reach
  // this page: it's the lightweight device-connectivity check the till uses
  // and every Cashier/Supervisor holds it, but neither role should land
  // here (route-level enforcement mirrors this in App.jsx, and the backend
  // independently gates every /api/vsdc/* route the same way).
  const { viewZRAPage, syncZRA, adminZRA } = canAccess;

  if (!viewZRAPage) {
    return (
      <div className="min-h-[40vh] flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">Access Denied</h2>
          <p className="text-gray-600">You don&apos;t have permission to view ZRA sync status.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow-sm p-4 sm:p-6">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">ZRA Sync</h1>
        <p className="text-gray-600 mt-1">
          Device initialisation, code lists and branch registration status
        </p>
      </div>

      {!syncZRA && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-md p-4 text-sm text-yellow-800">
          You have read-only access. Contact an administrator to trigger a sync.
        </div>
      )}

      <DeviceStatusCard canAdmin={adminZRA} />
      <CodesSyncCard canSync={syncZRA} />
      <BranchSnapshotCard canSync={syncZRA} />
    </div>
  );
}
