import React from 'react';
import { ShoppingCart, Fuel, FileText, Wrench, Menu, Printer, Wifi, WifiOff, Satellite } from 'lucide-react';
import { useOutletContext } from 'react-router-dom';
import TopBarStatusIcon from './TopBarStatusIcon';

const TABS = [
  { id: 'quickshop', label: 'Quick shop', icon: ShoppingCart },
  { id: 'forecourt', label: 'Forecourt', icon: Fuel },
  { id: 'drafts', label: 'Drafts', icon: FileText },
  { id: 'tools', label: 'Tools', icon: Wrench },
];

const PRINTER_STATE = { ready: 'ok', error: 'offline', none: 'neutral', unknown: 'neutral' };
const PRINTER_LABEL = { ready: 'Connected', error: 'Error', none: 'Not configured', unknown: 'Unknown' };

const ZRA_STATE = {
  connected: 'ok',
  'not initialized': 'warning',
  offline: 'offline',
  'status unavailable': 'neutral',
  checking: 'neutral',
};
const ZRA_LABEL = {
  connected: 'Connected',
  'not initialized': 'Not initialized',
  offline: 'Offline',
  'status unavailable': 'Status unavailable',
  checking: 'Checking…',
};

// Replaces the old CashierHeader + CashierTabs pair — a workspace switcher,
// not a page title. "Point of Sale" added no information the app shell
// doesn't already establish, and having the tabs live in their own bar
// below a title bar cost a full extra row of height for no reason.
const CashierTopBar = ({ activeTab, onTabChange, showTabs, printerStatus, zraStatus, online }) => {
  const { openSidebar } = useOutletContext() || {};

  return (
    <header className="h-12 flex-shrink-0 bg-surface-raised border-b border-surface-border px-3 flex items-center justify-between gap-4">
      <div className="flex items-center gap-1 min-w-0">
        <button
          type="button"
          onClick={() => openSidebar?.()}
          className="lg:hidden btn-ghost p-1.5 shrink-0"
          aria-label="Open menu"
        >
          <Menu className="w-4 h-4" />
        </button>

        {showTabs && (
          <nav className="flex items-center gap-1 overflow-x-auto">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => onTabChange(tab.id)}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
                    isActive
                      ? 'border-surface-accent text-gray-900'
                      : 'border-transparent text-gray-500 hover:text-gray-800'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" strokeWidth={1.5} />
                  {tab.label}
                </button>
              );
            })}
          </nav>
        )}
      </div>

      <div className="flex items-center gap-3 shrink-0">
        <TopBarStatusIcon
          icon={Printer}
          state={PRINTER_STATE[printerStatus?.state] || 'neutral'}
          label="Receipt Printer"
          detail={printerStatus?.name ? `${PRINTER_LABEL[printerStatus.state]} · ${printerStatus.name}` : PRINTER_LABEL[printerStatus?.state] || 'Unknown'}
        />
        <TopBarStatusIcon
          icon={online ? Wifi : WifiOff}
          state={online ? 'ok' : 'offline'}
          label="Network"
          detail={online ? 'Online' : 'Offline'}
        />
        <TopBarStatusIcon
          icon={Satellite}
          state={ZRA_STATE[zraStatus] || 'neutral'}
          label="ZRA VSDC"
          detail={ZRA_LABEL[zraStatus] || 'Unknown'}
        />
      </div>
    </header>
  );
};

export default CashierTopBar;
