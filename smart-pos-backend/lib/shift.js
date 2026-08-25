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
 * The active (OPEN) shift on a given till, if any — what the Cashier screen
 * checks on load to decide "open a new shift" vs. "someone (maybe me) is
 * already operating this till." Requirement: register/till opening a shift
 * must never silently spawn a second one for the same till.
 */
async function getActiveShiftForTill(tillId) {
  return prisma.shift.findFirst({
    where: { tillId, status: 'OPEN' },
    include: shiftInclude,
  });
}

/**
 * The single, unified "what shift is this user currently operating" answer
 * — requirement: do not maintain two competing current-shift systems.
 *
 * The two ownership concepts are NOT interchangeable, and deliberately
 * scoped so they can never both claim the same shift: a legacy (userId,
 * branchId) shift has no tillId at all, and Shift.userId is its only
 * ownership concept, unchanged from before this model existed. A shift
 * opened via openShiftForTill() always has a tillId, and its current
 * operator is whoever ShiftCashier says — never Shift.userId, which on a
 * till-based shift only ever means "who opened it" and does NOT change on a
 * handover. Checking Shift.userId for a till-based shift would incorrectly
 * keep matching the original opener forever, even after they've handed off
 * — exactly the bug this scoping avoids.
 */
async function getCurrentOperatingShiftForUser(userId, branchId = DEFAULT_BRANCH) {
  const legacy = await prisma.shift.findFirst({
    where: { userId, branchId, status: 'OPEN', tillId: null },
    include: shiftInclude,
  });
  if (legacy) return legacy;

  const currentTurn = await prisma.shiftCashier.findFirst({
    where: { userId, endedAt: null, shift: { status: 'OPEN' } },
    include: { shift: { include: shiftInclude } },
  });
  return currentTurn?.shift ?? null;
}

/**
 * OPEN or INITIALIZING — "does this user currently have an active shift at
 * all," used by ensureShiftForLogin to decide resume-vs-create. Deliberately
 * separate from getOpenShiftForUser (OPEN-only), which other callers rely on
 * meaning "ready to operate," not merely "exists."
 */
