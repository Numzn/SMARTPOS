import React from 'react';
import { Clock, Menu } from 'lucide-react';
import { useOutletContext } from 'react-router-dom';

// Profile/sign-out lives in the sidebar footer's SidebarUserMenu now (see
// Sidebar.jsx) — it renders on /cashier too, so this header doesn't need
// its own copy. It used to carry a duplicate name/role/logout dropdown,
// styled for the (removed) light-themed header rather than the sidebar's
// dark footer.
const CashierHeader = ({ currentTime }) => {
  const { openSidebar } = useOutletContext() || {};

  const formatTime = (date) =>
    date.toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });

  const formatDate = (date) =>
    date.toLocaleDateString('en-GB', {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });

  return (
    <header className="h-12 flex-shrink-0 bg-surface-raised border-b border-surface-border px-4 flex items-center justify-between gap-4">
      <div className="flex items-center gap-2 min-w-0">
        <button
          type="button"
          onClick={() => openSidebar?.()}
          className="lg:hidden btn-ghost p-1.5 shrink-0"
          aria-label="Open menu"
        >
          <Menu className="w-4 h-4" />
        </button>
        <div className="text-sm font-semibold text-gray-900 tracking-tight truncate">
          Point of Sale
        </div>
      </div>

      <div className="flex items-center gap-2 font-mono text-sm text-gray-800 shrink-0">
        <Clock className="w-3.5 h-3.5 text-gray-500" />
        <span>{formatTime(currentTime)}</span>
        <span className="text-gray-400 hidden md:inline">|</span>
        <span className="text-xs text-gray-500 hidden md:inline">{formatDate(currentTime)}</span>
      </div>
    </header>
  );
};

export default CashierHeader;
