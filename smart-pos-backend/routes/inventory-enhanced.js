const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { authenticateToken, requirePermission, requireAnyPermission } = require('../middleware/auth');

// Helper function to calculate days until expiry
const calculateDaysUntilExpiry = (expiryDate) => {
  if (!expiryDate) return null;
  const today = new Date();
  const expiry = new Date(expiryDate);
  return Math.ceil((expiry - today) / (1000 * 60 * 60 * 24));
};

// Helper function to get expiry status
const getExpiryStatus = (expiryDate) => {
  const daysUntilExpiry = calculateDaysUntilExpiry(expiryDate);
  if (daysUntilExpiry === null) return 'NO_EXPIRY';
  if (daysUntilExpiry < 0) return 'EXPIRED';
  if (daysUntilExpiry <= 1) return 'EXPIRES_TODAY';
  if (daysUntilExpiry <= 3) return 'EXPIRES_SOON';
  if (daysUntilExpiry <= 7) return 'NEAR_EXPIRY';
  return 'FRESH';
};

// Get all inventory with product details and expiry tracking
router.get('/', authenticateToken, requirePermission('inventory:read'), async (req, res) => {
  try {
    const { branchId = 'main', lowStockOnly = false, category, includeExpired = false, expiryFilter } = req.query;
    
    let whereClause = { branchId };
    
    if (lowStockOnly === 'true') {
      whereClause.lowStockAlert = true;
    }
    
    const inventory = await prisma.inventory.findMany({
      where: whereClause,
      include: {
        product: {
          include: {
            category: true
          }
        },
        batches: {
          where: includeExpired === 'true' ? {} : {
            status: {
              not: 'EXPIRED'
            }
          },
          orderBy: {
            expiryDate: 'asc' // FIFO - First to expire first
          }
        }
      },
      orderBy: [
        { lowStockAlert: 'desc' },
        { product: { name: 'asc' } }
      ]
    });
    
    // Filter by category if specified
    let filteredInventory = inventory;
    if (category) {
      filteredInventory = inventory.filter(inv => 
        inv.product.category.name.toLowerCase().includes(category.toLowerCase())
      );
    }

    // Process inventory with expiry information
    const processedInventory = filteredInventory.map(item => {
      // Calculate expiry alerts
      const expiringBatches = item.batches.filter(batch => {
        if (!batch.expiryDate) return false;
        const status = getExpiryStatus(batch.expiryDate);
        return ['EXPIRED', 'EXPIRES_TODAY', 'EXPIRES_SOON', 'NEAR_EXPIRY'].includes(status);
      });

      const nearestExpiry = item.batches
        .filter(batch => batch.expiryDate && batch.quantity > 0)
        .sort((a, b) => new Date(a.expiryDate) - new Date(b.expiryDate))[0];

      return {
        ...item,
        batches: item.batches.map(batch => ({
          ...batch,
          daysUntilExpiry: calculateDaysUntilExpiry(batch.expiryDate),
          expiryStatus: getExpiryStatus(batch.expiryDate)
        })),
        expiryAlerts: {
          hasExpiringItems: expiringBatches.length > 0,
          expiringBatchCount: expiringBatches.length,
          nearestExpiryDate: nearestExpiry?.expiryDate,
          nearestExpiryDays: nearestExpiry ? calculateDaysUntilExpiry(nearestExpiry.expiryDate) : null
        }
      };
    });

    // Apply expiry filter if specified
    if (expiryFilter) {
      filteredInventory = processedInventory.filter(item => {
        switch (expiryFilter) {
          case 'expiring':
            return item.expiryAlerts.hasExpiringItems;
          case 'expired':
            return item.batches.some(batch => batch.expiryStatus === 'EXPIRED');
          case 'fresh':
            return item.batches.every(batch => batch.expiryStatus === 'FRESH' || batch.expiryStatus === 'NO_EXPIRY');
          default:
            return true;
        }
      });
    }
    
    // Calculate summary stats including expiry
    const totalExpiringBatches = processedInventory.reduce((sum, inv) => 
      sum + inv.expiryAlerts.expiringBatchCount, 0);
    
    const summary = {
      totalProducts: processedInventory.length,
      totalValue: processedInventory.reduce((sum, inv) => sum + inv.totalValue, 0),
      lowStockItems: processedInventory.filter(inv => inv.lowStockAlert).length,
      outOfStockItems: processedInventory.filter(inv => inv.currentStock === 0).length,
      excessStockItems: processedInventory.filter(inv => inv.excessStockAlert).length,
      expiringItems: processedInventory.filter(inv => inv.expiryAlerts.hasExpiringItems).length,
      totalExpiringBatches
    };
    
    res.json({
      inventory: processedInventory,
      summary
    });
    
  } catch (error) {
    console.error('Error fetching inventory:', error);
    res.status(500).json({ 
      error: 'Failed to fetch inventory',
      details: error.message 
    });
  }
});

