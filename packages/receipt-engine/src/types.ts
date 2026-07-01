export type ReceiptType = 'SALE' | 'CREDIT_NOTE' | 'DEBIT_NOTE' | 'PROFORMA' | 'PURCHASE';

export type FiscalMode = 'ONLINE' | 'OFFLINE';

export type FiscalSubmissionStatus = 'SUBMITTED' | 'PENDING' | 'FAILED';

export interface ReceiptMeta {
  receiptType: ReceiptType;
  originalReceiptNo: string | null;
  isCopy: boolean;
  printedAt: string | null;
  printedBy: string | null;
  reprintCount: number;
  version: string;
}

export interface MerchantBlock {
  brand: string;
  logoUrl: string | null;
  tradingName: string;
  tpin: string;
  branchName: string;
  address: string;
  phone: string | null;
}

export interface TransactionBlock {
  date: string;
  time: string;
  cashier: string;
  receiptNo: string | null;
  invoiceNo: string | null;
  itemCount: number;
}

export interface ReceiptLineItem {
  name: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
}

export interface TotalsBlock {
  subtotal: number;
  vat: number;
  vatLabel: string;
  discount: number;
  total: number;
}

export interface PaymentBlock {
  method: string;
  amountPaid: number | null;
  change: number | null;
}

export interface FiscalBlock {
  mode: FiscalMode;
  submissionStatus: FiscalSubmissionStatus;
  submissionTime: string | null;
  sdcId: string | null;
  fiscalReceiptNo: string | null;
  receiptSignature: string | null;
  verificationCode: string | null;
  qrPayload: string | null;
  fiscalInvoiceNo: string | null;
}

export interface CustomerBlock {
  name: string;
  tpin: string | null;
  showTpin: boolean;
}

export interface FooterBlock {
  lines: string[];
  showPoweredBy: boolean;
  poweredByLine: string;
  fiscalizedLine: string;
}

export interface ReceiptViewModel {
  merchant: MerchantBlock;
  transaction: TransactionBlock;
  items: ReceiptLineItem[];
  totals: TotalsBlock;
  payment: PaymentBlock;
  fiscal: FiscalBlock;
  customer: CustomerBlock;
  footer: FooterBlock;
  receiptMeta: ReceiptMeta;
}

export interface ReceiptSourceData {
  receiptType: ReceiptType;
  originalReceiptNo?: string | null;
  merchant: {
    brand?: string;
    logoUrl?: string | null;
    tradingName: string;
    tpin: string;
    branchName: string;
    address: string;
    phone?: string | null;
  };
  transaction: {
    occurredAt: string | Date;
    cashier: string;
    receiptNo: string | null;
    fiscalInvoiceNo: number | null;
    itemCount: number;
  };
  items: ReceiptLineItem[];
  totals: {
    subtotal: number;
    vat: number;
    vatRate?: number;
    discount: number;
    total: number;
  };
  payment: {
    method: string;
    amountPaid?: number | null;
    change?: number | null;
  };
  fiscal: {
    mode?: FiscalMode;
    submissionStatus: FiscalSubmissionStatus;
    submissionTime?: string | Date | null;
    sdcId?: string | null;
    fiscalReceiptNo?: string | null;
    receiptSignature?: string | null;
    verificationCode?: string | null;
    qrPayload?: string | null;
  };
  customer?: {
    name?: string | null;
    tpin?: string | null;
  };
  footer?: {
    lines?: string[];
    showPoweredBy?: boolean;
    receiptVersion?: string;
  };
  receiptMeta?: Partial<ReceiptMeta>;
}
