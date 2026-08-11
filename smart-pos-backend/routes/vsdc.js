const express = require('express');
const router = express.Router();
const vsdcService = require('../services/vsdcService');
const stockSyncService = require('../services/stockSyncService');
const { authenticateToken, requirePermission } = require('../middleware/auth');

/**
 * GET /api/vsdc/status — device init status (no secrets exposed)
 */
router.get('/status', authenticateToken, requirePermission('zra:read'), async (req, res) => {
  try {
    const status = await vsdcService.getDeviceStatus();
    res.json(status);
  } catch (error) {
    console.error('VSDC status error:', error.message);
    res.status(500).json({ error: 'Failed to get VSDC status' });
  }
});

/**
 * POST /api/vsdc/initialize — run device initialization (admin/manager)
 */
router.post('/initialize', authenticateToken, requirePermission('zra:sync'), async (req, res) => {
  try {
    const result = await vsdcService.ensureDeviceInitialized();
    if (!result.success) {
      return res.status(503).json({ error: result.error || 'Initialization failed' });
    }
    const status = await vsdcService.getDeviceStatus();
    res.json({ message: result.message, ...status });
  } catch (error) {
    console.error('VSDC initialize error:', error.message);
    res.status(500).json({ error: 'Failed to initialize VSDC device' });
  }
});

/**
 * POST /api/vsdc/stock/sync — sync pending stock movements to VSDC
 */
router.post('/stock/sync', authenticateToken, requirePermission('zra:sync'), async (req, res) => {
  try {
    const { branchId, referenceId, since, limit } = req.body || {};
    const result = await stockSyncService.syncRecentMovements({
      branchId,
      referenceId,
      since: since ? new Date(since) : undefined,
      limit: limit ? parseInt(limit, 10) : 100,
    });
    res.json({
      message: 'Stock sync completed',
      ...result,
    });
  } catch (error) {
    console.error('VSDC stock sync error:', error.message);
    res.status(500).json({ error: 'Failed to sync stock to VSDC' });
  }
});

/**
 * POST /api/vsdc/codes/sync — sync ZRA codes + classifications via gateway
 */
router.post('/codes/sync', authenticateToken, requirePermission('zra:sync'), async (req, res) => {
  try {
    const vsdcGateway = require('../lib/vsdc-gateway');
    const ready = await vsdcGateway.ensureReady();
    if (!ready.success) {
      return res.status(503).json({ error: ready.error || 'VSDC not initialized' });
    }
    const result = await vsdcGateway.syncCodes();
    res.json({ message: 'Codes sync completed', ...result });
  } catch (error) {
    console.error('VSDC codes sync error:', error.message);
    res.status(500).json({ error: error.message || 'Failed to sync codes' });
  }
});

/**
 * POST /api/vsdc/branches/sync — pull ZRA's registered branch list
 * (VSDC POST /branches/selectBranches) and store it as a reference
 * snapshot on matching local Branch rows by bhfId. Does not overwrite
 * operational Branch fields (name, province, etc.) — see
 * schema.prisma Branch.zraBranchSnapshot for why.
 */
router.post('/branches/sync', authenticateToken, requirePermission('zra:sync'), async (req, res) => {
  try {
    const vsdcGateway = require('../lib/vsdc-gateway');
    const ready = await vsdcGateway.ensureReady();
    if (!ready.success) {
      return res.status(503).json({ error: ready.error || 'VSDC not initialized' });
    }
    const result = await vsdcGateway.selectBranches();

    const auditService = require('../services/auditService');
    auditService.safeLog(auditService.eventTypes.BRANCH_ZRA_SYNC, {
      ...auditService.contextFromReq(req),
      entityType: 'BRANCH',
      action: 'ZRA_SYNC',
      description: `Pulled ${result.count} branch record(s) from ZRA, matched ${result.matched} locally`,
    });

    res.json({ message: 'Branch sync completed', ...result });
  } catch (error) {
    console.error('VSDC branches sync error:', error.message);
    res.status(500).json({ error: error.message || 'Failed to sync branches' });
  }
});

module.exports = router;
