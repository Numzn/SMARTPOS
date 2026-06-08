const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { deductStockForSale, DEFAULT_BRANCH } = require('../lib/inventoryStock');
const { authenticateToken, requirePermission } = require('../middleware/auth');

// Get all sales (requires sales:read permission)
router.get('/', authenticateToken, requirePermission('sales:read'), async (req, res) => {
  try {
    const sales = await prisma.sale.findMany({
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true
          }
        },
        saleItems: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                price: true
              }
            }
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });
    res.json(sales);
  } catch (error) {
    console.error('Error fetching sales:', error);
    res.status(500).json({ error: 'Failed to fetch sales' });
  }
});

// Get sale by ID
// Get sale by ID (requires sales:read permission)
router.get('/:id', authenticateToken, requirePermission('sales:read'), async (req, res) => {
  try {
    const sale = await prisma.sale.findUnique({
      where: { id: req.params.id },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true
          }
        },
        saleItems: {
          include: {
            product: true
          }
        }
      }
    });
    
    if (!sale) {
      return res.status(404).json({ error: 'Sale not found' });
    }
    
    res.json(sale);
  } catch (error) {
    console.error('Error fetching sale:', error);
    res.status(500).json({ error: 'Failed to fetch sale' });
  }
});

// Create new sale
// Create new sale (requires sales:write permission)
router.post('/', authenticateToken, requirePermission('sales:write'), async (req, res) => {
  try {
    const { userId, items, paymentMethod, tax, discount, branchId = DEFAULT_BRANCH } = req.body;

    if (!userId || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'userId and items array are required' });
    }

    const subtotal = items.reduce((sum, item) => sum + item.quantity * item.price, 0);
    const taxAmount = tax || 0;
    const discountAmount = discount || 0;
    const total = subtotal + taxAmount - discountAmount;

    const sale = await prisma.$transaction(async (tx) => {
      const newSale = await tx.sale.create({
        data: {
          userId,
          total: parseFloat(total),
          subtotal: parseFloat(subtotal),
          tax: parseFloat(taxAmount),
          discount: parseFloat(discountAmount),
          paymentMethod: paymentMethod || 'CASH',
          status: 'COMPLETED',
        },
      });

      await Promise.all(
        items.map(async (item) => {
          const product = await tx.product.findUnique({
            where: { id: item.productId },
          });

          if (!product) {
            throw new Error(`Product not found: ${item.productId}`);
          }

          const quantity = parseInt(item.quantity, 10);
          const unitPrice = parseFloat(item.price);
          const itemTotal = quantity * unitPrice;
          const taxRate = (product.taxRate ?? 16) / 100;
          const splyAmt = itemTotal;
          const taxblAmt = splyAmt;
          const taxAmt = taxblAmt * taxRate;
          const totAmt = splyAmt + taxAmt;

          await tx.saleItem.create({
            data: {
              saleId: newSale.id,
              productId: item.productId,
              quantity,
              price: unitPrice,
              total: itemTotal,
              pkg: 1,
              qty: quantity,
              prc: unitPrice,
              splyAmt,
              taxblAmt,
              taxAmt,
              totAmt,
            },
          });

          await deductStockForSale(tx, {
            productId: item.productId,
            quantity,
            branchId,
            userId,
            saleId: newSale.id,
          });
        })
      );

      return newSale;
    });
    
    // Fetch complete sale data
    const completeSale = await prisma.sale.findUnique({
      where: { id: sale.id },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true
          }
        },
        saleItems: {
          include: {
            product: true
          }
        }
      }
    });
    
    res.status(201).json(completeSale);
  } catch (error) {
    console.error('Error creating sale:', error);
    res.status(500).json({ error: 'Failed to create sale' });
  }
});

// Get sales summary/analytics
// Get analytics summary (requires reports:read permission)
router.get('/analytics/summary', authenticateToken, requirePermission('reports:read'), async (req, res) => {
  try {
    const today = new Date();
    const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
    
    const [todaySales, totalSales, todayRevenue, totalRevenue] = await Promise.all([
      prisma.sale.count({
        where: {
          createdAt: {
            gte: startOfDay,
            lt: endOfDay
          }
        }
      }),
      prisma.sale.count(),
      prisma.sale.aggregate({
        where: {
          createdAt: {
            gte: startOfDay,
            lt: endOfDay
          }
        },
        _sum: {
          total: true
        }
      }),
      prisma.sale.aggregate({
        _sum: {
          total: true
        }
      })
    ]);
    
    res.json({
      todaySales,
      totalSales,
      todayRevenue: todayRevenue._sum.total || 0,
      totalRevenue: totalRevenue._sum.total || 0
    });
  } catch (error) {
    console.error('Error fetching sales analytics:', error);
    res.status(500).json({ error: 'Failed to fetch sales analytics' });
  }
});

module.exports = router;
