/**
 * V1 register/till model — CRUD for Register (checkout station) and Till
 * (its cash drawer). Gated the same way PrinterProfile CRUD is
 * (settings:read/settings:write) — configuring physical stations is an
 * administrative task, not a till-operating one.
 */
const express = require('express');
const router = express.Router();
const { authenticateToken, requirePermission } = require('../middleware/auth');
const auditService = require('../services/auditService');
const {
  createRegister,
  listRegisters,
  updateRegister,
  createTill,
  listTills,
  getTill,
  updateTill,
} = require('../lib/register');

router.get('/', authenticateToken, requirePermission('settings:read'), async (req, res) => {
  try {
    const registers = await listRegisters({
      branchId: req.query.branchId,
      includeInactive: req.query.includeInactive === 'true',
    });
    res.json(registers);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Failed to load registers' });
  }
});

router.post('/', authenticateToken, requirePermission('settings:write'), async (req, res) => {
  try {
    const register = await createRegister({
      code: req.body?.code,
      name: req.body?.name,
      branchId: req.body?.branchId,
    });

    auditService.safeLog(auditService.eventTypes.REGISTER_CREATED, {
      ...auditService.contextFromReq(req),
      entityType: 'REGISTER',
      entityId: register.id,
      action: 'CREATE',
      newValues: { code: register.code, name: register.name, branchId: register.branchId },
      description: `Register ${register.code} created by ${req.user.email || req.user.userId}`,
    });

    res.status(201).json(register);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Failed to create register' });
  }
});

router.patch('/:id', authenticateToken, requirePermission('settings:write'), async (req, res) => {
  try {
    const register = await updateRegister(req.params.id, {
      name: req.body?.name,
      isActive: req.body?.isActive,
    });
    res.json(register);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Failed to update register' });
  }
});

router.get('/tills', authenticateToken, requirePermission('settings:read'), async (req, res) => {
  try {
    const tills = await listTills({
      registerId: req.query.registerId,
      includeInactive: req.query.includeInactive === 'true',
    });
    res.json(tills);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Failed to load tills' });
  }
});

router.get('/tills/:id', authenticateToken, requirePermission('settings:read'), async (req, res) => {
  try {
    const till = await getTill(req.params.id);
    res.json(till);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Failed to load till' });
  }
});

router.post('/tills', authenticateToken, requirePermission('settings:write'), async (req, res) => {
  try {
    const till = await createTill({
      code: req.body?.code,
      name: req.body?.name,
      registerId: req.body?.registerId,
      defaultOpeningFloat: req.body?.defaultOpeningFloat,
    });

    auditService.safeLog(auditService.eventTypes.TILL_CREATED, {
      ...auditService.contextFromReq(req),
      entityType: 'TILL',
      entityId: till.id,
      action: 'CREATE',
      newValues: { code: till.code, name: till.name, registerId: till.registerId },
      description: `Till ${till.code} created by ${req.user.email || req.user.userId}`,
    });

    res.status(201).json(till);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Failed to create till' });
  }
});

router.patch('/tills/:id', authenticateToken, requirePermission('settings:write'), async (req, res) => {
  try {
    const till = await updateTill(req.params.id, {
      name: req.body?.name,
      isActive: req.body?.isActive,
      defaultOpeningFloat: req.body?.defaultOpeningFloat,
    });
    res.json(till);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Failed to update till' });
  }
});

module.exports = router;
