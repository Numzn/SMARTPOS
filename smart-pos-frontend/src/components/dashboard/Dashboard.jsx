import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { usePermissions } from '../../hooks/usePermissions';
import axios from 'axios';

const Dashboard = () => {
  const { user } = useAuth();
  const { canAccess } = usePermissions();
  const [stats, setStats] = useState({
    todaysSales: 0,
    todaysRevenue: 0,
    totalProducts: 0,
    lowStockItems: 0,
    pendingOrders: 0,
    zraStatus: 'connected'
  });
  const [recentSales, setRecentSales] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
    try {
      // Mock data for now - replace with actual API calls
      setStats({
        todaysSales: 15,
        todaysRevenue: 2450.75,
        totalProducts: 245,
        lowStockItems: 8,
        pendingOrders: 3,
        zraStatus: 'connected'
      });

      setRecentSales([
        { id: '1', createdAt: new Date(), total: 125.50, paymentMethod: 'CASH' },
        { id: '2', createdAt: new Date(), total: 89.25, paymentMethod: 'CARD' },
        { id: '3', createdAt: new Date(), total: 245.00, paymentMethod: 'CASH' }
      ]);
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  const statCards = [
    {
      name: "Today's Sales",
      value: stats.todaysSales,
      icon: '🛒',
      color: 'bg-blue-500',
      show: canAccess.viewSales
    },
    {
      name: "Today's Revenue",
      value: `K${stats.todaysRevenue.toFixed(2)}`,
      icon: '💰',
      color: 'bg-green-500',
      show: canAccess.viewSales
    },
    {
      name: 'Total Products',
      value: stats.totalProducts,
      icon: '📦',
      color: 'bg-purple-500',
      show: canAccess.viewProducts
    },
    {
      name: 'Low Stock Items',
      value: stats.lowStockItems,
      icon: '⚠️',
      color: 'bg-red-500',
      show: canAccess.viewInventory
    }
  ].filter(card => card.show);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Welcome Header */}
      <div className="bg-white rounded-lg shadow-sm p-6">
        <h1 className="text-2xl font-bold text-gray-900">
          Welcome back, {user?.name}!
        </h1>
        <p className="text-gray-600 mt-1">
          Here's what's happening with your store today.
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {statCards.map((stat, index) => (
          <div key={index} className="bg-white rounded-lg shadow-sm p-6">
            <div className="flex items-center">
              <div className={`${stat.color} rounded-md p-3 text-white text-2xl`}>
                {stat.icon}
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">{stat.name}</p>
                <p className="text-2xl font-bold text-gray-900">{stat.value}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Recent Activity & Quick Actions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Sales */}
        {canAccess.viewSales && (
          <div className="lg:col-span-2 bg-white rounded-lg shadow-sm">
            <div className="p-6 border-b border-gray-200">
              <h3 className="text-lg font-medium text-gray-900">Recent Sales</h3>
            </div>
            <div className="p-6">
              {recentSales.length > 0 ? (
                <div className="space-y-4">
                  {recentSales.map((sale) => (
                    <div key={sale.id} className="flex items-center justify-between py-3 border-b border-gray-100 last:border-b-0">
                      <div className="flex items-center">
                        <div className="flex-shrink-0">
                          <span className="text-2xl">✅</span>
                        </div>
                        <div className="ml-3">
                          <p className="text-sm font-medium text-gray-900">
                            Sale #{sale.id.slice(-8)}
                          </p>
                          <p className="text-sm text-gray-500">
                            {new Date(sale.createdAt).toLocaleString()}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-medium text-gray-900">
                          K{sale.total}
                        </p>
                        <p className="text-sm text-gray-500">
                          {sale.paymentMethod}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-gray-500 text-center py-8">No recent sales</p>
              )}
            </div>
          </div>
        )}

        {/* Quick Actions */}
        <div className="bg-white rounded-lg shadow-sm">
          <div className="p-6 border-b border-gray-200">
            <h3 className="text-lg font-medium text-gray-900">Quick Actions</h3>
          </div>
          <div className="p-6 space-y-4">
            {canAccess.createSale && (
              <button 
                onClick={() => window.location.href = '/sales'}
                className="w-full bg-indigo-600 text-white py-3 px-4 rounded-md hover:bg-indigo-700 transition duration-150"
              >
                🛒 New Sale
              </button>
            )}
            {canAccess.manageProducts && (
              <button 
                onClick={() => window.location.href = '/products'}
                className="w-full bg-green-600 text-white py-3 px-4 rounded-md hover:bg-green-700 transition duration-150"
              >
                📦 Add Product
              </button>
            )}
            {canAccess.viewReports && (
              <button 
                onClick={() => window.location.href = '/reports'}
                className="w-full bg-purple-600 text-white py-3 px-4 rounded-md hover:bg-purple-700 transition duration-150"
              >
                📊 View Reports
              </button>
            )}
            {canAccess.manageInventory && (
              <button 
                onClick={() => window.location.href = '/inventory'}
                className="w-full bg-orange-600 text-white py-3 px-4 rounded-md hover:bg-orange-700 transition duration-150"
              >
                📋 Stock Adjustment
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ZRA Status */}
      {canAccess.viewZRAStatus && (
        <div className="bg-white rounded-lg shadow-sm p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <span className="text-2xl">✅</span>
              </div>
              <div className="ml-3">
                <h3 className="text-lg font-medium text-gray-900">ZRA VSDC Status</h3>
                <p className="text-sm text-gray-600">
                  System is connected and compliant with ZRA requirements
                </p>
              </div>
            </div>
            <div className="text-sm text-green-600 font-medium">
              ACTIVE
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
