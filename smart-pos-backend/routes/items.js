const express = require('express');
const router = express.Router();
const itemManagementService = require('../services/itemManagement');
const zraCodesService = require('../services/zraCodesService');
const { authenticateToken, requirePermission } = require('../middleware/auth');

/**
 * Item Management Routes - VSDC Section 6.1 Complete Implementation
 * All endpoints require appropriate ZRA permissions
 */

// Save/Update item to VSDC (requires products:write permission)
router.post('/save', authenticateToken, requirePermission('products:write'), async (req, res) => {
  try {
    const productData = req.body;
    
    const result = await itemManagementService.saveItemToVSDC(productData);
    
    if (result.success) {
      res.json({
        success: true,
        itemCode: result.itemCode,
        zraResponse: result.zraResponse,
        message: result.message
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error,
        code: result.code
      });
    }
  } catch (error) {
    console.error('Error saving item to VSDC:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to save item to VSDC',
      code: 'ITEM_SAVE_ERROR'
    });
  }
});

// Sync items from VSDC (requires zra:sync permission) - FIXES COMPLIANCE GAP
router.post('/sync', authenticateToken, requirePermission('zra:sync'), async (req, res) => {
  try {
    const { lastReqDt } = req.body;
    
    console.log('🔄 Starting item sync from VSDC...');
    const result = await itemManagementService.syncItemsFromVSDC(lastReqDt);
    
    if (result.success) {
      res.json({
        success: true,
        itemsCount: result.itemsCount,
        syncResults: result.syncResults,
        message: result.message
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error,
        code: result.code
      });
    }
  } catch (error) {
    console.error('Error syncing items from VSDC:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to sync items from VSDC',
      code: 'ITEM_SYNC_ERROR'
    });
  }
});

// Get ZRA item classification codes — reads the synced ZraClassificationCode
// table (populated by codesSync.js -> /itemClass/selectItemsClass), syncing
// on demand if empty. Previously called itemManagementService's version,
// which bypassed endpointAdapter entirely and hit a hardcoded mock-only
// path (/api/codes/get) on every request instead of the synced data.
//
// ?q=&limit= drives the ClassificationPicker type-ahead (bounded, server-side
// search via zraCodesService.searchItemClassifications). No query params
// preserves the original unbounded "full usable list" behaviour for the
// handful of internal/back-compat callers that still want everything.
router.get('/classification-codes', authenticateToken, requirePermission('products:read'), async (req, res) => {
  try {
    const { q, limit } = req.query;
    const result = (q !== undefined || limit !== undefined)
      ? await zraCodesService.searchItemClassifications({ q, limit })
      : await zraCodesService.getItemClassifications();

    if (result.success) {
      res.json({
        success: true,
        codes: result.classifications,
        message: result.message
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error,
        code: 'CLASSIFICATION_CODES_ERROR'
      });
    }
  } catch (error) {
    console.error('Error getting classification codes:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get classification codes',
      code: 'CLASSIFICATION_CODES_ERROR'
    });
  }
});

// Tax type / package unit / quantity unit — small, bounded lists (unlike
// classification's thousands of rows), so no search/pagination: just the
// current usable set for the class, read from the synced ZraCode table
// (populated by codesSync.js -> /code/selectCodes, class '04'/'17'/'10'
// respectively — see zraCodesService.js's CODE_CLASS_MAP comment).
router.get('/tax-types', authenticateToken, requirePermission('products:read'), async (req, res) => {
  try {
    const result = await zraCodesService.searchTaxTypes();
    if (result.success) {
      res.json({ success: true, codes: result.codes, message: result.message });
    } else {
      res.status(400).json({ success: false, error: result.error, code: 'TAX_TYPES_ERROR' });
    }
  } catch (error) {
    console.error('Error getting tax types:', error);
    res.status(500).json({ success: false, error: 'Failed to get tax types', code: 'TAX_TYPES_ERROR' });
  }
});

router.get('/package-units', authenticateToken, requirePermission('products:read'), async (req, res) => {
  try {
    const result = await zraCodesService.searchPackagingUnits();
    if (result.success) {
      res.json({ success: true, codes: result.codes, message: result.message });
    } else {
      res.status(400).json({ success: false, error: result.error, code: 'PACKAGE_UNITS_ERROR' });
    }
  } catch (error) {
    console.error('Error getting package units:', error);
    res.status(500).json({ success: false, error: 'Failed to get package units', code: 'PACKAGE_UNITS_ERROR' });
  }
});

router.get('/quantity-units', authenticateToken, requirePermission('products:read'), async (req, res) => {
  try {
    const result = await zraCodesService.searchQuantityUnits();
    if (result.success) {
      res.json({ success: true, codes: result.codes, message: result.message });
    } else {
      res.status(400).json({ success: false, error: result.error, code: 'QUANTITY_UNITS_ERROR' });
    }
  } catch (error) {
    console.error('Error getting quantity units:', error);
    res.status(500).json({ success: false, error: 'Failed to get quantity units', code: 'QUANTITY_UNITS_ERROR' });
  }
});

// Bulk save multiple items to VSDC (requires products:write permission)
router.post('/bulk-save', authenticateToken, requirePermission('products:write'), async (req, res) => {
  try {
    const { products } = req.body;
    
    if (!products || !Array.isArray(products)) {
      return res.status(400).json({
        success: false,
        error: 'Products array is required',
        code: 'INVALID_INPUT'
      });
    }
    
    console.log(`📦 Starting bulk save of ${products.length} items...`);
    const result = await itemManagementService.bulkSaveItems(products);
    
    res.json({
      success: true,
      totalCount: result.totalCount,
      successful: result.successful.length,
      failed: result.failed.length,
      results: result,
      message: `Bulk save completed: ${result.successful.length} successful, ${result.failed.length} failed`
    });
  } catch (error) {
    console.error('Error bulk saving items:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to bulk save items',
      code: 'BULK_SAVE_ERROR'
    });
  }
});

// Validate item data against VSDC requirements (requires products:read permission)
router.post('/validate', authenticateToken, requirePermission('products:read'), async (req, res) => {
  try {
    const productData = req.body;
    
    const validation = itemManagementService.validateItemData(productData);
    
    res.json({
      success: true,
      validation: {
        isValid: validation.isValid,
        errors: validation.errors,
        warnings: validation.warnings
      }
    });
  } catch (error) {
    console.error('Error validating item data:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to validate item data',
      code: 'VALIDATION_ERROR'
    });
  }
});

module.exports = router;
