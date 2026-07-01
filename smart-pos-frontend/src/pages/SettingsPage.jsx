import { useEffect, useState } from 'react';
import { fetchBusinessSettings, updateBusinessSettings } from '../api/receiptsApi';
import { usePermissions } from '../hooks/usePermissions';

export default function SettingsPage() {
  const { manageSettings } = usePermissions();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  const [form, setForm] = useState({
    tradingName: '',
    tpin: '',
    logoUrl: '',
    footerLines: '',
    showPoweredBy: true,
    receiptVersion: '1.0',
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchBusinessSettings();
        if (!cancelled) {
          setForm({
            tradingName: data.tradingName || '',
            tpin: data.tpin || '',
            logoUrl: data.logoUrl || '',
            footerLines: Array.isArray(data.footerLines)
              ? data.footerLines.join('\n')
              : '',
            showPoweredBy: data.showPoweredBy !== false,
            receiptVersion: data.receiptVersion || '1.0',
          });
        }
      } catch (e) {
        if (!cancelled) setError(e.message || 'Failed to load settings');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!manageSettings) return;
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      await updateBusinessSettings({
        tradingName: form.tradingName,
        tpin: form.tpin,
        logoUrl: form.logoUrl || null,
        footerLines: form.footerLines.split('\n').map((l) => l.trim()).filter(Boolean),
        showPoweredBy: form.showPoweredBy,
        receiptVersion: form.receiptVersion,
      });
      setSuccess(true);
    } catch (err) {
      setError(err.message || 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6">
        <p className="text-gray-500">Loading settings…</p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-2xl">
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Business settings</h1>
      <p className="text-sm text-gray-500 mb-6">Receipt header, footer, and merchant profile.</p>

      {!manageSettings && (
        <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded p-3 mb-4">
          You have read-only access. Contact an administrator to change settings.
        </p>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <label className="block">
          <span className="text-sm font-medium text-gray-700">Trading name</span>
          <input
            type="text"
            value={form.tradingName}
            onChange={(e) => setForm({ ...form, tradingName: e.target.value })}
            disabled={!manageSettings}
            className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
          />
        </label>

        <label className="block">
          <span className="text-sm font-medium text-gray-700">TPIN</span>
          <input
            type="text"
            value={form.tpin}
            onChange={(e) => setForm({ ...form, tpin: e.target.value })}
            disabled={!manageSettings}
            className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2 text-sm font-mono"
          />
        </label>

        <label className="block">
          <span className="text-sm font-medium text-gray-700">Logo URL</span>
          <input
            type="url"
            value={form.logoUrl}
            onChange={(e) => setForm({ ...form, logoUrl: e.target.value })}
            disabled={!manageSettings}
            placeholder="https://…"
            className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
          />
        </label>

        <label className="block">
          <span className="text-sm font-medium text-gray-700">Receipt footer lines</span>
          <textarea
            rows={5}
            value={form.footerLines}
            onChange={(e) => setForm({ ...form, footerLines: e.target.value })}
            disabled={!manageSettings}
            placeholder="One line per row"
            className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
          />
        </label>

        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={form.showPoweredBy}
            onChange={(e) => setForm({ ...form, showPoweredBy: e.target.checked })}
            disabled={!manageSettings}
          />
          <span className="text-sm text-gray-700">Show &quot;Powered by NUMZPAY&quot; on receipts</span>
        </label>

        {error && (
          <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-3">{error}</div>
        )}
        {success && (
          <div className="text-sm text-green-700 bg-green-50 border border-green-200 rounded p-3">
            Settings saved.
          </div>
        )}

        {manageSettings && (
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save settings'}
          </button>
        )}
      </form>
    </div>
  );
}
