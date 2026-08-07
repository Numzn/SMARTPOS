import React from 'react';

const roleColors = {
  ADMIN: 'bg-purple-100 text-purple-700',
  MANAGER: 'bg-blue-100 text-blue-700',
  CASHIER: 'bg-green-100 text-green-700',
  VIEWER: 'bg-gray-100 text-gray-700',
};

const formatDateTime = (value) => {
  if (!value) return 'Never';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? 'Never' : d.toLocaleString();
};

const UsersTable = ({ users, currentUserId, onEdit, onResetPassword, onToggleActive }) => {
  if (!users.length) {
    return (
      <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">No users found.</div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            {['Name', 'Email', 'Role', 'Status', 'Last Sign-in'].map((h) => (
              <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                {h}
              </th>
            ))}
            <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200">
          {users.map((user) => {
            const isSelf = user.id === currentUserId;
            return (
              <tr key={user.id} className={user.isActive === false ? 'bg-gray-50' : ''}>
                <td className="px-4 py-3 text-sm font-medium text-gray-900">
                  {user.name || '—'}
                  {isSelf && <span className="ml-2 text-xs text-gray-400">(you)</span>}
                </td>
                <td className="px-4 py-3 text-sm text-gray-600">{user.email}</td>
                <td className="px-4 py-3 text-sm">
                  <span className={`px-2 py-0.5 rounded text-xs ${roleColors[user.role] || ''}`}>
                    {user.role}
                  </span>
                </td>
                <td className="px-4 py-3 text-sm">
                  {user.isActive === false ? (
                    <span className="px-2 py-0.5 rounded text-xs bg-red-100 text-red-700">Deactivated</span>
                  ) : (
                    <span className="px-2 py-0.5 rounded text-xs bg-green-100 text-green-700">Active</span>
                  )}
                </td>
                <td className="px-4 py-3 text-sm text-gray-500">{formatDateTime(user.lastLoginAt)}</td>
                <td className="px-4 py-3 text-right text-sm whitespace-nowrap">
                  <button onClick={() => onEdit(user)} className="text-blue-600 hover:text-blue-800 mr-3">
                    Edit
                  </button>
                  <button
                    onClick={() => onResetPassword(user)}
                    className="text-amber-700 hover:text-amber-900 mr-3"
                  >
                    Reset Password
                  </button>
                  {/* The backend refuses to let an admin deactivate themselves;
                      don't offer an action that can only fail. */}
                  {isSelf ? (
                    <span className="text-gray-300" title="You cannot deactivate your own account">
                      Deactivate
                    </span>
                  ) : (
                    <button
                      onClick={() => onToggleActive(user)}
                      className={
                        user.isActive === false
                          ? 'text-green-700 hover:text-green-900'
                          : 'text-red-600 hover:text-red-800'
                      }
                    >
                      {user.isActive === false ? 'Reactivate' : 'Deactivate'}
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

export default UsersTable;
