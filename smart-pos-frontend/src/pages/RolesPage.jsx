import React, { useEffect, useMemo, useState } from 'react';
import { ShieldCheck, AlertTriangle } from 'lucide-react';
import { fetchRoleMatrix, setRolePermission } from '../api/rolesApi';

// Grouped by the resource prefix (everything before the colon) so the table
// reads the same way the permission list itself is organized in
// lib/permissions.js — one section per module/domain.
function groupByResource(permissions) {
  const groups = new Map();
  for (const permission of permissions) {
    const resource = permission.split(':')[0];
    if (!groups.has(resource)) groups.set(resource, []);
    groups.get(resource).push(permission);
  }
  return [...groups.entries()];
}

const RolesPage = () => {
  const [roles, setRoles] = useState([]);
  const [permissions, setPermissions] = useState([]);
  const [grants, setGrants] = useState([]); // [{ role, permission, granted }]
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(null); // `${role}:${permission}` while a toggle is in flight

  const load = () => {
    setLoading(true);
    setError(null);
    fetchRoleMatrix()
      .then((data) => {
        setRoles(data.roles || []);
        setPermissions(data.permissions || []);
        setGrants(data.grants || []);
      })
      .catch((err) => setError(err?.data?.error || err.message || 'Failed to load role permissions'))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const grantMap = useMemo(() => {
    const map = new Map();
    for (const g of grants) {
      if (g.granted) map.set(`${g.role}:${g.permission}`, true);
    }
    return map;
  }, [grants]);

  const groups = useMemo(() => groupByResource(permissions), [permissions]);

  const handleToggle = async (role, permission, nextGranted) => {
    const key = `${role}:${permission}`;
    setPending(key);
    // Optimistic update — rolled back on failure.
    setGrants((prev) => {
      const next = prev.filter((g) => !(g.role === role && g.permission === permission));
      next.push({ role, permission, granted: nextGranted });
      return next;
    });
    try {
      await setRolePermission(role, permission, nextGranted);
    } catch (err) {
      setError(err?.data?.error || err.message || 'Failed to update permission');
      load(); // reload the authoritative state after a failed write
    } finally {
      setPending(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="flex items-center gap-2">
        <ShieldCheck className="w-5 h-5 text-gray-500" strokeWidth={1.5} />
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Roles &amp; Permissions</h1>
          <p className="text-gray-600 text-sm">
            Toggling a permission here takes effect on the affected role&apos;s next request — no
            deploy, no restart. This does not change who can approve PIN-gated exceptions
            (discounts, reversals) — that authority is a separate, rank-based system.
          </p>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 flex items-center gap-2 text-sm">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      <div className="bg-white rounded-lg shadow overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              <th className="text-left px-4 py-2 font-medium text-gray-500 uppercase text-xs tracking-wide">
                Permission
              </th>
              {roles.map((role) => (
                <th key={role} className="text-center px-4 py-2 font-medium text-gray-500 uppercase text-xs tracking-wide">
                  {role}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {groups.map(([resource, perms]) => (
              <React.Fragment key={resource}>
                <tr className="bg-gray-50/60">
                  <td colSpan={roles.length + 1} className="px-4 py-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    {resource}
                  </td>
                </tr>
                {perms.map((permission) => (
                  <tr key={permission}>
                    <td className="px-4 py-2 text-gray-700 font-mono text-xs">{permission}</td>
                    {roles.map((role) => {
                      const key = `${role}:${permission}`;
                      const granted = grantMap.has(key);
                      return (
                        <td key={role} className="px-4 py-2 text-center">
                          <input
                            type="checkbox"
                            checked={granted}
                            disabled={pending === key}
                            onChange={(e) => handleToggle(role, permission, e.target.checked)}
                            className="w-4 h-4 accent-indigo-600 cursor-pointer disabled:opacity-50"
                            aria-label={`${role} ${permission}`}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default RolesPage;
