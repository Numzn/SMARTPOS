import { describe, it, expect } from 'vitest';
import loaders from '../../lib/receipt/loaders.js';

const { buildSaleReceiptSource } = loaders;

function fakeSale(overrides = {}) {
  return {
    id: 'sale-1',
    branch: { name: 'Main', address: '1 Main St', phone: null },
    branchId: 'main',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    user: { name: 'Cashier One' },
    rcptNo: 'RCPT-1',
    fiscalInvcNo: 1,
    saleItems: [{ product: { name: 'Widget' }, quantity: 1, price: 100, total: 100, taxblAmt: 100, taxAmt: 16 }],
    subtotal: 100,
    tax: 16,
    discount: 0,
    total: 116,
    paymentMethod: 'CASH',
    amountPaid: 116,
    changeAmount: 0,
    status: 'COMPLETED',
    vsdcTimestamp: new Date('2026-01-01T00:00:01Z'),
    vsdcResponse: null,
    rcptSign: 'SIGN-1',
    intrlData: 'INTRL-1',
    qrCode: 'https://verify.example/RCPT-1',
    customerName: null,
    customerTpin: null,
    customer: null,
    ...overrides,
  };
}

function fakeBusiness(overrides = {}) {
  return {
    logoUrl: null,
    tradingName: 'Test Store',
    tpin: '1000000000',
    footerLines: [],
    showPoweredBy: true,
    receiptVersion: '1.0',
    zraEnabled: false,
    ...overrides,
  };
}

// The one piece of new logic in loaders.js for the ZRA receipt toggle:
// BusinessProfile.zraEnabled must reach ReceiptSourceData.fiscal.enabled
// verbatim, for every source type this file builds.
describe('lib/receipt/loaders — zraEnabled threading', () => {
  it('threads business.zraEnabled = false into fiscal.enabled', async () => {
    const source = await buildSaleReceiptSource(fakeSale(), fakeBusiness({ zraEnabled: false }));
    expect(source.fiscal.enabled).toBe(false);
  });

  it('threads business.zraEnabled = true into fiscal.enabled', async () => {
    const source = await buildSaleReceiptSource(fakeSale(), fakeBusiness({ zraEnabled: true }));
    expect(source.fiscal.enabled).toBe(true);
  });

  it('coerces a non-boolean stored value rather than passing it through raw', async () => {
    const source = await buildSaleReceiptSource(fakeSale(), fakeBusiness({ zraEnabled: undefined }));
    expect(source.fiscal.enabled).toBe(false);
  });
});
