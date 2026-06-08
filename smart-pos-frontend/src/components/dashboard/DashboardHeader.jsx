import React from 'react';
import { Calendar, RefreshCw } from 'lucide-react';

const DashboardHeader = ({ selectedTimeframe, onTimeframeChange, onRefresh, lastUpdated }) => {
  const timeframes = [
    { id: 'today', label: 'Today' },
    { id: 'week', label: 'This week' },
    { id: 'month', label: 'This month' },
    { id: 'quarter', label: 'This quarter' },
  ];

  const formatLastUpdated = (timestamp) => {
    if (!timestamp) return '—';
    const diff = Math.floor((Date.now() - new Date(timestamp)) / 60000);
    if (diff < 1) return 'just now';
    if (diff < 60) return `${diff}m ago`;
    return `${Math.floor(diff / 60)}h ago`;
  };

  return (
    <div className="panel mb-4">
      <div className="panel-header flex items-center justify-between gap-4">
        <div>
          <h1 className="text-sm font-semibold text-gray-900">Operations overview</h1>
          <p className="text-xs text-gray-500 mt-0.5">
            Updated {formatLastUpdated(lastUpdated)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 text-xs text-gray-500">
            <Calendar className="w-3.5 h-3.5" />
            <select
              value={selectedTimeframe}
              onChange={(e) => onTimeframeChange(e.target.value)}
              className="input-sys py-1 h-8 min-w-[120px]"
            >
              {timeframes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          <button type="button" onClick={onRefresh} className="btn-secondary">
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
        </div>
      </div>
    </div>
  );
};

export default DashboardHeader;
