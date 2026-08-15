import React, { useState } from 'react';
import { ChevronDown, ChevronRight, CheckCircle2, XCircle } from 'lucide-react';

const RISK_BADGE = {
  LOW: 'bg-gray-100 text-gray-700',
  MEDIUM: 'bg-blue-100 text-blue-800',
  HIGH: 'bg-orange-100 text-orange-800',
  CRITICAL: 'bg-red-100 text-red-800',
};

function formatDateTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString();
}

const DetailRow = ({ entry }) => {
  const hasDetail = entry.entityType || entry.entityId || entry.oldValues || entry.newValues || entry.metadata;
  if (!hasDetail) {
    return (
      <tr>
        <td colSpan={7} className="px-6 py-3 text-xs text-gray-500 bg-gray-50">
          No additional detail recorded for this event.
        </td>
      </tr>
    );
  }
  return (
    <tr>
      <td colSpan={7} className="px-6 py-3 bg-gray-50">
        <div className="text-xs space-y-2">
          {(entry.entityType || entry.entityId) && (
            <div className="text-gray-700">
              <span className="font-medium">Entity:</span> {entry.entityType || '—'}
              {entry.entityId ? ` #${entry.entityId}` : ''}
            </div>
          )}
          {entry.oldValues && (
            <div>
              <p className="font-medium text-gray-700 mb-1">Old values</p>
              <pre className="bg-white border border-surface-border rounded p-2 overflow-x-auto text-gray-600">
                {JSON.stringify(entry.oldValues, null, 2)}
              </pre>
            </div>
          )}
          {entry.newValues && (
            <div>
              <p className="font-medium text-gray-700 mb-1">New values</p>
              <pre className="bg-white border border-surface-border rounded p-2 overflow-x-auto text-gray-600">
                {JSON.stringify(entry.newValues, null, 2)}
              </pre>
            </div>
          )}
          {entry.metadata && (
            <div>
              <p className="font-medium text-gray-700 mb-1">Metadata</p>
              <pre className="bg-white border border-surface-border rounded p-2 overflow-x-auto text-gray-600">
                {JSON.stringify(entry.metadata, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </td>
    </tr>
  );
};

/**
 * One row per audit event. Rows expand inline on click to show
 * entity/oldValues/newValues/metadata — detail that's only occasionally
 * populated and is debugging-level, not primary content, so it doesn't need
 * its own modal.
 */
const AuditLogTable = ({ entries, usersById }) => {
  const [expandedId, setExpandedId] = useState(null);

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-6"></th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Time</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Event</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">User</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Description</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Risk</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
            {entries.length === 0 && (
              <tr>
                <td colSpan={7} className="px-6 py-8 text-center text-sm text-gray-500">
                  No audit events match the current filters.
                </td>
              </tr>
            )}
            {entries.map((entry) => {
              const isExpanded = expandedId === entry.id;
              const userLabel = entry.userId
                ? usersById?.[entry.userId]?.name || entry.userId
                : entry.userRole === 'SYSTEM'
                  ? 'System'
                  : '—';
              return (
                <React.Fragment key={entry.id}>
                  <tr
                    className="hover:bg-gray-50 cursor-pointer"
                    onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                  >
                    <td className="px-6 py-3 text-gray-400">
                      {isExpanded ? (
                        <ChevronDown className="w-3.5 h-3.5" strokeWidth={1.75} />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5" strokeWidth={1.75} />
                      )}
                    </td>
                    <td className="px-6 py-3 whitespace-nowrap text-xs text-gray-500">
                      {formatDateTime(entry.timestamp)}
                    </td>
                    <td className="px-6 py-3 whitespace-nowrap text-xs font-mono text-gray-700">{entry.eventType}</td>
                    <td className="px-6 py-3 whitespace-nowrap text-sm text-gray-900">{userLabel}</td>
                    <td className="px-6 py-3 text-sm text-gray-600 max-w-md truncate">{entry.description || '—'}</td>
                    <td className="px-6 py-3 whitespace-nowrap">
                      <span
                        className={`inline-flex px-2 py-0.5 text-xs font-semibold rounded-full ${RISK_BADGE[entry.riskLevel] || RISK_BADGE.LOW}`}
                      >
                        {entry.riskLevel}
                      </span>
                    </td>
                    <td className="px-6 py-3 whitespace-nowrap">
                      {entry.success ? (
                        <CheckCircle2 className="w-4 h-4 text-green-600" strokeWidth={1.75} />
                      ) : (
                        <span title={entry.errorMessage || 'Failed'}>
                          <XCircle className="w-4 h-4 text-red-600" strokeWidth={1.75} />
                        </span>
                      )}
                    </td>
                  </tr>
                  {isExpanded && <DetailRow entry={entry} />}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
    </div>
  );
};

export default AuditLogTable;