// Receive new stock with expiry tracking
router.post('/receive', authenticateToken, requirePermission('inventory:write'), async (req, res) => {
  try {
    const { 
      productId, 
      quantity, 
      unitCost, 
      supplierInfo, 
      batchNumber,
      expiryDate,
      receivedDate = new Date(),
      branchId = 'main'
    } = req.body;
    
    const userId = req.user.id;

    // Validate required fields
    if (!productId || !quantity || !unitCost) {
      return res.status(400).json({ error: 'Missing required fields: productId, quantity, unitCost' });
    }

    const result = await prisma.$transaction(async (tx) => {
      // Find or create inventory record
      let inventory = await tx.inventory.findUnique({
        where: {
          productId_branchId: {
            productId,
            branchId
          }
        }
      });

      if (!inventory) {
        inventory = await tx.inventory.create({
          data: {
            productId,
            branchId,
            currentStock: 0,
            minimumStock: 10,
            maximumStock: 1000,
            reorderPoint: 25,
            reorderQuantity: 100,
            averageCost: parseFloat(unitCost),
            lastCost: parseFloat(unitCost),
            totalValue: 0
          }
        });
      }

      // Create batch record
      const batch = await tx.inventoryBatch.create({
        data: {
          inventoryId: inventory.id,
          batchNumber: batchNumber || `BATCH_${Date.now()}`,
          quantity: parseInt(quantity),
          unitCost: parseFloat(unitCost),
          totalCost: parseInt(quantity) * parseFloat(unitCost),
          receivedDate: new Date(receivedDate),
          expiryDate: expiryDate ? new Date(expiryDate) : null,
          daysUntilExpiry: expiryDate ? calculateDaysUntilExpiry(expiryDate) : null,
          supplierInfo,
          status: 'ACTIVE'
        }
      });

      // Update inventory totals
      const totalQuantity = inventory.currentStock + parseInt(quantity);
      const newTotalCost = (inventory.currentStock * inventory.averageCost) + (parseInt(quantity) * parseFloat(unitCost));
      const newAverageCost = totalQuantity > 0 ? newTotalCost / totalQuantity : parseFloat(unitCost);

      const updatedInventory = await tx.inventory.update({
        where: { id: inventory.id },
        data: {
          currentStock: totalQuantity,
          averageCost: newAverageCost,
          lastCost: parseFloat(unitCost),
          totalValue: totalQuantity * newAverageCost,
          lastStockedDate: new Date(),
          lowStockAlert: totalQuantity <= inventory.reorderPoint,
          excessStockAlert: totalQuantity > inventory.maximumStock
        }
      });

      // Create stock movement record
      await tx.stockMovement.create({
        data: {
          productId,
          branchId,
          batchId: batch.id,
          movementType: 'PURCHASE_IN',
          quantity: parseInt(quantity),
          previousStock: inventory.currentStock,
          newStock: totalQuantity,
          unitCost: parseFloat(unitCost),
          totalCost: parseInt(quantity) * parseFloat(unitCost),
          referenceType: 'PURCHASE',
          batchNumber: batch.batchNumber,
          expiryDate: batch.expiryDate,
          supplierInfo,
          userId
        }
      });

      return { inventory: updatedInventory, batch };
    });

    res.json({
      message: 'Stock received successfully',
      inventory: result.inventory,
      batch: result.batch
    });

  } catch (error) {
    console.error('Error receiving stock:', error);
    res.status(500).json({ 
      error: 'Failed to receive stock',
      details: error.message 
    });
  }
});

