import { describe, it, expect, vi, afterEach } from 'vitest';

const vsdcGateway = require('../../lib/vsdc-gateway/index.js');
const transport = require('../../lib/vsdc-gateway/transport.js');
const vsdcService = require('../../services/vsdcService.js');

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
});
