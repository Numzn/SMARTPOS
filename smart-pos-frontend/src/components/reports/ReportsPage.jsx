import React, { useEffect, useState } from 'react';
import { fetchReportSummary, fetchWeeklyReport, downloadTransactionsCsv } from '../../api/reportsApi';

const money = (n) => `K${Number(n || 0).toFixed(2)}`;

function formatDateTime(value) {
  if (!value) return 'Never';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return 'Never';
  return d.toLocaleString();
}

function fiscalHealth(fiscal) {
  if (!fiscal) return { label: 'Unknown', badge: 'bg-gray-100 text-gray-700' };
  if (fiscal.failed > 0) {
    return { label: 'Needs attention', badge: 'bg-red-100 text-red-800' };
  }
  if (fiscal.pending > 0) {
    return { label: 'Pending sync', badge: 'bg-yellow-100 text-yellow-800' };
  }
  return { label: 'Up to date', badge: 'bg-green-100 text-green-800' };
}

const ReportsPage = () => {
  const [summary, setSummary] = useState(null);
  const [weekly, setWeekly] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState(null);

  const loadReports = async () => {
    setLoading(true);
    setError(null);
    try {
      const [summaryData, weeklyData] = await Promise.all([
        fetchReportSummary(),
        fetchWeeklyReport(),
      ]);
      setSummary(summaryData);
      setWeekly(weeklyData.weekly || []);
    } catch (err) {
      setError(err?.data?.error || err.message || 'Failed to load reports');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadReports();
  }, []);

  const handleExport = async (range) => {
    setExporting(true);
    setExportError(null);
    try {
      await downloadTransactionsCsv(range);
    } catch (err) {
      setExportError(err.message || 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  const todayIso = new Date().toISOString().slice(0, 10);
  const exportToday = () => handleExport({ startDate: todayIso });
  const exportRecent = () => handleExport({});

  const health = fiscalHealth(summary?.fiscal);
  const maxSales = Math.max(1, ...weekly.map((d) => d.sales || 0));

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow-sm p-10 text-center text-gray-500">
        Loading reports…
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white rounded-lg shadow-sm p-6">
        <p className="text-red-600 font-medium">⚠️ {error}</p>
        <button
          onClick={loadReports}
          className="mt-4 bg-indigo-600 text-white px-4 py-2 rounded-md hover:bg-indigo-700"
        >
          Retry
        </button>
      </div>
    );
  }

  const today = summary?.today || {};
  const fiscal = summary?.fiscal || {};

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-lg shadow-sm p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Reports & Analytics</h1>
            <p className="text-gray-600 mt-1">Business insights and ZRA fiscal status</p>
          </div>
          <button
            onClick={exportRecent}
            disabled={exporting}
            className="bg-indigo-600 text-white px-4 py-2 rounded-md hover:bg-indigo-700 transition duration-150 disabled:opacity-60"
          >
            {exporting ? 'Exporting…' : '📄 Export (last 30 days)'}
          </button>
        </div>
        {exportError && <p className="text-red-600 text-sm mt-2">⚠️ {exportError}</p>}
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-white rounded-lg shadow-sm p-6">
          <div className="flex items-center">
            <span className="text-3xl mr-3">💰</span>
            <div>
              <p className="text-sm font-medium text-gray-600">Today's Sales</p>
              <p className="text-2xl font-bold text-gray-900">{money(today.sales)}</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm p-6">
          <div className="flex items-center">
            <span className="text-3xl mr-3">🧾</span>
            <div>
              <p className="text-sm font-medium text-gray-600">Transactions</p>
              <p className="text-2xl font-bold text-gray-900">{today.transactions || 0}</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm p-6">
          <div className="flex items-center">
            <span className="text-3xl mr-3">📊</span>
            <div>
              <p className="text-sm font-medium text-gray-600">Avg Transaction</p>
              <p className="text-2xl font-bold text-gray-900">{money(today.avgTransaction)}</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm p-6">
          <div className="flex items-center">
            <span className="text-3xl mr-3">🏛️</span>
            <div>
              <p className="text-sm font-medium text-gray-600">Tax Collected (today)</p>
              <p className="text-2xl font-bold text-gray-900">{money(today.tax)}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Fiscal Status Panel */}
      <div className="bg-white rounded-lg shadow-sm p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4">🏛️ ZRA VSDC Fiscal Status</h3>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="space-y-4">
            <div className="flex justify-between items-center p-4 bg-gray-50 rounded-lg">
              <div>
                <p className="font-medium text-gray-900">Fiscal Health</p>
                <p className="text-sm text-gray-600">Derived from live sale statuses</p>
              </div>
              <span className={`inline-flex px-3 py-1 text-sm font-semibold rounded-full ${health.badge}`}>
                {health.label}
              </span>
            </div>

            <div className="flex justify-between items-center p-4 bg-blue-50 rounded-lg">
              <div>
                <p className="font-medium text-gray-900">Last VSDC Sync</p>
                <p className="text-sm text-gray-600">Most recent accepted invoice</p>
              </div>
              <span className="text-blue-600 font-medium">{formatDateTime(fiscal.lastSync)}</span>
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex justify-between items-center p-4 bg-yellow-50 rounded-lg">
              <div>
                <p className="font-medium text-gray-900">Pending Submission</p>
                <p className="text-sm text-gray-600">Not yet accepted by VSDC</p>
              </div>
              <span className="inline-flex px-3 py-1 text-sm font-semibold rounded-full bg-yellow-100 text-yellow-800">
                ⏳ {fiscal.pending || 0}
              </span>
            </div>

            <div className="flex justify-between items-center p-4 bg-green-50 rounded-lg">
              <div>
                <p className="font-medium text-gray-900">Submitted Today</p>
                <p className="text-sm text-gray-600">Accepted by VSDC today</p>
              </div>
              <span className="inline-flex px-3 py-1 text-sm font-semibold rounded-full bg-green-100 text-green-800">
                ✅ {fiscal.submittedToday || 0}
              </span>
            </div>

            {fiscal.failed > 0 && (
              <div className="flex justify-between items-center p-4 bg-red-50 rounded-lg">
                <div>
                  <p className="font-medium text-gray-900">Fiscal Failures</p>
                  <p className="text-sm text-gray-600">Require resubmission</p>
                </div>
                <span className="inline-flex px-3 py-1 text-sm font-semibold rounded-full bg-red-100 text-red-800">
                  ❌ {fiscal.failed}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Weekly Sales Chart */}
      <div className="bg-white rounded-lg shadow-sm p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4">📈 Last 7 Days</h3>

        {weekly.length === 0 ? (
          <p className="text-gray-500">No completed sales in this period.</p>
        ) : (
          <div className="space-y-4">
            {weekly.map((day) => (
              <div key={day.date} className="flex items-center justify-between p-3 border rounded-lg">
                <div className="flex items-center space-x-4 flex-1">
                  <span className="font-medium text-gray-900 w-12">{day.day}</span>
                  <div className="flex-1 bg-gray-200 rounded-full h-2 max-w-xs">
                    <div
                      className="bg-indigo-600 h-2 rounded-full"
                      style={{ width: `${(day.sales / maxSales) * 100}%` }}
                    ></div>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-medium text-gray-900">{money(day.sales)}</p>
                  <p className="text-sm text-gray-500">{day.transactions} transactions</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Report Actions */}
      <div className="bg-white rounded-lg shadow-sm p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4">📋 Report Actions</h3>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <button
            onClick={exportToday}
            disabled={exporting}
            className="flex items-center justify-center px-4 py-3 border border-gray-300 rounded-md hover:bg-gray-50 transition duration-150 disabled:opacity-60"
          >
            <span className="mr-2">📊</span>
            Export Today (CSV)
          </button>

          <button
            onClick={exportRecent}
            disabled={exporting}
            className="flex items-center justify-center px-4 py-3 border border-gray-300 rounded-md hover:bg-gray-50 transition duration-150 disabled:opacity-60"
          >
            <span className="mr-2">📈</span>
            Export 30 Days (CSV)
          </button>

          <button
            onClick={loadReports}
            className="flex items-center justify-center px-4 py-3 border border-gray-300 rounded-md hover:bg-gray-50 transition duration-150"
          >
            <span className="mr-2">🔄</span>
            Refresh
          </button>
        </div>
      </div>
    </div>
  );
};

export default ReportsPage;
