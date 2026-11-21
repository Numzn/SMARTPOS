/**
 * Forecourt attendant roster CRUD. Gated the same way Register/Till CRUD is
 * (forecourt:read/forecourt:write) — configuring the attendant roster is an
 * administrative task, distinct from forecourt:settle (clearing).
 */
const express = require('express');
const router = express.Router();
const { authenticateToken, requirePermission } = require('../../middleware/auth');
const auditService = require('../../services/auditService');
const { createAttendant, listAttendants, updateAttendant } = require('../../lib/forecourt/attendant');

router.get('/attendants', authenticateToken, requirePermission('forecourt:read'), async (req, res) => {
  try {
    const attendants = await listAttendants({
      branchId: req.query.branchId,
      includeInactive: req.query.includeInactive === 'true',
    });
    res.json(attendants);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Failed to load attendants' });
  }
});

router.post('/attendants', authenticateToken, requirePermission('forecourt:write'), async (req, res) => {
  try {
    const attendant = await createAttendant({
      name: req.body?.name,
      attendantCode: req.body?.attendantCode,
      branchId: req.body?.branchId,
      userId: req.body?.userId,
    });

    auditService.safeLog(auditService.eventTypes.ATTENDANT_CREATED, {
      ...auditService.contextFromReq(req),
      entityType: 'ATTENDANT',
      entityId: attendant.id,
      action: 'CREATE',
      newValues: { name: attendant.name, attendantCode: attendant.attendantCode, branchId: attendant.branchId },
      description: `Attendant ${attendant.attendantCode} created by ${req.user.email || req.user.userId}`,
    });

    res.status(201).json(attendant);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Failed to create attendant' });
  }
});

router.patch('/attendants/:id', authenticateToken, requirePermission('forecourt:write'), async (req, res) => {
  try {
    const attendant = await updateAttendant(req.params.id, {
      name: req.body?.name,
      status: req.body?.status,
    });
    res.json(attendant);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Failed to update attendant' });
  }
});

module.exports = router;
