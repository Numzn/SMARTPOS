const express = require('express');
const router = express.Router();
const prisma = require('../../lib/prisma');
const { authenticateToken, requirePermission } = require('../../middleware/auth');

// Helper functions for expiry
const calculateDaysUntilExpiry = (expiryDate) => {
  if (!expiryDate) return null;
  const today = new Date();
  const expiry = new Date(expiryDate);
  return Math.ceil((expiry - today) / (1000 * 60 * 60 * 24));
};

const getExpiryStatus = (expiryDate) => {
  const daysUntilExpiry = calculateDaysUntilExpiry(expiryDate);
  if (daysUntilExpiry === null) return 'NO_EXPIRY';
  if (daysUntilExpiry < 0) return 'EXPIRED';
  if (daysUntilExpiry <= 1) return 'EXPIRES_TODAY';
  if (daysUntilExpiry <= 3) return 'EXPIRES_SOON';
  if (daysUntilExpiry <= 7) return 'NEAR_EXPIRY';
  return 'FRESH';
};

// Get expiry alerts
router.get('/expiry-alerts', authenticateToken, requirePermission('inventory:read'), async (req, res) => {
  try {
    const { days = 7, branchId = 'main' } = req.query;

    console.log(`🔍 Fetching expiry alerts for next ${days} days`);

    const batches = await prisma.inventoryBatch.findMany({
      where: {
        status: 'ACTIVE',
        quantity: { gt: 0 },
        expiryDate: {
          lte: new Date(Date.now() + (parseInt(days) * 24 * 60 * 60 * 1000))
        },
        inventory: {
          branchId
        }
      },
      include: {
        inventory: {
          include: {
            product: true
          }
        }
      },
      orderBy: {
        expiryDate: 'asc'
      }
    });

    const alerts = batches.map(batch => ({
      id: batch.id,
      productName: batch.inventory.product.name,
      productSku: batch.inventory.product.sku,
      batchNumber: batch.batchNumber,
      quantity: batch.quantity,
      expiryDate: batch.expiryDate,
      daysUntilExpiry: calculateDaysUntilExpiry(batch.expiryDate),
      expiryStatus: getExpiryStatus(batch.expiryDate),
      totalValue: batch.quantity * batch.unitCost,
      supplierInfo: batch.supplier
    }));

    console.log(`✅ Found ${alerts.length} expiry alerts`);
    res.json(alerts);
  } catch (error) {
    console.error('❌ Error fetching expiry alerts:', error);
    res.status(500).json({ error: 'Failed to fetch expiry alerts' });
  }
});

// Mark batch as expired
router.post('/mark-expired', authenticateToken, requirePermission('inventory:write'), async (req, res) => {
  try {
    const { batchId, reason = 'Expired' } = req.body;
    const userId = req.user.userId;

    const result = await prisma.$transaction(async (tx) => {
      const batch = await tx.inventoryBatch.findUnique({
        where: { id: batchId },
        include: { inventory: true }
      });

      if (!batch) {
        throw new Error('Batch not found');
      }

      await tx.inventoryBatch.update({
        where: { id: batchId },
        data: { status: 'EXPIRED' }
      });

      const newStock = batch.inventory.currentStock - batch.quantity;
      await tx.inventory.update({
        where: { id: batch.inventoryId },
        data: {
          currentStock: Math.max(0, newStock),
          totalValue: Math.max(0, newStock) * batch.inventory.averageCost,
          lowStockAlert: newStock <= batch.inventory.reorderPoint
        }
      });

      // Create stock movement record
      await tx.stockMovement.create({
        data: {
          productId: batch.productId,
          branchId: batch.inventory.branchId,
          movementType: 'ADJUSTMENT_OUT',
          quantity: -batch.quantity,
          previousStock: batch.inventory.currentStock,
          newStock: Math.max(0, newStock),
          unitCost: batch.unitCost,
          totalCost: batch.quantity * batch.unitCost,
          referenceType: 'EXPIRY',
          reason: reason,
          userId
        }
      });

      return { batch, newStock };
    });

    res.json({
      message: 'Batch marked as expired successfully',
      batch: result.batch,
      newStock: result.newStock
    });
  } catch (error) {
    console.error('❌ Error marking batch as expired:', error);
    res.status(500).json({ 
      error: 'Failed to mark batch as expired',
      details: error.message 
    });
  }
});

module.exports = router;
