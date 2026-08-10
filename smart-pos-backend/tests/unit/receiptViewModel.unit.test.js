import { describe, it, expect } from 'vitest';

const { buildReceiptViewModel } = require('@smartpos/receipt-engine');

function baseSource(overrides = {}) {
  return {
    receiptType: 'SALE',
    merchant: {
      tradingName: 'Test Store',
      tpin: '1000000000',
      branchName: 'main',
      address: '1 Main St',
    },
    transaction: {
      occurredAt: new Date('2026-01-01T00:00:00Z'),
      cashier: 'Cashier One',
      receiptNo: 'RCPT-1',
      fiscalInvoiceNo: 1,
      itemCount: 1,
    },
    items: [{ name: 'Widget', qty: 1, unitPrice: 100, lineTotal: 100 }],
    totals: {
      subtotal: 100,
      vat: 0,
      discount: 0,
      total: 100,
    },
    payment: { method: 'CASH' },
    fiscal: { submissionStatus: 'SUBMITTED' },
    ...overrides,
  };
}

describe('REGRESSION: VAT rate is derived from real data, never hardcoded to 16%', () => {
  it('reports 0% for a zero-rated/exempt sale instead of defaulting to 16%', () => {
    const vm = buildReceiptViewModel(baseSource());
    expect(vm.totals.vatLabel).toBe('VAT (0%)');
    expect(vm.totals.vatBreakdown).toEqual([{ rate: 0, taxable: 100, vat: 0, label: 'VAT (0%)' }]);
  });

  it('derives the blended rate from vat/subtotal when no explicit breakdown is supplied', () => {
    const vm = buildReceiptViewModel(
      baseSource({ totals: { subtotal: 100, vat: 16, discount: 0, total: 116 } })
    );
    expect(vm.totals.vatLabel).toBe('VAT (16%)');
  });

  it('renders a per-rate breakdown for a mixed-rate basket instead of one blended line', () => {
    const vm = buildReceiptViewModel(
      baseSource({
        totals: {
          subtotal: 200,
          vat: 16,
          discount: 0,
          total: 216,
          vatBreakdown: [
            { rate: 16, taxable: 100, vat: 16 },
            { rate: 0, taxable: 100, vat: 0 },
          ],
        },
      })
    );
    expect(vm.totals.vatLabel).toBe('VAT');
    expect(vm.totals.vatBreakdown).toEqual([
      { rate: 16, taxable: 100, vat: 16, label: 'VAT (16%)' },
      { rate: 0, taxable: 100, vat: 0, label: 'VAT (0%)' },
    ]);
  });
});

describe('REGRESSION: discount rate is surfaced alongside the discount amount', () => {
  it('computes and labels the discount rate from discount/subtotal', () => {
    const vm = buildReceiptViewModel(
      baseSource({ totals: { subtotal: 100, vat: 0, discount: 10, total: 90 } })
    );
    expect(vm.totals.discountRate).toBe(10);
    expect(vm.totals.discountLabel).toBe('Discount (10%)');
  });

  it('falls back to a plain "Discount" label when there is no discount', () => {
    const vm = buildReceiptViewModel(baseSource());
    expect(vm.totals.discountRate).toBe(0);
    expect(vm.totals.discountLabel).toBe('Discount');
  });
});

describe('REGRESSION: customer address is surfaced on the view model', () => {
  it('passes through a supplied customer address', () => {
    const vm = buildReceiptViewModel(
      baseSource({ customer: { name: 'Acme Ltd', tpin: '2000000000', address: '5 Industrial Rd' } })
    );
    expect(vm.customer.address).toBe('5 Industrial Rd');
  });

  it('is null when no customer address is available', () => {
    const vm = buildReceiptViewModel(baseSource());
    expect(vm.customer.address).toBeNull();
  });
});
