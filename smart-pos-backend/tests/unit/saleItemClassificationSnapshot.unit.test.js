import { describe, it, expect } from 'vitest';

const zraInvoiceService = require('../../services/zraInvoice.js');

function saleFixture(saleItemOverrides = {}) {
  return {
    id: 'sale-1',
    customerName: null,
    customerTpin: null,
    fiscalInvcNo: 42,
    total: 116,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    userId: 'user-1',
    user: { name: 'Cashier One' },
    paymentMethod: 'CASH',
    saleItems: [
      {
        pkg: 1,
        qty: 1,
        prc: 100,
        splyAmt: 100,
        taxblAmt: 100,
        taxAmt: 16,
        totAmt: 116,
        itemClsCd: '50101500',
        taxType: 'A',
        ...saleItemOverrides,
        product: {
          id: 'prod-1',
          sku: 'SKU-1',
          name: 'Widget',
          barcode: null,
          unit: 'EA',
          // Product has since been re-classified/re-taxed after the sale —
          // the built invoice must NOT pick these up for an already-sold line.
          zraItemClassification: '99999999',
          zraClassificationCode: '99999999',
          taxType: 'C',
        },
      },
    ],
  };
}

describe('REGRESSION: SaleItem classification/tax-type snapshot is not overridden by a later Product edit', () => {
  it('uses the SaleItem.itemClsCd snapshot, not the live Product classification', () => {
    const invoice = zraInvoiceService.buildInvoiceDataFromSale(saleFixture());
    expect(invoice.items[0].itemClassification).toBe('50101500');
  });

  it('uses the SaleItem.taxType snapshot, not the live Product taxType', () => {
    const invoice = zraInvoiceService.buildInvoiceDataFromSale(saleFixture());
    expect(invoice.items[0].taxType).toBe('A');
  });

  it('falls back to the live Product read for older rows with no snapshot stored', () => {
    const invoice = zraInvoiceService.buildInvoiceDataFromSale(
      saleFixture({ itemClsCd: null, taxType: null })
    );
    expect(invoice.items[0].itemClassification).toBe('99999999');
    expect(invoice.items[0].taxType).toBe('C');
  });
});
