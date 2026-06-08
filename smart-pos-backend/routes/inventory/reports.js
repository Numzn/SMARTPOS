const express = require('express');
const router = express.Router();
const prisma = require('../../lib/prisma');
const { authenticateToken, requirePermission } = require('../../middleware/auth');

// Stock report
router.get('/stock-report', authenticateToken, requirePermission('inventory:read'), async (req, res) => {
  try {
    const { branchId = 'main', categoryId, lowStock = false } = req.query;

    const where = {
      branchId,
      ...(categoryId && { product: { categoryId } }),
      ...(lowStock === 'true' && { lowStockAlert: true })
    };

    const inventory = await prisma.inventory.findMany({
      where,
      include: {
        product: {
          include: {
            category: true
          }
        },
        batches: {
          where: { status: 'ACTIVE' },
          orderBy: { expiryDate: 'asc' }
        }
      },
      orderBy: {
        product: {
          name: 'asc'
        }
      }
    });

    const report = inventory.map(item => ({
      productId: item.productId,
      productName: item.product.name,
      sku: item.product.sku,
      category: item.product.category?.name,
      currentStock: item.currentStock,
      minimumStock: item.minimumStock,
      reorderPoint: item.reorderPoint,
      totalValue: item.totalValue,
      averageCost: item.averageCost,
      lowStockAlert: item.lowStockAlert,
      batchCount: item.batches.length,
      nearestExpiry: item.batches[0]?.expiryDate,
      lastUpdated: item.updatedAt
    }));

    const summary = {
      totalProducts: inventory.length,
      totalValue: inventory.reduce((sum, item) => sum + item.totalValue, 0),
      lowStockItems: inventory.filter(item => item.lowStockAlert).length,
      totalStock: inventory.reduce((sum, item) => sum + item.currentStock, 0)
    };

    res.json({
      summary,
      report
    });
  } catch (error) {
    console.error('❌ Error generating stock report:', error);
    res.status(500).json({ error: 'Failed to generate stock report' });
  }
});

// Stock movement report
router.get('/movement-report', authenticateToken, requirePermission('inventory:read'), async (req, res) => {
  try {
    const { 
      branchId = 'main', 
      productId, 
      from, 
      to, 
      movementType 
    } = req.query;

    const where = {
      branchId,
      ...(productId && { productId }),
      ...(movementType && { movementType }),
      ...(from && to && {
        createdAt: {
          gte: new Date(from),
          lte: new Date(to)
        }
      })
    };

    const movements = await prisma.stockMovement.findMany({
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
      orderBy: {
        createdAt: 'desc'
      }
    });

    const IN_TYPES = new Set([
      'PURCHASE_IN', 'ADJUSTMENT_IN', 'TRANSFER_IN', 'RETURN_IN', 'PRODUCTION_IN',
    ]);
    const OUT_TYPES = new Set([
      'SALE_OUT', 'ADJUSTMENT_OUT', 'TRANSFER_OUT', 'RETURN_OUT', 'PRODUCTION_OUT',
    ]);

    const summary = {
      totalMovements: movements.length,
      totalIn: movements
        .filter((m) => IN_TYPES.has(m.movementType) || m.quantity > 0)
        .reduce((sum, m) => sum + Math.abs(m.quantity), 0),
      totalOut: movements
        .filter((m) => OUT_TYPES.has(m.movementType) || m.quantity < 0)
        .reduce((sum, m) => sum + Math.abs(m.quantity), 0),
      totalValue: movements.reduce((sum, m) => sum + (m.totalCost || 0), 0),
    };

    res.json({
      summary,
      movements: movements.map(m => ({
        id: m.id,
        productName: m.product.name,
        productSku: m.product.sku,
        movementType: m.movementType,
        quantity: m.quantity,
        previousStock: m.previousStock,
        newStock: m.newStock,
        unitCost: m.unitCost,
        totalCost: m.totalCost,
        referenceType: m.referenceType,
        referenceId: m.referenceId,
        reason: m.reason,
        userName: m.user?.name,
        createdAt: m.createdAt
      }))
    });
  } catch (error) {
    console.error('❌ Error generating movement report:', error);
    res.status(500).json({ error: 'Failed to generate movement report' });
  }
});

// Value report
router.get('/value-report', authenticateToken, requirePermission('inventory:read'), async (req, res) => {
  try {
    const { branchId = 'main' } = req.query;

    const inventory = await prisma.inventory.findMany({
      where: { branchId },
      include: {
        product: {
          include: {
            category: true
          }
        }
      }
    });

    const categoryBreakdown = inventory.reduce((acc, item) => {
      const categoryName = item.product.category?.name || 'Uncategorized';
      if (!acc[categoryName]) {
        acc[categoryName] = {
          totalValue: 0,
          totalStock: 0,
          productCount: 0
        };
      }
      acc[categoryName].totalValue += item.totalValue;
      acc[categoryName].totalStock += item.currentStock;
      acc[categoryName].productCount += 1;
      return acc;
    }, {});

    const totalValue = inventory.reduce((sum, item) => sum + item.totalValue, 0);
    const totalStock = inventory.reduce((sum, item) => sum + item.currentStock, 0);

    res.json({
      summary: {
        totalValue,
        totalStock,
        totalProducts: inventory.length,
        averageValue: totalValue / inventory.length || 0
      },
      categoryBreakdown: Object.entries(categoryBreakdown).map(([name, data]) => ({
        category: name,
        ...data,
        percentage: (data.totalValue / totalValue * 100).toFixed(2)
      }))
    });
  } catch (error) {
    console.error('❌ Error generating value report:', error);
    res.status(500).json({ error: 'Failed to generate value report' });
  }
});

module.exports = router;
