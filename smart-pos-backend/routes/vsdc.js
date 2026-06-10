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

module.exports = router;
