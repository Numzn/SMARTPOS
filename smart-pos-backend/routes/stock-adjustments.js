const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { authenticateToken, requirePermission } = require('../middleware/auth');

// Get all stock adjustments (requires inventory:read permission)
router.get('/', authenticateToken, requirePermission('inventory:read'), async (req, res) => {
  try {
    const adjustments = await prisma.stockAdjustment.findMany({
      include: {
        product: {
          select: {
            id: true,
            name: true,
            sku: true,
            stock: true
          }
        },
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
    res.json(adjustments);
  } catch (error) {
    console.error('Error fetching stock adjustments:', error);
    res.status(500).json({ error: 'Failed to fetch stock adjustments' });
  }
});

// Create stock adjustment (requires inventory:write permission)
router.post('/', authenticateToken, requirePermission('inventory:write'), async (req, res) => {
  try {
    const { productId, adjustmentType, quantity, reason, occurrenceDate } = req.body;
    const userId = req.user.userId;
    
    // Validate required fields
    if (!productId || !adjustmentType || !quantity || !reason) {
      return res.status(400).json({ 
        error: 'Missing required fields: productId, adjustmentType, quantity, reason' 
      });
    }
    
    // Validate adjustment type
    const validTypes = ['INCREASE', 'DECREASE', 'RECOUNT', 'DAMAGED', 'EXPIRED'];
    if (!validTypes.includes(adjustmentType)) {
      return res.status(400).json({ 
        error: 'Invalid adjustment type. Must be one of: ' + validTypes.join(', ') 
      });
    }
    
    // Use provided occurrence date or current time
    const ocrnDt = occurrenceDate ? new Date(occurrenceDate) : new Date();
    
    const result = await prisma.$transaction(async (tx) => {
      // Get current product
      const product = await tx.product.findUnique({
        where: { id: productId }
      });
      
      if (!product) {
        throw new Error('Product not found');
      }
      
      // Calculate new stock level
      let newStock = product.stock;
      const adjustmentQty = parseInt(quantity);
      
      switch (adjustmentType) {
        case 'INCREASE':
          newStock += adjustmentQty;
          break;
        case 'DECREASE':
        case 'DAMAGED':
        case 'EXPIRED':
          newStock -= adjustmentQty;
          break;
        case 'RECOUNT':
          newStock = adjustmentQty; // Set exact quantity
          break;
      }
      
      // Ensure stock doesn't go negative
      if (newStock < 0) {
        throw new Error('Stock adjustment would result in negative inventory');
      }
      
      // Create adjustment record
      const adjustment = await tx.stockAdjustment.create({
        data: {
          productId,
          adjustmentType,
          quantity: adjustmentQty,
          reason,
          ocrnDt, // ZRA required occurrence date field
          userId
        }
      });
      
      // Update product stock
      await tx.product.update({
        where: { id: productId },
        data: { stock: newStock }
      });
      
      return adjustment;
    });
    
    // Fetch complete adjustment data
    const completeAdjustment = await prisma.stockAdjustment.findUnique({
      where: { id: result.id },
      include: {
        product: {
          select: {
            id: true,
            name: true,
            sku: true,
            stock: true
          }
        },
        user: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      }
    });
    
    res.status(201).json(completeAdjustment);
  } catch (error) {
    console.error('Error creating stock adjustment:', error);
    if (error.message === 'Product not found') {
      return res.status(404).json({ error: error.message });
    }
    if (error.message === 'Stock adjustment would result in negative inventory') {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: 'Failed to create stock adjustment' });
  }
});

// Get stock adjustment by ID
router.get('/:id', authenticateToken, requirePermission('inventory:read'), async (req, res) => {
  try {
    const adjustment = await prisma.stockAdjustment.findUnique({
      where: { id: req.params.id },
      include: {
        product: {
          select: {
            id: true,
            name: true,
            sku: true,
            stock: true
          }
        },
        user: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      }
    });
    
    if (!adjustment) {
      return res.status(404).json({ error: 'Stock adjustment not found' });
    }
    
    res.json(adjustment);
  } catch (error) {
    console.error('Error fetching stock adjustment:', error);
    res.status(500).json({ error: 'Failed to fetch stock adjustment' });
  }
});

// Get adjustments for a specific product
router.get('/product/:productId', authenticateToken, requirePermission('inventory:read'), async (req, res) => {
  try {
    const adjustments = await prisma.stockAdjustment.findMany({
      where: { productId: req.params.productId },
      include: {
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
    
    res.json(adjustments);
  } catch (error) {
    console.error('Error fetching product adjustments:', error);
    res.status(500).json({ error: 'Failed to fetch product adjustments' });
  }
});

module.exports = router;
