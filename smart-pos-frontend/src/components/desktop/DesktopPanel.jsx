import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { getDesktopBridge } from '../../lib/desktop';

const PRINTER_MODES = [
  { value: 'NONE', label: 'Not configured (use the Windows print dialog)' },
  { value: 'SYSTEM', label: 'Windows printer (driver)' },
  { value: 'ESCPOS_NETWORK', label: 'Network receipt printer (ESC/POS)' },
];

function Row({ label, children }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5 text-sm">
      <span className="text-gray-500">{label}</span>
      <span className="text-gray-900 text-right break-all">{children}</span>
    </div>
  );
}

/**
 * Desktop-only settings: app/backend status, local printer configuration,
 * updates and diagnostics. Every control calls a real desktop-bridge function;
 * nothing here renders outside the Electron app.
 */
export default function DesktopPanel() {
  const bridge = getDesktopBridge();
  const [info, setInfo] = useState(null);
  const [diag, setDiag] = useState(null);
  const [printer, setPrinter] = useState(null);
  const [systemPrinters, setSystemPrinters] = useState([]);
  const [updates, setUpdates] = useState(null);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState(null);

  const notify = (text, ok = true) => setMessage({ text, ok });

  const refreshDiagnostics = useCallback(async () => {
    if (!bridge) return;
    setDiag(await bridge.diagnostics.get().catch(() => null));
  }, [bridge]);

  useEffect(() => {
    if (!bridge) return undefined;
    bridge.app.getInfo().then(setInfo).catch(() => {});
    bridge.printers.getConfig().then(setPrinter).catch(() => {});
    bridge.print.listPrinters().then((r) => setSystemPrinters(r.printers || [])).catch(() => {});
    bridge.updates.getStatus().then(setUpdates).catch(() => {});
    refreshDiagnostics();
    return bridge.updates.onStatus(setUpdates);
  }, [bridge, refreshDiagnostics]);

  if (!bridge) return null;

  async function run(key, fn, success) {
    setBusy(key);
    setMessage(null);
    try {
      const r = await fn();
      if (r && r.ok === false) notify(r.error || 'That did not work.', false);
      else if (success) notify(success);
      return r;
    } catch (e) {
      notify(e.message || 'That did not work.', false);
      return null;
    } finally {
      setBusy('');
    }
  }

  const savePrinter = () =>
    run('save', async () => {
      const r = await bridge.printers.setConfig(printer);
      if (r.ok) setPrinter(r.value);
      return r;
    }, 'Printer settings saved.');

  const backend = diag?.backend;
  const update = updates || { state: 'disabled' };

  return (
    <section className="mt-10 border-t border-gray-200 pt-6" aria-labelledby="desktop-heading">
      <h2 id="desktop-heading" className="text-lg font-semibold text-gray-900 mb-1">
        This computer (desktop app)
      </h2>
      <p className="text-sm text-gray-500 mb-4">
        Settings stored on this computer only. They do not change anything on the server.
      </p>

      {message && (
        <p role="status" className={`mb-4 text-sm ${message.ok ? 'text-green-700' : 'text-red-700'}`}>
          {message.text}
        </p>
      )}

      <div className="panel mb-4">
        <div className="panel-header text-sm font-medium">Application</div>
        <div className="panel-body">
          <Row label="Version">{info ? info.version : '…'}</Row>
          <Row label="Platform">{info ? `${info.platform} ${info.arch}` : '…'}</Row>
          <Row label="Server">{backend?.origin || 'Not configured'}</Row>
          <Row label="Connection">
            {!backend
              ? '…'
              : !backend.configured
                ? 'No server set'
                : backend.reachable
                  ? `Connected (${backend.latencyMs} ms)`
                  : 'Cannot reach the server'}
          </Row>
          <Row label="Secure token storage">
            {diag ? (diag.secureStorageAvailable ? 'Available' : 'Not available: you will sign in each launch') : '…'}
          </Row>
          <div className="flex gap-2 mt-3">
            <button type="button" className="btn-secondary" onClick={() => bridge.app.openSetup()}>
              Change server
            </button>
            <button type="button" className="btn-secondary" onClick={refreshDiagnostics}>
              Re-check connection
            </button>
          </div>
        </div>
      </div>

      <div className="panel mb-4">
        <div className="panel-header text-sm font-medium">Receipt printer and cash drawer</div>
        <div className="panel-body space-y-3">
          {!printer ? (
            <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
          ) : (
            <>
              <div>
                <label className="label-sys" htmlFor="dp-mode">Printer type</label>
                <select
                  id="dp-mode"
                  className="input-sys"
                  value={printer.mode}
                  onChange={(e) => setPrinter({ ...printer, mode: e.target.value })}
                >
                  {PRINTER_MODES.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              </div>

              {printer.mode === 'SYSTEM' && (
                <div>
                  <label className="label-sys" htmlFor="dp-sys">Windows printer</label>
                  <select
                    id="dp-sys"
                    className="input-sys"
                    value={printer.systemPrinterName}
                    onChange={(e) => setPrinter({ ...printer, systemPrinterName: e.target.value })}
                  >
                    <option value="">Ask each time (print dialog)</option>
                    {systemPrinters.map((p) => (
                      <option key={p.name} value={p.name}>
                        {p.displayName}{p.isDefault ? ' (default)' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {printer.mode === 'ESCPOS_NETWORK' && (
                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-2">
                    <label className="label-sys" htmlFor="dp-host">Printer address</label>
                    <input
                      id="dp-host"
                      className="input-sys"
                      placeholder="192.168.1.50"
                      value={printer.host}
                      onChange={(e) => setPrinter({ ...printer, host: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="label-sys" htmlFor="dp-port">Port</label>
                    <input
                      id="dp-port"
                      className="input-sys"
                      inputMode="numeric"
                      value={printer.port}
                      onChange={(e) => setPrinter({ ...printer, port: e.target.value })}
                    />
                  </div>
                </div>
              )}

              <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={printer.openDrawerOnCash}
                  disabled={printer.mode !== 'ESCPOS_NETWORK'}
                  onChange={(e) => setPrinter({ ...printer, openDrawerOnCash: e.target.checked })}
                />
                Open the cash drawer for cash sales (drawer connected to the receipt printer)
              </label>
              {printer.mode !== 'ESCPOS_NETWORK' && (
                <p className="text-xs text-gray-500">
                  Cash drawer control needs a network ESC/POS printer. Windows printer drivers cannot send the drawer command.
                </p>
              )}

              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn-primary" disabled={busy === 'save'} onClick={savePrinter}>
                  {busy === 'save' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Save
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={busy === 'test'}
                  onClick={() => run('test', () => bridge.print.test(), 'Test page sent to the printer.')}
                >
                  Print test page
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={busy === 'drawer'}
                  onClick={() => run('drawer', () => bridge.print.openDrawer(), 'Drawer command sent.')}
                >
                  Open drawer
                </button>
              </div>
              <p className="text-xs text-gray-500">
                Save first, then test. Buttons act on the saved settings.
              </p>
            </>
          )}
        </div>
      </div>

      <div className="panel mb-4">
        <div className="panel-header text-sm font-medium">Updates</div>
        <div className="panel-body">
          <Row label="Status">
            {update.state === 'disabled' && (update.reason || 'Not configured')}
            {update.state === 'idle' && (update.upToDate ? 'Up to date' : 'Ready to check')}
            {update.state === 'checking' && 'Checking…'}
            {update.state === 'available' && `Version ${update.version} is available`}
            {update.state === 'downloading' && `Downloading… ${update.percent}%`}
            {update.state === 'downloaded' && `Version ${update.version} is ready to install`}
            {update.state === 'error' && `Error: ${update.message}`}
          </Row>
          <div className="flex gap-2 mt-3">
            <button
              type="button"
              className="btn-secondary"
              disabled={update.state === 'disabled' || update.state === 'checking' || update.state === 'downloading'}
              onClick={() => run('check', () => bridge.updates.check())}
            >
              Check for updates
            </button>
            {update.state === 'available' && (
              <button type="button" className="btn-primary" onClick={() => run('dl', () => bridge.updates.download())}>
                Download
              </button>
            )}
            {update.state === 'downloaded' && (
              <button type="button" className="btn-primary" onClick={() => run('inst', () => bridge.updates.install())}>
                Restart and install
              </button>
            )}
          </div>
          {update.state === 'downloaded' && (
            <p className="text-xs text-gray-500 mt-2">
              Finish or park any open sale first: the app restarts to install.
            </p>
          )}
        </div>
      </div>

      {diag && (
        <details className="text-xs text-gray-600">
          <summary className="cursor-pointer">Diagnostic information (for support)</summary>
          <pre className="mt-2 p-3 bg-gray-50 border border-gray-200 rounded overflow-auto">
            {JSON.stringify(diag, null, 2)}
          </pre>
        </details>
      )}
    </section>
  );
}
