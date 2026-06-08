const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { authenticateToken, requirePermission } = require('../middleware/auth');

/**
 * DEPRECATED (write path).
 *
 * The canonical stock-adjustment write path is now:
 *   POST /api/inventory/adjust
 *
 * That endpoint writes Inventory + StockMovement + InventoryBatch (FIFO) +
 * StockAdjustment (ZRA audit) atomically. It accepts both operational
 * (IN/OUT) and ZRA-style (INCREASE/DECREASE/DAMAGED/EXPIRED/RECOUNT)
 * adjustment types.
 *
 * This route is kept ONLY for read-only access to the historical
 * StockAdjustment audit table.
 */

function toDirection(adjustmentType) {
  if (adjustmentType === 'INCREASE') return 'IN';
  if (['DECREASE', 'DAMAGED', 'EXPIRED'].includes(adjustmentType)) return 'OUT';
  return adjustmentType;
}

router.get('/', authenticateToken, requirePermission('inventory:read'), async (req, res) => {
  try {
    const adjustments = await prisma.stockAdjustment.findMany({
      include: {
        product: { select: { id: true, name: true, sku: true } },
        user: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(
      adjustments.map((adj) => ({
        ...adj,
        adjustmentDirection: toDirection(adj.adjustmentType),
      }))
    );
  } catch (error) {
    console.error('Error fetching stock adjustments:', error);
    res.status(500).json({ error: 'Failed to fetch stock adjustments' });
  }
});

router.get('/:id', authenticateToken, requirePermission('inventory:read'), async (req, res) => {
  try {
    const adjustment = await prisma.stockAdjustment.findUnique({
      where: { id: req.params.id },
      include: {
        product: { select: { id: true, name: true, sku: true } },
        user: { select: { id: true, name: true, email: true } },
      },
    });
    if (!adjustment) {
      return res.status(404).json({ error: 'Stock adjustment not found' });
    }
    res.json({
      ...adjustment,
      adjustmentDirection: toDirection(adjustment.adjustmentType),
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch stock adjustment' });
  }
});

router.get(
  '/product/:productId',
  authenticateToken,
  requirePermission('inventory:read'),
  async (req, res) => {
    try {
      const adjustments = await prisma.stockAdjustment.findMany({
        where: { productId: req.params.productId },
        include: { user: { select: { id: true, name: true, email: true } } },
        orderBy: { createdAt: 'desc' },
      });
      res.json(
        adjustments.map((adj) => ({
          ...adj,
          adjustmentDirection: toDirection(adj.adjustmentType),
        }))
      );
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch product adjustments' });
    }
  }
);

// Block the legacy write path and tell clients where to go.
router.post('/', authenticateToken, (req, res) => {
  res.set('Deprecation', 'true');
  res.set('Link', '</api/inventory/adjust>; rel="successor-version"');
  res.status(410).json({
    error: 'Endpoint deprecated',
    code: 'DEPRECATED_ENDPOINT',
    message:
      'POST /api/stock-adjustments has been retired. Use POST /api/inventory/adjust instead.',
    canonical: '/api/inventory/adjust',
  });
});

module.exports = router;
