/**
 * Cash register / shift lifecycle — open/close, cash movements, and the
 * expected-vs-counted-cash reconciliation behind X/Z reports.
 */

const prisma = require('./prisma');
const { DEFAULT_BRANCH } = require('./inventoryStock');
const { nextSequentialNumber } = require('./sequentialNumber');
const { createZReport } = require('./zReport');
const { consumeApproval } = require('./approval');

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

/**
 * The branch's currently active shift, regardless of who opened it — what a
 * Cashier (shifts:recordMovement, not shifts:operate) resolves "current
 * shift" to, since they never open one themselves. Most-recently-opened
 * wins if more than one is somehow OPEN for the branch at once.
 */
async function getOpenShiftForBranch(branchId = DEFAULT_BRANCH) {
  return prisma.shift.findFirst({
    where: { branchId, status: 'OPEN' },
    orderBy: { openedAt: 'desc' },
    include: shiftInclude,
  });
}

/**
 * Every currently OPEN shift, across all branches — the back-office "Active
 * Tills" view. Deliberately unfiltered by branch (unlike getOpenShiftForBranch)
 * since a manager overseeing the whole store needs to see every register at
 * once, not just their own branch's.
 */
async function getActiveTills() {
  return prisma.shift.findMany({
    where: { status: 'OPEN' },
    include: shiftInclude,
    orderBy: { openedAt: 'asc' },
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

async function recordCashMovement(shiftId, { type, amount, reason, userId, safeId, witnessUserId }) {
  if (!['CASH_IN', 'CASH_OUT', 'PAID_OUT', 'SAFE_DROP'].includes(type)) {
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
    data: {
      shiftId,
      type,
      amount: value,
      reason: reason || null,
      userId,
      safeId: type === 'SAFE_DROP' ? safeId || null : null,
      witnessUserId: type === 'SAFE_DROP' ? witnessUserId || null : null,
    },
  });

  return prisma.shift.findUnique({ where: { id: shiftId }, include: shiftInclude });
}

/**
 * Expected cash in the drawer: opening float, plus completed cash sales,
 * minus completed cash refunds, plus/minus recorded cash movements
 * (including safe drops, subtracted the same way a payout is). Only
 * COMPLETED sales/refunds count — a PENDING or FISCAL_FAILED sale never
 * became a real, fiscally-recorded transaction.
 *
 * `db` defaults to the module-level prisma client but accepts an active `tx`
 * so a caller (notably Z-report generation) can compute this figure inside
 * the same transaction that freezes it — the whole point of a Z report is
 * that nothing can change between "compute" and "persist."
 */
async function computeExpectedCash(shiftId, db = prisma) {
  const shift = await db.shift.findUnique({ where: { id: shiftId } });
  if (!shift) {
    const err = new Error('Shift not found');
    err.status = 404;
    throw err;
  }

  const [salesAgg, refundsAgg, movements] = await Promise.all([
    db.sale.aggregate({
      where: { shiftId, status: 'COMPLETED', paymentMethod: 'CASH' },
      _sum: { total: true },
    }),
    db.refund.aggregate({
      where: { shiftId, status: 'COMPLETED', paymentMethod: 'CASH' },
      _sum: { total: true },
    }),
    db.shiftCashMovement.groupBy({
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
  const safeDropsTotal = byType.SAFE_DROP || 0;

  const expectedCash = shift.openingFloat + cashSales - cashRefunds + cashIn - cashOut - paidOut - safeDropsTotal;

  return {
    openingFloat: shift.openingFloat,
    cashSales,
    cashRefunds,
    cashIn,
    cashOut,
    paidOut,
    safeDropsTotal,
    expectedCash: parseFloat(expectedCash.toFixed(2)),
  };
}

/**
 * Gathers every figure a Z report freezes, scoped to `tx` so it runs inside
 * the same transaction that will persist it. Shares its aggregation shape
 * with getShiftReport() below by design — a Z report is exactly "what
 * getShiftReport() would say right now," just written down permanently
 * instead of recomputed live forever after.
 */
async function buildZReportTotals(tx, shiftId) {
  const shift = await tx.shift.findUnique({ where: { id: shiftId } });
  if (!shift) {
    const err = new Error('Shift not found');
    err.status = 404;
    throw err;
  }

  const [breakdown, salesByMethod, salesTotals, refundTotals, saleCount, cancelledCount, safeDropRows] =
    await Promise.all([
      computeExpectedCash(shiftId, tx),
      tx.sale.groupBy({
        by: ['paymentMethod'],
        where: { shiftId, status: 'COMPLETED' },
        _sum: { total: true },
        _count: true,
      }),
      tx.sale.aggregate({
        where: { shiftId, status: 'COMPLETED' },
        _sum: { total: true, subtotal: true, tax: true, discount: true },
      }),
      tx.refund.aggregate({
        where: { shiftId, status: 'COMPLETED' },
        _sum: { total: true },
      }),
      tx.sale.count({ where: { shiftId, status: 'COMPLETED' } }),
      tx.sale.count({ where: { shiftId, status: 'CANCELLED' } }),
      tx.shiftCashMovement.findMany({ where: { shiftId, type: 'SAFE_DROP' }, orderBy: { createdAt: 'asc' } }),
    ]);

  const netSales = salesTotals._sum.subtotal || 0;
  const discounts = salesTotals._sum.discount || 0;
  const grossSales = netSales + discounts;

  return {
    branchId: shift.branchId,
    cashierUserId: shift.userId,
    shiftOpenedAt: shift.openedAt,
    shiftEndedAt: new Date(),
    openingFloat: shift.openingFloat,
    grossSales: round2(grossSales),
    discounts: round2(discounts),
    netSales: round2(netSales),
    tax: round2(salesTotals._sum.tax || 0),
    refunds: round2(refundTotals._sum.total || 0),
    cancelledCount,
    transactionCount: saleCount,
    salesByMethod: salesByMethod.map((m) => ({
      paymentMethod: m.paymentMethod,
      total: round2(m._sum.total || 0),
      count: m._count,
    })),
    cashSales: breakdown.cashSales,
    cashRefunds: breakdown.cashRefunds,
    cashIn: breakdown.cashIn,
    cashOut: breakdown.cashOut,
    paidOut: breakdown.paidOut,
    safeDrops: safeDropRows.map((d) => ({
      id: d.id,
      amount: d.amount,
      createdAt: d.createdAt,
      safeId: d.safeId,
      witnessUserId: d.witnessUserId,
    })),
    safeDropsTotal: breakdown.safeDropsTotal,
    expectedClosingCash: breakdown.expectedCash,
  };
}

/**
 * End a shift — Supervisor+ PIN required, no exceptions (including for a
 * Supervisor ending their own shift; self-approval is unconditionally
 * blocked in lib/approval.js). Atomically: consumes the SHIFT_END approval
 * ticket, freezes every figure into an immutable ZReport row, and locks the
 * shift for reconciliation. No financial figures are exposed by this
 * function's return value beyond what's already frozen into the ZReport —
 * the caller (route layer) decides what to show whom.
 */
async function endShift(shiftId, { approvalId }) {
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

  return prisma.$transaction(async (tx) => {
    const approver = await consumeApproval(tx, approvalId, {
      actionType: 'SHIFT_END',
      sessionId: null,
      target: { shiftId },
    });

    const totals = await buildZReportTotals(tx, shiftId);
    const zReport = await createZReport(tx, shiftId, {
      ...totals,
      authorizedByUserId: approver.id,
      supervisorApprovalId: approvalId,
    });

    const updatedShift = await tx.shift.update({
      where: { id: shiftId },
      data: { status: 'PENDING_RECONCILIATION', endedAt: totals.shiftEndedAt },
      include: shiftInclude,
    });

    return { shift: updatedShift, zReport };
  });
}

/**
 * Auto-backfill a ZReport for a shift that reached PENDING_RECONCILIATION
 * before this feature existed (no PIN-gated endShift() ever ran for it).
 * Same totals computation as a normal Z, just missing a real consumed
 * approval ticket to point to — `backfilled: true` marks it as such so it
 * stays visually distinguishable from a properly authorized one if that
 * ever matters for an audit. Only ever called from closeShift() below, and
 * only when no ZReport already exists.
 */
async function backfillZReport(tx, shiftId, { triggeredByUserId = null } = {}) {
  const totals = await buildZReportTotals(tx, shiftId);
  return createZReport(tx, shiftId, {
    ...totals,
    authorizedByUserId: triggeredByUserId,
    supervisorApprovalId: null,
    backfilled: true,
  });
}

/**
 * Reconcile a shift: compares the frozen ZReport.expectedClosingCash against
 * the cashier's own CashierDeclaration.declaredTotal — neither number is
 * recomputed or re-entered here, both already exist and are read-only by
 * this point. `reconcilerUserId` must differ from the shift's owner — a hard
 * invariant, not permission-gated, mirroring SELF_APPROVAL_DENIED in
 * lib/approval.js: a till can never be balanced by the person who worked
 * it, regardless of what role or permissions that person holds (including
 * ADMIN — segregation of duties is structural, not a privilege check).
 */
async function closeShift(shiftId, { reconcilerUserId, notes }) {
  const shift = await prisma.shift.findUnique({ where: { id: shiftId } });
  if (!shift) {
    const err = new Error('Shift not found');
    err.status = 404;
    throw err;
  }
  if (shift.status !== 'PENDING_RECONCILIATION') {
    const err = new Error(
      shift.status === 'CLOSED' ? 'Shift is already closed' : 'Shift must be ended before it can be reconciled'
    );
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

  const declaration = await prisma.cashierDeclaration.findUnique({ where: { shiftId } });
  if (!declaration) {
    const err = new Error('The cashier has not submitted a physical cash declaration for this shift yet');
    err.status = 409;
    err.code = 'DECLARATION_REQUIRED';
    throw err;
  }

  return prisma.$transaction(async (tx) => {
    let zReport = await tx.zReport.findUnique({ where: { shiftId } });
    if (!zReport) {
      // Only reachable for a shift that entered PENDING_RECONCILIATION
      // before this feature shipped — see backfillZReport() above.
      zReport = await backfillZReport(tx, shiftId, { triggeredByUserId: reconcilerUserId });
    } else if (zReport.backfilled) {
      // submitDeclaration() backfills a ZReport itself when none exists yet
      // (same legacy-shift case, just discovered earlier — at declaration
      // time rather than close time), attributed to the cashier as a
      // placeholder since authorizedByUserId can't be null. The reconciler
      // closing the shift out is the one actually taking responsibility for
      // a backfilled Z, so that supersedes the placeholder here.
      zReport = await tx.zReport.update({
        where: { shiftId },
        data: { authorizedByUserId: reconcilerUserId },
      });
    }

    const variance = round2(declaration.declaredTotal - zReport.expectedClosingCash);

    return tx.shift.update({
      where: { id: shiftId },
      data: {
        status: 'CLOSED',
        closedAt: new Date(),
        closedByUserId: reconcilerUserId,
        countedCash: declaration.declaredTotal,
        expectedCash: zReport.expectedClosingCash,
        variance,
        closingNotes: notes || null,
      },
      include: shiftInclude,
    });
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
    zReport,
  ] = await Promise.all([
    // Only actually used for an OPEN shift with no ZReport yet — computed
    // eagerly either way since it's cheap and keeps this Promise.all simple;
    // once a ZReport exists, the frozen figures below take over instead.
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
    prisma.zReport.findUnique({ where: { shiftId } }),
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
  const frozenExpected = zReport?.expectedClosingCash ?? shift.expectedCash ?? cashBreakdown.expectedCash;
  const variancePct =
    shift.status === 'CLOSED' && frozenExpected
      ? parseFloat(((variance / frozenExpected) * 100).toFixed(2))
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
      // Present once the shift has been through the PIN-gated endShift() —
      // the frontend uses this to know a Z has been generated (and to link
      // to GET /:id/z-report) independent of whether it's been reconciled yet.
      zNumber: zReport?.zNumber ?? null,
      zGeneratedAt: zReport?.generatedAt ?? null,
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
    // Once a ZReport exists (status PENDING_RECONCILIATION or CLOSED), its
    // frozen figures are authoritative — never a live recomputation, that's
    // the entire point of freezing them at end-shift time. Only a genuinely
    // OPEN shift (no ZReport yet) falls back to the live cashBreakdown.
    cash: zReport
      ? {
          openingFloat: zReport.openingFloat,
          cashSales: zReport.cashSales,
          cashRefunds: zReport.cashRefunds,
          cashIn: zReport.cashIn,
          cashOut: zReport.cashOut,
          paidOut: zReport.paidOut,
          safeDropsTotal: zReport.safeDropsTotal,
          expectedCash: zReport.expectedClosingCash,
          ...(shift.status === 'CLOSED' ? { countedCash: shift.countedCash, variance, variancePct } : {}),
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
      type: m.type, // CASH_IN | CASH_OUT | PAID_OUT | SAFE_DROP
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
      cashMovements: countOf('CASH_IN', 'CASH_OUT', 'PAID_OUT', 'SAFE_DROP'),
    },
    transactions: paged,
    page: pageNum,
    limit: pageSize,
  };
}

module.exports = {
  shiftInclude,
  getOpenShiftForUser,
  getOpenShiftForBranch,
  getActiveTills,
  openShift,
  recordCashMovement,
  computeExpectedCash,
  endShift,
  closeShift,
  reopenShift,
  getShiftReport,
  getShiftTransactions,
  backfillZReport,
};
