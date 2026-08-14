import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildSaveSalesPayload } from '../../lib/vsdc-gateway/payloadBuilders/saveSales.js';
import { validateSaveSalesPayload } from '../../lib/vsdc-gateway/validators/saveSales.js';

const VSDC_CTX = { tpin: '1000000000', bhfId: '000' };

// buildSaveSalesPayload returns a fuller shape when endpointAdapter.isOfficial()
// is true vs an abbreviated one in mock mode (the default, and what the live
// mock-vsdc container actually receives) — both shapes carry dcRt/dcAmt/
// cashDcRt/cashDcAmt so the reconciliation in validateSaveSalesPayload holds
// in either mode. See lib/vsdc-gateway/payloadBuilders/saveSales.js.
let originalVsdcMode;
beforeAll(() => {
  originalVsdcMode = process.env.VSDC_MODE;
  process.env.VSDC_MODE = 'official';
});
afterAll(() => {
  if (originalVsdcMode === undefined) delete process.env.VSDC_MODE;
  else process.env.VSDC_MODE = originalVsdcMode;
});

function baseInvoiceData(overrides = {}) {
  return {
    invoiceNumber: 1,
    receiptType: 'S',
    paymentMethod: 'CASH',
    items: [],
    totalAmount: 0,
    ...overrides,
  };
}

// ZRA item-level discount (dcRt/dcAmt) and order-level cash discount
// (cashDcRt/cashDcAmt) are two separate mechanisms — see the spec's own
// worked example (splyAmt 125, dcRt 20, dcAmt 25 -> item totAmt 100; header
// cashDcRt 25, cashDcAmt 50 on a 200 item-sum -> header totAmt 150).
describe('buildSaveSalesPayload — discount fields', () => {
  it('no discount: dcRt/dcAmt/cashDcRt/cashDcAmt are all 0 (unchanged prior behavior)', () => {
    const invoiceData = baseInvoiceData({
      items: [
        {
          itemCode: 'SKU1',
          itemClassification: '50101500',
          itemName: 'Item',
          unitPrice: 12,
          supplyAmount: 12,
          discountRate: 0,
          discountAmount: 0,
          taxableAmount: 12,
          taxAmount: 1.92,
          totalAmount: 13.92,
        },
      ],
      totalAmount: 13.92,
      cashDiscountRate: 0,
      cashDiscountAmount: 0,
    });

    const payload = buildSaveSalesPayload(invoiceData, VSDC_CTX);

    expect(payload.itemList[0].dcRt).toBe(0);
    expect(payload.itemList[0].dcAmt).toBe(0);
    expect(payload.cashDcRt).toBe(0);
    expect(payload.cashDcAmt).toBe(0);

    const result = validateSaveSalesPayload(payload);
    expect(result.isValid).toBe(true);
  });

  it('item-level discount: dcRt/dcAmt populated on the item, cashDcAmt stays 0', () => {
    // Mirrors the ZRA spec's own worked example numbers.
    const invoiceData = baseInvoiceData({
      items: [
        {
          itemCode: 'BREAD',
          itemClassification: '50101500',
          itemName: 'Bread',
          unitPrice: 125,
          supplyAmount: 125,
          discountRate: 20,
          discountAmount: 25,
          taxableAmount: 86.2069,
          taxAmount: 13.7931,
          totalAmount: 100,
        },
      ],
      totalAmount: 100,
      cashDiscountRate: 0,
      cashDiscountAmount: 0,
    });

    const payload = buildSaveSalesPayload(invoiceData, VSDC_CTX);

    expect(payload.itemList[0].dcRt).toBe(20);
    expect(payload.itemList[0].dcAmt).toBe(25);
    expect(payload.itemList[0].splyAmt).toBe(125);
    expect(payload.itemList[0].totAmt).toBe(100);
    expect(payload.cashDcAmt).toBe(0); // no order-level discount here

    const result = validateSaveSalesPayload(payload);
    expect(result.isValid).toBe(true);
  });

  it('order-level discount: cashDcRt/cashDcAmt populated at header level, NOT duplicated into item dcAmt', () => {
    const invoiceData = baseInvoiceData({
      items: [
        {
          itemCode: 'SKU1',
          itemClassification: '50101500',
          itemName: 'Item',
          unitPrice: 12,
          supplyAmount: 12,
          discountRate: 0,
          discountAmount: 0, // item itself carries no discount
          taxableAmount: 12,
          taxAmount: 1.92,
          totalAmount: 13.92,
        },
      ],
      totalAmount: 6.96, // post order-level-discount header total
      cashDiscountRate: 50,
      cashDiscountAmount: 6.96,
    });

    const payload = buildSaveSalesPayload(invoiceData, VSDC_CTX);

    expect(payload.itemList[0].dcRt).toBe(0);
    expect(payload.itemList[0].dcAmt).toBe(0); // order discount stays out of the item
    expect(payload.cashDcRt).toBe(50);
    expect(payload.cashDcAmt).toBe(6.96);
    expect(payload.totAmt).toBe(6.96);

    const result = validateSaveSalesPayload(payload);
    expect(result.isValid).toBe(true);
  });

  it('50% order discount reconciles and passes validation (the exact scenario that used to fail)', () => {
    // Same numbers as the live Numzlab failure this phase fixes: Coca-Cola
    // 500ml, qty 1, price 12.00, 50% cart discount -> item totAmt 13.92,
    // header totAmt 6.96, cashDcAmt 6.96.
    const invoiceData = baseInvoiceData({
      items: [
        {
          itemCode: 'COKE500',
          itemClassification: '50101500',
          itemName: 'Coca-Cola 500ml',
          unitPrice: 12,
          supplyAmount: 12,
          discountRate: 0,
          discountAmount: 0,
          taxableAmount: 12,
          taxAmount: 1.92,
          totalAmount: 13.92,
        },
      ],
      totalAmount: 6.96,
      cashDiscountRate: (6.96 / 13.92) * 100,
      cashDiscountAmount: 6.96,
    });

    const payload = buildSaveSalesPayload(invoiceData, VSDC_CTX);
    const result = validateSaveSalesPayload(payload);

    expect(result.isValid).toBe(true);
    expect(result.errors).toEqual([]);
  });
});

