import React from 'react';
import { ShoppingCart, Plus, Package, BarChart2, FileText, Settings } from 'lucide-react';

const QuickActions = ({ onActionClick }) => {
  const actions = [
    { id: 'new-sale', title: 'New sale', icon: ShoppingCart, path: '/cashier' },
    { id: 'add-product', title: 'Products', icon: Plus, path: '/products' },
    { id: 'inventory', title: 'Inventory', icon: Package, path: '/inventory' },
    { id: 'reports', title: 'Reports', icon: BarChart2, path: '/reports' },
    { id: 'zra-status', title: 'ZRA status', icon: FileText, path: '/reports' },
    { id: 'settings', title: 'Settings', icon: Settings, path: '/settings' },
  ];

  return (
    <div className="panel">
      <div className="panel-header">
        <h3 className="text-sm font-semibold text-gray-900">Shortcuts</h3>
      </div>
      <div className="panel-body">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          {actions.map((action) => {
            const Icon = action.icon;
            return (
              <button
                key={action.id}
                type="button"
                onClick={() =>
                  onActionClick ? onActionClick(action) : (window.location.href = action.path)
                }
                className="flex flex-col items-center gap-2 p-3 border border-surface-border rounded bg-gray-50/50 hover:bg-white hover:border-gray-400 transition-colors text-center"
              >
                <Icon className="w-4 h-4 text-gray-600" strokeWidth={1.5} />
                <span className="text-xs font-medium text-gray-800">{action.title}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default QuickActions;
