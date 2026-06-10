import React, { useState } from 'react';
import { Clock, Menu, LogOut, ChevronDown } from 'lucide-react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { useAuth } from '../../../contexts/AuthContext';

const CashierHeader = ({ currentTime }) => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { openSidebar } = useOutletContext() || {};
  const [profileOpen, setProfileOpen] = useState(false);

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

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

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

      <div className="relative shrink-0">
        <button
          type="button"
          onClick={() => setProfileOpen(!profileOpen)}
          className="flex items-center gap-2 px-2 py-1 border border-surface-border rounded bg-gray-50 hover:bg-gray-100"
        >
          <span className="text-xs font-medium text-gray-800 max-w-[120px] truncate hidden sm:inline">
            {user?.name}
          </span>
          <span className="text-[10px] text-gray-500 uppercase">{user?.role}</span>
          <ChevronDown className="w-3 h-3 text-gray-500" />
        </button>

        {profileOpen && (
          <>
            <button
              type="button"
              className="fixed inset-0 z-40"
              aria-label="Close profile menu"
              onClick={() => setProfileOpen(false)}
            />
            <div className="absolute right-0 mt-1 w-52 panel z-50 py-1">
              <div className="px-3 py-2 border-b border-surface-border">
                <p className="text-sm font-medium text-gray-900">{user?.name}</p>
                <p className="text-xs text-gray-500 truncate">{user?.email}</p>
              </div>
              <button
                type="button"
                onClick={handleLogout}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                <LogOut className="w-3.5 h-3.5" />
                Sign out
              </button>
            </div>
          </>
        )}
      </div>
    </header>
  );
};

export default CashierHeader;
