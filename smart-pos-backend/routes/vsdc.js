const express = require('express');
const router = express.Router();
const vsdcService = require('../services/vsdcService');
const stockSyncService = require('../services/stockSyncService');
const prisma = require('../lib/prisma');
const { authenticateToken, requirePermission } = require('../middleware/auth');
const { DEFAULT_BRANCH } = require('../lib/inventoryStock');

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
 * POST /api/vsdc/stock/retrieve — item 28*, pull stock records ZRA already
 * has (POST /stock/selectStockItems) and reconcile them locally. Distinct
 * from /stock/sync above, which pushes OUR pending movements TO VSDC —
 * this pulls the other direction. See lib/vsdc-gateway/stockRetrieveSync.js
 * for why retrieved records are reconciliation-only, never applied as
 * inventory changes.
 */
router.post('/stock/retrieve', authenticateToken, requirePermission('zra:sync'), async (req, res) => {
  try {
    const branchId = req.body?.branchId || DEFAULT_BRANCH;
    const vsdcGateway = require('../lib/vsdc-gateway');
    const ready = await vsdcGateway.ensureReady();
    if (!ready.success) {
      return res.status(503).json({ error: ready.error || 'VSDC not initialized' });
    }
    const result = await vsdcGateway.retrieveStockItems({ branchId });

    const auditService = require('../services/auditService');
    auditService.safeLog(auditService.eventTypes.STOCK_SYNC, {
      ...auditService.contextFromReq(req),
      entityType: 'STOCK_MOVEMENT',
      action: 'ZRA_RETRIEVE',
      success: result.success,
      errorMessage: result.success ? null : result.error,
      description: result.success
        ? `Retrieved stock records from ZRA: ${result.imported} imported, ${result.skipped} already known, ${result.unmatched} unmatched`
        : `ZRA stock retrieval failed: ${result.error}`,
    });

    if (!result.success) {
      return res.status(502).json({ message: 'Stock retrieval failed', ...result });
    }
    res.json({ message: 'Stock retrieval completed', ...result });
  } catch (error) {
    console.error('VSDC stock retrieve error:', error.message);
    res.status(500).json({ error: error.message || 'Failed to retrieve stock from VSDC' });
  }
});

/**
 * GET /api/vsdc/stock/retrieve/status — cursor + last-run status, per branch.
 */
router.get('/stock/retrieve/status', authenticateToken, requirePermission('zra:read'), async (req, res) => {
  try {
    const branchId = req.query.branchId || DEFAULT_BRANCH;
    const cursor = await prisma.stockRetrievalCursor.findUnique({ where: { branchId } });
    res.json({
      branchId,
      lastReqDt: cursor?.lastReqDt || null,
      lastSyncedAt: cursor?.lastSyncedAt || null,
      lastSyncError: cursor?.lastSyncError || null,
      lastImportedCount: cursor?.lastImportedCount ?? 0,
      everSynced: Boolean(cursor?.lastSyncedAt),
    });
  } catch (error) {
    console.error('VSDC stock retrieve status error:', error.message);
    res.status(500).json({ error: 'Failed to get stock retrieval status' });
  }
});

/**
 * POST /api/vsdc/items/retrieve — item 10*, pull item master records ZRA
 * already has (POST /items/selectItems) and snapshot them onto matching
 * local Products. See lib/vsdc-gateway/itemsRetrieveSync.js for why this
 * writes to Product.zraItemSnapshot rather than overwriting operational
 * fields, and why no dedup step is needed here (idempotent overwrite, not
 * an event log like item 28*'s stock retrieval).
 */
