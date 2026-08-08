const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const auditService = require('../services/auditService');
const { toCsv } = require('../lib/csv');
const { authenticateToken, requirePermission } = require('../middleware/auth');

const UPDATABLE_FIELDS = ['name', 'contactPerson', 'phone', 'email', 'tpin', 'address', 'notes'];

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

/** GET /api/suppliers?q=search */
router.get('/', authenticateToken, requirePermission('suppliers:read'), async (req, res) => {
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

    const suppliers = await prisma.supplier.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    res.json({ success: true, suppliers, total: suppliers.length });
  } catch (error) {
    console.error('Error fetching suppliers:', error.message);
    res.status(500).json({ success: false, error: 'Failed to fetch suppliers' });
  }
});


/**
 * GET /api/suppliers/export — suppliers as CSV, including deactivated ones so the
 * file is a complete record rather than only what the list screen shows.
 */
router.get('/export', authenticateToken, requirePermission('suppliers:read'), async (req, res) => {
  try {
    const records = await prisma.supplier.findMany({ orderBy: { name: 'asc' } });
    const csv = toCsv(
      ['name', 'contactPerson', 'phone', 'email', 'tpin', 'address', 'notes', 'isActive', 'createdAt'],
      records.map((r) => [
      r.name ?? '',
      r.contactPerson ?? '',
      r.phone ?? '',
      r.email ?? '',
      r.tpin ?? '',
      r.address ?? '',
      r.notes ?? '',
      r.isActive ?? '',
      new Date(r.createdAt).toISOString(),
      ])
    );
    const filename = `suppliers_${new Date().toISOString().slice(0, 10)}.csv`;

    auditService.safeLog(auditService.eventTypes.DATA_EXPORT, {
      ...auditService.contextFromReq(req),
      entityType: 'SUPPLIER',
      action: 'EXPORT_SUPPLIERS_CSV',
      description: `Exported ${records.length} suppliers to CSV (${filename})`,
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(csv);
  } catch (error) {
    console.error('Error exporting suppliers:', error.message);
    return res.status(500).json({ error: 'Failed to export suppliers' });
  }
});

/** GET /api/suppliers/:id */
router.get('/:id', authenticateToken, requirePermission('suppliers:read'), async (req, res) => {
  try {
    const supplier = await prisma.supplier.findUnique({
      where: { id: req.params.id },
      include: {
        purchaseOrders: {
          take: 10,
          orderBy: { createdAt: 'desc' },
          select: { id: true, poNumber: true, status: true, total: true, createdAt: true },
        },
        _count: { select: { purchaseOrders: true, goodsReceivedNotes: true, supplierReturns: true } },
      },
    });

    if (!supplier) {
      return res.status(404).json({ success: false, error: 'Supplier not found' });
    }

    res.json({
      success: true,
      supplier: {
        ...supplier,
        purchaseOrderCount: supplier._count.purchaseOrders,
        goodsReceivedNoteCount: supplier._count.goodsReceivedNotes,
        supplierReturnCount: supplier._count.supplierReturns,
        recentPurchaseOrders: supplier.purchaseOrders,
      },
    });
  } catch (error) {
    console.error('Error fetching supplier:', error.message);
    res.status(500).json({ success: false, error: 'Failed to fetch supplier' });
  }
});

/** GET /api/suppliers/:id/purchase-history — POs and GRNs for this supplier */
router.get(
  '/:id/purchase-history',
  authenticateToken,
  requirePermission('suppliers:read'),
  async (req, res) => {
    try {
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));

      const [purchaseOrders, poTotal, goodsReceivedNotes, grnTotal] = await Promise.all([
        prisma.purchaseOrder.findMany({
          where: { supplierId: req.params.id },
          include: { items: true },
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.purchaseOrder.count({ where: { supplierId: req.params.id } }),
        prisma.goodsReceivedNote.findMany({
          where: { supplierId: req.params.id },
          include: { items: true },
          orderBy: { receivedDate: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.goodsReceivedNote.count({ where: { supplierId: req.params.id } }),
      ]);

      res.json({
        success: true,
        purchaseOrders,
        purchaseOrderTotal: poTotal,
        goodsReceivedNotes,
        goodsReceivedNoteTotal: grnTotal,
        page,
        limit,
      });
    } catch (error) {
      console.error('Error fetching supplier purchase history:', error.message);
      res.status(500).json({ success: false, error: 'Failed to fetch purchase history' });
    }
  }
);

/** POST /api/suppliers */
router.post('/', authenticateToken, requirePermission('suppliers:write'), async (req, res) => {
  try {
    const { name, contactPerson, phone, email, tpin, address, notes } = req.body;

    if (!name) {
      return res.status(400).json({ success: false, error: 'Name is required' });
    }

    const supplier = await prisma.supplier.create({
      data: { name, contactPerson, phone, email, tpin, address, notes, createdBy: actorId(req) },
    });

    auditService.safeLog(auditService.eventTypes.SUPPLIER_CREATE, {
      ...auditService.contextFromReq(req),
      entityType: 'SUPPLIER',
      entityId: supplier.id,
      action: 'CREATE',
      newValues: { name: supplier.name, phone: supplier.phone, tpin: supplier.tpin },
      description: `Supplier created: ${supplier.name}`,
    });

    res.status(201).json({ success: true, supplier, message: 'Supplier created successfully' });
  } catch (error) {
    console.error('Error creating supplier:', error.message);
    res.status(500).json({ success: false, error: 'Failed to create supplier' });
  }
});

/** PUT /api/suppliers/:id */
router.put('/:id', authenticateToken, requirePermission('suppliers:write'), async (req, res) => {
  try {
    const existing = await prisma.supplier.findUnique({ where: { id: req.params.id } });
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Supplier not found' });
    }

    const data = pickUpdatable(req.body);
    if (Object.keys(data).length === 0) {
      return res.status(400).json({ success: false, error: 'No updatable fields provided' });
    }

    const supplier = await prisma.supplier.update({
      where: { id: req.params.id },
      data: { ...data, updatedBy: actorId(req) },
    });

    auditService.safeLog(auditService.eventTypes.SUPPLIER_UPDATE, {
      ...auditService.contextFromReq(req),
      entityType: 'SUPPLIER',
      entityId: supplier.id,
      action: 'UPDATE',
      oldValues: existing,
      newValues: data,
      description: `Supplier updated: ${supplier.name}`,
    });

    res.json({ success: true, supplier, message: 'Supplier updated successfully' });
  } catch (error) {
    console.error('Error updating supplier:', error.message);
    res.status(500).json({ success: false, error: 'Failed to update supplier' });
  }
});

/** DELETE /api/suppliers/:id — soft deactivate */
router.delete('/:id', authenticateToken, requirePermission('suppliers:delete'), async (req, res) => {
  try {
    const supplier = await prisma.supplier.findUnique({ where: { id: req.params.id } });
    if (!supplier) {
      return res.status(404).json({ success: false, error: 'Supplier not found' });
    }

    await prisma.supplier.update({
      where: { id: req.params.id },
      data: { isActive: false, deactivatedAt: new Date(), deactivatedBy: actorId(req) },
    });

    auditService.safeLog(auditService.eventTypes.SUPPLIER_DELETE, {
      ...auditService.contextFromReq(req),
      entityType: 'SUPPLIER',
      entityId: supplier.id,
      action: 'DEACTIVATE',
      description: `Supplier deactivated: ${supplier.name}`,
    });

    res.json({ success: true, message: 'Supplier deactivated successfully' });
  } catch (error) {
    console.error('Error deactivating supplier:', error.message);
    res.status(500).json({ success: false, error: 'Failed to deactivate supplier' });
  }
});

module.exports = router;
