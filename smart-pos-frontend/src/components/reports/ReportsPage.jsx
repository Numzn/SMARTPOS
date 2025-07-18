import React, { useState, useEffect } from 'react';

const ReportsPage = () => {
  const [reports, setReports] = useState({
    todaySales: {
      amount: 1567.50,
      transactions: 23,
      avgTransaction: 68.15
    },
    zraStatus: {
      lastSync: '2024-01-15 14:30:22',
      complianceStatus: 'Compliant',
      pendingInvoices: 2,
      submittedToday: 21
    },
    weeklyStats: [
      { day: 'Mon', sales: 1200, transactions: 18 },
      { day: 'Tue', sales: 1567, transactions: 23 },
      { day: 'Wed', sales: 890, transactions: 14 },
      { day: 'Thu', sales: 2100, transactions: 31 },
      { day: 'Fri', sales: 1780, transactions: 27 },
      { day: 'Sat', sales: 2450, transactions: 38 },
      { day: 'Sun', sales: 1340, transactions: 20 }
    ]
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-lg shadow-sm p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Reports & Analytics</h1>
            <p className="text-gray-600 mt-1">Business insights and ZRA compliance</p>
          </div>
          <button className="bg-indigo-600 text-white px-4 py-2 rounded-md hover:bg-indigo-700 transition duration-150">
            📄 Export Report
          </button>
        </div>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-white rounded-lg shadow-sm p-6">
          <div className="flex items-center">
            <span className="text-3xl mr-3">💰</span>
            <div>
              <p className="text-sm font-medium text-gray-600">Today's Sales</p>
              <p className="text-2xl font-bold text-gray-900">K{reports.todaySales.amount.toFixed(2)}</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm p-6">
          <div className="flex items-center">
            <span className="text-3xl mr-3">🧾</span>
            <div>
              <p className="text-sm font-medium text-gray-600">Transactions</p>
              <p className="text-2xl font-bold text-gray-900">{reports.todaySales.transactions}</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm p-6">
          <div className="flex items-center">
            <span className="text-3xl mr-3">📊</span>
            <div>
              <p className="text-sm font-medium text-gray-600">Avg Transaction</p>
              <p className="text-2xl font-bold text-gray-900">K{reports.todaySales.avgTransaction.toFixed(2)}</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm p-6">
          <div className="flex items-center">
            <span className="text-3xl mr-3">✅</span>
            <div>
              <p className="text-sm font-medium text-gray-600">ZRA Status</p>
              <p className="text-lg font-bold text-green-600">{reports.zraStatus.complianceStatus}</p>
            </div>
          </div>
        </div>
      </div>

      {/* ZRA Compliance Panel */}
      <div className="bg-white rounded-lg shadow-sm p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4">🏛️ ZRA VSDC Compliance Status</h3>
        
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="space-y-4">
            <div className="flex justify-between items-center p-4 bg-green-50 rounded-lg">
              <div>
                <p className="font-medium text-gray-900">Compliance Status</p>
                <p className="text-sm text-gray-600">All requirements met</p>
              </div>
              <span className="inline-flex px-3 py-1 text-sm font-semibold rounded-full bg-green-100 text-green-800">
                ✅ 100% Compliant
              </span>
            </div>

            <div className="flex justify-between items-center p-4 bg-blue-50 rounded-lg">
              <div>
                <p className="font-medium text-gray-900">Last Sync</p>
                <p className="text-sm text-gray-600">{reports.zraStatus.lastSync}</p>
              </div>
              <span className="text-blue-600 font-medium">🔄 Synced</span>
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex justify-between items-center p-4 bg-yellow-50 rounded-lg">
              <div>
                <p className="font-medium text-gray-900">Pending Invoices</p>
                <p className="text-sm text-gray-600">Awaiting submission</p>
              </div>
              <span className="inline-flex px-3 py-1 text-sm font-semibold rounded-full bg-yellow-100 text-yellow-800">
                ⏳ {reports.zraStatus.pendingInvoices}
              </span>
            </div>

            <div className="flex justify-between items-center p-4 bg-green-50 rounded-lg">
              <div>
                <p className="font-medium text-gray-900">Submitted Today</p>
                <p className="text-sm text-gray-600">Successfully processed</p>
              </div>
              <span className="inline-flex px-3 py-1 text-sm font-semibold rounded-full bg-green-100 text-green-800">
                ✅ {reports.zraStatus.submittedToday}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Weekly Sales Chart */}
      <div className="bg-white rounded-lg shadow-sm p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4">📈 Weekly Sales Overview</h3>
        
        <div className="space-y-4">
          {reports.weeklyStats.map((day, index) => (
            <div key={index} className="flex items-center justify-between p-3 border rounded-lg">
              <div className="flex items-center space-x-4">
                <span className="font-medium text-gray-900 w-12">{day.day}</span>
                <div className="flex-1 bg-gray-200 rounded-full h-2 max-w-xs">
                  <div 
                    className="bg-indigo-600 h-2 rounded-full" 
                    style={{ width: `${(day.sales / 2500) * 100}%` }}
                  ></div>
                </div>
              </div>
              <div className="text-right">
                <p className="font-medium text-gray-900">K{day.sales.toFixed(2)}</p>
                <p className="text-sm text-gray-500">{day.transactions} transactions</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Action Buttons */}
      <div className="bg-white rounded-lg shadow-sm p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4">📋 Report Actions</h3>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <button className="flex items-center justify-center px-4 py-3 border border-gray-300 rounded-md hover:bg-gray-50 transition duration-150">
            <span className="mr-2">📊</span>
            Generate Daily Report
          </button>
          
          <button className="flex items-center justify-center px-4 py-3 border border-gray-300 rounded-md hover:bg-gray-50 transition duration-150">
            <span className="mr-2">📈</span>
            Export Sales Data
          </button>
          
          <button className="flex items-center justify-center px-4 py-3 border border-gray-300 rounded-md hover:bg-gray-50 transition duration-150">
            <span className="mr-2">🏛️</span>
            ZRA Compliance Report
          </button>
        </div>
      </div>
    </div>
  );
};

export default ReportsPage;
