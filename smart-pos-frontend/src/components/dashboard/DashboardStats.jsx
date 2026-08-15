import React from 'react';
import { DollarSign, ShoppingCart, Users, Clock } from 'lucide-react';
import StatCard from '../ui/StatCard';

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
      {cards.map((card) => (
        <StatCard key={card.title} {...card} />
      ))}
    </div>
  );
};

export default DashboardStats;
