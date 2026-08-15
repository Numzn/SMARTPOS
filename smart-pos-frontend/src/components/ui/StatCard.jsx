import React from 'react';

/**
 * A single stat tile, matching the panel/stat-value system already used by
 * the dashboard. `tone` is an optional Tailwind text-color utility for
 * values that are meaningfully color-coded (e.g. out-of-stock in red) —
 * that coding is real information, not decoration, so it stays.
 */
const StatCard = ({ title, value, icon: Icon, mono = false, tone = '' }) => (
  <div className="panel">
    <div className="panel-body flex items-start justify-between gap-2">
      <div className="min-w-0">
        <p className="text-[11px] font-medium text-gray-500 uppercase tracking-wide">{title}</p>
        <p className={`stat-value mt-1 ${mono ? 'text-base' : ''} ${tone}`}>{value}</p>
      </div>
      {Icon && <Icon className="w-4 h-4 text-gray-400 shrink-0" strokeWidth={1.5} />}
    </div>
  </div>
);

export default StatCard;
