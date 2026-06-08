import React from 'react';
import { ShoppingCart, Fuel, FileText, Wrench } from 'lucide-react';

const CashierTabs = ({ activeTab, onTabChange }) => {
  const tabs = [
    { id: 'quickshop', label: 'Quick shop', icon: ShoppingCart },
    { id: 'forecourt', label: 'Forecourt', icon: Fuel },
    { id: 'drafts', label: 'Drafts', icon: FileText },
    { id: 'tools', label: 'Tools', icon: Wrench },
  ];

  return (
    <div className="bg-surface-raised border-b border-surface-border px-4">
      <nav className="flex gap-1">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onTabChange(tab.id)}
              className={`flex items-center gap-2 px-3 py-2.5 text-xs font-medium border-b-2 -mb-px transition-colors ${
                isActive
                  ? 'border-gray-800 text-gray-900'
                  : 'border-transparent text-gray-500 hover:text-gray-800'
              }`}
            >
              <Icon className="w-3.5 h-3.5" strokeWidth={1.5} />
              {tab.label}
            </button>
          );
        })}
      </nav>
    </div>
  );
};

export default CashierTabs;
