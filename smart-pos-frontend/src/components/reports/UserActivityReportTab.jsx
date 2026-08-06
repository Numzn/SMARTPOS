import React from 'react';
import { fetchUserActivityReport, downloadUserActivityCsv } from '../../api/reportsApi';
import {
  formatDateTime, StatTiles, ReportFilterBar, ReportTable, ReportStates, useReportTab,
} from './ReportShared';

const UserActivityReportTab = () => {
  const { range, setRange, data, loading, error, exporting, setExporting, reload } =
    useReportTab(fetchUserActivityReport);

  const handleExport = async () => {
    setExporting(true);
    try {
      await downloadUserActivityCsv(range);
    } catch (err) {
      alert(`Export failed: ${err.message}`);
    } finally {
      setExporting(false);
    }
  };

  const summary = data?.summary || {};

  return (
    <div className="space-y-4">
      <ReportFilterBar
        range={range}
        setRange={setRange}
        onApply={reload}
        onExport={handleExport}
        exporting={exporting}
      />

      <ReportStates loading={loading} error={error} onRetry={reload}>
        <StatTiles
          tiles={[
            { label: 'Audit Events', value: summary.totalEvents ?? 0 },
            { label: 'Active Users', value: summary.activeUsers ?? 0 },
          ]}
        />

        <ReportTable
          title="By User"
          rows={data?.byUser || []}
          rowKey={(r) => r.userId || 'system'}
          columns={[
            { key: 'userName', label: 'User' },
            { key: 'role', label: 'Role', render: (r) => r.role || '—' },
            { key: 'eventCount', label: 'Events', align: 'right' },
            { key: 'lastActivity', label: 'Last Activity', render: (r) => formatDateTime(r.lastActivity) },
          ]}
        />

        <ReportTable
          title="Most Frequent Events"
          rows={data?.byEventType || []}
          rowKey={(r) => r.eventType}
          columns={[
            { key: 'eventType', label: 'Event Type' },
            { key: 'count', label: 'Count', align: 'right' },
          ]}
        />

        <p className="text-xs text-gray-500">
          The CSV export contains the individual audit events rather than these totals, capped at
          10,000 rows for the selected period.
        </p>
      </ReportStates>
    </div>
  );
};

export default UserActivityReportTab;