// Adjust stock levels (existing functionality)
router.post('/adjust', authenticateToken, requirePermission('inventory:write'), async (req, res) => {
  try {
    const { productId, quantity, reason, branchId = 'main' } = req.body;
    const userId = req.user.id;

    if (!productId || quantity === undefined || !reason) {
      return res.status(400).json({ error: 'Missing required fields: productId, quantity, reason' });
    }

    const result = await prisma.$transaction(async (tx) => {
      const inventory = await tx.inventory.findUnique({
        where: {
          productId_branchId: {
            productId,
            branchId
          }
        }
      });

      if (!inventory) {
        throw new Error('Inventory record not found');
      }

      const adjustmentQuantity = parseInt(quantity);
      const newStock = Math.max(0, inventory.currentStock + adjustmentQuantity);
      const newTotalValue = newStock * inventory.averageCost;

      const updatedInventory = await tx.inventory.update({
        where: { id: inventory.id },
        data: {
          currentStock: newStock,
          totalValue: newTotalValue,
          lowStockAlert: newStock <= inventory.reorderPoint,
          excessStockAlert: newStock > inventory.maximumStock,
          updatedAt: new Date()
        }
      });

      await tx.stockMovement.create({
        data: {
          productId,
          branchId,
          movementType: adjustmentQuantity > 0 ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT',
          quantity: adjustmentQuantity,
          previousStock: inventory.currentStock,
          newStock: newStock,
          unitCost: inventory.averageCost,
          totalCost: Math.abs(adjustmentQuantity) * inventory.averageCost,
          referenceType: 'ADJUSTMENT',
          reason,
          userId
        }
      });

      return updatedInventory;
    });

    res.json({
      message: 'Stock adjusted successfully',
      inventory: result
    });

  } catch (error) {
    console.error('Error adjusting stock:', error);
    res.status(500).json({ 
      error: error.message || 'Failed to adjust stock'
    });
  }
});

// Get expiry alerts
router.get('/expiry-alerts', authenticateToken, requirePermission('inventory:read'), async (req, res) => {
  try {
    const { days = 7, branchId = 'main' } = req.query;

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
      supplierInfo: batch.supplierInfo
    }));

    res.json(alerts);
  } catch (error) {
    console.error('Error fetching expiry alerts:', error);
    res.status(500).json({ error: 'Failed to fetch expiry alerts' });
  }
});

// Mark batch as expired
router.post('/mark-expired', authenticateToken, requirePermission('inventory:write'), async (req, res) => {
  try {
    const { batchId, reason = 'Expired' } = req.body;
    const userId = req.user.id;

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

      await tx.stockMovement.create({
        data: {
          productId: batch.inventory.productId,
          branchId: batch.inventory.branchId,
          batchId: batch.id,
          movementType: 'ADJUSTMENT_OUT',
          quantity: -batch.quantity,
          previousStock: batch.inventory.currentStock,
          newStock: Math.max(0, newStock),
          unitCost: batch.unitCost,
          totalCost: -(batch.quantity * batch.unitCost),
          referenceType: 'EXPIRY',
          reason,
          batchNumber: batch.batchNumber,
          expiryDate: batch.expiryDate,
          userId
        }
      });

      return batch;
    });

    res.json({ message: 'Batch marked as expired', batch: result });
  } catch (error) {
    console.error('Error marking batch as expired:', error);
    res.status(500).json({ error: 'Failed to mark batch as expired' });
  }
});

// Get stock movement history  
router.get('/movements', authenticateToken, requirePermission('inventory:read'), async (req, res) => {
  try {
    const { productId, limit = 50, offset = 0, branchId = 'main' } = req.query;

    let whereClause = { branchId };
    if (productId) {
      whereClause.productId = productId;
    }

    const movements = await prisma.stockMovement.findMany({
      where: whereClause,
      include: {
        product: {
          select: {
            name: true,
            sku: true
          }
        },
        user: {
          select: {
            name: true,
            email: true
          }
        },
        batch: {
          select: {
            batchNumber: true,
            expiryDate: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      },
      take: parseInt(limit),
      skip: parseInt(offset)
    });

    res.json(movements);
  } catch (error) {
    console.error('Error fetching stock movements:', error);
    res.status(500).json({ error: 'Failed to fetch stock movements' });
  }
});

// Get inventory alerts (low stock, excess stock, etc.)
router.get('/alerts', authenticateToken, requirePermission('inventory:read'), async (req, res) => {
  try {
    const { branchId = 'main' } = req.query;

    const alerts = await prisma.inventory.findMany({
      where: {
        branchId,
        OR: [
          { lowStockAlert: true },
          { excessStockAlert: true },
          { currentStock: 0 }
        ]
      },
      include: {
        product: {
          select: {
            id: true,
            name: true,
            sku: true,
            price: true
          }
        }
      },
      orderBy: [
        { lowStockAlert: 'desc' },
        { currentStock: 'asc' }
      ]
    });

    const categorizedAlerts = {
      lowStock: alerts.filter(item => item.lowStockAlert),
      excessStock: alerts.filter(item => item.excessStockAlert),
      outOfStock: alerts.filter(item => item.currentStock === 0)
    };

    res.json(categorizedAlerts);
  } catch (error) {
    console.error('Error fetching alerts:', error);
    res.status(500).json({ error: 'Failed to fetch alerts' });
  }
});

module.exports = router;
