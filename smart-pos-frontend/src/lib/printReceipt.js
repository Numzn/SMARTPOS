import { fetchPrinterStatus, printReceiptEscPos } from '../api/printersApi';
import { getDesktopBridge } from './desktop';

// Let React flush the receipt DOM before a page print captures it.
function nextPaint() {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    } else {
      setTimeout(resolve, 50);
    }
  });
}

/**
 * Desktop app: print from the till PC itself (its configured LAN ESC/POS
 * printer, or a Windows printer driver). The server cannot reach a printer on
 * the shop network, so this path never touches /settings/printers/receipt.
 * Returns null when the desktop could not print, so the caller can fall back.
 */
async function routeDesktopPrint(bridge, viewModel) {
  try {
    const r = await bridge.print.receipt(viewModel);
    if (r && r.ok && r.method === 'escpos') return 'escpos';
    if (r && r.ok && r.method === 'page') {
      await nextPaint();
      const p = await bridge.print.currentPage();
      if (p && p.ok) return 'desktop';
      console.warn('Desktop page print failed:', p && p.error);
      return null;
    }
    console.warn('Desktop receipt print failed:', r && r.error);
  } catch (e) {
    console.warn('Desktop print unavailable:', e.message);
  }
  return null;
}

/**
 * Route receipt print to ESC/POS network printer or browser print.
 * @returns {'escpos'|'desktop'|'browser'}
 */
export async function routeReceiptPrint(viewModel) {
  const bridge = getDesktopBridge();
  if (bridge) {
    const via = await routeDesktopPrint(bridge, viewModel);
    if (via) return via;
    // fall through to the same last-resort path the web app uses
    window.print();
    return 'browser';
  }

  try {
    const status = await fetchPrinterStatus();
    if (status?.printer?.type === 'ESCPOS_NETWORK') {
      await printReceiptEscPos(viewModel);
      return 'escpos';
    }
  } catch (e) {
    console.warn('ESC/POS print unavailable, falling back to browser:', e.message);
  }
  window.print();
  return 'browser';
}

export function mapPrinterStatusLabel(status) {
  if (!status || status.status === 'none') return 'none';
  if (status.status === 'ready') return 'ready';
  if (status.status === 'error') return 'error';
  return 'unknown';
}
