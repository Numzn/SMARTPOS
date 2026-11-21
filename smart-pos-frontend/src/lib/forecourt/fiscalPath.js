/**
 * Mirrors smart-pos-backend/lib/forecourt/fiscalPolicy.js's
 * determineFiscalPath 1:1. Used only for optimistic UI preview (e.g. a
 * fiscal-status badge shown before the server responds) — never the
 * authority. The backend's decision at creation time is always what's
 * persisted and displayed once a real response comes back.
 */
import { FISCAL_STATUS, CUSTOMER_TYPE } from './statuses';

export function determineFiscalPath({ customerType = CUSTOMER_TYPE.B2C, invoiceRequested = false } = {}) {
  const isB2B = customerType === CUSTOMER_TYPE.B2B;
  const isInvoicedB2C = customerType === CUSTOMER_TYPE.B2C && Boolean(invoiceRequested);

  if (isB2B || isInvoicedB2C) {
    return { fiscalizeNow: true, initialFiscalStatus: FISCAL_STATUS.PENDING };
  }

  return { fiscalizeNow: false, initialFiscalStatus: FISCAL_STATUS.SUMMARY_PENDING };
}
