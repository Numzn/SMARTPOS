import React from 'react';
import { Package } from 'lucide-react';

const TopProducts = ({ data, isLoading }) => {
  const formatCurrency = (amount) =>
    new Intl.NumberFormat('en-ZM', { style: 'currency', currency: 'ZMW' }).format(amount ?? 0);

  const formatNumber = (num) => new Intl.NumberFormat('en-ZM').format(num ?? 0);

  if (isLoading) {
    return <div className="panel h-48 animate-pulse bg-gray-100" />;
  }

  const list = data?.length ? data : [];

  return (
    <div className="panel">
      <div className="panel-header flex items-center gap-2">
        <Package className="w-4 h-4 text-gray-500" />
        <h3 className="text-sm font-semibold text-gray-900">Top products</h3>
      </div>
      <div className="panel-body">
        {list.length === 0 ? (
          <p className="text-xs text-gray-500 text-center py-6">No product data</p>
        ) : (
          <div className="space-y-2">
            {list.map((product, index) => (
              <div
                key={index}
                className="flex items-center gap-3 py-2 border-b border-gray-100 last:border-0"
              >
                <span className="font-mono text-xs text-gray-400 w-4">{index + 1}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{product.name}</p>
                  <p className="text-xs text-gray-500">
                    {formatNumber(product.sales)} sold
                  </p>
                </div>
                <span className="font-mono text-xs text-gray-900">
                  {formatCurrency(product.revenue)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default TopProducts;
