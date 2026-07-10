import { fetchPrinterStatus, printReceiptEscPos } from '../api/printersApi';

/**
 * Route receipt print to ESC/POS network printer or browser print.
 * @returns {'escpos'|'browser'}
 */
export async function routeReceiptPrint(viewModel) {
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
