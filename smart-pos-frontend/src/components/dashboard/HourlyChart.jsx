import React from 'react';
import { BarChart3, TrendingUp } from 'lucide-react';

const HourlyChart = ({ data, isLoading }) => {
  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-ZM', {
      style: 'currency',
      currency: 'ZMW',
      minimumFractionDigits: 0
    }).format(amount);
  };

  const getMaxValue = () => {
    if (!data || data.length === 0) return 100;
    return Math.max(...data.map(item => item.sales));
  };

  const maxValue = getMaxValue();

  if (isLoading) {
    return (
      <div className="panel">
        <div className="flex items-center justify-between mb-6">
          <div className="h-6 bg-gray-200 rounded w-32 animate-pulse"></div>
          <div className="h-6 bg-gray-200 rounded w-16 animate-pulse"></div>
        </div>
        <div className="space-y-3">
          {[1, 2, 3, 4, 5, 6].map(i => (
            <div key={i} className="flex items-center space-x-4">
              <div className="h-4 bg-gray-200 rounded w-12 animate-pulse"></div>
              <div className="flex-1 h-4 bg-gray-200 rounded animate-pulse"></div>
              <div className="h-4 bg-gray-200 rounded w-16 animate-pulse"></div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="panel-header flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-gray-500" />
          <h3 className="text-sm font-semibold text-gray-900">Hourly sales</h3>
        </div>
      </div>
      <div className="panel-body">

      <div className="space-y-4">
        {data.map((item, index) => {
          const percentage = maxValue > 0 ? (item.sales / maxValue) * 100 : 0;
          
          return (
            <div key={index} className="flex items-center space-x-4">
              <div className="w-16 text-sm font-medium text-gray-600">
                {item.hour}
              </div>
              
              <div className="flex-1">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm text-gray-500">
                    {item.transactions} transactions
                  </span>
                  <span className="text-sm font-semibold text-gray-900">
                    {formatCurrency(item.sales)}
                  </span>
                </div>
                
                <div className="w-full bg-gray-200 h-1.5">
                  <div
                    className="bg-gray-700 h-1.5 transition-all"
                    style={{ width: `${percentage}%` }}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4 pt-3 border-t border-surface-border flex justify-between text-xs">
        <span className="text-gray-500">Total today</span>
        <span className="font-mono font-medium text-gray-900">
          {formatCurrency(data.reduce((sum, item) => sum + item.sales, 0))}
        </span>
      </div>
      </div>
    </div>
  );
};

export default HourlyChart;


