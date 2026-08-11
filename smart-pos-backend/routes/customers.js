const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const auditService = require('../services/auditService');
const { toCsv } = require('../lib/csv');
const { authenticateToken, requirePermission } = require('../middleware/auth');

const UPDATABLE_FIELDS = ['name', 'phone', 'email', 'tpin', 'address', 'notes'];

function actorId(req) {
  return req.user?.userId || req.user?.id || null;
}

function pickUpdatable(body) {
  const data = {};
  for (const key of UPDATABLE_FIELDS) {
    if (body[key] !== undefined) data[key] = body[key];
  }
  return data;
}

/** GET /api/customers?q=search */
router.get('/', authenticateToken, requirePermission('customers:read'), async (req, res) => {
  try {
    const where = { isActive: true };
    if (req.query.q) {
      const q = String(req.query.q);
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { phone: { contains: q } },
        { tpin: { contains: q } },
      ];
    }

    const customers = await prisma.customer.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    res.json({ success: true, customers, total: customers.length });
  } catch (error) {
    console.error('Error fetching customers:', error.message);
    res.status(500).json({ success: false, error: 'Failed to fetch customers' });
  }
});


/**
 * GET /api/customers/export — customers as CSV, including deactivated ones so the
 * file is a complete record rather than only what the list screen shows.
 */
