import { describe, it, expect } from 'vitest';

const { buildSavePurchasePayload, DEFAULT_PMT_TY_CD } = require('../../lib/vsdc-gateway/payloadBuilders/savePurchase');

const CTX = { tpin: '1000000000', bhfId: '000' };

function grnFixture(overrides = {}) {
  return {
    grnNumber: 'TEST-GRN-1',
    receivedDate: new Date('2026-08-01T10:00:00Z'),
    supplier: { name: 'Test Supplier', tpin: '2000000000' },
    items: [
      {
        quantityReceived: 2,
        unitCost: 10,
        product: {
          sku: 'COKE500',
          name: 'Coca-Cola 500ml',
          barcode: '600130800002',
          zraClassificationCode: 'BVRG001',
          zraPackageUnit: 'EA',
          zraQuantityUnit: 'EA',
          taxType: 'A',
        },
      },
    ],
    ...overrides,
  };
}

describe('buildSavePurchasePayload', () => {
  it('always sets regTyCd to M (manual self-report), regardless of supplier tpin', () => {
    const withTpin = buildSavePurchasePayload(grnFixture(), CTX);
    const withoutTpin = buildSavePurchasePayload(
      grnFixture({ supplier: { name: 'No TPIN Supplier', tpin: null } }),
      CTX
    );
    expect(withTpin.regTyCd).toBe('M');
    expect(withoutTpin.regTyCd).toBe('M');
  });

  it('sets the fixed spec codes: pchsTyCd=N, rcptTyCd=P, pchsSttsCd=02', () => {
    const payload = buildSavePurchasePayload(grnFixture(), CTX);
    expect(payload.pchsTyCd).toBe('N');
    expect(payload.rcptTyCd).toBe('P');
    expect(payload.pchsSttsCd).toBe('02');
    expect(payload.pmtTyCd).toBe(DEFAULT_PMT_TY_CD);
  });

  it('uses grnNumber as cisInvcNo', () => {
    const payload = buildSavePurchasePayload(grnFixture(), CTX);
    expect(payload.cisInvcNo).toBe('TEST-GRN-1');
  });

  it('formats pchsDt as yyyyMMdd from receivedDate', () => {
    const payload = buildSavePurchasePayload(grnFixture(), CTX);
    expect(payload.pchsDt).toBe('20260801');
  });

  it('all tax/discount fields are honestly 0.0, not fabricated', () => {
    const payload = buildSavePurchasePayload(grnFixture(), CTX);
    const item = payload.itemList[0];
    expect(item.dcRt).toBe(0);
    expect(item.dcAmt).toBe(0);
    expect(item.taxblAmt).toBe(0);
    expect(item.iplTaxblAmt).toBe(0);
    expect(item.tlTaxblAmt).toBe(0);
    expect(item.exciseTaxblAmt).toBe(0);
    expect(item.taxAmt).toBe(0);
    expect(item.iplAmt).toBe(0);
    expect(item.tlAmt).toBe(0);
    expect(item.exciseTxAmt).toBe(0);
    expect(payload.totTaxblAmt).toBe(0);
    expect(payload.totTaxAmt).toBe(0);
  });

  it('itemSeq is sequential starting at 1', () => {
    const payload = buildSavePurchasePayload(
      grnFixture({
        items: [
          { quantityReceived: 1, unitCost: 5, product: { sku: 'A' } },
          { quantityReceived: 1, unitCost: 5, product: { sku: 'B' } },
        ],
      }),
      CTX
    );
    expect(payload.itemList[0].itemSeq).toBe(1);
    expect(payload.itemList[1].itemSeq).toBe(2);
  });

  it('qty/prc/splyAmt come from quantityReceived/unitCost, and totAmt sums line totals', () => {
    const payload = buildSavePurchasePayload(grnFixture(), CTX);
    const item = payload.itemList[0];
    expect(item.qty).toBe(2);
    expect(item.prc).toBe(10);
    expect(item.splyAmt).toBe(20);
    expect(item.totAmt).toBe(20);
    expect(payload.totAmt).toBe(20);
  });

  it('totItemCnt matches the number of item lines', () => {
    const payload = buildSavePurchasePayload(
      grnFixture({
        items: [
          { quantityReceived: 1, unitCost: 5, product: { sku: 'A' } },
          { quantityReceived: 1, unitCost: 5, product: { sku: 'B' } },
        ],
      }),
      CTX
    );
    expect(payload.totItemCnt).toBe(2);
  });

  it('a missing product.sku does not crash — itemCd is null, not fabricated', () => {
    const payload = buildSavePurchasePayload(
      grnFixture({ items: [{ quantityReceived: 1, unitCost: 5, product: {} }] }),
      CTX
    );
    expect(payload.itemList[0].itemCd).toBeNull();
  });

  it('a missing supplier.tpin does not crash — spplrTpin is null, not fabricated', () => {
    const payload = buildSavePurchasePayload(
      grnFixture({ supplier: { name: 'No TPIN', tpin: null } }),
      CTX
    );
    expect(payload.spplrTpin).toBeNull();
  });
});
