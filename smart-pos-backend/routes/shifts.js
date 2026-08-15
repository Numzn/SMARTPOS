const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const {
  shiftInclude,
  getOpenShiftForUser,
  getOpenShiftForBranch,
  openShift,
  recordCashMovement,
  endShift,
  closeShift,
  reopenShift,
  getShiftReport,
  getShiftTransactions,
} = require('../lib/shift');
const { authenticateToken, requirePermission, requireAnyPermission } = require('../middleware/auth');
const { DEFAULT_BRANCH } = require('../lib/inventoryStock');
const auditService = require('../services/auditService');

// Cash figures a viewer without shifts:viewExpected/shifts:viewVariance must
// never see, on their own shift or anyone else's — this is the field-level
// half of the segregation-of-duties boundary (the route-level half is the
// permission gate on each handler below). Movement totals (cashSales,
// cashIn, etc.) are left in: the operating cashier already knows those,
// they entered them.
function stripCashFigures(cash, permissions) {
  if (!cash) return cash;
  const next = { ...cash };
  if (!permissions.includes('shifts:viewExpected')) {
    delete next.expectedCash;
    delete next.countedCash;
  }
  if (!permissions.includes('shifts:viewVariance')) {
    delete next.variance;
    delete next.variancePct;
  }
  return next;
}

function stripShiftFigures(shift, permissions) {
  const next = { ...shift };
  if (!permissions.includes('shifts:viewExpected')) {
    delete next.expectedCash;
    delete next.countedCash;
  }
  if (!permissions.includes('shifts:viewVariance')) {
    delete next.variance;
  }
  return next;
}

// A caller may reach their own shift via shifts:operate (ownership required),
// any shift via shifts:viewAll / shifts:reconcile (reconcile because the
// pending-reconciliation queue needs to inspect a shift before closing it),
// or — a Cashier, shifts:recordMovement only — the branch's currently active
// shift (OPEN or PENDING_RECONCILIATION), never arbitrary history.
const CAN_VIEW_ANY = ['shifts:viewAll', 'shifts:reconcile'];

function canViewShift(shift, req) {
  if (CAN_VIEW_ANY.some((p) => req.user.permissions.includes(p))) return true;
  if (req.user.permissions.includes('shifts:operate') && shift.userId === req.user.userId) return true;
  if (
    req.user.permissions.includes('shifts:recordMovement') &&
    shift.branchId === req.user.branchId &&
    ['OPEN', 'PENDING_RECONCILIATION'].includes(shift.status)
  ) {
    return true;
  }
  return false;
}

/**
 * GET /api/shifts/current — the requesting user's currently open shift
 * (shifts:operate holders — Supervisor/Manager/Admin, who each open their
 * own), or the branch's currently active shift (shifts:recordMovement only
 * — Cashier, who never opens one themselves).
 */
router.get(
  '/current',
  authenticateToken,
  requireAnyPermission('shifts:operate', 'shifts:recordMovement'),
  async (req, res) => {
    try {
      const branchId = req.query.branchId || req.user.branchId || DEFAULT_BRANCH;
      const shift = req.user.permissions.includes('shifts:operate')
        ? await getOpenShiftForUser(req.user.userId, branchId)
        : await getOpenShiftForBranch(branchId);
      if (!shift) {
        return res.status(404).json({ error: 'No open shift for this user' });
      }
      res.json(stripShiftFigures(shift, req.user.permissions));
    } catch (error) {
      console.error('Error fetching current shift:', error);
      res.status(500).json({ error: 'Failed to fetch current shift' });
    }
  }
);

/**
 * GET /api/shifts — list shifts.
 *
 * shifts:viewAll sees the full store-wide list with whatever filters are
 * supplied. shifts:reconcile alone (no viewAll) only ever sees the
 * reconciliation queue — status is forced to PENDING_RECONCILIATION and
 * every other filter is ignored, so a Supervisor can't widen this into a
 * general shift browser just by adding query params.
 */
