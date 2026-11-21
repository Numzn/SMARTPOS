import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../api/printersApi', () => ({
  fetchPrinterStatus: vi.fn(),
  printReceiptEscPos: vi.fn(),
}));

import { fetchPrinterStatus, printReceiptEscPos } from '../api/printersApi';
import { routeReceiptPrint } from './printReceipt';

const vm = { merchant: { tradingName: 'T' } };

beforeEach(() => {
  vi.clearAllMocks();
  window.print = vi.fn();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  delete window.numzDesktop;
  vi.restoreAllMocks();
});

describe('routeReceiptPrint in a browser (unchanged)', () => {
  it('uses the server ESC/POS printer when configured', async () => {
    fetchPrinterStatus.mockResolvedValue({ printer: { type: 'ESCPOS_NETWORK' } });
    printReceiptEscPos.mockResolvedValue({});
    expect(await routeReceiptPrint(vm)).toBe('escpos');
    expect(window.print).not.toHaveBeenCalled();
  });

  it('falls back to window.print when the printer lookup fails', async () => {
    fetchPrinterStatus.mockRejectedValue(new Error('offline'));
    expect(await routeReceiptPrint(vm)).toBe('browser');
    expect(window.print).toHaveBeenCalled();
  });
});

describe('routeReceiptPrint in the desktop app', () => {
  function bridge(print) {
    window.numzDesktop = { isDesktop: true, print };
  }

  it('prints through the local ESC/POS printer and never calls the server printer API', async () => {
    bridge({ receipt: vi.fn(async () => ({ ok: true, method: 'escpos' })), currentPage: vi.fn() });
    expect(await routeReceiptPrint(vm)).toBe('escpos');
    expect(fetchPrinterStatus).not.toHaveBeenCalled();
    expect(printReceiptEscPos).not.toHaveBeenCalled();
    expect(window.print).not.toHaveBeenCalled();
  });

  it('prints the on-screen receipt via the desktop when no ESC/POS printer is set', async () => {
    const currentPage = vi.fn(async () => ({ ok: true, method: 'system-silent' }));
    bridge({ receipt: vi.fn(async () => ({ ok: true, method: 'page' })), currentPage });
    expect(await routeReceiptPrint(vm)).toBe('desktop');
    expect(currentPage).toHaveBeenCalled();
    expect(window.print).not.toHaveBeenCalled();
  });

  it('falls back to window.print when the local printer fails, so a receipt is never lost', async () => {
    bridge({ receipt: vi.fn(async () => ({ ok: false, error: 'Printer error: ECONNREFUSED' })), currentPage: vi.fn() });
    expect(await routeReceiptPrint(vm)).toBe('browser');
    expect(window.print).toHaveBeenCalled();
  });

  it('falls back when the bridge itself throws', async () => {
    bridge({ receipt: vi.fn(async () => { throw new Error('ipc down'); }), currentPage: vi.fn() });
    expect(await routeReceiptPrint(vm)).toBe('browser');
    expect(window.print).toHaveBeenCalled();
  });
});