// Regression coverage for a live-verification finding: the mock-mode payload
// branch (VSDC_MODE unset/mock, the default — what the live mock-vsdc
// container actually receives) originally omitted cashDcRt/cashDcAmt/dcRt/
// dcAmt entirely, so any real order-level discount checkout failed
// validation with a false "does not reconcile" error and went FISCAL_FAILED.
describe('buildSaveSalesPayload — discount fields (mock mode, VSDC_MODE unset)', () => {
  let originalMockVsdcMode;
  beforeAll(() => {
    originalMockVsdcMode = process.env.VSDC_MODE;
    delete process.env.VSDC_MODE;
  });
  afterAll(() => {
    if (originalMockVsdcMode !== undefined) process.env.VSDC_MODE = originalMockVsdcMode;
  });

  it('order-level discount reconciles in mock mode too (the exact live failure this regression-tests)', () => {
    const invoiceData = baseInvoiceData({
      items: [
        {
          itemCode: 'COKE500',
          itemClassification: '50101500',
          itemName: 'Coca-Cola 500ml',
          unitPrice: 12,
          supplyAmount: 12,
          discountRate: 0,
          discountAmount: 0,
          taxableAmount: 12,
          taxAmount: 1.92,
          totalAmount: 13.92,
        },
      ],
      totalAmount: 6.96,
      cashDiscountRate: (6.96 / 13.92) * 100,
      cashDiscountAmount: 6.96,
    });

    const payload = buildSaveSalesPayload(invoiceData, VSDC_CTX);

    expect(payload.cashDcAmt).toBe(6.96);
    expect(payload.itemList[0].dcRt).toBe(0);
    expect(payload.itemList[0].dcAmt).toBe(0);

    const result = validateSaveSalesPayload(payload);
    expect(result.isValid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('item-level discount is carried through in mock mode', () => {
    const invoiceData = baseInvoiceData({
      items: [
        {
          itemCode: 'BREAD',
          itemClassification: '50101500',
          itemName: 'Bread',
          unitPrice: 125,
          supplyAmount: 125,
          discountRate: 20,
          discountAmount: 25,
          taxableAmount: 86.2069,
          taxAmount: 13.7931,
          totalAmount: 100,
        },
      ],
      totalAmount: 100,
      cashDiscountRate: 0,
      cashDiscountAmount: 0,
    });

    const payload = buildSaveSalesPayload(invoiceData, VSDC_CTX);

    expect(payload.itemList[0].dcRt).toBe(20);
    expect(payload.itemList[0].dcAmt).toBe(25);

    const result = validateSaveSalesPayload(payload);
    expect(result.isValid).toBe(true);
  });

  it('no discount: cashDcAmt is 0 and validation still passes (regression)', () => {
    const invoiceData = baseInvoiceData({
      items: [
        {
          itemCode: 'SKU1',
          itemClassification: '50101500',
          itemName: 'Item',
          unitPrice: 12,
          supplyAmount: 12,
          discountRate: 0,
          discountAmount: 0,
          taxableAmount: 12,
          taxAmount: 1.92,
          totalAmount: 13.92,
        },
      ],
      totalAmount: 13.92,
      cashDiscountRate: 0,
      cashDiscountAmount: 0,
    });

    const payload = buildSaveSalesPayload(invoiceData, VSDC_CTX);
    expect(payload.cashDcAmt).toBe(0);

    const result = validateSaveSalesPayload(payload);
    expect(result.isValid).toBe(true);
  });
});

describe('validateSaveSalesPayload — discount edge cases', () => {
  function payloadWith({ itemTotal = 100, cashDcAmt = 0, totAmt }) {
    return {
      tpin: '1000000000',
      bhfId: '000',
      itemList: [{ totAmt: itemTotal }],
      cashDcAmt,
      totAmt: totAmt ?? itemTotal - cashDcAmt,
    };
  }

  it('rejects a negative cashDcAmt', () => {
    const result = validateSaveSalesPayload(payloadWith({ itemTotal: 100, cashDcAmt: -5, totAmt: 105 }));
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.includes('cashDcAmt'))).toBe(true);
  });

  it('rejects a cashDcAmt larger than the item total', () => {
    const result = validateSaveSalesPayload(payloadWith({ itemTotal: 100, cashDcAmt: 150, totAmt: -50 }));
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.includes('exceeds the item total'))).toBe(true);
  });

  it('rejects a header totAmt that does not reconcile even accounting for cashDcAmt', () => {
    const result = validateSaveSalesPayload(payloadWith({ itemTotal: 100, cashDcAmt: 20, totAmt: 90 })); // should be 80
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.includes('does not reconcile'))).toBe(true);
  });

  it('accepts a correctly reconciled header total with cashDcAmt present', () => {
    const result = validateSaveSalesPayload(payloadWith({ itemTotal: 100, cashDcAmt: 20, totAmt: 80 }));
    expect(result.isValid).toBe(true);
  });

  it('0% discount (cashDcAmt=0) still validates via the original identity', () => {
    const result = validateSaveSalesPayload(payloadWith({ itemTotal: 100, cashDcAmt: 0, totAmt: 100 }));
    expect(result.isValid).toBe(true);
  });

  it('still rejects a plain item-sum mismatch when there is no discount at all (regression)', () => {
    const result = validateSaveSalesPayload(payloadWith({ itemTotal: 100, cashDcAmt: 0, totAmt: 90 }));
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.includes('does not reconcile'))).toBe(true);
  });
});
