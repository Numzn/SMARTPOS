const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { authenticateToken, ROLE_RANK } = require('../middleware/auth');
const { requestApproval } = require('../lib/approval');
const { getDiscountPolicy, canApplyDiscount, canRequestDiscount } = require('../lib/discountPolicy');
const auditService = require('../services/auditService');

const APPROVER_ROLES = Object.keys(ROLE_RANK).filter((role) => ROLE_RANK[role] >= ROLE_RANK.SUPERVISOR);

/**
 * GET /api/till/discount-policy — whether the CURRENT user's own role may
 * apply/request a discount. Deliberately narrow (booleans only, not the raw
 * policy/thresholds) — any authenticated till user needs this to decide
 * whether to show a discount control at all; the full policy object is a
 * settings:read-gated concern (routes/settings.js), not a till concern.
 */
router.get('/discount-policy', authenticateToken, async (req, res) => {
  try {
    const policy = await getDiscountPolicy(prisma);
    res.json({
      canApply: canApplyDiscount(req.user.role, policy),
      canRequest: canRequestDiscount(req.user.role, policy),
    });
  } catch (error) {
    console.error('Error loading discount policy:', error.message);
    res.status(500).json({ error: 'Failed to load discount policy' });
  }
});

/**
 * GET /api/till/approvers — id+name only (no email, no other fields) of
 * active users eligible to approve a till action. GET /api/users is
 * ADMIN-only, but any cashier needs to find "who can I ask to approve
 * this" at the till — this is the minimal, low-privilege lookup for that,
 * not a general user directory.
 */
router.get('/approvers', authenticateToken, async (req, res) => {
  try {
    const approvers = await prisma.user.findMany({
      where: { role: { in: APPROVER_ROLES }, isActive: true },
      select: { id: true, name: true, role: true },
      orderBy: { name: 'asc' },
    });
    res.json({ approvers });
  } catch (error) {
    console.error('Error listing approvers:', error.message);
    res.status(500).json({ error: 'Failed to list approvers' });
  }
});

/**
 * POST /api/till/approvals
 *
 * Mints a short-lived, single-use approval ticket for one specific action
 * (LINE_REVERSAL or ORDER_DISCOUNT) on one specific till session. The
 * requesting cashier must own that session; the approver is a *different*
 * user (a supervisor/manager/admin) whose PIN or password is verified here
 * — this is the only place a raw credential is ever checked. Everything
 * downstream (till-lock reversal, checkout's discount gate) only ever sees
 * the returned `approvalId`.
 */
router.post('/approvals', authenticateToken, async (req, res) => {
  try {
    const { actionType, credential, method = 'PIN', approverUserId, sessionId, target } = req.body || {};

    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId is required' });
    }

    const session = await prisma.cashierCartSession.findUnique({ where: { id: sessionId } });
    if (!session) {
      return res.status(404).json({ error: 'Till session not found' });
    }
    if (session.userId !== req.user.userId) {
      auditService.safeLog(auditService.eventTypes.PERMISSION_DENIED, {
        ...auditService.contextFromReq(req),
        entityType: 'CASHIER_CART_SESSION',
        entityId: sessionId,
        description: `User attempted to request approval for a till session they do not own`,
      });
      return res.status(403).json({ error: 'You do not own this till session' });
    }

    const approval = await requestApproval(prisma, {
      approverUserId,
      requesterUserId: req.user.userId,
      credential,
      method,
      actionType,
      sessionId,
      target,
    });

    auditService.safeLog(auditService.eventTypes.SUPERVISOR_APPROVAL_GRANTED, {
      ...auditService.contextFromReq(req),
      entityType: 'SUPERVISOR_APPROVAL',
      entityId: approval.id,
      action: 'GRANT',
      newValues: { actionType, sessionId, target, approverUserId: approval.approverUserId, authMethod: method },
      description: `Supervisor approval granted for ${actionType} on till session ${sessionId}`,
    });

    res.status(201).json({ approvalId: approval.id, expiresAt: approval.expiresAt });
  } catch (error) {
    console.error('Supervisor approval request failed:', error.message);
    res.status(error.status || 500).json({ error: error.message || 'Approval request failed', code: error.code });
  }
});

module.exports = router;
