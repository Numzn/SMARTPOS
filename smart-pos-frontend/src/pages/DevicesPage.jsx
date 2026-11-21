import { useCallback, useEffect, useState } from 'react';
import {
  Cpu,
  Loader2,
  Plus,
  Printer,
  ScanLine,
  Archive,
  MonitorSmartphone,
  CreditCard,
  Trash2,
  Zap,
} from 'lucide-react';
import {
  createPrinter,
  deletePrinter,
  fetchPrinters,
  fetchPrinterStatus,
  testPrinter,
  updatePrinter,
} from '../api/printersApi';
import { usePermissions } from '../hooks/usePermissions';
import DesktopPanel from '../components/desktop/DesktopPanel';

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

const PILL_TONE = {
  good: 'bg-green-50 text-green-700 border-green-200',
  neutral: 'bg-gray-50 text-gray-600 border-gray-200',
  bad: 'bg-red-50 text-red-700 border-red-200',
};

function StatusPill({ tone, children }) {
  return (
    <span
      className={`inline-flex items-center text-[11px] font-medium uppercase tracking-wide px-2 py-0.5 rounded-full border ${PILL_TONE[tone]}`}
    >
      {children}
    </span>
  );
}

function DeviceCard({ icon: Icon, title, tone, status, description }) {
  return (
    <div className="border border-gray-200 rounded-lg p-4 bg-white flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Icon className="w-4 h-4 text-gray-500" />
          <span className="font-medium text-gray-900 text-sm">{title}</span>
        </div>
        <StatusPill tone={tone}>{status}</StatusPill>
      </div>
      <p className="text-xs text-gray-500">{description}</p>
    </div>
  );
}

/**
 * Devices — a status overview across every hardware role in the hot path
 * (scanner/printer/drawer/display/terminal), plus receipt-printer profile
 * management (unchanged from the old Printers page).
 *
 * Deliberately honest about what each card can and can't know:
 * - Printer has a real configured profile and a live status endpoint, so it
 *   gets a real Connected/Error/None pill.
 * - Scanner is HID keyboard-wedge — ambient, per-till, and has no positive
 *   "connected" signal a settings page could observe (it's just a keyboard
 *   to the OS). It gets a capability description, not a fabricated status.
 * - Cash drawer and customer display don't exist yet (H2/H3) — shown as
 *   not-yet-integrated rather than hidden, so this page stays the one place
 *   that tells the truth about hardware readiness.
 * - Payment terminal is today's honor-system manual entry, which is a
 *   legitimate v1 for a standalone terminal next to the till, not a gap.
 */
export default function DevicesPage() {
  const { canAccess } = usePermissions();
  const { manageSettings } = canAccess;
  const [loading, setLoading] = useState(true);
  const [printers, setPrinters] = useState([]);
  const [printerStatus, setPrinterStatus] = useState(null);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [list, status] = await Promise.all([
        fetchPrinters(),
        fetchPrinterStatus().catch(() => null),
      ]);
      setPrinters(Array.isArray(list) ? list : []);
      setPrinterStatus(status);
    } catch (e) {
      setError(e.message || 'Failed to load devices');
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

  const printerTone =
    printerStatus?.status === 'ready' ? 'good' : printerStatus?.status === 'error' ? 'bad' : 'neutral';
  const printerLabel =
    printerStatus?.status === 'ready'
      ? 'Connected'
      : printerStatus?.status === 'error'
        ? 'Error'
        : printerStatus?.status === 'none'
          ? 'Not configured'
          : 'Unknown';

  return (
    <div className="p-6 max-w-4xl">
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Devices</h1>
      <p className="text-sm text-gray-500 mb-6">
        Hardware status across the till — what&apos;s connected, what&apos;s manual, and what
        hasn&apos;t been built yet.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-8">
        <DeviceCard
          icon={ScanLine}
          title="Barcode scanner"
          tone="good"
          status="Active"
          description="HID keyboard-wedge — works on any till automatically, no per-device setup. Wedge mode can't report a live connected/disconnected signal; it's just a keyboard to the OS."
        />
        <DeviceCard
          icon={Printer}
          title="Receipt printer"
          tone={printerTone}
          status={printerLabel}
          description={
            printerStatus?.printer
              ? `${printerStatus.printer.name} — ${printerStatus.printer.type === 'ESCPOS_NETWORK' ? `ESC/POS ${printerStatus.printer.host}:${printerStatus.printer.port || 9100}` : 'browser print'}`
              : 'No default printer configured yet — add one below.'
          }
        />
        <DeviceCard
          icon={Archive}
          title="Cash drawer"
          tone="neutral"
          status="Not integrated"
          description="Planned to open via the receipt printer's kick command — not wired up yet."
        />
        <DeviceCard
          icon={MonitorSmartphone}
          title="Customer display"
          tone="neutral"
          status="Not configured"
          description="No 2×20 LED/VFD or second-screen display driver exists yet."
        />
        <DeviceCard
          icon={CreditCard}
          title="Payment terminal"
          tone="neutral"
          status="Manual"
          description="Cashier records the reference from a standalone card/mobile-money terminal — no live integration exists."
        />
      </div>

      <div className="flex items-center gap-2 mb-3">
        <Cpu className="w-4 h-4 text-gray-500" />
        <h2 className="text-sm font-semibold text-gray-800">Receipt printers</h2>
      </div>
      <p className="text-sm text-gray-500 mb-4">
        Configure browser or ESC/POS network printers. Checkout and sales reprints use the default
        profile.
      </p>

      {!manageSettings && (
        <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded p-3 mb-4">
          Read-only access. Contact an administrator to manage devices.
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

      <DesktopPanel />
    </div>
  );
}
