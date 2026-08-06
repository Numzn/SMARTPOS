const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { authenticateToken, requirePermission } = require('../middleware/auth');

const grnInclude = {
  supplier: true,
  purchaseOrder: { select: { id: true, poNumber: true, status: true } },
  items: { include: { product: { select: { id: true, name: true, sku: true } } } },
};

/**
 * Read-only — GRNs are only ever created via POST /api/purchase-orders/:id/receive,
 * keeping a single write path for stock-affecting receiving.
 */
router.get('/', authenticateToken, requirePermission('purchasing:read'), async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
    const where = {};
    if (req.query.supplierId) where.supplierId = req.query.supplierId;
    if (req.query.branchId) where.branchId = req.query.branchId;
    if (req.query.purchaseOrderId) where.purchaseOrderId = req.query.purchaseOrderId;

    const [goodsReceivedNotes, total] = await Promise.all([
      prisma.goodsReceivedNote.findMany({
        where,
        include: grnInclude,
        orderBy: { receivedDate: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.goodsReceivedNote.count({ where }),
    ]);

    res.json({ success: true, goodsReceivedNotes, total, page, limit });
  } catch (error) {
    console.error('Error listing goods received notes:', error.message);
    res.status(500).json({ success: false, error: 'Failed to list goods received notes' });
  }
});

router.get('/:id', authenticateToken, requirePermission('purchasing:read'), async (req, res) => {
  try {
    const grn = await prisma.goodsReceivedNote.findUnique({
      where: { id: req.params.id },
      include: grnInclude,
    });
    if (!grn) {
      return res.status(404).json({ success: false, error: 'Goods received note not found' });
    }
    res.json({ success: true, goodsReceivedNote: grn });
  } catch (error) {
    console.error('Error fetching goods received note:', error.message);
    res.status(500).json({ success: false, error: 'Failed to fetch goods received note' });
  }
});

module.exports = router;
