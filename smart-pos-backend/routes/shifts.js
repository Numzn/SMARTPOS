const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const {
  shiftInclude,
  getOpenShiftForUser,
  openShift,
  recordCashMovement,
  closeShift,
  getShiftReport,
  getShiftTransactions,
} = require('../lib/shift');
const { authenticateToken, requirePermission, requireAnyPermission } = require('../middleware/auth');
const { DEFAULT_BRANCH } = require('../lib/inventoryStock');
const auditService = require('../services/auditService');

/**
 * GET /api/shifts/current — the requesting user's currently open shift, if any.
 */
router.get('/current', authenticateToken, requirePermission('shifts:write'), async (req, res) => {
  try {
    const branchId = req.query.branchId || DEFAULT_BRANCH;
    const shift = await getOpenShiftForUser(req.user.userId, branchId);
    if (!shift) {
      return res.status(404).json({ error: 'No open shift for this user' });
    }
    res.json(shift);
  } catch (error) {
    console.error('Error fetching current shift:', error);
    res.status(500).json({ error: 'Failed to fetch current shift' });
  }
});

/**
 * GET /api/shifts — list shifts (manager/admin oversight), most recent first.
 */
router.get('/', authenticateToken, requirePermission('shifts:read'), async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
    const where = {};
    if (req.query.branchId) where.branchId = req.query.branchId;
    if (req.query.status) where.status = req.query.status;
    if (req.query.userId) where.userId = req.query.userId;

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

    res.json({ shifts, total, page, limit });
  } catch (error) {
    console.error('Error listing shifts:', error);
    res.status(500).json({ error: 'Failed to list shifts' });
  }
});

/**
 * POST /api/shifts/open — open a till session for the requesting cashier.
 */
router.post('/open', authenticateToken, requirePermission('shifts:write'), async (req, res) => {
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
router.get('/:id', authenticateToken, requireAnyPermission('shifts:read', 'shifts:write'), async (req, res) => {
  try {
    const shift = await prisma.shift.findUnique({ where: { id: req.params.id }, include: shiftInclude });
    if (!shift) {
      return res.status(404).json({ error: 'Shift not found' });
    }
    // Cashiers may only view their own shift; managers/admins (shifts:read) see all.
    if (!req.user.permissions.includes('shifts:read') && shift.userId !== req.user.userId) {
      return res.status(403).json({ error: 'Access denied' });
    }
    res.json(shift);
  } catch (error) {
    console.error('Error fetching shift:', error);
    res.status(500).json({ error: 'Failed to fetch shift' });
  }
});

/**
 * GET /api/shifts/:id/report — X-report (open) or Z-report (closed).
 */
router.get(
  '/:id/report',
  authenticateToken,
  requireAnyPermission('shifts:read', 'shifts:write'),
  async (req, res) => {
    try {
      const shift = await prisma.shift.findUnique({ where: { id: req.params.id } });
      if (!shift) {
        return res.status(404).json({ error: 'Shift not found' });
      }
      if (!req.user.permissions.includes('shifts:read') && shift.userId !== req.user.userId) {
        return res.status(403).json({ error: 'Access denied' });
      }
      const report = await getShiftReport(req.params.id);
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
 * Same access rule as the report: a cashier may inspect their own shift,
 * shifts:read sees any.
 */
router.get(
  '/:id/transactions',
  authenticateToken,
  requireAnyPermission('shifts:read', 'shifts:write'),
  async (req, res) => {
    try {
      const shift = await prisma.shift.findUnique({ where: { id: req.params.id } });
      if (!shift) {
        return res.status(404).json({ error: 'Shift not found' });
      }
      if (!req.user.permissions.includes('shifts:read') && shift.userId !== req.user.userId) {
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

function handleCashMovement(type) {
  return async (req, res) => {
    try {
      const shift = await prisma.shift.findUnique({ where: { id: req.params.id } });
      if (!shift) {
        return res.status(404).json({ error: 'Shift not found' });
      }
      if (shift.userId !== req.user.userId && !req.user.permissions.includes('shifts:read')) {
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

      res.json(updated);
    } catch (error) {
      console.error(`Error recording ${type}:`, error);
      res.status(error.status || 500).json({ error: error.message || 'Failed to record cash movement' });
    }
  };
}

router.post('/:id/cash-in', authenticateToken, requirePermission('shifts:write'), handleCashMovement('CASH_IN'));
router.post('/:id/cash-out', authenticateToken, requirePermission('shifts:write'), handleCashMovement('CASH_OUT'));
router.post('/:id/paid-out', authenticateToken, requirePermission('shifts:write'), handleCashMovement('PAID_OUT'));

/**
 * POST /api/shifts/:id/close — count the drawer, compute variance, close the shift.
 */
router.post('/:id/close', authenticateToken, requirePermission('shifts:write'), async (req, res) => {
  try {
    const shift = await prisma.shift.findUnique({ where: { id: req.params.id } });
    if (!shift) {
      return res.status(404).json({ error: 'Shift not found' });
    }
    if (shift.userId !== req.user.userId && !req.user.permissions.includes('shifts:read')) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const closed = await closeShift(req.params.id, {
      countedCash: req.body.countedCash,
      userId: req.user.userId,
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
      description: `Shift ${closed.id} closed — variance ${closed.variance}`,
      riskLevel: Math.abs(closed.variance || 0) > 0 ? 'MEDIUM' : 'LOW',
    });

    res.json(closed);
  } catch (error) {
    console.error('Error closing shift:', error);
    res.status(error.status || 500).json({ error: error.message || 'Failed to close shift' });
  }
});

module.exports = router;
