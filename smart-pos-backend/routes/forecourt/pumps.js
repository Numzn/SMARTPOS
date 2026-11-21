/**
 * Forecourt pump CRUD. Gated the same way Register/Till CRUD is
 * (forecourt:read/forecourt:write) — configuring a physical pump is an
 * administrative task.
 */
const express = require('express');
const router = express.Router();
const { authenticateToken, requirePermission } = require('../../middleware/auth');
const auditService = require('../../services/auditService');
const { createPump, listPumps, updatePump } = require('../../lib/forecourt/pump');

router.get('/pumps', authenticateToken, requirePermission('forecourt:read'), async (req, res) => {
  try {
    const pumps = await listPumps({
      branchId: req.query.branchId,
      includeInactive: req.query.includeInactive === 'true',
    });
    res.json(pumps);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Failed to load pumps' });
  }
});

router.post('/pumps', authenticateToken, requirePermission('forecourt:write'), async (req, res) => {
  try {
    const pump = await createPump({
      code: req.body?.code,
      name: req.body?.name,
      branchId: req.body?.branchId,
    });

    auditService.safeLog(auditService.eventTypes.PUMP_CREATED, {
      ...auditService.contextFromReq(req),
      entityType: 'PUMP',
      entityId: pump.id,
      action: 'CREATE',
      newValues: { code: pump.code, name: pump.name, branchId: pump.branchId },
      description: `Pump ${pump.code} created by ${req.user.email || req.user.userId}`,
    });

    res.status(201).json(pump);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Failed to create pump' });
  }
});

router.patch('/pumps/:id', authenticateToken, requirePermission('forecourt:write'), async (req, res) => {
  try {
    const pump = await updatePump(req.params.id, {
      name: req.body?.name,
      status: req.body?.status,
    });
    res.json(pump);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Failed to update pump' });
  }
});

module.exports = router;
