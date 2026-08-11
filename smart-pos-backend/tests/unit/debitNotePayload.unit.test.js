import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const { buildSaveSalesPayload } = require('../../lib/vsdc-gateway/payloadBuilders/saveSales');

// dbtRsnCd/invcAdjustReason are only present on the OFFICIAL-spec payload —
// endpointAdapter.isOfficial() reads VSDC_MODE live, so mock mode (the test
// default) returns a truncated shape without these fields at all. Forcing
// official mode here tests what the ZRA sandbox actually receives.
describe('REGRESSION: buildSaveSalesPayload carries debit-note fields for rcptTyCd=D', () => {
  const vsdcCtx = { tpin: '1000000000', bhfId: '000' };
  let originalVsdcMode;

  beforeAll(() => {
    originalVsdcMode = process.env.VSDC_MODE;
    process.env.VSDC_MODE = 'official';
  });

  afterAll(() => {
    process.env.VSDC_MODE = originalVsdcMode;
  });

  const baseInvoiceData = {
    invoiceNumber: 42,
    originalInvoiceNumber: 41,
    receiptType: 'D',
    debitReasonCode: '02',
    remark: 'Under-billed by KES 500 — correcting invoice',
    paymentMethod: 'CASH',
    totalAmount: 116,
    items: [
      {
        itemCode: 'SKU-1',
        itemClassification: '1010101',
        itemName: 'Widget',
        quantity: 1,
        unitPrice: 100,
        supplyAmount: 100,
        taxType: 'A',
        taxableAmount: 100,
        taxAmount: 16,
        totalAmount: 116,
      },
    ],
  };

  it('sets rcptTyCd to D', () => {
    const payload = buildSaveSalesPayload(baseInvoiceData, vsdcCtx);
    expect(payload.rcptTyCd).toBe('D');
  });

  it('carries the debit reason code into dbtRsnCd, not the hardcoded empty string', () => {
    const payload = buildSaveSalesPayload(baseInvoiceData, vsdcCtx);
    expect(payload.dbtRsnCd).toBe('02');
  });

  it('carries the adjustment remark into invcAdjustReason, not the hardcoded empty string', () => {
    const payload = buildSaveSalesPayload(baseInvoiceData, vsdcCtx);
    expect(payload.invcAdjustReason).toBe('Under-billed by KES 500 — correcting invoice');
  });

  it('defaults dbtRsnCd to 01 when no debitReasonCode is supplied', () => {
    const { debitReasonCode, ...withoutReasonCode } = baseInvoiceData;
    const payload = buildSaveSalesPayload(withoutReasonCode, vsdcCtx);
    expect(payload.dbtRsnCd).toBe('01');
  });

  it('links the original invoice via orgInvcNo', () => {
    const payload = buildSaveSalesPayload(baseInvoiceData, vsdcCtx);
    expect(payload.orgInvcNo).toBe(41);
  });

  it('leaves dbtRsnCd/invcAdjustReason empty for an ordinary sale (rcptTyCd=S)', () => {
    const payload = buildSaveSalesPayload({ ...baseInvoiceData, receiptType: 'S' }, vsdcCtx);
    expect(payload.dbtRsnCd).toBe('');
    expect(payload.invcAdjustReason).toBe('');
  });
});
