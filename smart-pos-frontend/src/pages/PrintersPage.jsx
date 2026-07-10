import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Printer, Trash2, Zap } from 'lucide-react';
import {
  createPrinter,
  deletePrinter,
  fetchPrinters,
  testPrinter,
  updatePrinter,
} from '../api/printersApi';
import { usePermissions } from '../hooks/usePermissions';

const PRINTER_TYPES = [
  { value: 'BROWSER', label: 'Browser (window.print)' },
  { value: 'ESCPOS_NETWORK', label: 'ESC/POS network (TCP)' },
];

const emptyForm = () => ({
  name: '',
  type: 'BROWSER',
  format: 'thermal',
  host: '',
  port: 9100,
  isDefault: false,
});

export default function PrintersPage() {
  const { canAccess } = usePermissions();
  const { manageSettings } = canAccess;
  const [loading, setLoading] = useState(true);
  const [printers, setPrinters] = useState([]);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchPrinters();
      setPrinters(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e.message || 'Failed to load printers');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!manageSettings) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await createPrinter({
        ...form,
        port: Number(form.port) || 9100,
        host: form.type === 'ESCPOS_NETWORK' ? form.host : null,
      });
      setForm(emptyForm());
      setMessage('Printer profile created');
      await load();
    } catch (err) {
      setError(err.message || 'Failed to create printer');
    } finally {
      setSaving(false);
    }
  };

  const handleSetDefault = async (printer) => {
    if (!manageSettings) return;
    try {
      await updatePrinter(printer.id, { isDefault: true });
      setMessage(`${printer.name} set as default`);
      await load();
    } catch (err) {
      setError(err.message || 'Failed to update printer');
    }
  };

  const handleTest = async (id) => {
    setTestingId(id);
    setError(null);
    setMessage(null);
    try {
      const res = await testPrinter(id);
      setMessage(res.message || 'Test print sent');
      await load();
    } catch (err) {
      setError(err.message || 'Test print failed');
      await load();
    } finally {
      setTestingId(null);
    }
  };

  const handleDelete = async (id) => {
    if (!manageSettings || !window.confirm('Delete this printer profile?')) return;
    try {
      await deletePrinter(id);
      setMessage('Printer deleted');
      await load();
    } catch (err) {
      setError(err.message || 'Failed to delete printer');
    }
  };

  return (
    <div className="p-6 max-w-4xl">
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Printer management</h1>
      <p className="text-sm text-gray-500 mb-6">
        Configure browser or ESC/POS network printers. Checkout and sales reprints use the default
        profile.
      </p>

      {!manageSettings && (
        <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded p-3 mb-4">
          Read-only access. Contact an administrator to manage printers.
        </p>
      )}

      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-3 mb-4">{error}</p>
      )}
      {message && (
        <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded p-3 mb-4">
          {message}
        </p>
      )}

      {loading ? (
        <p className="text-gray-500 text-sm">Loading printers…</p>
      ) : (
        <div className="space-y-3 mb-8">
          {printers.length === 0 && (
            <p className="text-sm text-gray-500 border border-dashed border-gray-300 rounded p-4">
              No printer profiles yet. Add a browser default or an ESC/POS network printer below.
            </p>
          )}
          {printers.map((p) => (
            <div
              key={p.id}
              className="flex flex-wrap items-center justify-between gap-3 border border-gray-200 rounded-lg p-4 bg-white"
            >
              <div>
                <div className="flex items-center gap-2">
                  <Printer className="w-4 h-4 text-gray-500" />
                  <span className="font-medium text-gray-900">{p.name}</span>
                  {p.isDefault && (
                    <span className="text-[10px] uppercase tracking-wide bg-gray-900 text-white px-1.5 py-0.5 rounded">
                      Default
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  {p.type === 'ESCPOS_NETWORK'
                    ? `ESC/POS ${p.host}:${p.port || 9100}`
                    : 'Browser print'}
                  {p.lastTestAt && (
                    <>
                      {' · '}
                      Last test: {p.lastTestOk ? 'OK' : 'Failed'} (
                      {new Date(p.lastTestAt).toLocaleString()})
                    </>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {!p.isDefault && manageSettings && (
                  <button
                    type="button"
                    onClick={() => handleSetDefault(p)}
                    className="text-xs px-2 py-1 border border-gray-300 rounded hover:bg-gray-50"
                  >
                    Set default
                  </button>
                )}
                {p.type === 'ESCPOS_NETWORK' && manageSettings && (
                  <button
                    type="button"
                    onClick={() => handleTest(p.id)}
                    disabled={testingId === p.id}
                    className="inline-flex items-center gap-1 text-xs px-2 py-1 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
                  >
                    {testingId === p.id ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Zap className="w-3 h-3" />
                    )}
                    Test
                  </button>
                )}
                {manageSettings && (
                  <button
                    type="button"
                    onClick={() => handleDelete(p.id)}
                    className="text-xs px-2 py-1 border border-red-200 text-red-600 rounded hover:bg-red-50"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {manageSettings && (
        <form onSubmit={handleCreate} className="border border-gray-200 rounded-lg p-4 bg-gray-50 space-y-3">
          <h2 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
            <Plus className="w-4 h-4" /> Add printer
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-gray-600">Name</span>
              <input
                type="text"
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="mt-1 block w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-gray-600">Type</span>
              <select
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value })}
                className="mt-1 block w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
              >
                {PRINTER_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            {form.type === 'ESCPOS_NETWORK' && (
              <>
                <label className="block">
                  <span className="text-xs font-medium text-gray-600">Host (IP)</span>
                  <input
                    type="text"
                    required
                    placeholder="192.168.1.50"
                    value={form.host}
                    onChange={(e) => setForm({ ...form, host: e.target.value })}
                    className="mt-1 block w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-gray-600">Port</span>
                  <input
                    type="number"
                    value={form.port}
                    onChange={(e) => setForm({ ...form, port: e.target.value })}
                    className="mt-1 block w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
                  />
                </label>
              </>
            )}
          </div>
          <label className="inline-flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={form.isDefault}
              onChange={(e) => setForm({ ...form, isDefault: e.target.checked })}
            />
            Set as default printer
          </label>
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 px-3 py-1.5 bg-gray-900 text-white text-sm rounded hover:bg-gray-800 disabled:opacity-50"
          >
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Add printer
          </button>
        </form>
      )}
    </div>
  );
}
