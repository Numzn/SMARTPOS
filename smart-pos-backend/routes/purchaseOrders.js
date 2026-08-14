const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const {
  poInclude,
  createDraftPurchaseOrder,
  updateDraftPurchaseOrder,
  sendPurchaseOrder,
  cancelPurchaseOrder,
  receiveAgainstPurchaseOrder,
} = require('../lib/purchasing');
const { authenticateToken, requirePermission } = require('../middleware/auth');
const { DEFAULT_BRANCH } = require('../lib/inventoryStock');
const auditService = require('../services/auditService');
const purchaseSaveSync = require('../lib/vsdc-gateway/purchaseSaveSync');

function actorId(req) {
  return req.user?.userId || req.user?.id || null;
}

/** GET /api/purchase-orders */
router.get('/', authenticateToken, requirePermission('purchasing:read'), async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
    const where = {};
    if (req.query.status) where.status = req.query.status;
    if (req.query.supplierId) where.supplierId = req.query.supplierId;
    if (req.query.branchId) where.branchId = req.query.branchId;

    const [purchaseOrders, total] = await Promise.all([
      prisma.purchaseOrder.findMany({
        where,
        include: poInclude,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.purchaseOrder.count({ where }),
    ]);

    res.json({ success: true, purchaseOrders, total, page, limit });
  } catch (error) {
    console.error('Error listing purchase orders:', error.message);
    res.status(500).json({ success: false, error: 'Failed to list purchase orders' });
  }
});

/** GET /api/purchase-orders/:id */
router.get('/:id', authenticateToken, requirePermission('purchasing:read'), async (req, res) => {
  try {
    const po = await prisma.purchaseOrder.findUnique({ where: { id: req.params.id }, include: poInclude });
    if (!po) {
      return res.status(404).json({ success: false, error: 'Purchase order not found' });
    }
    res.json({ success: true, purchaseOrder: po });
  } catch (error) {
    console.error('Error fetching purchase order:', error.message);
    res.status(500).json({ success: false, error: 'Failed to fetch purchase order' });
  }
});

/** GET /api/purchase-orders/:id/grns */
router.get('/:id/grns', authenticateToken, requirePermission('purchasing:read'), async (req, res) => {
  try {
    const grns = await prisma.goodsReceivedNote.findMany({
      where: { purchaseOrderId: req.params.id },
      include: { items: true },
      orderBy: { receivedDate: 'desc' },
    });
    res.json({ success: true, goodsReceivedNotes: grns });
  } catch (error) {
    console.error('Error fetching GRNs for purchase order:', error.message);
    res.status(500).json({ success: false, error: 'Failed to fetch goods received notes' });
  }
});

/** POST /api/purchase-orders */
router.post('/', authenticateToken, requirePermission('purchasing:write'), async (req, res) => {
  try {
    const po = await createDraftPurchaseOrder({
      supplierId: req.body.supplierId,
      branchId: req.body.branchId || DEFAULT_BRANCH,
      items: req.body.items,
      expectedDate: req.body.expectedDate,
      notes: req.body.notes,
      userId: actorId(req),
    });

    auditService.safeLog(auditService.eventTypes.PURCHASE_ORDER_CREATE, {
      ...auditService.contextFromReq(req),
      entityType: 'PURCHASE_ORDER',
      entityId: po.id,
      action: 'CREATE',
      newValues: { poNumber: po.poNumber, supplierId: po.supplierId, total: po.total },
      description: `Purchase order ${po.poNumber} created`,
    });

    res.status(201).json({ success: true, purchaseOrder: po });
  } catch (error) {
    console.error('Error creating purchase order:', error.message);
    res.status(error.status || 500).json({ success: false, error: error.message || 'Failed to create purchase order' });
  }
});

