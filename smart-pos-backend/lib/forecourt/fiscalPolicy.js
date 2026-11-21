/**
 * Forecourt fiscalization policy — pure, no I/O, no VSDC awareness. This is
 * the ONLY place that decides *whether/when* a FuelTransaction should be
 * fiscalized; it never talks to fiscalAdapter.js itself — callers
 * (fuelTransaction.js) read the decision and act on it.
 *
 * This is a working interpretation of Zambian fuel-station Smart Invoice
 * requirements, NOT a certified/verified regulatory rule — see
 * fiscalAdapter.js for the mock/sandbox boundary this policy feeds, and do
 * not represent this behavior as ZRA/VSDC-compliant without formal
 * verification.
 *
 * B2B and B2C-with-invoice-requested fiscalize individually and
 * immediately. Ordinary B2C (no invoice requested) is deferred into
 * SUMMARY_PENDING for later batch/summary fiscalization via a
 * B2CSummaryPool (not implemented until a later phase).
 */
function determineFiscalPath({ customerType = 'B2C', invoiceRequested = false } = {}) {
  const isB2B = customerType === 'B2B';
  const isInvoicedB2C = customerType === 'B2C' && Boolean(invoiceRequested);

  if (isB2B || isInvoicedB2C) {
    return { fiscalizeNow: true, initialFiscalStatus: 'PENDING' };
  }

  return { fiscalizeNow: false, initialFiscalStatus: 'SUMMARY_PENDING' };
}

module.exports = { determineFiscalPath };
