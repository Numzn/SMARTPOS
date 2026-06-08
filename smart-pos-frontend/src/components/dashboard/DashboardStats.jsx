import React from 'react';
import { DollarSign, ShoppingCart, Users, Clock } from 'lucide-react';

const DashboardStats = ({ stats, isLoading }) => {
  const formatCurrency = (amount) =>
    new Intl.NumberFormat('en-ZM', { style: 'currency', currency: 'ZMW' }).format(amount ?? 0);

  const cards = [
    { title: "Today's sales", value: formatCurrency(stats.todaySales), icon: DollarSign },
    { title: 'Transactions', value: stats.transactionCount ?? 0, icon: ShoppingCart, mono: true },
    { title: 'Avg. ticket', value: formatCurrency(stats.averageTicket), icon: Users },
    { title: 'Last sale', value: stats.lastSale || '—', icon: Clock, mono: true },
  ];

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="panel h-20 animate-pulse bg-gray-100" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {cards.map(({ title, value, icon, mono }) => (
        <div key={title} className="panel">
          <div className="panel-body flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[11px] font-medium text-gray-500 uppercase tracking-wide">{title}</p>
              <p className={mono ? 'stat-value text-base mt-1' : 'stat-value mt-1'}>{value}</p>
            </div>
            {React.createElement(icon, {
              className: 'w-4 h-4 text-gray-400 shrink-0',
              strokeWidth: 1.5,
            })}
          </div>
        </div>
      ))}
    </div>
  );
};

export default DashboardStats;
