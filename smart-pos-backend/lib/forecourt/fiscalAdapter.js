/**
 * The ONLY module in the Forecourt domain that would ever talk to an
 * external fiscal system. Every caller (fuelTransaction.js, and eventually
 * settlement/B2C-summary logic) goes through fiscalizeTransaction() and
 * never reasons about VSDC/ZRA directly — this isolation is deliberate so a
 * real provider can be dropped in later without touching any caller,
 * mirroring lib/vsdc-gateway/endpointAdapter.js's VSDC_MODE env-switch.
 *
 * Phase 1 has only a mock implementation. Mock output is unmistakably
 * synthetic (provider: 'mock', MOCK-prefixed rcptNo/qrCode/rcptSign) so it
 * can never be mistaken for a real ZRA response. This module makes NO claim
 * of ZRA/VSDC certification or regulatory compliance — see fiscalPolicy.js
 * for the same caveat on the policy side.
 */

// Unlike lib/vsdc-gateway/endpointAdapter.js's mode() — which normalizes
// any non-'official' value down to 'mock' — this deliberately does NOT
// normalize unrecognized values. Only 'mock' is implemented today, and
// silently mapping an unrecognized FORECOURT_FISCAL_MODE (e.g. a typo, or a
// real value like 'vsdc' before that provider exists) to 'mock' would mask
// a misconfiguration instead of failing loud via fiscalizeTransaction()'s
// FISCAL_PROVIDER_NOT_IMPLEMENTED error below. Do not compare this
// function's return value against 'official'/'vsdc' expecting VSDC-style
// normalization — it returns the raw lowercased env value as-is.
function mode() {
  return (process.env.FORECOURT_FISCAL_MODE || 'mock').toLowerCase();
}

function mockStamp() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
}

async function fiscalizeMock(transaction) {
  const stamp = mockStamp();
  return {
    success: true,
    fiscalRecord: {
      scope: 'TRANSACTION',
      branchId: transaction.branchId,
      provider: 'mock',
      amount: transaction.amount,
      // Real tax-amount computation is deferred to when a genuine
      // ZRA/VSDC-backed adapter lands — not fabricated here.
      taxAmount: null,
      rcptNo: `MOCK-${stamp}`,
      qrCode: `MOCK-QR-${stamp}`,
      rcptSign: `MOCK-SIGN-${stamp}`,
      submittedAt: new Date(),
    },
  };
}

async function fiscalizeTransaction(transaction) {
  if (mode() !== 'mock') {
    return {
      success: false,
      error: `Forecourt fiscal provider "${mode()}" is not implemented yet`,
      code: 'FISCAL_PROVIDER_NOT_IMPLEMENTED',
    };
  }
  return fiscalizeMock(transaction);
}

module.exports = { mode, fiscalizeTransaction };
