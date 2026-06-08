import React from 'react';
import { Clock, User } from 'lucide-react';

const CashierHeader = ({ user, currentTime }) => {
  const formatTime = (date) =>
    date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

  const formatDate = (date) =>
    date.toLocaleDateString('en-GB', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });

  return (
    <header className="h-12 flex-shrink-0 bg-surface-raised border-b border-surface-border px-4 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 border border-surface-border bg-gray-100 flex items-center justify-center rounded">
          <User className="w-4 h-4 text-gray-600" strokeWidth={1.5} />
        </div>
        <div>
          <div className="text-sm font-medium text-gray-900">{user?.name || 'Operator'}</div>
          <div className="text-[11px] text-gray-500 font-mono">
            {user?.role || 'CASHIER'} · T01
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 font-mono text-sm text-gray-800">
        <Clock className="w-3.5 h-3.5 text-gray-500" />
        <span>{formatTime(currentTime)}</span>
        <span className="text-gray-400 hidden md:inline">|</span>
        <span className="text-xs text-gray-500 hidden md:inline">{formatDate(currentTime)}</span>
      </div>

      <div className="status-pill border-emerald-200 bg-emerald-50 text-emerald-800">
        <span className="status-dot bg-emerald-500" />
        Session active
      </div>
    </header>
  );
};

export default CashierHeader;