async function getActiveShiftForUser(userId, branchId = DEFAULT_BRANCH) {
  return prisma.shift.findFirst({
    where: { userId, branchId, status: { in: ['OPEN', 'INITIALIZING'] } },
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
 * Every currently OPEN or INITIALIZING shift, across all branches — the
 * back-office "Active Tills" view. INITIALIZING rows are included so a
 * cashier stuck on the opening-cash prompt is visible for cancellation (see
 * cancelInitializingShift) rather than invisibly consuming their one active
 * shift slot. Deliberately unfiltered by branch (unlike getOpenShiftForBranch)
 * since a manager overseeing the whole store needs to see every register at
 * once, not just their own branch's.
 */
async function getActiveTills() {
  return prisma.shift.findMany({
    where: { status: { in: ['OPEN', 'INITIALIZING'] } },
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

/**
 * Get-or-create the shift a cashier lands on when they open the till screen
 * with none active — resumes an existing OPEN/INITIALIZING shift, or starts
 * a new one in INITIALIZING (opening cash not yet confirmed; see
 * confirmOpeningCash). This is the one place a shift ever gets created
 * without an explicit manual "open" action.
 *
 * Race-safety is enforced by Postgres, not application locking: the partial
 * unique index `shifts_active_user_branch_key` (see the comment on the Shift
 * model in schema.prisma) guarantees at most one OPEN-or-INITIALIZING row
 * per (userId, branchId), so two near-simultaneous calls (double-click, two
 * tabs, a retried request) can never both succeed at creating one. The loser
 * gets a unique-constraint violation and re-reads instead of erroring — same
 * shape as the P2002 fallback in lib/fiscalInvoiceNumber.js's
 * allocateFiscalInvcNo(), except here there are two *different* unique
 * constraints that can produce that P2002 (the partial index above, or the
 * pre-existing plain uniqueness on shiftNumber — nextSequentialNumber's own
 * scan-and-increment has no in-transaction retry, so two concurrent calls
 * for two *different* users can independently land on the same next
 * number). Rather than parse which constraint fired, just re-check: if an
 * active shift now exists, someone else's create won the race — return it.
 * If not, the collision was on shiftNumber — retry with a freshly allocated
 * one (bounded, so a persistent unrelated failure doesn't loop forever).
 */
async function ensureShiftForLogin(userId, branchId = DEFAULT_BRANCH, attempt = 1) {
  if (!userId) {
    const err = new Error('userId is required');
    err.status = 400;
    throw err;
  }

  const existing = await getActiveShiftForUser(userId, branchId);
  if (existing) return existing;

  try {
    return await prisma.$transaction(async (tx) => {
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
          status: 'INITIALIZING',
        },
        include: shiftInclude,
      });
    });
  } catch (error) {
    if (error.code === 'P2002') {
      // Use the plain `prisma` client, never the aborted `tx` — a failed
      // transaction refuses further queries on the same connection.
      const winner = await getActiveShiftForUser(userId, branchId);
      if (winner) return winner;
      if (attempt < 3) return ensureShiftForLogin(userId, branchId, attempt + 1);
    }
    throw error;
  }
}

/**
 * The cashier confirms the physical cash they counted into the drawer,
 * completing INITIALIZING -> OPEN. openedAt is set here, not at
 * ensureShiftForLogin's creation time, so shift duration and the frozen
 * ZReport's shiftOpenedAt reflect when the till actually started operating —
 * not however long the cashier took to get around to confirming.
 */
async function confirmOpeningCash(shiftId, { userId, openingFloat, notes }) {
  const float = Number(openingFloat);
  if (!Number.isFinite(float) || float < 0) {
    const err = new Error('openingFloat must be a non-negative number');
    err.status = 400;
    throw err;
  }

  const shift = await prisma.shift.findUnique({ where: { id: shiftId } });
  if (!shift) {
    const err = new Error('Shift not found');
    err.status = 404;
    throw err;
  }
  if (shift.status !== 'INITIALIZING') {
    const err = new Error(`Cannot confirm opening cash for a shift with status ${shift.status}`);
    err.status = 409;
    throw err;
  }
  if (shift.userId !== userId) {
    const err = new Error('Only the shift\'s own cashier can confirm its opening cash');
    err.status = 403;
    throw err;
  }

  return prisma.shift.update({
    where: { id: shiftId },
    data: {
      status: 'OPEN',
      openingFloat: float,
      openingNotes: notes || null,
      openedAt: new Date(),
    },
    include: shiftInclude,
  });
}

/**
 * The escape hatch for a shift stuck in INITIALIZING — a cashier who started
 * the opening-cash prompt and never confirmed it (crash, browser closed,
 * transferred branches). Without this, the partial unique index that
 * guarantees race-safety would also permanently lock that user out of ever
 * getting another shift at this branch. Hard-deletes rather than
 * soft-cancelling: nothing meaningful can be attached to an INITIALIZING
 * shift (recordCashMovement already rejects non-OPEN, sale attribution only
 * ever matches status:'OPEN'), so there is nothing to cascade or preserve.
 * The resulting gap in the shiftNumber sequence is fine — same as any
 * rolled-back transaction.
 */
async function cancelInitializingShift(shiftId) {
  const shift = await prisma.shift.findUnique({ where: { id: shiftId } });
  if (!shift) {
    const err = new Error('Shift not found');
    err.status = 404;
    throw err;
  }
  if (shift.status !== 'INITIALIZING') {
    const err = new Error(`Cannot cancel a shift with status ${shift.status}`);
    err.status = 409;
    throw err;
  }

  await prisma.shift.delete({ where: { id: shiftId } });
  return shift;
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

    // V1 register/till model — a shift opened via openShiftForTill() has an
    // open-ended ShiftCashier row for whoever is currently on it; the shift
    // ending means that participation is over too. A no-op for a legacy
    // (userId, branchId) shift, which never has any ShiftCashier rows.
    await tx.shiftCashier.updateMany({
      where: { shiftId, endedAt: null },
      data: { endedAt: totals.shiftEndedAt },
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
 * this point. `reconcilerUserId` must differ from the shift's owner AND
 * from everyone who ever operated it via ShiftCashier (see
 * isShiftParticipant) — a hard invariant, not permission-gated, mirroring
 * SELF_APPROVAL_DENIED in lib/approval.js: a till can never be balanced by
 * anyone who worked it, regardless of what role or permissions that person
 * holds (including ADMIN — segregation of duties is structural, not a
 * privilege check), and regardless of whether they were the original
 * opener or someone it was later handed to.
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
  if (reconcilerUserId === shift.userId || (await isShiftParticipant(shiftId, reconcilerUserId))) {
    const err = new Error('A shift cannot be reconciled by anyone who worked it');
    err.status = 403;
    err.code = 'SELF_RECONCILE_DENIED';
    throw err;
  }

  // shiftId is no longer unique on its own (see the V1 register/till model's
  // OPENING/HANDOVER declaration types) — closeShift() specifically needs
  // the CLOSING one.
  const declaration = await prisma.cashierDeclaration.findFirst({ where: { shiftId, type: 'CLOSING' } });
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

// ---------------------------------------------------------------------------
// V1 register/till model — additive. openShift()/ensureShiftForLogin() above
// are completely untouched and remain the only way the pre-existing
// (userId, branchId) auto-shift flow works; nothing below changes their
// behavior. This is a parallel path: a shift opened here has tillId set and
// carries a ShiftCashier participation history instead of a single fixed
// owner for its whole life.
// ---------------------------------------------------------------------------

/**
 * Opens a shift explicitly against a Till, as opposed to
 * ensureShiftForLogin's implicit per-(user, branch) auto-shift. Records the
 * opening cashier in ShiftCashier and an OPENING CashierDeclaration (the
 * physical count that justified the float) in the same transaction.
 * declaredOpeningCash defaults to the till's own configured
 * defaultOpeningFloat when omitted — never a global business-wide default
 * (requirement: each register/till can have its own).
 *
 * Race-safety is enforced by Postgres, not application locking, same
 * pattern as ensureShiftForLogin above: the partial unique index
 * `shifts_active_till_key` (see the comment on the Shift model in
 * schema.prisma) guarantees at most one OPEN-or-INITIALIZING row per
 * tillId, so two near-simultaneous opens for the same till (double-click,
 * two devices resolving to the same till) can never both succeed. The
 * pre-check below (existingForTill) exists only to fail fast with a
 * friendly error in the common case — it is NOT the concurrency guarantee,
 * since it runs before the transaction and two callers can both pass it.
 * The database is the final authority: a loser gets a P2002 unique-
 * constraint violation, and the catch block re-checks which constraint
 * fired — same two-constraint ambiguity as ensureShiftForLogin (this
 * index, or the pre-existing plain uniqueness on shiftNumber) — surfacing
 * the same business error the pre-check would have given, or retrying on a
 * freshly allocated shiftNumber.
 */
async function openShiftForTill({ tillId, userId, declaredOpeningCash, denominations, notes }, attempt = 1) {
  if (!tillId) {
    const err = new Error('tillId is required');
    err.status = 400;
    throw err;
  }
  if (!userId) {
    const err = new Error('userId is required');
    err.status = 400;
    throw err;
  }

  const till = await prisma.till.findUnique({ where: { id: tillId }, include: { register: true } });
  if (!till) {
    const err = new Error('Till not found');
    err.status = 404;
    throw err;
  }
  if (!till.isActive) {
    const err = new Error('This till is not active');
    err.status = 409;
    throw err;
  }

  const existingForTill = await prisma.shift.findFirst({
    where: { tillId, status: { in: ['OPEN', 'INITIALIZING'] } },
  });
  if (existingForTill) {
    const err = new Error('This till already has an active shift — use handover, not a new open');
    err.status = 409;
    err.code = 'TILL_ALREADY_HAS_ACTIVE_SHIFT';
    throw err;
  }

  const declared = declaredOpeningCash != null ? Number(declaredOpeningCash) : till.defaultOpeningFloat;
  if (!Number.isFinite(declared) || declared < 0) {
    const err = new Error('declaredOpeningCash must be a non-negative number');
    err.status = 400;
    throw err;
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const shiftNumber = await nextSequentialNumber(tx, {
        model: 'shift',
        field: 'shiftNumber',
        prefix: 'SHIFT',
      });

      const shift = await tx.shift.create({
        data: {
          shiftNumber,
          userId,
          branchId: till.register.branchId,
          tillId,
          openingFloat: declared,
          openingNotes: notes || null,
        },
        include: shiftInclude,
      });

      await tx.shiftCashier.create({ data: { shiftId: shift.id, userId } });

      await tx.cashierDeclaration.create({
        data: {
          shiftId: shift.id,
          type: 'OPENING',
          declaredByUserId: userId,
          declaredTotal: declared,
          denominations: denominations ?? null,
        },
      });

      return shift;
    });
  } catch (error) {
    if (error.code === 'P2002') {
      // Use the plain `prisma` client, never the aborted `tx` — a failed
      // transaction refuses further queries on the same connection.
      const stillActive = await prisma.shift.findFirst({
        where: { tillId, status: { in: ['OPEN', 'INITIALIZING'] } },
      });
      if (stillActive) {
        const err = new Error('This till already has an active shift — use handover, not a new open');
        err.status = 409;
        err.code = 'TILL_ALREADY_HAS_ACTIVE_SHIFT';
        throw err;
      }
      // The tillId index didn't fire — the collision was on shiftNumber
      // instead (two concurrent opens for two different tills independently
      // landing on the same next number). Retry with a freshly allocated
      // one (bounded, so a persistent unrelated failure doesn't loop forever).
      if (attempt < 3) {
        return openShiftForTill({ tillId, userId, declaredOpeningCash, denominations, notes }, attempt + 1);
      }
    }
    throw error;
  }
}

/**
 * The currently-active cashier for a shift — the ShiftCashier row with no
 * endedAt yet. Null for a shift opened through the legacy (userId, branchId)
 * flow, which never creates ShiftCashier rows at all.
 */
async function getCurrentShiftCashier(shiftId) {
  return prisma.shiftCashier.findFirst({
    where: { shiftId, endedAt: null },
    include: { user: { select: { id: true, name: true, email: true } } },
  });
}

/**
 * The operator-of-record for authorization purposes — the most recent
 * ShiftCashier row for this shift, whether or not it has ended yet. While a
 * shift is OPEN this is always the one active turn (same row
 * getCurrentShiftCashier above would find), since at most one row may have
 * endedAt: null at a time. Once the shift ends, endShift() closes out every
 * open turn — at that point this still correctly names whoever was
 * operating it right before it ended, which is exactly who's authorized to
 * submit its closing declaration. Null only for a legacy (userId, branchId)
 * shift, which never creates ShiftCashier rows at all.
 */
async function getOperatingCashier(shiftId) {
  return prisma.shiftCashier.findFirst({
    where: { shiftId },
    orderBy: { startedAt: 'desc' },
    include: { user: { select: { id: true, name: true, email: true } } },
  });
}

/**
 * The single, centralized "is this user authorized to perform cashier
 * operations on this shift" check. Cash movements, ending the shift, and
 * submitting its closing declaration all defer to this rather than each
 * re-deriving their own notion of ownership — see routes/shifts.js and
 * lib/cashierDeclaration.js. A till-based shift (opened via
 * openShiftForTill) is authorized by getOperatingCashier() above, NOT by
 * Shift.userId: after a handover, the original opener is no longer the one
 * allowed to touch it. A legacy (userId, branchId) shift has no
 * ShiftCashier history at all — for that case only, Shift.userId is the
 * sole authority, same as before this model existed.
 */
async function isAuthorizedCashier(shift, userId) {
  if (!userId) return false;
  const operating = await getOperatingCashier(shift.id);
  if (operating) return operating.userId === userId;
  return shift.userId === userId;
}

/**
 * Has this user ever operated this shift at all — every ShiftCashier turn,
 * active or ended, not just the current one. Backs SELF_RECONCILE_DENIED in
 * closeShift(): segregation of duties means nobody who worked a shift (the
 * opener, or anyone it was handed to) may be the one who reconciles it,
 * regardless of whether they're still the current operator. A till-based
 * shift's opener always has their own ShiftCashier row (created by
 * openShiftForTill), so this alone covers them too — the separate
 * Shift.userId check in closeShift exists only for the legacy shift case,
 * which never creates ShiftCashier rows at all.
 */
async function isShiftParticipant(shiftId, userId) {
  if (!userId) return false;
  const turn = await prisma.shiftCashier.findFirst({ where: { shiftId, userId }, select: { id: true } });
  return Boolean(turn);
}

/**
 * One cashier hands the till to another without closing the shift.
 * Records a HANDOVER CashierDeclaration (declared vs. computeExpectedCash()
 * at this moment, not the frozen ZReport — that doesn't exist until the
 * shift actually ends), closes the outgoing ShiftCashier row, opens a new
 * one for the incoming cashier. Shift.status and Shift.userId are both
 * untouched — only endShift()/closeShift() ever move status off OPEN, and
 * userId keeps meaning "who opened it," never reassigned.
 */
async function handoverShift(shiftId, { fromUserId, toUserId, declaredTotal, denominations, note }) {
  if (!toUserId) {
    const err = new Error('toUserId is required');
    err.status = 400;
    throw err;
  }
  const total = Number(declaredTotal);
  if (!Number.isFinite(total) || total < 0) {
    const err = new Error('declaredTotal must be a non-negative number');
    err.status = 400;
    throw err;
  }
  if (toUserId === fromUserId) {
    const err = new Error('Cannot hand over a shift to the same cashier');
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
    const err = new Error(`Cannot hand over a shift with status ${shift.status}`);
    err.status = 409;
    throw err;
  }

  const current = await getCurrentShiftCashier(shiftId);
  if (!current) {
    const err = new Error('This shift has no current cashier on record — it was not opened through a till');
    err.status = 409;
    err.code = 'NO_ACTIVE_SHIFT_CASHIER';
    throw err;
  }
  if (current.userId !== fromUserId) {
    const err = new Error('Only the cashier currently on this shift can hand it over');
    err.status = 403;
    throw err;
  }

  // computeExpectedCash returns the full breakdown object, not a bare
  // number — same shape used everywhere else (getShiftReport, ZReport).
  const { expectedCash } = await computeExpectedCash(shiftId);

  return prisma.$transaction(async (tx) => {
    await tx.shiftCashier.update({
      where: { id: current.id },
      data: { endedAt: new Date(), note: note || null },
    });

    const nextTurn = await tx.shiftCashier.create({ data: { shiftId, userId: toUserId } });

    const declaration = await tx.cashierDeclaration.create({
      data: {
        shiftId,
        type: 'HANDOVER',
        declaredByUserId: fromUserId,
        declaredTotal: total,
        denominations: denominations ?? null,
      },
    });

    return {
      declaration: {
        ...declaration,
        expectedCash: round2(expectedCash),
        variance: round2(total - expectedCash),
      },
      shiftCashier: nextTurn,
    };
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
  getActiveShiftForUser,
  getOpenShiftForBranch,
  getActiveTills,
  openShift,
  ensureShiftForLogin,
  confirmOpeningCash,
  cancelInitializingShift,
  recordCashMovement,
  computeExpectedCash,
  endShift,
  closeShift,
  reopenShift,
  getShiftReport,
  getShiftTransactions,
  backfillZReport,
  openShiftForTill,
  getCurrentShiftCashier,
  getOperatingCashier,
  isAuthorizedCashier,
  isShiftParticipant,
  handoverShift,
  getActiveShiftForTill,
  getCurrentOperatingShiftForUser,
};
