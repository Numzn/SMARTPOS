const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const {
  shiftInclude,
  getOpenShiftForUser,
  getOpenShiftForBranch,
  getActiveTills,
  openShift,
  ensureShiftForLogin,
  confirmOpeningCash,
  cancelInitializingShift,
  recordCashMovement,
  endShift,
  closeShift,
  reopenShift,
  getShiftReport,
  getShiftTransactions,
} = require('../lib/shift');
const { submitDeclaration } = require('../lib/cashierDeclaration');
const { createAdjustment, listAdjustments } = require('../lib/shiftAdjustment');
const { authenticateToken, requirePermission, requireAnyPermission } = require('../middleware/auth');
const { DEFAULT_BRANCH } = require('../lib/inventoryStock');
const auditService = require('../services/auditService');

const round2 = (n) => parseFloat((n || 0).toFixed(2));

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
// or — shifts:recordMovement only — the branch's currently active shift
// (OPEN or PENDING_RECONCILIATION), never arbitrary history.
const CAN_VIEW_ANY = ['shifts:viewAll', 'shifts:reconcile'];

function canViewShift(shift, req) {
  if (CAN_VIEW_ANY.some((p) => req.user.permissions.includes(p))) return true;
  if (
    req.user.permissions.includes('shifts:operate') &&
    shift.userId === req.user.userId &&
    ['OPEN', 'PENDING_RECONCILIATION'].includes(shift.status)
  ) {
    return true;
  }
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
 * (shifts:operate holders open their own), or the branch's currently active
 * shift (shifts:recordMovement only — a role that acts on a till without
 * ever opening one itself).
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
 * GET /api/shifts/active-tills — every currently OPEN or INITIALIZING shift,
 * store-wide. The back office's "Active Tills" view. Registered before
 * GET /:id so this fixed path can never be shadowed by the :id wildcard.
 */
router.get('/active-tills', authenticateToken, requirePermission('shifts:viewAll'), async (req, res) => {
  try {
    const shifts = await getActiveTills();
    res.json({ shifts: shifts.map((s) => stripShiftFigures(s, req.user.permissions)) });
  } catch (error) {
    console.error('Error listing active tills:', error);
    res.status(500).json({ error: 'Failed to list active tills' });
  }
});

/**
 * GET /api/shifts — list shifts.
 *
 * shifts:viewAll sees the full store-wide list with whatever filters are
 * supplied. shifts:reconcile alone (no viewAll) only ever sees the
 * reconciliation queue — status is forced to PENDING_RECONCILIATION and
 * every other filter is ignored, so a Supervisor can't widen this into a
 * general shift browser just by adding query params.
 *
 * PENDING_RECONCILIATION rows additionally carry zNumber/hasDeclaration (and,
 * for a viewer with shifts:viewExpected/viewVariance, a declared-total/
 * variance preview) so the back office can visually separate "awaiting
 * declaration" from "declared, awaiting manager review" without a
 * round-trip per row.
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

      const shiftIds = shifts.map((s) => s.id);
      const [declarations, zReports] = await Promise.all([
        shiftIds.length
          ? prisma.cashierDeclaration.findMany({ where: { shiftId: { in: shiftIds } } })
          : Promise.resolve([]),
        shiftIds.length
          ? prisma.zReport.findMany({
              where: { shiftId: { in: shiftIds } },
              select: { shiftId: true, zNumber: true, expectedClosingCash: true },
            })
          : Promise.resolve([]),
      ]);
      const declByShift = new Map(declarations.map((d) => [d.shiftId, d]));
      const zByShift = new Map(zReports.map((z) => [z.shiftId, z]));
      const canViewExpected = req.user.permissions.includes('shifts:viewExpected');
      const canViewVariance = req.user.permissions.includes('shifts:viewVariance');

      res.json({
        shifts: shifts.map((s) => {
          const decl = declByShift.get(s.id);
          const z = zByShift.get(s.id);
          return {
            ...stripShiftFigures(s, req.user.permissions),
            zNumber: z?.zNumber ?? null,
            hasDeclaration: !!decl,
            declaration:
              decl && canViewExpected
                ? {
                    declaredTotal: decl.declaredTotal,
                    declaredAt: decl.declaredAt,
                    variance: canViewVariance && z ? round2(decl.declaredTotal - z.expectedClosingCash) : undefined,
                  }
                : null,
          };
        }),
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
 * POST /api/shifts/open — open a till for the requesting user.
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
 * POST /api/shifts/ensure — get-or-create the caller's active shift. This is
 * what a cashier's till screen calls on load instead of a manual "Open
 * Shift" button: resumes an existing OPEN/INITIALIZING shift, or starts a
 * new INITIALIZING one awaiting an opening-cash confirmation (see
 * POST /:id/confirm-opening). Race-safe via a DB-level partial unique index,
 * not application locking — see ensureShiftForLogin's own doc comment.
 */
router.post('/ensure', authenticateToken, requirePermission('shifts:operate'), async (req, res) => {
  try {
    const branchId = req.body?.branchId || DEFAULT_BRANCH;
    const shift = await ensureShiftForLogin(req.user.userId, branchId);
    res.status(200).json(shift);
  } catch (error) {
    console.error('Error ensuring shift:', error);
    res.status(error.status || 500).json({ error: error.message || 'Failed to start shift' });
  }
});

/**
 * POST /api/shifts/:id/confirm-opening — completes INITIALIZING -> OPEN with
 * the cashier's physically-counted opening cash. Ownership-enforced inside
 * confirmOpeningCash (only the shift's own cashier). Logged as SHIFT_OPEN —
 * this is the moment the shift actually becomes usable, same event the old
 * one-step POST /open flow always logged.
 */
router.post('/:id/confirm-opening', authenticateToken, requirePermission('shifts:operate'), async (req, res) => {
  try {
    const shift = await confirmOpeningCash(req.params.id, {
      userId: req.user.userId,
      openingFloat: req.body.openingFloat,
      notes: req.body.notes,
    });

    auditService.safeLog(auditService.eventTypes.SHIFT_OPEN, {
      ...auditService.contextFromReq(req),
      entityType: 'SHIFT',
      entityId: shift.id,
      action: 'OPEN',
      newValues: { openingFloat: shift.openingFloat, branchId: shift.branchId },
      description: `Opening cash confirmed by ${req.user.email || req.user.userId} for shift ${shift.shiftNumber}`,
    });

    res.status(200).json(shift);
  } catch (error) {
    console.error('Error confirming opening cash:', error);
    res.status(error.status || 500).json({ error: error.message || 'Failed to confirm opening cash' });
  }
});

/**
 * POST /api/shifts/:id/cancel-initialization — the escape hatch for a shift
 * stuck awaiting opening-cash confirmation (crash, abandoned browser,
 * transferred branches). shifts:reopen-gated, same back-office-override tier
 * as reopenShift — a cashier can never cancel their own stuck shift, only
 * request a new opening-cash prompt by returning to the till, which
 * ensureShiftForLogin will correctly resume rather than duplicate.
 */
router.post('/:id/cancel-initialization', authenticateToken, requirePermission('shifts:reopen'), async (req, res) => {
  try {
    const shift = await cancelInitializingShift(req.params.id);

    auditService.safeLog(auditService.eventTypes.SHIFT_INITIALIZATION_CANCELLED, {
      ...auditService.contextFromReq(req),
      entityType: 'SHIFT',
      entityId: shift.id,
      action: 'CANCEL_INITIALIZATION',
      description: `Stuck shift ${shift.shiftNumber} (INITIALIZING) cancelled by ${req.user.email || req.user.userId}`,
    });

    res.status(200).json({ cancelled: true, shiftId: shift.id });
  } catch (error) {
    console.error('Error cancelling initializing shift:', error);
    res.status(error.status || 500).json({ error: error.message || 'Failed to cancel shift' });
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
 * GET /api/shifts/:id/report — X-report (still OPEN, no ZReport yet) or the
 * frozen Z figures (PENDING_RECONCILIATION/CLOSED — see lib/shift.js's
 * getShiftReport, which prefers the ZReport once one exists). Field-stripped
 * the same as everywhere else in this file.
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
 * GET /api/shifts/:id/z-report — the immutable ZReport row itself, in full
 * (every field the Z froze — safe drops, sales-by-method, etc., not just the
 * summary shape GET /:id/report returns). shifts:viewExpected-gated — the
 * shift's own cashier never sees this, same segregation of duties as
 * everywhere else; they only ever see the operational "Z-000184 generated"
 * confirmation from POST /:id/end's response, never the figures.
 */
router.get('/:id/z-report', authenticateToken, requirePermission('shifts:viewExpected'), async (req, res) => {
  try {
    const shift = await prisma.shift.findUnique({ where: { id: req.params.id } });
    if (!shift) {
      return res.status(404).json({ error: 'Shift not found' });
    }
    if (!canViewShift(shift, req)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const zReport = await prisma.zReport.findUnique({
      where: { shiftId: req.params.id },
      include: {
        cashier: { select: { id: true, name: true, email: true } },
        authorizedBy: { select: { id: true, name: true, email: true } },
        declaration: true,
      },
    });
    if (!zReport) {
      return res.status(404).json({ error: 'No Z report exists for this shift yet' });
    }
    res.json(req.user.permissions.includes('shifts:viewVariance') ? zReport : { ...zReport, declaration: null });
  } catch (error) {
    console.error('Error fetching Z report:', error);
    res.status(500).json({ error: 'Failed to fetch Z report' });
  }
});

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

// A cash movement may be recorded by: the shift's owner (shifts:operate
// working their own till), a holder of shifts:recordMovement acting on the
// branch's OPEN shift regardless of who opened it, or shifts:viewAll as a
// store-wide override.
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
        safeId: req.body.safeId,
        witnessUserId: req.body.witnessUserId,
      });

      auditService.safeLog(
        type === 'SAFE_DROP' ? auditService.eventTypes.SAFE_DROP : auditService.eventTypes.CASH_MOVEMENT,
        {
          ...auditService.contextFromReq(req),
          entityType: 'SHIFT',
          entityId: req.params.id,
          action: type,
          newValues: { amount: req.body.amount, reason: req.body.reason || null, safeId: req.body.safeId || null },
          description: `${type} of ${req.body.amount} recorded on shift ${req.params.id}`,
        }
      );

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
// Safe drops are cashier-initiated like any other cash movement — not
// manager-authorized like ending a shift. The optional safeId/witnessUserId
// in the body are just extra recorded detail, not an approval step.
router.post('/:id/safe-drop', authenticateToken, canOperateOrRecordMovement, handleCashMovement('SAFE_DROP'));

/**
 * POST /api/shifts/:id/end — request (and, with a valid ticket, complete)
 * ending a shift. Requires a consumed SHIFT_END approval ticket
 * (approvalId in the body, minted via POST /api/till/approvals) — a
 * Supervisor+ PIN, no exceptions, enforced here regardless of who's calling
 * (even a Supervisor ending their own shift needs a second person; self-
 * approval is unconditionally blocked in lib/approval.js). Atomically
 * generates the immutable ZReport and locks the shift for reconciliation —
 * this endpoint's response never includes financial figures beyond what
 * stripShiftFigures already allows the caller to see.
 */
router.post('/:id/end', authenticateToken, canOperateOrRecordMovement, async (req, res) => {
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

    const { shift: ended, zReport } = await endShift(req.params.id, { approvalId: req.body.approvalId });

    auditService.safeLog(auditService.eventTypes.SHIFT_END_AUTHORIZED, {
      ...auditService.contextFromReq(req),
      entityType: 'SHIFT',
      entityId: ended.id,
      action: 'END',
      newValues: { approvalId: req.body.approvalId, zNumber: zReport.zNumber },
      description: `Shift ${ended.id} ended by ${req.user.email || req.user.userId}, authorized via approval ${req.body.approvalId} — ${zReport.zNumber} generated`,
    });
    auditService.safeLog(auditService.eventTypes.Z_REPORT_GENERATED, {
      ...auditService.contextFromReq(req),
      entityType: 'Z_REPORT',
      entityId: zReport.id,
      action: 'GENERATE',
      description: `${zReport.zNumber} generated for shift ${ended.id}`,
    });

    res.json({
      shift: stripShiftFigures(ended, req.user.permissions),
      zNumber: zReport.zNumber,
    });
  } catch (error) {
    if (error.code === 'SELF_APPROVAL_DENIED' || error.code === 'APPROVAL_REQUIRED') {
      auditService.safeLog(auditService.eventTypes.PERMISSION_DENIED, {
        ...auditService.contextFromReq(req),
        entityType: 'SHIFT',
        entityId: req.params.id,
        description: `Blocked shift-end attempt without a valid SHIFT_END approval: ${error.code}`,
        success: false,
      });
    }
    console.error('Error ending shift:', error);
    res.status(error.status || 500).json({ error: error.message || 'Failed to end shift', code: error.code });
  }
});

/**
 * POST /api/shifts/:id/declaration — the cashier's own physical cash count,
 * submitted independently of the till (never at the POS). Ownership is
 * enforced inside lib/cashierDeclaration.js itself (the shift's own cashier
 * only) — this is the one place ownership, not a broader permission, is the
 * correct check, since a declaration is inherently personal.
 */
router.post('/:id/declaration', authenticateToken, canOperateOrRecordMovement, async (req, res) => {
  try {
    const declaration = await submitDeclaration(req.params.id, {
      declaredByUserId: req.user.userId,
      declaredTotal: req.body.declaredTotal,
      denominations: req.body.denominations,
    });

    auditService.safeLog(auditService.eventTypes.CASHIER_DECLARATION_SUBMITTED, {
      ...auditService.contextFromReq(req),
      entityType: 'SHIFT',
      entityId: req.params.id,
      action: 'DECLARE',
      newValues: { declaredTotal: declaration.declaredTotal },
      description: `Cashier declaration submitted for shift ${req.params.id}: ${declaration.declaredTotal}`,
    });

    res.status(201).json(declaration);
  } catch (error) {
    console.error('Error submitting declaration:', error);
    res.status(error.status || 500).json({ error: error.message || 'Failed to submit declaration', code: error.code });
  }
});

/**
 * POST /api/shifts/:id/close — reconcile. Compares the frozen
 * ZReport.expectedClosingCash against the cashier's own
 * CashierDeclaration.declaredTotal — neither figure is entered or
 * recomputed here, both already exist (lib/shift.js:closeShift). The
 * reconciler can never be the shift's own owner (hard-enforced independent
 * of permissions — see SELF_RECONCILE_DENIED).
 */
router.post('/:id/close', authenticateToken, requirePermission('shifts:reconcile'), async (req, res) => {
  try {
    const closed = await closeShift(req.params.id, {
      reconcilerUserId: req.user.userId,
      notes: req.body.notes,
    });

    auditService.safeLog(auditService.eventTypes.SHIFT_RECONCILED, {
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
    if (closed.variance) {
      auditService.safeLog(auditService.eventTypes.SHIFT_VARIANCE_FLAGGED, {
        ...auditService.contextFromReq(req),
        entityType: 'SHIFT',
        entityId: closed.id,
        description: `Shift ${closed.id} reconciled with a variance of ${closed.variance}`,
        riskLevel: 'MEDIUM',
      });
    }

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
    res.status(error.status || 500).json({ error: error.message || 'Failed to close shift', code: error.code });
  }
});

/**
 * POST /api/shifts/:id/adjustments — the only way a recorded variance's
 * story ever changes. Never touches the original ZReport/CashierDeclaration
 * rows (lib/shiftAdjustment.js) — a separate, additive, audited fact.
 * shifts:adjust is deliberately a step up from shifts:reconcile — not every
 * reconciler should be able to write off a variance.
 */
router.post('/:id/adjustments', authenticateToken, requirePermission('shifts:adjust'), async (req, res) => {
  try {
    const adjustment = await createAdjustment(req.params.id, {
      adjustedByUserId: req.user.userId,
      reason: req.body.reason,
      resolutionNote: req.body.resolutionNote,
    });

    auditService.safeLog(auditService.eventTypes.SHIFT_ADJUSTMENT_CREATED, {
      ...auditService.contextFromReq(req),
      entityType: 'SHIFT',
      entityId: req.params.id,
      action: 'ADJUST',
      newValues: { reason: adjustment.reason, resolutionNote: adjustment.resolutionNote },
      description: `Adjustment recorded for shift ${req.params.id}: ${adjustment.reason}`,
      riskLevel: 'MEDIUM',
    });

    res.status(201).json(adjustment);
  } catch (error) {
    console.error('Error creating adjustment:', error);
    res.status(error.status || 500).json({ error: error.message || 'Failed to create adjustment' });
  }
});

router.get('/:id/adjustments', authenticateToken, requirePermission('shifts:reconcile'), async (req, res) => {
  try {
    const adjustments = await listAdjustments(req.params.id);
    res.json({ adjustments });
  } catch (error) {
    console.error('Error listing adjustments:', error);
    res.status(500).json({ error: 'Failed to list adjustments' });
  }
});

/**
 * POST /api/shifts/:id/reopen — Manager+ override for a shift closed in
 * error. Not available to Supervisor (shifts:reconcile does not imply
 * shifts:reopen) — reopening is a step up from reconciling, not part of it.
 * The shift's CashierDeclaration stays attached (a fresh declaration is not
 * required) — only the reconciliation decision is redone against it.
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
