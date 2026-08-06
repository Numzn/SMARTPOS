const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { createSupplierReturn } = require('../lib/supplierReturn');
const { authenticateToken, requirePermission } = require('../middleware/auth');
const { DEFAULT_BRANCH } = require('../lib/inventoryStock');
const auditService = require('../services/auditService');

const returnInclude = {
  supplier: true,
  items: { include: { product: { select: { id: true, name: true, sku: true } } } },
};

function actorId(req) {
  return req.user?.userId || req.user?.id || null;
}

/** GET /api/supplier-returns */
router.get('/', authenticateToken, requirePermission('purchasing:read'), async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
    const where = {};
    if (req.query.supplierId) where.supplierId = req.query.supplierId;
    if (req.query.branchId) where.branchId = req.query.branchId;

    const [supplierReturns, total] = await Promise.all([
      prisma.supplierReturn.findMany({
        where,
        include: returnInclude,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.supplierReturn.count({ where }),
    ]);

    res.json({ success: true, supplierReturns, total, page, limit });
  } catch (error) {
    console.error('Error listing supplier returns:', error.message);
    res.status(500).json({ success: false, error: 'Failed to list supplier returns' });
  }
});

/** GET /api/supplier-returns/:id */
router.get('/:id', authenticateToken, requirePermission('purchasing:read'), async (req, res) => {
  try {
    const supplierReturn = await prisma.supplierReturn.findUnique({
      where: { id: req.params.id },
      include: returnInclude,
    });
    if (!supplierReturn) {
      return res.status(404).json({ success: false, error: 'Supplier return not found' });
    }
    res.json({ success: true, supplierReturn });
  } catch (error) {
    console.error('Error fetching supplier return:', error.message);
    res.status(500).json({ success: false, error: 'Failed to fetch supplier return' });
  }
});

/** POST /api/supplier-returns */
router.post('/', authenticateToken, requirePermission('purchasing:write'), async (req, res) => {
  try {
    const supplierReturn = await createSupplierReturn({
      supplierId: req.body.supplierId,
      branchId: req.body.branchId || DEFAULT_BRANCH,
      items: req.body.items,
      reason: req.body.reason,
      userId: actorId(req),
    });

    auditService.safeLog(auditService.eventTypes.SUPPLIER_RETURN_CREATE, {
      ...auditService.contextFromReq(req),
      entityType: 'SUPPLIER_RETURN',
      entityId: supplierReturn.id,
      action: 'CREATE',
      newValues: { returnNumber: supplierReturn.returnNumber, subtotal: supplierReturn.subtotal },
      description: `Supplier return ${supplierReturn.returnNumber} recorded for ${supplierReturn.supplier?.name}`,
    });

    res.status(201).json({ success: true, supplierReturn });
  } catch (error) {
    console.error('Error creating supplier return:', error.message);
    res.status(error.status || 500).json({ success: false, error: error.message || 'Failed to create supplier return' });
  }
});

module.exports = router;
