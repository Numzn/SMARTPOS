const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');

// Get all sales
router.get('/', async (req, res) => {
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
router.get('/:id', async (req, res) => {
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
router.post('/', async (req, res) => {
  try {
    const { userId, items, paymentMethod, tax, discount } = req.body;
    // items format: [{ productId, quantity, price }]
    
    // Calculate totals
    const subtotal = items.reduce((sum, item) => sum + (item.quantity * item.price), 0);
    const taxAmount = tax || 0;
    const discountAmount = discount || 0;
    const total = subtotal + taxAmount - discountAmount;
    
    // Create sale with transaction
    const sale = await prisma.$transaction(async (tx) => {
      // Create the sale
      const newSale = await tx.sale.create({
        data: {
          userId,
          total: parseFloat(total),
          subtotal: parseFloat(subtotal),
          tax: parseFloat(taxAmount),
          discount: parseFloat(discountAmount),
          paymentMethod: paymentMethod || 'CASH',
          status: 'COMPLETED'
        }
      });
      
      // Create sale items
      const saleItems = await Promise.all(
        items.map(item => 
          tx.saleItem.create({
            data: {
              saleId: newSale.id,
              productId: item.productId,
              quantity: parseInt(item.quantity),
              price: parseFloat(item.price),
              total: parseFloat(item.quantity * item.price)
            }
          })
        )
      );
      
      // Update product stock
      await Promise.all(
        items.map(item =>
          tx.product.update({
            where: { id: item.productId },
            data: {
              stock: {
                decrement: parseInt(item.quantity)
              }
            }
          })
        )
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
router.get('/analytics/summary', async (req, res) => {
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
