import { buildReceiptViewModel } from './buildReceiptViewModel';
import type { ReceiptSourceData, ReceiptViewModel } from './types';

export interface SampleReceiptProfile {
  tradingName?: string;
  tpin?: string;
  logoUrl?: string | null;
  footerLines?: string[];
  showPoweredBy?: boolean;
  receiptVersion?: string;
}

/** Sample VM for settings preview and layout testing. */
export function buildSampleReceiptViewModel(
  profile: SampleReceiptProfile = {}
): ReceiptViewModel {
  const source: ReceiptSourceData = {
    receiptType: 'SALE',
    merchant: {
      brand: 'NUMZPAY',
      tradingName: profile.tradingName || 'NUMZPAY DEMO STORE',
      tpin: profile.tpin || '1000000000',
      logoUrl: profile.logoUrl ?? null,
      branchName: 'Main Branch',
      address: 'Lusaka, Zambia',
      phone: '+260 97 123 4567',
    },
    transaction: {
      occurredAt: new Date(),
      cashier: 'Preview Cashier',
      receiptNo: 'MOCK-RCPT-PREVIEW',
      fiscalInvoiceNo: 42,
      itemCount: 2,
    },
    items: [
      { name: 'Sample Product A', qty: 2, unitPrice: 25.0, lineTotal: 50.0 },
      { name: 'Sample Product B', qty: 1, unitPrice: 86.21, lineTotal: 86.21 },
    ],
    totals: {
      subtotal: 136.21,
      vat: 21.79,
      vatRate: 16,
      discount: 0,
      total: 158.0,
    },
    payment: {
      method: 'CASH',
      amountPaid: 200,
      change: 42,
    },
    fiscal: {
      mode: 'ONLINE',
      submissionStatus: 'SUBMITTED',
      submissionTime: new Date(),
      sdcId: 'MOCK-SDC-001',
      fiscalReceiptNo: 'MOCK-RCPT-PREVIEW',
      receiptSignature: 'AB12-CD34-EF56',
      internalData: 'INTRL-98GH-76KL',
      verificationCode: 'VERIFY-1234',
      qrPayload: 'https://verify.zra.org.zm/MOCK-RCPT-PREVIEW',
    },
    customer: { name: 'Walk-in Customer' },
    footer: {
      lines: profile.footerLines?.length
        ? profile.footerLines
        : ['Thank you for shopping!', 'Returns within 7 days.'],
      showPoweredBy: profile.showPoweredBy !== false,
      receiptVersion: profile.receiptVersion || '1.0',
    },
    receiptMeta: {
      isCopy: false,
      reprintCount: 0,
    },
  };

  return buildReceiptViewModel(source);
}
