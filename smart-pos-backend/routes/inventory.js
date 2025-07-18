const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { authenticateToken, requirePermission, requireAnyPermission } = require('../middleware/auth');

// Get all inventory with product details (requires inventory:read permission)
router.get('/', authenticateToken, requirePermission('inventory:read'), async (req, res) => {
  try {
    const { branchId = 'main', lowStockOnly = false, category } = req.query;
    
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
        }
      },
      orderBy: [
        { lowStockAlert: 'desc' }, // Low stock items first
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
    
    // Calculate summary stats
    const summary = {
      totalProducts: filteredInventory.length,
      totalValue: filteredInventory.reduce((sum, inv) => sum + inv.totalValue, 0),
      lowStockItems: filteredInventory.filter(inv => inv.lowStockAlert).length,
      outOfStockItems: filteredInventory.filter(inv => inv.currentStock === 0).length,
      excessStockItems: filteredInventory.filter(inv => inv.excessStockAlert).length
    };
    
    res.json({
      inventory: filteredInventory,
      summary
    });
  } catch (error) {
    console.error('Error fetching inventory:', error);
    res.status(500).json({ error: 'Failed to fetch inventory' });
  }
});

// Get inventory for specific product
router.get('/product/:productId', authenticateToken, requirePermission('inventory:read'), async (req, res) => {
  try {
    const { productId } = req.params;
    const { branchId = 'main' } = req.query;
    
    const inventory = await prisma.inventory.findUnique({
      where: {
        productId_branchId: {
          productId,
          branchId
        }
      },
      include: {
        product: {
          include: {
            category: true
          }
        }
      }
    });
    
    if (!inventory) {
      return res.status(404).json({ error: 'Inventory record not found' });
    }
    
    // Get recent stock movements
    const recentMovements = await prisma.stockMovement.findMany({
      where: {
        productId,
        branchId
      },
      include: {
        user: {
          select: { name: true, email: true }
        }
      },
      orderBy: {
        createdAt: 'desc'
      },
      take: 10
    });
    
    res.json({
      inventory,
      recentMovements
    });
  } catch (error) {
    console.error('Error fetching product inventory:', error);
    res.status(500).json({ error: 'Failed to fetch product inventory' });
  }
});

// Update inventory levels (stock adjustment)
router.post('/adjust', authenticateToken, requirePermission('inventory:write'), async (req, res) => {
  try {
    const { 
      productId, 
      branchId = 'main', 
      adjustmentType, 
      quantity, 
      reason, 
      unitCost 
    } = req.body;
    
    if (!productId || !adjustmentType || !quantity || !reason) {
      return res.status(400).json({ 
        error: 'Product ID, adjustment type, quantity, and reason are required' 
      });
    }
    
    // Start transaction
    const result = await prisma.$transaction(async (tx) => {
      // Get current inventory
      let inventory = await tx.inventory.findUnique({
        where: {
          productId_branchId: {
            productId,
            branchId
          }
        }
      });
      
      // Create inventory record if it doesn't exist
      if (!inventory) {
        inventory = await tx.inventory.create({
          data: {
            productId,
            branchId,
            currentStock: 0,
            averageCost: unitCost || 0
          }
        });
      }
      
      const previousStock = inventory.currentStock;
      let newStock;
      let movementQuantity;
      
      // Calculate new stock based on adjustment type
      switch (adjustmentType) {
        case 'INCREASE':
        case 'RECOUNT_UP':
          newStock = previousStock + Math.abs(quantity);
          movementQuantity = Math.abs(quantity);
          break;
        case 'DECREASE':
        case 'DAMAGED':
        case 'EXPIRED':
        case 'RECOUNT_DOWN':
          newStock = Math.max(0, previousStock - Math.abs(quantity));
          movementQuantity = -Math.abs(quantity);
          break;
        case 'SET_EXACT':
          newStock = Math.abs(quantity);
          movementQuantity = newStock - previousStock;
          break;
        default:
          throw new Error('Invalid adjustment type');
      }
      
      // Calculate new average cost if unit cost provided
      let newAverageCost = inventory.averageCost;
      if (unitCost && movementQuantity > 0) {
        const totalValue = (inventory.currentStock * inventory.averageCost) + (movementQuantity * unitCost);
        newAverageCost = newStock > 0 ? totalValue / newStock : unitCost;
      }
      
      // Update inventory
      const updatedInventory = await tx.inventory.update({
        where: {
          productId_branchId: {
            productId,
            branchId
          }
        },
        data: {
          currentStock: newStock,
          averageCost: newAverageCost,
          totalValue: newStock * newAverageCost,
          lowStockAlert: newStock <= inventory.reorderPoint,
          excessStockAlert: newStock >= inventory.maximumStock,
          lastCountDate: new Date()
        }
      });
      
      // Create stock movement record
      const stockMovement = await tx.stockMovement.create({
        data: {
          productId,
          branchId,
          movementType: `ADJUSTMENT_${movementQuantity > 0 ? 'IN' : 'OUT'}`,
          quantity: movementQuantity,
          previousStock,
          newStock,
          unitCost,
          totalCost: unitCost ? Math.abs(movementQuantity) * unitCost : null,
          referenceType: 'ADJUSTMENT',
          reason,
          userId: req.user.userId
        }
      });
      
      // Create stock adjustment record for ZRA compliance
      await tx.stockAdjustment.create({
        data: {
          productId,
          adjustmentType: adjustmentType,
          quantity: Math.abs(movementQuantity),
          reason,
          ocrnDt: new Date(),
          userId: req.user.userId
        }
      });
      
      return { updatedInventory, stockMovement };
    });
    
    res.json({
      message: 'Inventory adjusted successfully',
      inventory: result.updatedInventory,
      movement: result.stockMovement
    });
    
  } catch (error) {
    console.error('Error adjusting inventory:', error);
    res.status(500).json({ error: 'Failed to adjust inventory' });
  }
});