/** PUT /api/purchase-orders/:id — DRAFT only */
router.put('/:id', authenticateToken, requirePermission('purchasing:write'), async (req, res) => {
  try {
    const po = await updateDraftPurchaseOrder(
      req.params.id,
      {
        supplierId: req.body.supplierId,
        expectedDate: req.body.expectedDate,
        notes: req.body.notes,
        items: req.body.items,
      },
      actorId(req)
    );
    res.json({ success: true, purchaseOrder: po });
  } catch (error) {
    console.error('Error updating purchase order:', error.message);
    res.status(error.status || 500).json({ success: false, error: error.message || 'Failed to update purchase order' });
  }
});

/** POST /api/purchase-orders/:id/send */
router.post('/:id/send', authenticateToken, requirePermission('purchasing:write'), async (req, res) => {
  try {
    const po = await sendPurchaseOrder(req.params.id, actorId(req));

    auditService.safeLog(auditService.eventTypes.PURCHASE_ORDER_SEND, {
      ...auditService.contextFromReq(req),
      entityType: 'PURCHASE_ORDER',
      entityId: po.id,
      action: 'SEND',
      description: `Purchase order ${po.poNumber} sent to ${po.supplier?.name || po.supplierId}`,
    });

    res.json({ success: true, purchaseOrder: po });
  } catch (error) {
    console.error('Error sending purchase order:', error.message);
    res.status(error.status || 500).json({ success: false, error: error.message || 'Failed to send purchase order' });
  }
});

/** POST /api/purchase-orders/:id/cancel */
router.post('/:id/cancel', authenticateToken, requirePermission('purchasing:write'), async (req, res) => {
  try {
    const po = await cancelPurchaseOrder(req.params.id, actorId(req));

    auditService.safeLog(auditService.eventTypes.PURCHASE_ORDER_CANCEL, {
      ...auditService.contextFromReq(req),
      entityType: 'PURCHASE_ORDER',
      entityId: po.id,
      action: 'CANCEL',
      description: `Purchase order ${po.poNumber} cancelled`,
    });

    res.json({ success: true, purchaseOrder: po });
  } catch (error) {
    console.error('Error cancelling purchase order:', error.message);
    res.status(error.status || 500).json({ success: false, error: error.message || 'Failed to cancel purchase order' });
  }
});

/**
 * POST /api/purchase-orders/:id/receive
 *
 * Item 15* — a successful receive automatically fires fiscal purchase
 * reporting for the new GRN (syncAfterReceive), so an operator no longer
 * has to remember the separate POST /api/vsdc/purchases/sync call. The
 * trigger fires only after receiveAgainstPurchaseOrder's own transaction has
 * committed and the response is already built, so a VSDC outage can never
 * roll back or block the receive itself — it only leaves the GRN's
 * zraSyncedAt null, which is exactly the same "pending" state
 * /api/vsdc/purchases/sync already recovers from (kept fully intact below,
 * unchanged, for historical/administrative retry).
 */
router.post('/:id/receive', authenticateToken, requirePermission('purchasing:write'), async (req, res) => {
  try {
    const result = await receiveAgainstPurchaseOrder(req.params.id, {
      items: req.body.items,
      branchId: req.body.branchId || DEFAULT_BRANCH,
      userId: actorId(req),
      notes: req.body.notes,
      receivedDate: req.body.receivedDate,
    });

    auditService.safeLog(auditService.eventTypes.PURCHASE_ORDER_RECEIVE, {
      ...auditService.contextFromReq(req),
      entityType: 'PURCHASE_ORDER',
      entityId: result.purchaseOrder.id,
      action: 'RECEIVE',
      newValues: { grnNumber: result.grn.grnNumber, status: result.purchaseOrder.status },
      description: `Goods received against ${result.purchaseOrder.poNumber} (${result.grn.grnNumber}), status now ${result.purchaseOrder.status}`,
    });

    res.status(201).json({ success: true, ...result });

    purchaseSaveSync.syncAfterReceive(result.grn.id);
  } catch (error) {
    console.error('Error receiving against purchase order:', error.message);
    res.status(error.status || 500).json({ success: false, error: error.message || 'Failed to receive stock' });
  }
});

module.exports = router;