router.get(
  '/',
  authenticateToken,
  requireAnyPermission('shifts:viewAll', 'shifts:reconcile'),
  async (req, res) => {
    try {
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));

      const canViewAll = req.user.permissions.includes('shifts:viewAll');
      const where = {};
      if (canViewAll) {
        if (req.query.branchId) where.branchId = req.query.branchId;
        if (req.query.status) where.status = req.query.status;
        if (req.query.userId) where.userId = req.query.userId;
      } else {
        where.status = 'PENDING_RECONCILIATION';
      }

      const [shifts, total] = await Promise.all([
        prisma.shift.findMany({
          where,
          include: shiftInclude,
          orderBy: { openedAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.shift.count({ where }),
      ]);

      res.json({
        shifts: shifts.map((s) => stripShiftFigures(s, req.user.permissions)),
        total,
        page,
        limit,
      });
    } catch (error) {
      console.error('Error listing shifts:', error);
      res.status(500).json({ error: 'Failed to list shifts' });
    }
  }
);

/**
 * POST /api/shifts/open — open a till session for the requesting cashier.
 */
router.post('/open', authenticateToken, requirePermission('shifts:operate'), async (req, res) => {
  try {
    const branchId = req.body.branchId || DEFAULT_BRANCH;
    const shift = await openShift({
      userId: req.user.userId,
      branchId,
      openingFloat: req.body.openingFloat,
      notes: req.body.notes,
    });

    auditService.safeLog(auditService.eventTypes.SHIFT_OPEN, {
      ...auditService.contextFromReq(req),
      entityType: 'SHIFT',
      entityId: shift.id,
      action: 'OPEN',
      newValues: { openingFloat: shift.openingFloat, branchId: shift.branchId },
      description: `Shift opened by ${req.user.email || req.user.userId} at branch ${branchId}`,
    });

    res.status(201).json(shift);
  } catch (error) {
    console.error('Error opening shift:', error);
    res.status(error.status || 500).json({ error: error.message || 'Failed to open shift' });
  }
});

/**
 * GET /api/shifts/:id — a single shift with its cash movements.
 */
router.get(
  '/:id',
  authenticateToken,
  requireAnyPermission('shifts:operate', 'shifts:recordMovement', 'shifts:viewAll', 'shifts:reconcile'),
  async (req, res) => {
    try {
      const shift = await prisma.shift.findUnique({ where: { id: req.params.id }, include: shiftInclude });
      if (!shift) {
        return res.status(404).json({ error: 'Shift not found' });
      }
      if (!canViewShift(shift, req)) {
        return res.status(403).json({ error: 'Access denied' });
      }
      res.json(stripShiftFigures(shift, req.user.permissions));
    } catch (error) {
      console.error('Error fetching shift:', error);
      res.status(500).json({ error: 'Failed to fetch shift' });
    }
  }
);

/**
 * GET /api/shifts/:id/report — X-report (open/pending) or Z-report (closed).
 * expectedCash/countedCash/variance are stripped for a caller lacking
 * shifts:viewExpected/shifts:viewVariance — including the cashier viewing
 * their own shift, which is the whole point of this endpoint's redesign.
 */
router.get(
  '/:id/report',
  authenticateToken,
  requireAnyPermission('shifts:operate', 'shifts:recordMovement', 'shifts:viewAll', 'shifts:reconcile'),
  async (req, res) => {
    try {
      const shift = await prisma.shift.findUnique({ where: { id: req.params.id } });
      if (!shift) {
        return res.status(404).json({ error: 'Shift not found' });
      }
      if (!canViewShift(shift, req)) {
        return res.status(403).json({ error: 'Access denied' });
      }
      const report = await getShiftReport(req.params.id);
      report.cash = stripCashFigures(report.cash, req.user.permissions);
      res.json(report);
    } catch (error) {
      console.error('Error building shift report:', error);
      res.status(error.status || 500).json({ error: error.message || 'Failed to build shift report' });
    }
  }
);

/**
 * GET /api/shifts/:id/transactions — the Shift Transaction Journal: every
 * sale, refund, cancellation and cash movement in the shift, chronologically.
 * No expected/variance figures live here, so no field stripping is needed —
 * only the same view-access rule as the report/detail endpoints.
 */
router.get(
  '/:id/transactions',
  authenticateToken,
  requireAnyPermission('shifts:operate', 'shifts:recordMovement', 'shifts:viewAll', 'shifts:reconcile'),
  async (req, res) => {
    try {
      const shift = await prisma.shift.findUnique({ where: { id: req.params.id } });
      if (!shift) {
        return res.status(404).json({ error: 'Shift not found' });
      }
      if (!canViewShift(shift, req)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const journal = await getShiftTransactions(req.params.id, {
        search: req.query.search,
        type: req.query.type,
        sort: req.query.sort,
        page: req.query.page,
        limit: req.query.limit,
      });
      res.json(journal);
    } catch (error) {
      console.error('Error building shift transaction journal:', error);
      res.status(error.status || 500).json({ error: error.message || 'Failed to build transaction journal' });
    }
  }
);

// A cash movement may be recorded by: the shift's owner (Supervisor/Manager/
// Admin working their own till, shifts:operate), a Cashier
// (shifts:recordMovement) acting on the branch's OPEN shift regardless of
// who opened it — this is the whole point of the split, a Cashier who never
// opens a shift still needs to record cash-in/out/paid-out on the till
// they're actually working — or shifts:viewAll as a store-wide override.
function canRecordMovement(shift, req) {
  if (shift.userId === req.user.userId) return true;
  if (req.user.permissions.includes('shifts:viewAll')) return true;
  if (req.user.permissions.includes('shifts:recordMovement') && shift.branchId === req.user.branchId) return true;
  return false;
}

function handleCashMovement(type) {
  return async (req, res) => {
    try {
      const shift = await prisma.shift.findUnique({ where: { id: req.params.id } });
      if (!shift) {
        return res.status(404).json({ error: 'Shift not found' });
      }
      if (!canRecordMovement(shift, req)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const updated = await recordCashMovement(req.params.id, {
        type,
        amount: req.body.amount,
        reason: req.body.reason,
        userId: req.user.userId,
      });

      auditService.safeLog(auditService.eventTypes.CASH_MOVEMENT, {
        ...auditService.contextFromReq(req),
        entityType: 'SHIFT',
        entityId: req.params.id,
        action: type,
        newValues: { amount: req.body.amount, reason: req.body.reason || null },
        description: `${type} of ${req.body.amount} recorded on shift ${req.params.id}`,
      });

      res.json(stripShiftFigures(updated, req.user.permissions));
    } catch (error) {
      console.error(`Error recording ${type}:`, error);
      res.status(error.status || 500).json({ error: error.message || 'Failed to record cash movement' });
    }
  };
}

const canOperateOrRecordMovement = requireAnyPermission('shifts:operate', 'shifts:recordMovement');
router.post('/:id/cash-in', authenticateToken, canOperateOrRecordMovement, handleCashMovement('CASH_IN'));
router.post('/:id/cash-out', authenticateToken, canOperateOrRecordMovement, handleCashMovement('CASH_OUT'));
router.post('/:id/paid-out', authenticateToken, canOperateOrRecordMovement, handleCashMovement('PAID_OUT'));

/**
 * POST /api/shifts/:id/end — cashier's "I'm done" action. Locks the drawer,
 * hands it off for reconciliation, exposes no financial figures. This is
 * the only self-service action available once a cashier is finished — they
 * cannot close/reconcile their own shift (see POST /:id/close below).
 */
router.post('/:id/end', authenticateToken, requirePermission('shifts:operate'), async (req, res) => {
  try {
    const shift = await prisma.shift.findUnique({ where: { id: req.params.id } });
    if (!shift) {
      return res.status(404).json({ error: 'Shift not found' });
    }
    // Ownership only, with a shifts:reconcile override for a supervisor
    // force-ending a shift its cashier forgot to end.
    if (shift.userId !== req.user.userId && !req.user.permissions.includes('shifts:reconcile')) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const ended = await endShift(req.params.id, { userId: req.user.userId });

    auditService.safeLog(auditService.eventTypes.SHIFT_CLOSE, {
      ...auditService.contextFromReq(req),
      entityType: 'SHIFT',
      entityId: ended.id,
      action: 'END',
      description: `Shift ${ended.id} ended by ${req.user.email || req.user.userId}, awaiting reconciliation`,
    });

    // No expectedCash/countedCash/variance to strip — endShift() never
    // computes or stores them — but stripShiftFigures is still applied for
    // consistency with every other shift-shaped response.
    res.json(stripShiftFigures(ended, req.user.permissions));
  } catch (error) {
    console.error('Error ending shift:', error);
    res.status(error.status || 500).json({ error: error.message || 'Failed to end shift' });
  }
});

/**
 * POST /api/shifts/:id/close — count the drawer, compute variance, close
 * the shift. This is the reconciliation action: shifts:reconcile only, and
 * the reconciler can never be the shift's own owner (hard-enforced in
 * lib/shift.js:closeShift, independent of permissions — see SELF_RECONCILE_DENIED).
 */
router.post('/:id/close', authenticateToken, requirePermission('shifts:reconcile'), async (req, res) => {
  try {
    const closed = await closeShift(req.params.id, {
      countedCash: req.body.countedCash,
      reconcilerUserId: req.user.userId,
      notes: req.body.notes,
    });

    auditService.safeLog(auditService.eventTypes.SHIFT_CLOSE, {
      ...auditService.contextFromReq(req),
      entityType: 'SHIFT',
      entityId: closed.id,
      action: 'CLOSE',
      newValues: {
        countedCash: closed.countedCash,
        expectedCash: closed.expectedCash,
        variance: closed.variance,
      },
      description: `Shift ${closed.id} reconciled by ${req.user.email || req.user.userId} — variance ${closed.variance}`,
      riskLevel: Math.abs(closed.variance || 0) > 0 ? 'MEDIUM' : 'LOW',
    });

    res.json(closed);
  } catch (error) {
    if (error.code === 'SELF_RECONCILE_DENIED') {
      auditService.safeLog(auditService.eventTypes.PERMISSION_DENIED, {
        ...auditService.contextFromReq(req),
        entityType: 'SHIFT',
        entityId: req.params.id,
        description: 'Blocked self-reconciliation attempt',
        success: false,
      });
    }
    console.error('Error closing shift:', error);
    res.status(error.status || 500).json({ error: error.message || 'Failed to close shift' });
  }
});

/**
 * POST /api/shifts/:id/reopen — Manager+ override for a shift closed in
 * error. Not available to Supervisor (shifts:reconcile does not imply
 * shifts:reopen) — reopening is a step up from reconciling, not part of it.
 */
router.post('/:id/reopen', authenticateToken, requirePermission('shifts:reopen'), async (req, res) => {
  try {
    const reopened = await reopenShift(req.params.id, { notes: req.body.notes });

    auditService.safeLog(auditService.eventTypes.SHIFT_CLOSE, {
      ...auditService.contextFromReq(req),
      entityType: 'SHIFT',
      entityId: reopened.id,
      action: 'REOPEN',
      description: `Shift ${reopened.id} reopened by ${req.user.email || req.user.userId}`,
      riskLevel: 'MEDIUM',
    });

    res.json(reopened);
  } catch (error) {
    console.error('Error reopening shift:', error);
    res.status(error.status || 500).json({ error: error.message || 'Failed to reopen shift' });
  }
});

module.exports = router;
