import React, { useState } from 'react';
import { usePermissions } from '../../hooks/usePermissions';
import OverviewTab from './OverviewTab';
import InventoryReportsTab from './InventoryReportsTab';
import TaxReportTab from './TaxReportTab';
import ProfitReportTab from './ProfitReportTab';
import CashShiftReportTab from './CashShiftReportTab';
import PurchaseReportTab from './PurchaseReportTab';
import UserActivityReportTab from './UserActivityReportTab';

const TABS = [
  { key: 'overview', label: 'Overview', Component: OverviewTab },
  { key: 'inventory', label: 'Inventory', Component: InventoryReportsTab, requires: 'inventory:read' },
  { key: 'tax', label: 'Tax', Component: TaxReportTab },
  { key: 'profit', label: 'Profit', Component: ProfitReportTab },
  { key: 'cashshift', label: 'Cash & Shifts', Component: CashShiftReportTab },
  { key: 'purchasing', label: 'Purchasing', Component: PurchaseReportTab, requires: 'purchasing:read' },
  // Audit data is a tighter boundary than business reporting — a VIEWER can
  // read the numbers without being able to see who did what.
  { key: 'useractivity', label: 'User Activity', Component: UserActivityReportTab, requires: 'audit:read' },
];

const ReportsPage = () => {
  const { hasPermission } = usePermissions();
  const tabs = TABS.filter((tab) => !tab.requires || hasPermission(tab.requires));
  const [activeTab, setActiveTab] = useState(tabs[0]?.key || 'overview');

  const ActiveComponent = tabs.find((t) => t.key === activeTab)?.Component || OverviewTab;

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow-sm p-6">
        <h1 className="text-2xl font-bold text-gray-900">Reports &amp; Analytics</h1>
        <p className="text-gray-600 mt-1">Business insights and ZRA fiscal status</p>
      </div>

      <div className="border-b border-gray-200">
        <nav className="-mb-px flex gap-6 overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`py-3 px-1 border-b-2 text-sm font-medium whitespace-nowrap ${
                activeTab === tab.key
                  ? 'border-indigo-600 text-indigo-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Keyed so switching tabs remounts, resetting each tab's own filters
          and refetching rather than showing another tab's stale range. */}
      <ActiveComponent key={activeTab} />
    </div>
  );
};

export default ReportsPage;
