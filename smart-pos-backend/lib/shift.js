/**
 * Cash register / shift lifecycle — open/close, cash movements, and the
 * expected-vs-counted-cash reconciliation behind X/Z reports.
 */

const prisma = require('./prisma');
const { DEFAULT_BRANCH } = require('./inventoryStock');

const shiftInclude = {
  user: { select: { id: true, name: true, email: true } },
  cashMovements: { orderBy: { createdAt: 'asc' } },
};

async function getOpenShiftForUser(userId, branchId = DEFAULT_BRANCH) {
  return prisma.shift.findFirst({
    where: { userId, branchId, status: 'OPEN' },
    include: shiftInclude,
  });
}

async function openShift({ userId, branchId = DEFAULT_BRANCH, openingFloat = 0, notes }) {
  if (!userId) {
    const err = new Error('userId is required');
    err.status = 400;
    throw err;
  }

  const float = Number(openingFloat);
  if (!Number.isFinite(float) || float < 0) {
    const err = new Error('openingFloat must be a non-negative number');
    err.status = 400;
    throw err;
  }

  const existing = await getOpenShiftForUser(userId, branchId);
  if (existing) {
    const err = new Error('This user already has an open shift for this branch');
    err.status = 409;
    throw err;
  }

  return prisma.shift.create({
    data: {
      userId,
      branchId,
      openingFloat: float,
      openingNotes: notes || null,
    },
    include: shiftInclude,
  });
}

async function recordCashMovement(shiftId, { type, amount, reason, userId }) {
  if (!['CASH_IN', 'CASH_OUT', 'PAID_OUT'].includes(type)) {
    const err = new Error(`Invalid cash movement type: ${type}`);
    err.status = 400;
    throw err;
  }

  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) {
    const err = new Error('amount must be a positive number');
    err.status = 400;
    throw err;
  }

  if (!userId) {
    const err = new Error('userId is required');
    err.status = 400;
    throw err;
  }

  const shift = await prisma.shift.findUnique({ where: { id: shiftId } });
  if (!shift) {
    const err = new Error('Shift not found');
    err.status = 404;
    throw err;
  }
  if (shift.status !== 'OPEN') {
    const err = new Error('Cannot record a cash movement on a closed shift');
    err.status = 409;
    throw err;
  }

  await prisma.shiftCashMovement.create({
    data: { shiftId, type, amount: value, reason: reason || null, userId },
  });

  return prisma.shift.findUnique({ where: { id: shiftId }, include: shiftInclude });
}

/**
 * Expected cash in the drawer: opening float, plus completed cash sales,
 * minus completed cash refunds, plus/minus recorded cash movements. Only
 * COMPLETED sales/refunds count — a PENDING or FISCAL_FAILED sale never
 * became a real, fiscally-recorded transaction.
 */
async function computeExpectedCash(shiftId) {
  const shift = await prisma.shift.findUnique({ where: { id: shiftId } });
  if (!shift) {
    const err = new Error('Shift not found');
    err.status = 404;
    throw err;
  }

  const [salesAgg, refundsAgg, movements] = await Promise.all([
    prisma.sale.aggregate({
      where: { shiftId, status: 'COMPLETED', paymentMethod: 'CASH' },
      _sum: { total: true },
    }),
    prisma.refund.aggregate({
      where: { shiftId, status: 'COMPLETED', paymentMethod: 'CASH' },
      _sum: { total: true },
    }),
    prisma.shiftCashMovement.groupBy({
      by: ['type'],
      where: { shiftId },
      _sum: { amount: true },
    }),
  ]);

  const cashSales = salesAgg._sum.total || 0;
  const cashRefunds = refundsAgg._sum.total || 0;
  const byType = Object.fromEntries(movements.map((m) => [m.type, m._sum.amount || 0]));
  const cashIn = byType.CASH_IN || 0;
  const cashOut = byType.CASH_OUT || 0;
  const paidOut = byType.PAID_OUT || 0;

  const expectedCash = shift.openingFloat + cashSales - cashRefunds + cashIn - cashOut - paidOut;

  return {
    openingFloat: shift.openingFloat,
    cashSales,
    cashRefunds,
    cashIn,
    cashOut,
    paidOut,
    expectedCash: parseFloat(expectedCash.toFixed(2)),
  };
}

async function closeShift(shiftId, { countedCash, userId, notes }) {
  const shift = await prisma.shift.findUnique({ where: { id: shiftId } });
  if (!shift) {
    const err = new Error('Shift not found');
    err.status = 404;
    throw err;
  }
  if (shift.status !== 'OPEN') {
    const err = new Error('Shift is already closed');
    err.status = 409;
    throw err;
  }

  const counted = Number(countedCash);
  if (!Number.isFinite(counted) || counted < 0) {
    const err = new Error('countedCash must be a non-negative number');
    err.status = 400;
    throw err;
  }

  const breakdown = await computeExpectedCash(shiftId);
  const variance = parseFloat((counted - breakdown.expectedCash).toFixed(2));

  return prisma.shift.update({
    where: { id: shiftId },
    data: {
      status: 'CLOSED',
      closedAt: new Date(),
      closedByUserId: userId || shift.userId,
      countedCash: counted,
      expectedCash: breakdown.expectedCash,
      variance,
      closingNotes: notes || null,
    },
    include: shiftInclude,
  });
}

/**
 * Shift report — an X-report when called on an OPEN shift (a mid-shift
 * snapshot), a Z-report when called on a CLOSED one (the final reconciled
 * figures). Same computation either way; a CLOSED shift additionally carries
 * its recorded countedCash/variance rather than recomputing a live estimate.
 */
async function getShiftReport(shiftId) {
  const shift = await prisma.shift.findUnique({ where: { id: shiftId }, include: shiftInclude });
  if (!shift) {
    const err = new Error('Shift not found');
    err.status = 404;
    throw err;
  }

  const [cashBreakdown, salesByMethod, refundsByMethod, saleCount, refundCount] = await Promise.all([
    computeExpectedCash(shiftId),
    prisma.sale.groupBy({
      by: ['paymentMethod'],
      where: { shiftId, status: 'COMPLETED' },
      _sum: { total: true, tax: true },
      _count: true,
    }),
    prisma.refund.groupBy({
      by: ['paymentMethod'],
      where: { shiftId, status: 'COMPLETED' },
      _sum: { total: true },
      _count: true,
    }),
    prisma.sale.count({ where: { shiftId, status: 'COMPLETED' } }),
    prisma.refund.count({ where: { shiftId, status: 'COMPLETED' } }),
  ]);

  return {
    shift: {
      id: shift.id,
      status: shift.status,
      branchId: shift.branchId,
      cashier: shift.user,
      openedAt: shift.openedAt,
      closedAt: shift.closedAt,
      openingFloat: shift.openingFloat,
    },
    cash:
      shift.status === 'CLOSED'
        ? { ...cashBreakdown, countedCash: shift.countedCash, variance: shift.variance }
        : cashBreakdown,
    salesByMethod,
    refundsByMethod,
    saleCount,
    refundCount,
    cashMovements: shift.cashMovements,
  };
}

module.exports = {
  shiftInclude,
  getOpenShiftForUser,
  openShift,
  recordCashMovement,
  computeExpectedCash,
  closeShift,
  getShiftReport,
};