router.get('/export', authenticateToken, requirePermission('customers:read'), async (req, res) => {
  try {
    const records = await prisma.customer.findMany({ orderBy: { name: 'asc' } });
    const csv = toCsv(
      ['name', 'phone', 'email', 'tpin', 'address', 'notes', 'isActive', 'createdAt'],
      records.map((r) => [
      r.name ?? '',
      r.phone ?? '',
      r.email ?? '',
      r.tpin ?? '',
      r.address ?? '',
      r.notes ?? '',
      r.isActive ?? '',
      new Date(r.createdAt).toISOString(),
      ])
    );
    const filename = `customers_${new Date().toISOString().slice(0, 10)}.csv`;

    auditService.safeLog(auditService.eventTypes.DATA_EXPORT, {
      ...auditService.contextFromReq(req),
      entityType: 'CUSTOMER',
      action: 'EXPORT_CUSTOMERS_CSV',
      description: `Exported ${records.length} customers to CSV (${filename})`,
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(csv);
  } catch (error) {
    console.error('Error exporting customers:', error.message);
    return res.status(500).json({ error: 'Failed to export customers' });
  }
});

/**
 * GET /api/customers/zra-lookup?tpin=... — on-demand ZRA customer lookup
 * (VSDC POST /customers/selectCustomer). Read-only; does not touch local
 * data. Registered before /:id — a literal path must come first or /:id
 * would swallow it (same reason /export sits above /:id already).
 */
router.get('/zra-lookup', authenticateToken, requirePermission('customers:read'), async (req, res) => {
  try {
    const tpin = req.query.tpin;
    if (!tpin) {
      return res.status(400).json({ success: false, error: 'tpin query parameter is required' });
    }

    const vsdcGateway = require('../lib/vsdc-gateway');
    const result = await vsdcGateway.selectCustomer(String(tpin));

    res.json({ success: true, found: result.found, customer: result.customer });
  } catch (error) {
    console.error('Error looking up ZRA customer:', error.message);
    res.status(500).json({ success: false, error: 'Failed to look up customer on ZRA' });
  }
});

/** GET /api/customers/:id */
router.get('/:id', authenticateToken, requirePermission('customers:read'), async (req, res) => {
  try {
    const customer = await prisma.customer.findUnique({
      where: { id: req.params.id },
      include: {
        sales: {
          take: 10,
          orderBy: { createdAt: 'desc' },
          select: { id: true, total: true, createdAt: true, status: true, rcptNo: true },
        },
        _count: { select: { sales: true } },
      },
    });

    if (!customer) {
      return res.status(404).json({ success: false, error: 'Customer not found' });
    }

    res.json({
      success: true,
      customer: { ...customer, salesCount: customer._count.sales, recentSales: customer.sales },
    });
  } catch (error) {
    console.error('Error fetching customer:', error.message);
    res.status(500).json({ success: false, error: 'Failed to fetch customer' });
  }
});

/** GET /api/customers/:id/sales-history */
router.get(
  '/:id/sales-history',
  authenticateToken,
  requirePermission('customers:read'),
  async (req, res) => {
    try {
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));

      const [sales, total] = await Promise.all([
        prisma.sale.findMany({
          where: { customerId: req.params.id },
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.sale.count({ where: { customerId: req.params.id } }),
      ]);

      res.json({ success: true, sales, total, page, limit });
    } catch (error) {
      console.error('Error fetching customer sales history:', error.message);
      res.status(500).json({ success: false, error: 'Failed to fetch sales history' });
    }
  }
);

/** POST /api/customers */
router.post('/', authenticateToken, requirePermission('customers:write'), async (req, res) => {
  try {
    const { name, phone, email, tpin, address, notes } = req.body;

    if (!name) {
      return res.status(400).json({ success: false, error: 'Name is required' });
    }

    const customer = await prisma.customer.create({
      data: { name, phone, email, tpin, address, notes, createdBy: actorId(req) },
    });

    auditService.safeLog(auditService.eventTypes.CUSTOMER_CREATE, {
      ...auditService.contextFromReq(req),
      entityType: 'CUSTOMER',
      entityId: customer.id,
      action: 'CREATE',
      newValues: { name: customer.name, phone: customer.phone, tpin: customer.tpin },
      description: `Customer created: ${customer.name}`,
    });

    res.status(201).json({ success: true, customer, message: 'Customer created successfully' });
  } catch (error) {
    console.error('Error creating customer:', error.message);
    res.status(500).json({ success: false, error: 'Failed to create customer' });
  }
});

/** PUT /api/customers/:id */
router.put('/:id', authenticateToken, requirePermission('customers:write'), async (req, res) => {
  try {
    const existing = await prisma.customer.findUnique({ where: { id: req.params.id } });
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Customer not found' });
    }

    const data = pickUpdatable(req.body);
    if (Object.keys(data).length === 0) {
      return res.status(400).json({ success: false, error: 'No updatable fields provided' });
    }

    const customer = await prisma.customer.update({
      where: { id: req.params.id },
      data: { ...data, updatedBy: actorId(req) },
    });

    auditService.safeLog(auditService.eventTypes.CUSTOMER_UPDATE, {
      ...auditService.contextFromReq(req),
      entityType: 'CUSTOMER',
      entityId: customer.id,
      action: 'UPDATE',
      oldValues: existing,
      newValues: data,
      description: `Customer updated: ${customer.name}`,
    });

    res.json({ success: true, customer, message: 'Customer updated successfully' });
  } catch (error) {
    console.error('Error updating customer:', error.message);
    res.status(500).json({ success: false, error: 'Failed to update customer' });
  }
});

/** DELETE /api/customers/:id — soft deactivate */
router.delete('/:id', authenticateToken, requirePermission('customers:delete'), async (req, res) => {
  try {
    const customer = await prisma.customer.findUnique({ where: { id: req.params.id } });
    if (!customer) {
      return res.status(404).json({ success: false, error: 'Customer not found' });
    }

    await prisma.customer.update({
      where: { id: req.params.id },
      data: { isActive: false, deactivatedAt: new Date(), deactivatedBy: actorId(req) },
    });

    auditService.safeLog(auditService.eventTypes.CUSTOMER_DELETE, {
      ...auditService.contextFromReq(req),
      entityType: 'CUSTOMER',
      entityId: customer.id,
      action: 'DEACTIVATE',
      description: `Customer deactivated: ${customer.name}`,
    });

    res.json({ success: true, message: 'Customer deactivated successfully' });
  } catch (error) {
    console.error('Error deactivating customer:', error.message);
    res.status(500).json({ success: false, error: 'Failed to deactivate customer' });
  }
});

/**
 * POST /api/customers/:id/zra-sync — push this customer to ZRA as a branch
 * customer (VSDC POST /branches/saveBrancheCustomers). Only valid once the
 * customer has a tpin — that's the actual business trigger per the spec
 * (custTpin is a required field), not "sync every customer".
 */
router.post('/:id/zra-sync', authenticateToken, requirePermission('zra:sync'), async (req, res) => {
  try {
    const customer = await prisma.customer.findUnique({ where: { id: req.params.id } });
    if (!customer) {
      return res.status(404).json({ success: false, error: 'Customer not found' });
    }
    if (!customer.tpin) {
      return res.status(400).json({
        success: false,
        error: 'Customer has no TPIN — cannot register as a ZRA branch customer (custTpin is required by the spec)',
      });
    }

    const vsdcGateway = require('../lib/vsdc-gateway');
    const actor = { id: actorId(req), name: req.user?.name, email: req.user?.email };

    try {
      await vsdcGateway.saveBranchCustomer(customer, actor);
    } catch (zraError) {
      return res.status(422).json({ success: false, error: zraError.message });
    }

    const updated = await prisma.customer.findUnique({ where: { id: customer.id } });

    auditService.safeLog(auditService.eventTypes.CUSTOMER_ZRA_SYNC, {
      ...auditService.contextFromReq(req),
      entityType: 'CUSTOMER',
      entityId: customer.id,
      action: 'ZRA_SYNC',
      description: `Customer synced to ZRA as branch customer: ${customer.name} (${customer.tpin})`,
    });

    res.json({ success: true, customer: updated, message: 'Customer registered with ZRA' });
  } catch (error) {
    console.error('Error syncing customer to ZRA:', error.message);
    res.status(500).json({ success: false, error: 'Failed to sync customer to ZRA' });
  }
});

module.exports = router;
