/**
 * FuelTransaction — created at the physical dispensing event, never at
 * attendant-clearing time (see the schema module-level comment). Wires
 * fiscalPolicy.js's decision through to fiscalAdapter.js so a seeded
 * transaction ends up in a real, correct fiscal state end to end, even
 * though Phase 1 has no pump hardware or clearing UI in front of this yet.
 */

const prisma = require('../prisma');
const { DEFAULT_BRANCH } = require('../inventoryStock');
const { determineFiscalPath } = require('./fiscalPolicy');
const { fiscalizeTransaction } = require('./fiscalAdapter');

const VALID_CUSTOMER_TYPES = ['B2B', 'B2C'];

// Matches the codebase's existing money-rounding convention (lib/shift.js,
// components/shifts/VarianceBadge.jsx, settlementCalc.js's frontend twin) —
// toFixed(2), not a Number.EPSILON nudge, which disagrees with toFixed at
// .xx5 floating-point boundaries.
function round2(n) {
  return Number((Number(n) || 0).toFixed(2));
}

async function createFuelTransaction({
  pumpId,
  attendantId,
  productId,
  volume,
  customerId,
  customerType = 'B2C',
  invoiceRequested = false,
  shiftId,
  branchId = DEFAULT_BRANCH,
} = {}) {
  if (!pumpId) {
    const err = new Error('pumpId is required');
    err.status = 400;
    throw err;
  }
  if (!attendantId) {
    const err = new Error('attendantId is required');
    err.status = 400;
    throw err;
  }
  if (!productId) {
    const err = new Error('productId is required');
    err.status = 400;
    throw err;
  }
  if (!VALID_CUSTOMER_TYPES.includes(customerType)) {
    const err = new Error(`customerType must be one of: ${VALID_CUSTOMER_TYPES.join(', ')}`);
    err.status = 400;
    throw err;
  }

  const vol = Number(volume);
  if (!Number.isFinite(vol) || vol <= 0) {
    const err = new Error('volume must be a positive number');
    err.status = 400;
    throw err;
  }

  const [pump, attendant, product, customer] = await Promise.all([
    prisma.pump.findUnique({ where: { id: pumpId } }),
    prisma.attendant.findUnique({ where: { id: attendantId } }),
    prisma.product.findUnique({ where: { id: productId } }),
    customerId ? prisma.customer.findUnique({ where: { id: customerId } }) : Promise.resolve(null),
  ]);
  if (!pump) {
    const err = new Error('Pump not found');
    err.status = 400;
    throw err;
  }
  if (!attendant) {
    const err = new Error('Attendant not found');
    err.status = 400;
    throw err;
  }
  if (!product) {
    const err = new Error('Product not found');
    err.status = 400;
    throw err;
  }
  if (customerId && !customer) {
    const err = new Error('Customer not found');
    err.status = 400;
    throw err;
  }
  if (pump.status !== 'ACTIVE') {
    const err = new Error(`Pump ${pump.code} is not active (status: ${pump.status})`);
    err.status = 400;
    throw err;
  }
  if (attendant.status !== 'ACTIVE') {
    const err = new Error(`Attendant ${attendant.attendantCode} is not active (status: ${attendant.status})`);
    err.status = 400;
    throw err;
  }

  const unitPrice = product.price;
  const amount = round2(vol * unitPrice);
  const { fiscalizeNow, initialFiscalStatus } = determineFiscalPath({ customerType, invoiceRequested });

  const baseData = {
    branchId,
    pumpId,
    attendantId,
    productId,
    shiftId: shiftId || null,
    volume: vol,
    unitPrice,
    amount,
    taxRate: product.taxRate,
    vatCategoryCode: product.vatCategoryCode,
    customerId: customerId || null,
    customerType,
    invoiceRequested: Boolean(invoiceRequested),
  };

  if (!fiscalizeNow) {
    return prisma.fuelTransaction.create({ data: { ...baseData, fiscalStatus: initialFiscalStatus } });
  }

  // The external fiscal call happens BEFORE the row exists and outside any
  // DB transaction — never awaited inside a prisma.$transaction. A real
  // (non-mock) adapter's failure/timeout must never be able to roll back
  // and delete an already-created FuelTransaction row, which is exactly
  // what awaiting it inside an open transaction around the create risked.
  // Mirrors lib/saleFiscal.js keeping its external ZRA/VSDC call outside
  // any $transaction.
  const result = await fiscalizeTransaction({ branchId, amount });

  if (!result.success) {
    return prisma.fuelTransaction.create({ data: { ...baseData, fiscalStatus: 'FAILED' } });
  }

  // Both writes here are local-DB-only (no external call), so keeping them
  // in one transaction is genuinely atomic with no external-call risk.
  return prisma.$transaction(async (tx) => {
    const fiscalRecord = await tx.fiscalRecord.create({ data: result.fiscalRecord });
    return tx.fuelTransaction.create({
      data: { ...baseData, fiscalStatus: 'FISCALIZED', fiscalRecordId: fiscalRecord.id },
      include: { fiscalRecord: true },
    });
  });
}

async function listFuelTransactions({ branchId, attendantId, pumpId, settlementStatus, fiscalStatus } = {}) {
  return prisma.fuelTransaction.findMany({
    where: {
      ...(branchId ? { branchId } : {}),
      ...(attendantId ? { attendantId } : {}),
      ...(pumpId ? { pumpId } : {}),
      ...(settlementStatus ? { settlementStatus } : {}),
      ...(fiscalStatus ? { fiscalStatus } : {}),
    },
    include: { pump: true, attendant: true, product: true },
    orderBy: { transactionTime: 'desc' },
    take: 200,
  });
}

// Pure aggregation over already-fetched rows — no I/O — so it's
// unit-testable against plain-object fixtures with no DB. This is as far
// as settlement math goes in Phase 1; actual clearing (writing
// AttendantSettlement rows) is a later phase.
//
// "Still owed" means anything not fully SETTLED — UNSETTLED, EXCEPTION, and
// PARTIALLY_SETTLED all count, not just UNSETTLED. This is a Phase-1
// approximation: a PARTIALLY_SETTLED row's full `amount` is summed here
// since no per-transaction remaining-balance field exists yet (partial
// settlement bookkeeping lives on AttendantSettlement, not implemented
// until a later phase) — so this can overstate what's left on a partially
// cleared transaction, but never silently drops it from the total.
function computeUnsettledTotalsForAttendant(transactions) {
  const unsettled = (transactions || []).filter((t) => t.settlementStatus !== 'SETTLED');
  const total = round2(unsettled.reduce((sum, t) => sum + Number(t.amount || 0), 0));
  return { count: unsettled.length, total };
}

module.exports = {
  createFuelTransaction,
  listFuelTransactions,
  computeUnsettledTotalsForAttendant,
};
