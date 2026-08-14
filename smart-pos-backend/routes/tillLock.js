const express = require('express');
const router = express.Router();
const { authenticateToken, requirePermission } = require('../middleware/auth');
const tillLock = require('../lib/tillLock');
const auditService = require('../services/auditService');

function actorId(req) {
  return req.user?.userId || req.user?.id;
}

/** POST /api/till/sessions — open a new till transaction. */
router.post('/sessions', authenticateToken, requirePermission('sales:write'), async (req, res) => {
  try {
    const session = await tillLock.openSession(actorId(req), req.body?.branchId);
    res.status(201).json({ session });
  } catch (error) {
    console.error('Error opening till session:', error.message);
    res.status(error.status || 500).json({ error: error.message || 'Failed to open till session' });
  }
});

/** GET /api/till/sessions/:id — the session's currently committed lines. */
router.get('/sessions/:id', authenticateToken, requirePermission('sales:write'), async (req, res) => {
  try {
    const result = await tillLock.getSessionLines(req.params.id, actorId(req));
    res.json(result);
  } catch (error) {
    console.error('Error fetching till session:', error.message);
    res.status(error.status || 500).json({ error: error.message || 'Failed to fetch till session' });
  }
});

/** POST /api/till/sessions/:id/scan — add/increase a line. Always free. */
router.post('/sessions/:id/scan', authenticateToken, requirePermission('sales:write'), async (req, res) => {
  try {
    const line = await tillLock.scanItem(req.params.id, actorId(req), {
      productId: req.body?.productId,
      quantity: req.body?.quantity,
      unitPrice: req.body?.unitPrice,
    });
    res.status(201).json({ line });
  } catch (error) {
    console.error('Error scanning item:', error.message);
    res.status(error.status || 500).json({ error: error.message || 'Failed to scan item' });
  }
});

/**
 * PATCH /api/till/sessions/:id/lines/:productId — reduce/remove a committed
 * line. Requires an already-issued LINE_REVERSAL approval ticket for this
 * exact session/product/quantity-delta (see POST /api/till/approvals).
 */
router.patch('/sessions/:id/lines/:productId', authenticateToken, requirePermission('sales:write'), async (req, res) => {
  try {
    const { line, previousQuantity, approver, branchId } = await tillLock.reverseLine(
      req.params.id,
      actorId(req),
      req.params.productId,
      {
        toQuantity: req.body?.toQuantity,
        approvalId: req.body?.approvalId,
        reasonCode: req.body?.reasonCode,
        reasonNote: req.body?.reasonNote,
      }
    );

    auditService.safeLog(auditService.eventTypes.TILL_LINE_REVERSAL, {
      ...auditService.contextFromReq(req),
      entityType: 'CASHIER_CART_LINE',
      entityId: line.id,
      action: 'REVERSE',
      oldValues: { quantity: previousQuantity },
      newValues: {
        quantity: line.quantity,
        status: line.status,
        reasonCode: req.body?.reasonCode,
        reasonNote: req.body?.reasonNote,
        sessionId: req.params.id,
        productId: req.params.productId,
        branchId,
        approvedByUserId: approver.id,
      },
      description: `Line reversal on till session ${req.params.id}: ${req.params.productId} ${previousQuantity} -> ${line.quantity} (${req.body?.reasonCode}), approved by ${approver.name || approver.email}`,
    });

    res.json({ line });
  } catch (error) {
    console.error('Error reversing line:', error.message);
    res.status(error.status || 500).json({ error: error.message || 'Failed to reverse line' });
  }
});

/** DELETE /api/till/sessions/:id — abandon the whole transaction. No approval needed. */
router.delete('/sessions/:id', authenticateToken, requirePermission('sales:write'), async (req, res) => {
  try {
    const session = await tillLock.abandonSession(req.params.id, actorId(req));

    auditService.safeLog(auditService.eventTypes.TILL_SESSION_ABANDON, {
      ...auditService.contextFromReq(req),
      entityType: 'CASHIER_CART_SESSION',
      entityId: req.params.id,
      action: 'ABANDON',
      description: `Till session ${req.params.id} abandoned`,
    });

    res.json({ session });
  } catch (error) {
    console.error('Error abandoning till session:', error.message);
    res.status(error.status || 500).json({ error: error.message || 'Failed to abandon till session' });
  }
});

module.exports = router;
