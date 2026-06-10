const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const {
  createPendingSale,
  checkoutSale,
  finalizeSaleFiscally,
  saleInclude,
} = require('../lib/saleFiscal');
const { authenticateToken, requirePermission } = require('../middleware/auth');

// Get all sales (requires sales:read permission)
router.get('/', authenticateToken, requirePermission('sales:read'), async (req, res) => {
  try {
    const sales = await prisma.sale.findMany({
      include: saleInclude,
      orderBy: { createdAt: 'desc' },
    });
    res.json(sales);
  } catch (error) {
    console.error('Error fetching sales:', error);
    res.status(500).json({ error: 'Failed to fetch sales' });
  }
});

// Analytics — must be before /:id
router.get('/analytics/summary', authenticateToken, requirePermission('reports:read'), async (req, res) => {
  try {
    const today = new Date();
    const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);

    const completedFilter = { status: 'COMPLETED' };

    const [todaySales, totalSales, todayRevenue, totalRevenue] = await Promise.all([
      prisma.sale.count({
        where: {
          ...completedFilter,
          createdAt: { gte: startOfDay, lt: endOfDay },
        },
      }),
      prisma.sale.count({ where: completedFilter }),
      prisma.sale.aggregate({
        where: {
          ...completedFilter,
          createdAt: { gte: startOfDay, lt: endOfDay },
        },
        _sum: { total: true },
      }),
      prisma.sale.aggregate({
        where: completedFilter,
        _sum: { total: true },
      }),
    ]);

    res.json({
      todaySales,
      totalSales,
      todayRevenue: todayRevenue._sum.total || 0,
      totalRevenue: totalRevenue._sum.total || 0,
    });
  } catch (error) {
    console.error('Error fetching sales analytics:', error);
    res.status(500).json({ error: 'Failed to fetch sales analytics' });
  }
});

/**
 * POST /api/sales/checkout — fiscal-lock checkout (create pending + VSDC + stock on success)
 */
router.post('/checkout', authenticateToken, requirePermission('sales:write'), async (req, res) => {
  try {
    const outcome = await checkoutSale(req.body);

    if (!outcome.success) {
      return res.status(422).json({
        error: outcome.fiscal?.error || 'Fiscal submission failed',
        sale: outcome.sale,
        fiscal: outcome.fiscal,
      });
    }

    res.status(201).json({
      sale: outcome.sale,
      fiscal: outcome.fiscal,
    });
  } catch (error) {
    console.error('Checkout error:', error);
    res.status(error.status || 500).json({ error: error.message || 'Checkout failed' });
  }
});

// Get sale by ID
router.get('/:id', authenticateToken, requirePermission('sales:read'), async (req, res) => {
  try {
    const sale = await prisma.sale.findUnique({
      where: { id: req.params.id },
      include: saleInclude,
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

/**
 * POST /api/sales — create PENDING sale only (no stock deduct, no VSDC)
 * Use /checkout for fiscal-lock flow.
 */
router.post('/', authenticateToken, requirePermission('sales:write'), async (req, res) => {
  try {
    const sale = await createPendingSale(req.body);
    res.status(201).json(sale);
  } catch (error) {
    console.error('Error creating sale:', error);
    res.status(error.status || 500).json({ error: error.message || 'Failed to create sale' });
  }
});

/**
 * POST /api/sales/:id/fiscalize — retry fiscal submission for PENDING/FISCAL_FAILED sales
 */
router.post('/:id/fiscalize', authenticateToken, requirePermission('sales:write'), async (req, res) => {
  try {
    const outcome = await finalizeSaleFiscally(req.params.id, {
      branchId: req.body.branchId,
    });

    if (!outcome.success) {
      return res.status(422).json({
        error: outcome.fiscal?.error || 'Fiscal submission failed',
        sale: outcome.sale,
        fiscal: outcome.fiscal,
      });
    }

    res.json({
      sale: outcome.sale,
      fiscal: outcome.fiscal,
    });
  } catch (error) {
    console.error('Fiscalize error:', error);
    res.status(error.status || 500).json({ error: error.message || 'Fiscalization failed' });
  }
});

module.exports = router;
