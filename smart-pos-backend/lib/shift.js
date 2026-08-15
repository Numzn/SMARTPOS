/**
 * Cash register / shift lifecycle — open/close, cash movements, and the
 * expected-vs-counted-cash reconciliation behind X/Z reports.
 */

const prisma = require('./prisma');
const { DEFAULT_BRANCH } = require('./inventoryStock');
const { nextSequentialNumber } = require('./sequentialNumber');

const round2 = (n) => parseFloat((n || 0).toFixed(2));

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

  return prisma.$transaction(async (tx) => {
    const shiftNumber = await nextSequentialNumber(tx, {
      model: 'shift',
      field: 'shiftNumber',
      prefix: 'SHIFT',
    });

    return tx.shift.create({
      data: {
        shiftNumber,
        userId,
        branchId,
        openingFloat: float,
        openingNotes: notes || null,
      },
      include: shiftInclude,
    });
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

/**
 * Cashier's "I'm done" action — locks the drawer against further cash
 * movements and hands it off for reconciliation, but computes and exposes
 * no financial figures. Segregation of duties: the cashier who worked the
 * till is never the one who finds out (or decides) whether it balances.
 */
async function endShift(shiftId, { userId }) {
  const shift = await prisma.shift.findUnique({ where: { id: shiftId } });
  if (!shift) {
    const err = new Error('Shift not found');
    err.status = 404;
    throw err;
  }
  if (shift.status !== 'OPEN') {
    const err = new Error(`Cannot end a shift with status ${shift.status}`);
    err.status = 409;
    throw err;
  }

  return prisma.shift.update({
    where: { id: shiftId },
    data: {
      status: 'PENDING_RECONCILIATION',
      endedAt: new Date(),
    },
    include: shiftInclude,
  });
}

/**
 * Reconcile (count + close) a shift. Runnable on an OPEN shift directly (a
 * supervisor doing a spot-check) or, the normal path, one already ended by
 * its cashier (PENDING_RECONCILIATION).
 *
 * `reconcilerUserId` must differ from the shift's owner — this is a hard
 * invariant, not permission-gated, mirroring SELF_APPROVAL_DENIED in
 * lib/approval.js: a till can never be balanced by the person who worked
 * it, regardless of what role or permissions that person holds (including
 * ADMIN — segregation of duties is structural, not a privilege check).
 */
async function closeShift(shiftId, { countedCash, reconcilerUserId, notes }) {
  const shift = await prisma.shift.findUnique({ where: { id: shiftId } });
  if (!shift) {
    const err = new Error('Shift not found');
    err.status = 404;
    throw err;
  }
  if (!['OPEN', 'PENDING_RECONCILIATION'].includes(shift.status)) {
    const err = new Error('Shift is already closed');
    err.status = 409;
    throw err;
  }
  if (!reconcilerUserId) {
    const err = new Error('reconcilerUserId is required');
    err.status = 400;
    throw err;
  }
  if (reconcilerUserId === shift.userId) {
    const err = new Error('A shift cannot be reconciled by the cashier who worked it');
    err.status = 403;
    err.code = 'SELF_RECONCILE_DENIED';
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
      closedByUserId: reconcilerUserId,
      countedCash: counted,
      expectedCash: breakdown.expectedCash,
      variance,
      closingNotes: notes || null,
    },
    include: shiftInclude,
  });
}

/**
 * Manager override: reopen a reconciled shift (e.g. a counting error found
 * after the fact). Clears the reconciliation figures back to the
 * PENDING_RECONCILIATION state rather than OPEN — cash movements stay
 * locked; a reconciler still has to close it again.
 */
