const express = require('express');
const router = express.Router();
const prisma = require('../../lib/prisma');
const { authenticateToken, requirePermission } = require('../../middleware/auth');
const { deductBatchesFifo } = require('../../lib/inventoryStock');
const stockSyncService = require('../../services/stockSyncService');

// Canonical stock adjustment endpoint.
// Accepts both operational (IN/OUT) and ZRA-style adjustment types and writes:
//   - Inventory update
//   - StockMovement (operational ledger)
//   - InventoryBatch (FIFO for OUT, new batch for IN)
//   - StockAdjustment (ZRA audit trail)
const ADJUSTMENT_DIRECTION = {
  IN: 'IN',
  OUT: 'OUT',
  INCREASE: 'IN',
  DECREASE: 'OUT',
  DAMAGED: 'OUT',
  EXPIRED: 'OUT',
};

const ZRA_AUDIT_TYPE = {
  IN: 'INCREASE',
  OUT: 'DECREASE',
  INCREASE: 'INCREASE',
  DECREASE: 'DECREASE',
  DAMAGED: 'DAMAGED',
  EXPIRED: 'EXPIRED',
  RECOUNT: 'RECOUNT',
};

router.post('/adjust', authenticateToken, requirePermission('inventory:write'), async (req, res) => {
  try {
    const {
      productId,
      adjustmentType: rawAdjustmentType,
      quantity,
      reason,
      unitCost,
      occurrenceDate,
      branchId = 'main',
    } = req.body;
    const userId = req.user.userId;

    const normalizedType = String(rawAdjustmentType || '').toUpperCase();
    const direction = ADJUSTMENT_DIRECTION[normalizedType];
    const auditType = ZRA_AUDIT_TYPE[normalizedType];

    if (!productId || !quantity) {
      return res.status(400).json({
        error: 'Missing required fields: productId, quantity',
      });
    }

    if (!direction || !auditType) {
      return res.status(400).json({
        error:
          'Invalid adjustment type. Allowed: IN, OUT, INCREASE, DECREASE, DAMAGED, EXPIRED, RECOUNT',
      });
    }

    const adjustmentQty = Math.abs(parseInt(quantity, 10));
    const ocrnDt = occurrenceDate ? new Date(occurrenceDate) : new Date();

    const result = await prisma.$transaction(async (tx) => {
      // Get current inventory
      let inventory = await tx.inventory.findUnique({
        where: {
          productId_branchId: {
            productId,
            branchId
          }
        },
        include: {
          product: true
        }
      });

      if (!inventory) {
        // An IN adjustment can bootstrap the inventory row (initial stocking).
        // OUT/DAMAGED/EXPIRED/RECOUNT have nothing to remove, so reject.
        if (direction !== 'IN') {
          throw new Error('Inventory not found for this product');
        }
        inventory = await tx.inventory.create({
          data: {
            productId,
            branchId,
            currentStock: 0,
            averageCost: unitCost || 0,
            lastCost: unitCost || 0,
            totalValue: 0,
            lowStockAlert: true,
          },
          include: { product: true },
        });
      }

      const signedQty = direction === 'IN' ? adjustmentQty : -adjustmentQty;
      const newStock = Math.max(0, inventory.currentStock + signedQty);

      if (direction === 'OUT' && inventory.currentStock < adjustmentQty) {
        throw new Error(
          `Insufficient stock. Available: ${inventory.currentStock}, Requested: ${adjustmentQty}`
        );
      }

      const unit = unitCost || inventory.averageCost || 0;

      const updatedInventory = await tx.inventory.update({
        where: { id: inventory.id },
        data: {
          currentStock: newStock,
          totalValue: newStock * unit,
          averageCost: unit,
          lowStockAlert: newStock <= inventory.reorderPoint,
          updatedAt: new Date(),
        },
      });

      const stockMovement = await tx.stockMovement.create({
        data: {
          productId,
          branchId,
          movementType: direction === 'IN' ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT',
          quantity: signedQty,
          previousStock: inventory.currentStock,
          newStock,
          unitCost: unit,
          totalCost: adjustmentQty * unit,
          referenceType: 'ADJUSTMENT',
          reason: reason || `Stock adjustment ${direction.toLowerCase()}`,
          userId,
        },
      });

      const stockAdjustment = await tx.stockAdjustment.create({
        data: {
          productId,
          adjustmentType: auditType,
          quantity: adjustmentQty,
          reason: reason || `Stock adjustment ${direction.toLowerCase()}`,
          ocrnDt,
          userId,
        },
      });

      if (direction === 'IN') {
        await tx.inventoryBatch.create({
          data: {
            inventoryId: inventory.id,
            productId,
            batchNumber: `ADJ-${Date.now()}`,
            quantity: adjustmentQty,
            unitCost: unit,
            totalCost: adjustmentQty * unit,
            costPrice: unit,
            sellingPrice: unit,
            status: 'ACTIVE',
          },
        });
      } else {
        await deductBatchesFifo(tx, {
          inventoryId: inventory.id,
          productId,
          quantity: adjustmentQty,
        });
      }

      return {
        inventory: updatedInventory,
        stockMovement,
        stockAdjustment,
        previousStock: inventory.currentStock,
        newStock,
        adjustmentQuantity: signedQty,
        adjustmentDirection: direction,
        adjustmentType: auditType,
      };
    });

    res.json({
      message: 'Stock adjustment completed successfully',
      ...result,
    });

    if (result.stockMovement?.id) {
      stockSyncService.syncMovementById(result.stockMovement.id).catch((err) => {
        console.warn('[adjustments] stock sync failed:', err.message);
      });
    }
  } catch (error) {
    console.error('❌ Error processing stock adjustment:', error);
    res.status(500).json({ 
      error: 'Failed to process stock adjustment',
      details: error.message 
    });
  }
});

