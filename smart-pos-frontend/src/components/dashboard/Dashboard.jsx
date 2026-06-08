import { useState, useEffect } from 'react';
import api from '../../services/api';
import DashboardHeader from './DashboardHeader';
import DashboardStats from './DashboardStats';
import HourlyChart from './HourlyChart';
import TopProducts from './TopProducts';
import PaymentMethods from './PaymentMethods';
import QuickActions from './QuickActions';

const Dashboard = () => {
  const [stats, setStats] = useState({
    todaySales: 0,
    transactionCount: 0,
    averageTicket: 0,
    lastSale: null,
    hourlyStats: [],
    topProducts: [],
    paymentMethods: {},
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedTimeframe, setSelectedTimeframe] = useState('today');
  const [lastUpdated, setLastUpdated] = useState(null);

  const fetchStats = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const salesResponse = await api.get('/api/sales');
      const sales = salesResponse.data || [];
      const today = new Date().toDateString();
      const todaySales = sales.filter((s) => new Date(s.createdAt).toDateString() === today);
      const todayTotal = todaySales.reduce((sum, s) => sum + s.total, 0);
      setStats({
        todaySales: todayTotal,
        transactionCount: todaySales.length,
        averageTicket: todaySales.length ? todayTotal / todaySales.length : 0,
        lastSale: todaySales[0] ? new Date(todaySales[0].createdAt).toLocaleTimeString() : null,
        hourlyStats: [],
        topProducts: [],
        paymentMethods: {},
      });
      setLastUpdated(new Date().toISOString());
    } catch {
      setError('Failed to load dashboard data');
      setLastUpdated(new Date().toISOString());
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, [selectedTimeframe]);

  return (
    <div className="space-y-4">
      <DashboardHeader
        selectedTimeframe={selectedTimeframe}
        onTimeframeChange={setSelectedTimeframe}
        onRefresh={fetchStats}
        lastUpdated={lastUpdated}
      />

      {error && (
        <div className="panel border-amber-300 bg-amber-50 text-amber-900 text-xs p-3">{error}</div>
      )}

      <DashboardStats stats={stats} isLoading={isLoading} />
      <QuickActions onActionClick={(a) => (window.location.href = a.path)} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <HourlyChart data={stats.hourlyStats} isLoading={isLoading} />
        </div>
        <TopProducts data={stats.topProducts} isLoading={isLoading} />
      </div>
      <PaymentMethods data={stats.paymentMethods} isLoading={isLoading} />
    </div>
  );
};

export default Dashboard;
