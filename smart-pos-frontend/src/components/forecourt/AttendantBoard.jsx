import React from 'react';

const money = (n) => `K${Number(n || 0).toFixed(2)}`;

/**
 * The primary Forecourt workflow: attendants WITH unsettled fuel sales,
 * not a generic sales browser. Only attendants with unsettledCount > 0
 * are ever passed in (see ForecourtPanel).
 */
const AttendantBoard = ({
  attendants,
  search,
  onSearchChange,
  checkedIds,
  onToggleCheck,
  onSelectAttendant,
  onQuickClear,
  onReviewCombined,
  canSettle,
}) => {
  const term = search.trim().toLowerCase();
  const filtered = term
    ? attendants.filter(
        (a) => a.name?.toLowerCase().includes(term) || a.attendantCode?.toLowerCase().includes(term)
      )
    : attendants;
  const checkedCount = checkedIds.size;

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-4">
        <input
          type="text"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search attendant..."
          className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        {canSettle && checkedCount >= 2 && (
          <button
            onClick={onReviewCombined}
            className="px-4 py-2 bg-indigo-600 text-white rounded-md text-sm font-medium hover:bg-indigo-700 shrink-0"
          >
            Review Combined Clearing ({checkedCount})
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="text-sm text-gray-500 bg-gray-50 border border-gray-200 rounded-lg p-4">
          {attendants.length === 0 ? 'No attendants with unsettled sales.' : 'No attendants match your search.'}
        </div>
      ) : (
        <div className="divide-y divide-gray-100 -mx-6">
          {filtered.map((a) => (
            <div key={a.id} className="px-6 py-3 flex items-center gap-3">
              {canSettle && (
                <input
                  type="checkbox"
                  checked={checkedIds.has(a.id)}
                  onChange={() => onToggleCheck(a.id)}
                  className="h-4 w-4 rounded border-gray-300"
                  aria-label={`Select ${a.name} for combined clearing`}
                />
              )}
              <button onClick={() => onSelectAttendant(a.id)} className="flex-1 min-w-0 text-left">
                <div className="text-sm font-medium text-gray-900">
                  {a.name} <span className="text-gray-400 font-normal">{a.attendantCode}</span>
                </div>
                <div className="text-xs text-gray-500">
                  {a.unsettledCount} unsettled · {money(a.unsettledTotal)}
                </div>
              </button>
              {canSettle && (
                <button
                  onClick={() => onQuickClear(a)}
                  className="px-3 py-1.5 border border-gray-300 rounded-md text-xs font-medium text-gray-700 hover:bg-gray-50 shrink-0"
                >
                  CLEAR
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default AttendantBoard;
