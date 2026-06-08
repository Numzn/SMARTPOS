import React from 'react';
import { CreditCard } from 'lucide-react';

const PaymentMethods = ({ data, isLoading }) => {
  const labels = {
    cash: 'Cash',
    card: 'Card',
    mobile: 'Mobile money',
    bank: 'Bank transfer',
  };

  if (isLoading) {
    return <div className="panel h-32 animate-pulse bg-gray-100" />;
  }

  const entries = Object.entries(data || {});

  return (
    <div className="panel">
      <div className="panel-header flex items-center gap-2">
        <CreditCard className="w-4 h-4 text-gray-500" />
        <h3 className="text-sm font-semibold text-gray-900">Payment mix</h3>
      </div>
      <div className="panel-body space-y-3">
        {entries.length === 0 ? (
          <p className="text-xs text-gray-500 text-center py-4">No payment data</p>
        ) : (
          entries.map(([method, percentage]) => (
            <div key={method}>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-gray-700">{labels[method] || method}</span>
                <span className="font-mono text-gray-900">{percentage}%</span>
              </div>
              <div className="w-full bg-gray-200 h-1.5">
                <div className="bg-gray-600 h-1.5" style={{ width: `${percentage}%` }} />
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default PaymentMethods;
