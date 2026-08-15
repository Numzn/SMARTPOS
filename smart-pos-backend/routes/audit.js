const express = require('express');
const router = express.Router();
const auditService = require('../services/auditService');
const { authenticateToken, requirePermission } = require('../middleware/auth');

/**
 * GET /api/audit
 * Query the audit trail. All filters optional.
 * query: entityType, entityId, eventType, userId, riskLevel, success, startDate, endDate, limit, offset
 */
router.get('/', authenticateToken, requirePermission('audit:read'), async (req, res) => {
  try {
    const { entityType, entityId, eventType, userId, riskLevel, success, startDate, endDate } = req.query;
    const limit = parseInt(req.query.limit, 10) || 100;
    const offset = parseInt(req.query.offset, 10) || 0;

    const result = await auditService.getAuditTrail(entityType, entityId, {
      eventType,
      userId,
      riskLevel,
      success,
      startDate,
      endDate,
      limit,
      offset,
    });

    if (!result.success) {
      return res.status(500).json({ error: result.error });
    }

    res.json({
      auditTrail: result.auditTrail,
      totalCount: result.totalCount,
      limit,
      offset,
    });
  } catch (error) {
    console.error('[audit] list failed:', error.message);
    res.status(500).json({ error: 'Failed to fetch audit trail' });
  }
});

/**
 * GET /api/audit/security
 * Recent security-relevant events (failed logins, permission denials, etc.).
 * query: hours (default 24), limit (default 50)
 */
router.get('/security', authenticateToken, requirePermission('audit:read'), async (req, res) => {
  try {
    const hours = parseInt(req.query.hours, 10) || 24;
    const limit = parseInt(req.query.limit, 10) || 50;

    const result = await auditService.getSecurityEvents({ hours, limit });
    if (!result.success) {
      return res.status(500).json({ error: result.error });
    }

    res.json({
      securityEvents: result.securityEvents,
      alertCount: result.alertCount,
      windowHours: hours,
    });
  } catch (error) {
    console.error('[audit] security failed:', error.message);
    res.status(500).json({ error: 'Failed to fetch security events' });
  }
});

/**
 * GET /api/audit/verify
 * Verify tamper-evident integrity of the audit trail over a date range.
 * query: startDate, endDate (default: last 30 days)
 */
router.get('/verify', authenticateToken, requirePermission('audit:read'), async (req, res) => {
  try {
    const endDate = req.query.endDate ? new Date(req.query.endDate) : new Date();
    const startDate = req.query.startDate
      ? new Date(req.query.startDate)
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const result = await auditService.verifyIntegrity(startDate, endDate);
    if (!result.success) {
      return res.status(500).json({ error: result.error });
    }

    res.json(result);
  } catch (error) {
    console.error('[audit] verify failed:', error.message);
    res.status(500).json({ error: 'Failed to verify audit integrity' });
  }
});

module.exports = router;
