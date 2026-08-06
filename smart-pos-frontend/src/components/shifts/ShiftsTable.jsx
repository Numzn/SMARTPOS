import React from 'react';

const money = (n) => `K${Number(n || 0).toFixed(2)}`;

const formatDateTime = (value) => {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
};

const statusColors = {
  OPEN: 'bg-green-100 text-green-700',
  CLOSED: 'bg-gray-100 text-gray-700',
};

const ShiftsTable = ({ shifts, onView }) => {
  if (!shifts.length) {
    return (
      <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">
        No shifts recorded yet. A shift is created when a cashier opens the till.
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Cashier</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Opened</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Closed</th>
            <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Float</th>
            <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Variance</th>
            <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200">
          {shifts.map((shift) => {
            const variance = shift.variance;
            const varianceTone =
              variance == null
                ? 'text-gray-400'
                : variance === 0
                  ? 'text-gray-700'
                  : variance > 0
                    ? 'text-blue-700'
                    : 'text-red-700';
            return (
              <tr key={shift.id}>
                <td className="px-4 py-3 text-sm font-medium text-gray-900">
                  {shift.user?.name || '—'}
                </td>
                <td className="px-4 py-3 text-sm">
                  <span className={`px-2 py-0.5 rounded text-xs ${statusColors[shift.status] || ''}`}>
                    {shift.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-sm text-gray-500">{formatDateTime(shift.openedAt)}</td>
                <td className="px-4 py-3 text-sm text-gray-500">{formatDateTime(shift.closedAt)}</td>
                <td className="px-4 py-3 text-sm text-right text-gray-700">
                  {money(shift.openingFloat)}
                </td>
                <td className={`px-4 py-3 text-sm text-right ${varianceTone}`}>
                  {variance == null ? '—' : money(variance)}
                </td>
                <td className="px-4 py-3 text-right text-sm">
                  <button onClick={() => onView(shift)} className="text-blue-600 hover:text-blue-800">
                    Report
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

export default ShiftsTable;
