import { describe, it, expect, vi, afterEach } from 'vitest';

const vsdcGateway = require('../../lib/vsdc-gateway/index.js');
const transport = require('../../lib/vsdc-gateway/transport.js');
const vsdcService = require('../../services/vsdcService.js');
const endpointAdapter = require('../../lib/vsdc-gateway/endpointAdapter.js');

const originalTpin = vsdcService.tpin;
const originalBhfId = vsdcService.bhfId;

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.VSDC_MODE;
  vsdcService.tpin = originalTpin;
  vsdcService.bhfId = originalBhfId;
});

describe('submitInvoiceData payload validation (must reject invalid payloads in every mode)', () => {
  it('REGRESSION: rejects an empty itemList in mock mode instead of silently posting it', async () => {
    delete process.env.VSDC_MODE;
    vi.spyOn(vsdcService, 'isDeviceReady').mockResolvedValue(true);
    const postSpy = vi
      .spyOn(transport, 'authenticatedPost')
      .mockResolvedValue({ success: true, data: { resultCd: '000' } });

    const result = await vsdcGateway.submitInvoiceData({ items: [], totalAmount: 0 });

    expect(result.success).toBe(false);
    expect(result.code).toBe('VALIDATION_ERROR');
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('still rejects an empty itemList in official mode', async () => {
    process.env.VSDC_MODE = 'official';
    vi.spyOn(vsdcService, 'isDeviceReady').mockResolvedValue(true);
    const postSpy = vi
      .spyOn(transport, 'authenticatedPost')
      .mockResolvedValue({ success: true, data: { resultCd: '000' } });

    const result = await vsdcGateway.submitInvoiceData({ items: [], totalAmount: 0 });

    expect(result.success).toBe(false);
    expect(result.code).toBe('VALIDATION_ERROR');
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('accepts a well-formed payload in mock mode and actually submits it', async () => {
    delete process.env.VSDC_MODE;
    vsdcService.tpin = 'TEST-TPIN';
    vsdcService.bhfId = '000';
    vi.spyOn(vsdcService, 'isDeviceReady').mockResolvedValue(true);
    const postSpy = vi.spyOn(transport, 'authenticatedPost').mockResolvedValue({
      success: true,
      data: { rcptNo: 'RCPT-1', qrCode: 'QR-1', rcptSign: 'SIGN-1', intrlData: 'INTRL-1' },
    });

    const result = await vsdcGateway.submitInvoiceData({
      items: [{ itemCode: 'SKU-1', itemName: 'Item', quantity: 1, unitPrice: 100, totalAmount: 116, taxAmount: 16 }],
      totalAmount: 116,
    });

    expect(result.success).toBe(true);
    expect(postSpy).toHaveBeenCalled();
  });

  it('REGRESSION: submitInvoiceData no longer posts to stock endpoints — double-submission removed 2026-08-12', async () => {
    // Prior to this fix, submitInvoiceData's postSaleStock() posted to
    // stockItems/stockMaster in parallel with services/stockSyncService.js's
    // syncAfterSale(), which fires separately from
    // lib/saleFiscal.js's completeSaleAfterFiscalSuccess() for the exact
    // same sale — two malformed, contradictory reports per sale. Confirmed
    // via full call-graph trace (services/zraInvoice.js:457 ->
    // lib/saleFiscal.js:488/351). stockSyncService is now the sole source
    // of stock reporting; this call must touch only the sales endpoint.
    delete process.env.VSDC_MODE;
    vsdcService.tpin = 'TEST-TPIN';
    vsdcService.bhfId = '000';
    vi.spyOn(vsdcService, 'isDeviceReady').mockResolvedValue(true);
    const postSpy = vi.spyOn(transport, 'authenticatedPost').mockResolvedValue({
      success: true,
      data: { rcptNo: 'RCPT-1', qrCode: 'QR-1', rcptSign: 'SIGN-1', intrlData: 'INTRL-1' },
    });

    const result = await vsdcGateway.submitInvoiceData({
      items: [{ itemCode: 'SKU-1', itemName: 'Item', quantity: 1, unitPrice: 100, totalAmount: 116, taxAmount: 16 }],
      totalAmount: 116,
    });

    expect(result.success).toBe(true);
    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(postSpy.mock.calls[0][0]).toBe(endpointAdapter.path('salesSave'));
    expect(result.stockSyncErrors).toBeUndefined();
  });
});