router.post('/items/retrieve', authenticateToken, requirePermission('zra:sync'), async (req, res) => {
  try {
    const branchId = req.body?.branchId || DEFAULT_BRANCH;
    const vsdcGateway = require('../lib/vsdc-gateway');
    const ready = await vsdcGateway.ensureReady();
    if (!ready.success) {
      return res.status(503).json({ error: ready.error || 'VSDC not initialized' });
    }
    const result = await vsdcGateway.retrieveItems({ branchId });

    const auditService = require('../services/auditService');
    auditService.safeLog(auditService.eventTypes.ITEM_SYNC, {
      ...auditService.contextFromReq(req),
      entityType: 'PRODUCT',
      action: 'ZRA_RETRIEVE',
      success: result.success,
      errorMessage: result.success ? null : result.error,
      description: result.success
        ? `Retrieved item records from ZRA: ${result.updated} updated, ${result.unmatched} unmatched`
        : `ZRA item retrieval failed: ${result.error}`,
    });

    if (!result.success) {
      return res.status(502).json({ message: 'Item retrieval failed', ...result });
    }
    res.json({ message: 'Item retrieval completed', ...result });
  } catch (error) {
    console.error('VSDC item retrieve error:', error.message);
    res.status(500).json({ error: error.message || 'Failed to retrieve items from VSDC' });
  }
});

/**
 * GET /api/vsdc/items/retrieve/status — cursor + last-run status, per branch.
 */
router.get('/items/retrieve/status', authenticateToken, requirePermission('zra:read'), async (req, res) => {
  try {
    const branchId = req.query.branchId || DEFAULT_BRANCH;
    const cursor = await prisma.itemRetrievalCursor.findUnique({ where: { branchId } });
    res.json({
      branchId,
      lastReqDt: cursor?.lastReqDt || null,
      lastSyncedAt: cursor?.lastSyncedAt || null,
      lastSyncError: cursor?.lastSyncError || null,
      lastImportedCount: cursor?.lastImportedCount ?? 0,
      everSynced: Boolean(cursor?.lastSyncedAt),
    });
  } catch (error) {
    console.error('VSDC item retrieve status error:', error.message);
    res.status(500).json({ error: 'Failed to get item retrieval status' });
  }
});

/**
 * POST /api/vsdc/purchases/sync — item 13*, push unsynced GoodsReceivedNotes
 * as SAVE PURCHASES (POST /trnsPurchase/savePurchase). Manual-trigger only,
 * matching this domain's own established pattern — GRN receiving has never
 * had an automatic ZRA-sync trigger (unlike sales/refunds/adjustments/expiry,
 * which all auto-fire the stock-push sync), so this isn't wired into the
 * live receive transaction either. See lib/vsdc-gateway/purchaseSaveSync.js
 * for why regTyCd is always 'M' and for the stock-push follow-up dependency.
 */
router.post('/purchases/sync', authenticateToken, requirePermission('zra:sync'), async (req, res) => {
  try {
    const { branchId, limit } = req.body || {};
    const vsdcGateway = require('../lib/vsdc-gateway');
    const ready = await vsdcGateway.ensureReady();
    if (!ready.success) {
      return res.status(503).json({ error: ready.error || 'VSDC not initialized' });
    }
    const result = await vsdcGateway.submitPurchases({ branchId, limit: limit ? parseInt(limit, 10) : 50 });

    const auditService = require('../services/auditService');
    auditService.safeLog(auditService.eventTypes.PURCHASE_SYNC, {
      ...auditService.contextFromReq(req),
      entityType: 'GOODS_RECEIVED_NOTE',
      action: 'ZRA_SYNC',
      description: `Purchase sync: ${result.succeeded} succeeded, ${result.failed} failed (attempted ${result.attempted})`,
    });

    res.json({ message: 'Purchase sync completed', ...result });
  } catch (error) {
    console.error('VSDC purchase sync error:', error.message);
    res.status(500).json({ error: error.message || 'Failed to sync purchases to VSDC' });
  }
});

/**
 * POST /api/vsdc/purchases/retrieve — item 14*, pull purchase records ZRA
 * already has (POST /trnsPurchase/selectTrnsPurchaseSales). Separate,
 * uncoupled reconciliation feature from /purchases/sync above — see
 * lib/vsdc-gateway/purchaseRetrieveSync.js for why retrieved records are
 * standalone, never matched against GoodsReceivedNote.
 */
