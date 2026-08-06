import React from 'react';

export const money = (n) => `K${Number(n || 0).toFixed(2)}`;
export const pct = (n) => `${Number(n || 0).toFixed(1)}%`;

export const formatDate = (value) => {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString();
};

export const formatDateTime = (value) => {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
};

/** Default range used by every tab: trailing 30 days, inclusive of today. */
export function defaultRange() {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 29);
  return { startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10) };
}

export const StatTiles = ({ tiles }) => (
  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
    {tiles.map((tile) => (
      <div key={tile.label} className="bg-white rounded-lg shadow-sm p-4">
        <p className="text-sm font-medium text-gray-600">{tile.label}</p>
        <p className={`text-2xl font-bold ${tile.tone || 'text-gray-900'}`}>{tile.value}</p>
        {tile.hint && <p className="text-xs text-gray-500 mt-1">{tile.hint}</p>}
      </div>
    ))}
  </div>
);

/**
 * Date-range filter shared by every report tab. `children` is a slot for a
 * tab-specific dropdown (cashier, supplier, status) so each tab doesn't have
 * to rebuild the surrounding layout.
 */
export const ReportFilterBar = ({ range, setRange, onApply, onExport, exporting, children }) => (
  <div className="bg-white rounded-lg shadow-sm p-4 flex flex-wrap items-end gap-3">
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">From</label>
      <input
        type="date"
        value={range.startDate}
        onChange={(e) => setRange({ ...range, startDate: e.target.value })}
        className="px-3 py-2 border border-gray-300 rounded-md text-sm"
      />
    </div>
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">To</label>
      <input
        type="date"
        value={range.endDate}
        onChange={(e) => setRange({ ...range, endDate: e.target.value })}
        className="px-3 py-2 border border-gray-300 rounded-md text-sm"
      />
    </div>
    {children}
    <button
      onClick={onApply}
      className="px-4 py-2 bg-indigo-600 text-white rounded-md text-sm font-medium hover:bg-indigo-700"
    >
      Apply
    </button>
    {onExport && (
      <button
        onClick={onExport}
        disabled={exporting}
        className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
      >
        {exporting ? 'Exporting…' : 'Export CSV'}
      </button>
    )}
  </div>
);

/**
 * Table with a title. `columns` entries are {key, label, align?, render?}.
 * Kept deliberately plain — these are read-only report tables, not the
 * editable grids elsewhere in the app.
 */
export const ReportTable = ({ title, columns, rows, rowKey, empty = 'No data for this period.' }) => (
  <div className="bg-white rounded-lg shadow-sm">
    {title && (
      <div className="px-4 py-3 border-b border-gray-200">
        <h3 className="font-medium text-gray-900">{title}</h3>
      </div>
    )}
    {!rows.length ? (
      <p className="px-4 py-8 text-center text-gray-500 text-sm">{empty}</p>
    ) : (
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={`px-4 py-3 text-xs font-medium text-gray-500 uppercase ${
                    col.align === 'right' ? 'text-right' : 'text-left'
                  }`}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {rows.map((row, i) => (
              <tr key={rowKey ? rowKey(row) : i}>
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={`px-4 py-3 text-sm ${
                      col.align === 'right' ? 'text-right' : 'text-left'
                    } ${col.tone ? col.tone(row) : 'text-gray-700'}`}
                  >
                    {col.render ? col.render(row) : row[col.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
  </div>
);

export const ReportStates = ({ loading, error, onRetry, children }) => {
  if (loading) {
    return <div className="bg-white rounded-lg shadow-sm p-10 text-center text-gray-500">Loading…</div>;
  }
  if (error) {
    return (
      <div className="bg-white rounded-lg shadow-sm p-6">
        <p className="text-red-600 font-medium">⚠️ {error}</p>
        {onRetry && (
          <button
            onClick={onRetry}
            className="mt-4 bg-indigo-600 text-white px-4 py-2 rounded-md hover:bg-indigo-700"
          >
            Retry
          </button>
        )}
      </div>
    );
  }
  return children;
};

/** Shared fetch-on-apply state machine used by each report tab. */
export function useReportTab(fetcher) {
  const [range, setRange] = React.useState(defaultRange);
  const [data, setData] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(null);
  const [exporting, setExporting] = React.useState(false);

  const load = React.useCallback(
    async (params) => {
      setLoading(true);
      setError(null);
      try {
        setData(await fetcher(params));
      } catch (err) {
        setError(err?.data?.error || err.message || 'Failed to load report');
      } finally {
        setLoading(false);
      }
    },
    [fetcher]
  );

  React.useEffect(() => {
    load(range);
    // Intentionally load once on mount; further loads are driven by Apply.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { range, setRange, data, loading, error, exporting, setExporting, reload: () => load(range) };
}
