const express = require('express');
const {
  planInventoryImport,
  applyInventoryImport,
  exportInventoryCsv,
} = require('../../lib/inventoryImport');
const router = express.Router();
const prisma = require('../../lib/prisma');
const { authenticateToken, requirePermission } = require('../../middleware/auth');
const { receiveStock } = require('../../lib/receiving');
const { DEFAULT_BRANCH } = require('../../lib/inventoryStock');
const stockSyncService = require('../../services/stockSyncService');
const auditService = require('../../services/auditService');

// Get all inventory with product details and expiry tracking
router.get('/', authenticateToken, requirePermission('inventory:read'), async (req, res) => {
  try {
    const { branchId = 'main', lowStockOnly = false, category, includeExpired = false, expiryFilter } = req.query;
    
    console.log('🔍 Fetching inventory for branch:', branchId);
    
    // 🔥 Fetch ALL products and their inventory (or create missing inventory)
    const products = await prisma.product.findMany({
      include: {
        category: true,
        inventory: {
          where: { branchId }
        },
        InventoryItem: {
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
      orderBy: { name: 'asc' }
    });

    console.log(`📦 Found ${products.length} products`);

    // Create inventory records for products that don't have them and process data
    const inventoryData = await Promise.all(
      products.map(async (product) => {
        let inventory = product.inventory[0];
        
        if (!inventory) {
          // Create missing inventory record
          console.log(`🔧 Creating missing inventory for: ${product.name}`);
          inventory = await prisma.inventory.create({
            data: {
              productId: product.id,
              branchId,
              currentStock: 0,
              minimumStock: product.minStockLevel || 10,
              maximumStock: 1000,
              reorderPoint: product.minStockLevel || 10,
              reorderQuantity: 100,
              averageCost: product.cost || product.price,
              lastCost: product.cost || product.price,
              totalValue: 0,
              lowStockAlert: true,
              excessStockAlert: false
            }
          });
        }

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

        // Process batches with expiry information
        const processedBatches = product.InventoryItem.map(batch => ({
          ...batch,
          daysUntilExpiry: calculateDaysUntilExpiry(batch.expiryDate),
          expiryStatus: getExpiryStatus(batch.expiryDate)
        }));

        // Calculate expiry alerts
        const expiringBatches = processedBatches.filter(batch => {
          if (!batch.expiryDate) return false;
          const status = batch.expiryStatus;
          return ['EXPIRED', 'EXPIRES_TODAY', 'EXPIRES_SOON', 'NEAR_EXPIRY'].includes(status);
        });

        const nearestExpiry = processedBatches
          .filter(batch => batch.expiryDate && batch.quantity > 0)
          .sort((a, b) => new Date(a.expiryDate) - new Date(b.expiryDate))[0];

        return {
          ...inventory,
          product: {
            id: product.id,
            name: product.name,
            sku: product.sku,
            price: product.price,
            category: product.category
          },
          batches: processedBatches,
          expiryAlerts: {
            hasExpiringItems: expiringBatches.length > 0,
            expiringBatchCount: expiringBatches.length,
            nearestExpiryDate: nearestExpiry?.expiryDate,
            nearestExpiryDays: nearestExpiry ? calculateDaysUntilExpiry(nearestExpiry.expiryDate) : null
          }
        };
      })
    );

    // Apply filters
    let filteredInventory = inventoryData;
    
    if (lowStockOnly === 'true') {
      filteredInventory = inventoryData.filter(inv => inv.lowStockAlert);
    }

    if (category) {
      filteredInventory = filteredInventory.filter(inv => 
        inv.product.category.name.toLowerCase().includes(category.toLowerCase())
      );
    }

    // Apply expiry filter if specified
    if (expiryFilter) {
      filteredInventory = filteredInventory.filter(item => {
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
    const totalExpiringBatches = filteredInventory.reduce((sum, inv) => 
      sum + inv.expiryAlerts.expiringBatchCount, 0);

    const summary = {
      totalProducts: filteredInventory.length,
      totalValue: filteredInventory.reduce((sum, inv) => sum + inv.totalValue, 0),
      lowStockItems: filteredInventory.filter(inv => inv.lowStockAlert).length,
      outOfStockItems: filteredInventory.filter(inv => inv.currentStock === 0).length,
      excessStockItems: filteredInventory.filter(inv => inv.excessStockAlert).length,
      expiringItems: filteredInventory.filter(inv => inv.expiryAlerts.hasExpiringItems).length,
      totalExpiringBatches
    };

    console.log(`✅ Returning ${filteredInventory.length} inventory items`);

    res.json({
      inventory: filteredInventory,
      summary
    });
  } catch (error) {
    console.error('❌ Error fetching inventory:', error);
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
    
    const userId = req.user.userId;

    // Validate required fields
    if (!productId || !quantity || !unitCost) {
      return res.status(400).json({ error: 'Missing required fields: productId, quantity, unitCost' });
    }

    const result = await prisma.$transaction((tx) =>
      receiveStock(tx, {
        productId,
        quantity,
        unitCost,
        branchId,
        supplierInfo,
        batchNumber,
        expiryDate,
        receivedDate,
        userId,
      })
    );

    res.json({
      message: 'Stock received successfully',
      inventory: result.updatedInventory,
      batch: result.inventoryBatch,
      movement: result.stockMovement
    });

    auditService.safeLog(auditService.eventTypes.STOCK_RECEIVE, {
      ...auditService.contextFromReq(req),
      entityType: 'PRODUCT',
      entityId: productId,
      action: 'RECEIVE',
      newValues: {
        branchId,
        quantity: Math.abs(parseInt(quantity)),
        unitCost: parseFloat(unitCost),
        newStock: result.updatedInventory.currentStock,
        batchNumber: result.inventoryBatch.batchNumber,
        supplier: supplierInfo || 'Unknown',
      },
      description: `Stock received: ${Math.abs(parseInt(quantity))} of ${productId} @ ${branchId}`,
    });

    if (result.stockMovement?.id) {
      stockSyncService.syncMovementById(result.stockMovement.id).catch((err) => {
        console.warn('[inventory/receive] stock sync failed:', err.message);
      });
    }
    
  } catch (error) {
    console.error('❌ Error receiving stock:', error);
    res.status(500).json({ 
      error: 'Failed to receive stock',
      details: error.message 
    });
  }
});


/**
 * GET /api/inventory/export — current stock as CSV.
 *
 * Doubles as the stock-take sheet: the `counted` column is emitted blank so it
 * can be printed or opened, filled in, and fed straight back to /import.
 */
router.get('/export', authenticateToken, requirePermission('inventory:read'), async (req, res) => {
  try {
    const branchId = req.query.branchId || DEFAULT_BRANCH;
    const csv = await exportInventoryCsv({ branchId });
    const filename = `stock_take_${branchId}_${new Date().toISOString().slice(0, 10)}.csv`;

    auditService.safeLog(auditService.eventTypes.DATA_EXPORT, {
      ...auditService.contextFromReq(req),
      entityType: 'INVENTORY',
      action: 'EXPORT_STOCK_CSV',
      description: `Exported stock for branch ${branchId} to CSV (${filename})`,
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(csv);
  } catch (error) {
    console.error('Error exporting inventory:', error.message);
    return res.status(error.status || 500).json({ error: error.message || 'Failed to export stock' });
  }
});

/**
 * POST /api/inventory/import — body { csv, commit, branchId, reason }.
 *
 * A stock take, not a bulk overwrite. The file carries counted quantities;
 * each differing row becomes a RECOUNT adjustment through the same path the
 * manual screen uses, so every change lands in the stock ledger and the ZRA
 * audit trail. Preview-first, and refused wholesale if any row is invalid.
 */
router.post('/import', authenticateToken, requirePermission('inventory:write'), async (req, res) => {
  try {
    const { csv, commit, branchId = DEFAULT_BRANCH, reason } = req.body || {};
    if (typeof csv !== 'string' || !csv.trim()) {
      return res.status(400).json({ error: 'No CSV content was provided' });
    }

    if (!commit) {
      return res.json({ dryRun: true, ...(await planInventoryImport(csv, { branchId })) });
    }

    const result = await applyInventoryImport(csv, {
      branchId,
      reason,
      userId: req.user.userId,
    });

    auditService.safeLog(auditService.eventTypes.STOCK_ADJUSTMENT, {
      ...auditService.contextFromReq(req),
      entityType: 'INVENTORY',
      action: 'IMPORT_STOCK_TAKE_CSV',
      newValues: result,
      description:
        `Stock take imported for branch ${branchId}: ` +
        `${result.increased} increased, ${result.decreased} decreased, net ${result.netUnits} unit(s)`,
    });

    return res.json({ dryRun: false, ...result });
  } catch (error) {
    console.error('Error importing stock take:', error.message);
    return res
      .status(error.status || 500)
      .json({ error: error.message || 'Failed to import stock take', plan: error.plan });
  }
});

module.exports = router;