router.post('/purchases/retrieve', authenticateToken, requirePermission('zra:sync'), async (req, res) => {
  try {
    const branchId = req.body?.branchId || DEFAULT_BRANCH;
    const vsdcGateway = require('../lib/vsdc-gateway');
    const ready = await vsdcGateway.ensureReady();
    if (!ready.success) {
      return res.status(503).json({ error: ready.error || 'VSDC not initialized' });
    }
    const result = await vsdcGateway.retrievePurchases({ branchId });

    const auditService = require('../services/auditService');
    auditService.safeLog(auditService.eventTypes.PURCHASE_SYNC, {
      ...auditService.contextFromReq(req),
      entityType: 'RETRIEVED_PURCHASE',
      action: 'ZRA_RETRIEVE',
      success: result.success,
      errorMessage: result.success ? null : result.error,
      description: result.success
        ? `Retrieved purchase records from ZRA: ${result.imported} imported, ${result.skipped} already known`
        : `ZRA purchase retrieval failed: ${result.error}`,
    });

    if (!result.success) {
      return res.status(502).json({ message: 'Purchase retrieval failed', ...result });
    }
    res.json({ message: 'Purchase retrieval completed', ...result });
  } catch (error) {
    console.error('VSDC purchase retrieve error:', error.message);
    res.status(500).json({ error: error.message || 'Failed to retrieve purchases from VSDC' });
  }
});

/**
 * GET /api/vsdc/purchases/retrieve/status — cursor + last-run status, per branch.
 */
router.get('/purchases/retrieve/status', authenticateToken, requirePermission('zra:read'), async (req, res) => {
  try {
    const branchId = req.query.branchId || DEFAULT_BRANCH;
    const cursor = await prisma.purchaseRetrievalCursor.findUnique({ where: { branchId } });
    res.json({
      branchId,
      lastReqDt: cursor?.lastReqDt || null,
      lastSyncedAt: cursor?.lastSyncedAt || null,
      lastSyncError: cursor?.lastSyncError || null,
      lastImportedCount: cursor?.lastImportedCount ?? 0,
      everSynced: Boolean(cursor?.lastSyncedAt),
    });
  } catch (error) {
    console.error('VSDC purchase retrieve status error:', error.message);
    res.status(500).json({ error: 'Failed to get purchase retrieval status' });
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
 * GET /api/vsdc/codes/status — last-synced summary for ZRA codes (item 2*).
 * Codes sync is upsert-all-on-demand (lib/vsdc-gateway/codesSync.js), not
 * incremental — there is no cursor row to read, so this aggregates directly
 * off ZraCode/ZraClassificationCode.syncedAt rather than inventing cursor
 * infrastructure that doesn't match the sync semantics.
 */
router.get('/codes/status', authenticateToken, requirePermission('zra:read'), async (req, res) => {
  try {
    const [standardAgg, classAgg, byClass] = await Promise.all([
      prisma.zraCode.aggregate({ _max: { syncedAt: true }, _count: { _all: true } }),
      prisma.zraClassificationCode.aggregate({ _max: { syncedAt: true }, _count: { _all: true } }),
      prisma.zraCode.groupBy({ by: ['codeClass'], _count: { _all: true }, _max: { syncedAt: true } }),
    ]);
    res.json({
      standard: {
        count: standardAgg._count._all,
        lastSyncedAt: standardAgg._max.syncedAt,
        byClass: byClass.map((g) => ({
          codeClass: g.codeClass,
          count: g._count._all,
          lastSyncedAt: g._max.syncedAt,
        })),
      },
      classification: {
        count: classAgg._count._all,
        lastSyncedAt: classAgg._max.syncedAt,
      },
      everSynced: Boolean(standardAgg._max.syncedAt || classAgg._max.syncedAt),
    });
  } catch (error) {
    console.error('VSDC codes status error:', error.message);
    res.status(500).json({ error: 'Failed to get codes sync status' });
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