// Receive stock (purchase/delivery)
router.post('/receive', authenticateToken, requirePermission('inventory:write'), async (req, res) => {
  try {
    const { 
      productId, 
      branchId = 'main', 
      quantity, 
      unitCost, 
      supplierInfo, 
      batchNumber, 
      expiryDate, 
      notes 
    } = req.body;
    
    if (!productId || !quantity || !unitCost) {
      return res.status(400).json({ 
        error: 'Product ID, quantity, and unit cost are required' 
      });
    }
    
    const result = await prisma.$transaction(async (tx) => {
      // Get or create inventory record
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
            averageCost: 0
          }
        });
      }
      
      const previousStock = inventory.currentStock;
      const newStock = previousStock + Math.abs(quantity);
      
      // Calculate new average cost (weighted average)
      const totalCurrentValue = previousStock * inventory.averageCost;
      const newValue = Math.abs(quantity) * unitCost;
      const newAverageCost = (totalCurrentValue + newValue) / newStock;
      
      // Update inventory
      const updatedInventory = await tx.inventory.update({
        where: {
          productId_branchId: {
            productId,
            branchId
          }
        },
        data: {
          currentStock: newStock,
          averageCost: newAverageCost,
          totalValue: newStock * newAverageCost,
          lastCost: unitCost,
          lastStockedDate: new Date(),
          lowStockAlert: newStock <= inventory.reorderPoint,
          excessStockAlert: newStock >= inventory.maximumStock
        }
      });
      
      // Create stock movement record
      const stockMovement = await tx.stockMovement.create({
        data: {
          productId,
          branchId,
          movementType: 'PURCHASE_IN',
          quantity: Math.abs(quantity),
          previousStock,
          newStock,
          unitCost,
          totalCost: Math.abs(quantity) * unitCost,
          referenceType: 'PURCHASE',
          supplierInfo,
          batchNumber,
          expiryDate: expiryDate ? new Date(expiryDate) : null,
          notes,
          userId: req.user.userId
        }
      });
      
      return { updatedInventory, stockMovement };
    });
    
    res.json({
      message: 'Stock received successfully',
      inventory: result.updatedInventory,
      movement: result.stockMovement
    });
    
  } catch (error) {
    console.error('Error receiving stock:', error);
    res.status(500).json({ error: 'Failed to receive stock' });
  }
});

// Get stock movements history
router.get('/movements', authenticateToken, requirePermission('inventory:read'), async (req, res) => {
  try {
    const { 
      productId, 
      branchId = 'main', 
      movementType, 
      startDate, 
      endDate, 
      limit = 50 
    } = req.query;
    
    let whereClause = { branchId };
    
    if (productId) whereClause.productId = productId;
    if (movementType) whereClause.movementType = movementType;
    if (startDate || endDate) {
      whereClause.createdAt = {};
      if (startDate) whereClause.createdAt.gte = new Date(startDate);
      if (endDate) whereClause.createdAt.lte = new Date(endDate);
    }
    
    const movements = await prisma.stockMovement.findMany({
      where: whereClause,
      include: {
        product: {
          select: { name: true, sku: true }
        },
        user: {
          select: { name: true, email: true }
        }
      },
      orderBy: {
        createdAt: 'desc'
      },
      take: parseInt(limit)
    });
    
    res.json(movements);
  } catch (error) {
    console.error('Error fetching stock movements:', error);
    res.status(500).json({ error: 'Failed to fetch stock movements' });
  }
});

// Get low stock alerts
router.get('/alerts', authenticateToken, requirePermission('inventory:read'), async (req, res) => {
  try {
    const { branchId = 'main' } = req.query;
    
    const lowStockItems = await prisma.inventory.findMany({
      where: {
        branchId,
        lowStockAlert: true
      },
      include: {
        product: {
          include: {
            category: true
          }
        }
      },
      orderBy: [
        { currentStock: 'asc' },
        { product: { name: 'asc' } }
      ]
    });
    
    const outOfStockItems = await prisma.inventory.findMany({
      where: {
        branchId,
        currentStock: 0
      },
      include: {
        product: {
          include: {
            category: true
          }
        }
      },
      orderBy: {
        product: { name: 'asc' }
      }
    });
    
    res.json({
      lowStockItems,
      outOfStockItems,
      summary: {
        lowStockCount: lowStockItems.length,
        outOfStockCount: outOfStockItems.length
      }
    });
  } catch (error) {
    console.error('Error fetching inventory alerts:', error);
    res.status(500).json({ error: 'Failed to fetch inventory alerts' });
  }
});

// Update inventory settings (min/max stock levels)
router.put('/settings/:productId', authenticateToken, requirePermission('inventory:write'), async (req, res) => {
  try {
    const { productId } = req.params;
    const { branchId = 'main', minimumStock, maximumStock, reorderPoint, reorderQuantity } = req.body;
    
    const updatedInventory = await prisma.inventory.update({
      where: {
        productId_branchId: {
          productId,
          branchId
        }
      },
      data: {
        minimumStock,
        maximumStock,
        reorderPoint,
        reorderQuantity,
        lowStockAlert: minimumStock ? await prisma.inventory.findUnique({
          where: { productId_branchId: { productId, branchId } },
          select: { currentStock: true }
        }).then(inv => inv?.currentStock <= minimumStock) : undefined
      }
    });
    
    res.json({
      message: 'Inventory settings updated successfully',
      inventory: updatedInventory
    });
  } catch (error) {
    console.error('Error updating inventory settings:', error);
    res.status(500).json({ error: 'Failed to update inventory settings' });
  }
});

module.exports = router;