async function reopenShift(shiftId, { notes } = {}) {
  const shift = await prisma.shift.findUnique({ where: { id: shiftId } });
  if (!shift) {
    const err = new Error('Shift not found');
    err.status = 404;
    throw err;
  }
  if (shift.status !== 'CLOSED') {
    const err = new Error('Only a closed shift can be reopened');
    err.status = 409;
    throw err;
  }

  return prisma.shift.update({
    where: { id: shiftId },
    data: {
      status: 'PENDING_RECONCILIATION',
      closedAt: null,
      closedByUserId: null,
      countedCash: null,
      expectedCash: null,
      variance: null,
      closingNotes: notes || shift.closingNotes,
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
/**
 * X-report on an OPEN shift (live snapshot, never mutates anything), Z-report
 * on a CLOSED one (the permanent reconciliation). Same computation either way;
 * a CLOSED shift additionally carries its recorded countedCash/variance rather
 * than a live estimate.
 *
 * Deliberately a *summary* — the per-transaction detail lives in
 * getShiftTransactions() so a busy till's Z-report stays one printable page
 * instead of thousands of lines.
 *
 * Scoped to what the data model actually records: there is no register/
 * terminal concept, no suspended-sale state, and no void distinct from
 * CANCELLED, so none of those are reported rather than shown as a permanent
 * zero on an audit document.
 */
async function getShiftReport(shiftId) {
  const shift = await prisma.shift.findUnique({ where: { id: shiftId }, include: shiftInclude });
  if (!shift) {
    const err = new Error('Shift not found');
    err.status = 404;
    throw err;
  }

  const [
    cashBreakdown,
    salesByMethod,
    refundsByMethod,
    salesTotals,
    refundTotals,
    saleCount,
    refundCount,
    cancelledCount,
    business,
    branch,
    closedByUser,
  ] = await Promise.all([
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
    prisma.sale.aggregate({
      where: { shiftId, status: 'COMPLETED' },
      _sum: { total: true, subtotal: true, tax: true, discount: true },
    }),
    prisma.refund.aggregate({
      where: { shiftId, status: 'COMPLETED' },
      _sum: { total: true, tax: true },
    }),
    prisma.sale.count({ where: { shiftId, status: 'COMPLETED' } }),
    prisma.refund.count({ where: { shiftId, status: 'COMPLETED' } }),
    prisma.sale.count({ where: { shiftId, status: 'CANCELLED' } }),
    prisma.businessProfile.findFirst(),
    prisma.branch.findUnique({ where: { code: shift.branchId } }).catch(() => null),
    shift.closedByUserId
      ? prisma.user.findUnique({
          where: { id: shift.closedByUserId },
          select: { id: true, name: true, email: true },
        })
      : null,
  ]);

  const endedAt = shift.closedAt ? new Date(shift.closedAt) : new Date();
  const durationMinutes = Math.max(0, Math.round((endedAt - new Date(shift.openedAt)) / 60000));

  // Gross = what was rung up before discounts; net = the taxable base actually
  // charged. Sale.subtotal is already net of line discounts, so gross is
  // reconstructed by adding the order-level discount back on.
  const netSales = salesTotals._sum.subtotal || 0;
  const discounts = salesTotals._sum.discount || 0;
  const grossSales = netSales + discounts;
  const refundsTotal = refundTotals._sum.total || 0;

  const variance = shift.variance;
  const expectedForPct = shift.expectedCash ?? cashBreakdown.expectedCash;
  const variancePct =
    shift.status === 'CLOSED' && expectedForPct
      ? parseFloat(((variance / expectedForPct) * 100).toFixed(2))
      : null;

  return {
    shift: {
      id: shift.id,
      shiftNumber: shift.shiftNumber,
      status: shift.status,
      branchId: shift.branchId,
      branchName: branch?.name || null,
      companyName: business?.tradingName || null,
      companyTpin: business?.tpin || null,
      cashier: shift.user,
      openedAt: shift.openedAt,
      closedAt: shift.closedAt,
      generatedAt: new Date(),
      durationMinutes,
      openingFloat: shift.openingFloat,
      openingNotes: shift.openingNotes,
      closingNotes: shift.closingNotes,
      closedBy: closedByUser,
    },
    sales: {
      grossSales: round2(grossSales),
      discounts: round2(discounts),
      netSales: round2(netSales),
      tax: round2(salesTotals._sum.tax || 0),
      total: round2(salesTotals._sum.total || 0),
      refunds: round2(refundsTotal),
      refundTax: round2(refundTotals._sum.tax || 0),
      transactionCount: saleCount,
      refundCount,
      cancelledCount,
    },
    cash:
      shift.status === 'CLOSED'
        ? {
            ...cashBreakdown,
            expectedCash: shift.expectedCash ?? cashBreakdown.expectedCash,
            countedCash: shift.countedCash,
            variance,
            variancePct,
          }
        : cashBreakdown,
    salesByMethod,
    refundsByMethod,
    saleCount,
    refundCount,
    cashMovements: shift.cashMovements,
  };
}

/**
 * Shift Transaction Journal — every event that belongs to a shift, merged into
 * one chronological list: sales (including cancelled ones), refunds, and cash
 * movements. This is the drill-down behind the X/Z summary, not a replacement
 * for it.
 *
 * Merging happens in memory rather than via SQL UNION because the three
 * sources have genuinely different shapes and a shift is bounded by a single
 * till session — hundreds of rows, not millions. If a shift ever grows past
 * that, this is the function to push down into SQL.
 *
 * Types reported are the ones the data model actually has. There is no
 * suspended-sale state and no void distinct from CANCELLED, so those are
 * absent rather than always-empty.
 */
async function getShiftTransactions(shiftId, { search, type, sort = 'time_desc', page = 1, limit = 100 } = {}) {
  const shift = await prisma.shift.findUnique({ where: { id: shiftId } });
  if (!shift) {
    const err = new Error('Shift not found');
    err.status = 404;
    throw err;
  }

  const [sales, refunds, movements] = await Promise.all([
    prisma.sale.findMany({
      where: { shiftId },
      select: {
        id: true, createdAt: true, status: true, total: true, tax: true,
        paymentMethod: true, fiscalInvcNo: true, rcptNo: true,
        customerName: true, customerTpin: true,
        user: { select: { id: true, name: true } },
      },
    }),
    prisma.refund.findMany({
      where: { shiftId },
      select: {
        id: true, createdAt: true, status: true, total: true, tax: true,
        paymentMethod: true, fiscalInvcNo: true, rcptNo: true, reason: true,
        user: { select: { id: true, name: true } },
        originalSale: { select: { rcptNo: true, customerName: true } },
      },
    }),
    prisma.shiftCashMovement.findMany({ where: { shiftId } }),
  ]);

  const rows = [
    ...sales.map((s) => ({
      id: s.id,
      time: s.createdAt,
      type: s.status === 'CANCELLED' ? 'CANCELLED' : 'SALE',
      invoiceNumber: s.fiscalInvcNo == null ? null : String(s.fiscalInvcNo),
      receiptNumber: s.rcptNo,
      customer: s.customerName || 'Walk-in',
      customerTpin: s.customerTpin,
      cashier: s.user?.name || null,
      paymentMethod: s.paymentMethod,
      total: round2(s.total),
      tax: round2(s.tax || 0),
      status: s.status,
      note: null,
    })),
    ...refunds.map((r) => ({
      id: r.id,
      time: r.createdAt,
      type: 'REFUND',
      invoiceNumber: r.fiscalInvcNo == null ? null : String(r.fiscalInvcNo),
      receiptNumber: r.rcptNo,
      customer: r.originalSale?.customerName || 'Walk-in',
      customerTpin: null,
      cashier: r.user?.name || null,
      paymentMethod: r.paymentMethod,
      // Negative so the journal column sums to the shift's net position.
      total: round2(-(r.total || 0)),
      tax: round2(-(r.tax || 0)),
      status: r.status,
      note: r.reason || (r.originalSale?.rcptNo ? `Against ${r.originalSale.rcptNo}` : null),
    })),
    ...movements.map((m) => ({
      id: m.id,
      time: m.createdAt,
      type: m.type, // CASH_IN | CASH_OUT | PAID_OUT
      invoiceNumber: null,
      receiptNumber: null,
      customer: null,
      customerTpin: null,
      cashier: null,
      paymentMethod: 'CASH',
      total: round2(m.type === 'CASH_IN' ? m.amount : -m.amount),
      tax: 0,
      status: 'RECORDED',
      note: m.reason || null,
    })),
  ];

  let filtered = rows;
  if (type) {
    const wanted = String(type).split(',').map((t) => t.trim().toUpperCase());
    filtered = filtered.filter((r) => wanted.includes(r.type));
  }
  if (search) {
    const q = String(search).toLowerCase();
    filtered = filtered.filter((r) =>
      [r.receiptNumber, r.invoiceNumber, r.customer, r.cashier, r.note, r.paymentMethod, r.type]
        .some((v) => v && String(v).toLowerCase().includes(q))
    );
  }

  const sorters = {
    time_asc: (a, b) => new Date(a.time) - new Date(b.time),
    time_desc: (a, b) => new Date(b.time) - new Date(a.time),
    total_asc: (a, b) => a.total - b.total,
    total_desc: (a, b) => b.total - a.total,
  };
  filtered.sort(sorters[sort] || sorters.time_desc);

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const pageSize = Math.min(500, Math.max(1, parseInt(limit, 10) || 100));
  const paged = filtered.slice((pageNum - 1) * pageSize, pageNum * pageSize);

  const countOf = (...types) => rows.filter((r) => types.includes(r.type)).length;

  return {
    shift: { id: shift.id, shiftNumber: shift.shiftNumber, status: shift.status },
    // Summary always describes the whole shift, never the active filter — it
    // is the shift's shape, and having some counts respond to the filter while
    // others didn't made "2 transactions" sit next to "Sales: 2" while
    // filtered to cash movements. filteredCount is the one that tracks the
    // current view.
    summary: {
      total: rows.length,
      filteredCount: filtered.length,
      sales: countOf('SALE'),
      refunds: countOf('REFUND'),
      cancelled: countOf('CANCELLED'),
      cashMovements: countOf('CASH_IN', 'CASH_OUT', 'PAID_OUT'),
    },
    transactions: paged,
    page: pageNum,
    limit: pageSize,
  };
}

module.exports = {
  shiftInclude,
  getOpenShiftForUser,
  openShift,
  recordCashMovement,
  computeExpectedCash,
  endShift,
  closeShift,
  reopenShift,
  getShiftReport,
  getShiftTransactions,
};