// Get adjustment history
router.get('/history', authenticateToken, requirePermission('inventory:read'), async (req, res) => {
  try {
    const { 
      productId, 
      branchId = 'main', 
      from, 
      to, 
      page = 1, 
      limit = 50 
    } = req.query;

    const where = {
      branchId,
      movementType: { in: ['ADJUSTMENT_IN', 'ADJUSTMENT_OUT'] },
      ...(productId && { productId }),
      ...(from && to && {
        createdAt: {
          gte: new Date(from),
          lte: new Date(to)
        }
      })
    };

    const [adjustments, total] = await Promise.all([
      prisma.stockMovement.findMany({
        where,
        include: {
          product: true,
          user: {
            select: {
              id: true,
              name: true,
              email: true
            }
          }
        },
        orderBy: { createdAt: 'desc' },
        skip: (parseInt(page) - 1) * parseInt(limit),
        take: parseInt(limit)
      }),
      prisma.stockMovement.count({ where })
    ]);

    const formattedAdjustments = adjustments.map(adj => ({
      id: adj.id,
      productName: adj.product.name,
      productSku: adj.product.sku,
      adjustmentType: adj.movementType === 'ADJUSTMENT_IN' ? 'IN' : 'OUT',
      quantity: Math.abs(adj.quantity),
      previousStock: adj.previousStock,
      newStock: adj.newStock,
      unitCost: adj.unitCost,
      totalCost: adj.totalCost,
      reason: adj.reason,
      userName: adj.user?.name,
      createdAt: adj.createdAt
    }));

    res.json({
      adjustments: formattedAdjustments,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('❌ Error fetching adjustment history:', error);
    res.status(500).json({ error: 'Failed to fetch adjustment history' });
  }
});

// Bulk stock adjustment
router.post('/bulk-adjust', authenticateToken, requirePermission('inventory:write'), async (req, res) => {
  try {
    const { adjustments, branchId = 'main' } = req.body;
    const userId = req.user.userId;

    if (!Array.isArray(adjustments) || adjustments.length === 0) {
      return res.status(400).json({ error: 'No adjustments provided' });
    }

    const results = [];
    const errors = [];

    for (const [index, adjustment] of adjustments.entries()) {
      try {
        const result = await prisma.$transaction(async (tx) => {
          const { productId, adjustmentType: rawType, quantity, reason, unitCost } = adjustment;

          const normalizedType = String(rawType || '').toUpperCase();
          const direction = ADJUSTMENT_DIRECTION[normalizedType];
          const auditType = ZRA_AUDIT_TYPE[normalizedType];
          if (!direction || !auditType) {
            throw new Error(`Invalid adjustment type "${rawType}" for product ${productId}`);
          }

          const adjustmentQty = Math.abs(parseInt(quantity, 10));
          if (!adjustmentQty) {
            throw new Error(`Invalid quantity for product ${productId}`);
          }

          const inventory = await tx.inventory.findUnique({
            where: { productId_branchId: { productId, branchId } },
          });
          if (!inventory) {
            throw new Error(`Inventory not found for product ${productId}`);
          }

          const signedQty = direction === 'IN' ? adjustmentQty : -adjustmentQty;
          const newStock = Math.max(0, inventory.currentStock + signedQty);
          if (direction === 'OUT' && inventory.currentStock < adjustmentQty) {
            throw new Error(
              `Insufficient stock for product ${productId}. Available: ${inventory.currentStock}`
            );
          }

          const unit = unitCost || inventory.averageCost || 0;

          await tx.inventory.update({
            where: { id: inventory.id },
            data: {
              currentStock: newStock,
              totalValue: newStock * unit,
              lowStockAlert: newStock <= inventory.reorderPoint,
            },
          });

          await tx.stockMovement.create({
            data: {
              productId,
              branchId,
              movementType: direction === 'IN' ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT',
              quantity: signedQty,
              previousStock: inventory.currentStock,
              newStock,
              unitCost: unit,
              totalCost: adjustmentQty * unit,
              referenceType: 'BULK_ADJUSTMENT',
              reason: reason || `Bulk adjustment ${direction.toLowerCase()}`,
              userId,
            },
          });

          await tx.stockAdjustment.create({
            data: {
              productId,
              adjustmentType: auditType,
              quantity: adjustmentQty,
              reason: reason || `Bulk adjustment ${direction.toLowerCase()}`,
              ocrnDt: new Date(),
              userId,
            },
          });

          return { productId, success: true, newStock };
        });

        results.push(result);
      } catch (error) {
        errors.push({
          index,
          productId: adjustment.productId,
          error: error.message,
        });
      }
    }

    res.json({
      message: 'Bulk adjustment completed',
      successful: results.length,
      failed: errors.length,
      results,
      errors
    });
  } catch (error) {
    console.error('❌ Error processing bulk adjustment:', error);
    res.status(500).json({ 
      error: 'Failed to process bulk adjustment',
      details: error.message 
    });
  }
});

module.exports = router;
