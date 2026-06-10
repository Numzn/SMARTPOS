const express = require('express');
const router = express.Router();
const zraInvoiceService = require('../services/zraInvoice');
const { finalizeSaleFiscally } = require('../lib/saleFiscal');
const prisma = require('../lib/prisma');
const { authenticateToken, requirePermission, requireAnyPermission } = require('../middleware/auth');

/**
 * Send sale to ZRA VSDC for Smart Invoice generation (requires zra:submit permission)
 * POST /api/zra/send-invoice/:saleId
 * Retries fiscal submission for PENDING/FISCAL_FAILED sales.
 */
router.post('/send-invoice/:saleId', authenticateToken, requirePermission('zra:submit'), async (req, res) => {
  try {
    const { saleId } = req.params;

    if (!saleId) {
      return res.status(400).json({ error: 'Sale ID is required' });
    }

    const existing = await prisma.sale.findUnique({ where: { id: saleId } });
    if (!existing) {
      return res.status(404).json({ error: 'Sale not found' });
    }

    if (existing.status === 'COMPLETED' && existing.rcptNo) {
      const status = await zraInvoiceService.getReceiptStatus(saleId);
      return res.json({
        message: 'Sale already submitted to ZRA',
        sale: existing,
        zraResponse: status,
      });
    }

    if (!['PENDING', 'FISCAL_FAILED', 'FISCAL_SUBMITTING'].includes(existing.status)) {
      return res.status(400).json({
        error: `Cannot fiscalize sale in status ${existing.status}`,
      });
    }

    console.log(`🧾 Processing ZRA invoice for sale: ${saleId}`);

    const outcome = await finalizeSaleFiscally(saleId);

    if (!outcome.success) {
      return res.status(422).json({
        error: outcome.fiscal?.error || 'ZRA submission failed',
        sale: outcome.sale,
        fiscal: outcome.fiscal,
      });
    }

    res.json({
      message: 'Smart Invoice generated successfully',
      sale: outcome.sale,
      zraResponse: outcome.fiscal,
      receiptNumber: outcome.fiscal.rcptNo,
    });
  } catch (error) {
    console.error('ZRA Invoice Error:', error.message);
    res.status(error.status || 500).json({
      error: 'Failed to generate Smart Invoice',
      details: error.message,
    });
  }
});

/**
 * Get ZRA receipt status for a sale
 * GET /api/zra/receipt-status/:saleId
 */
// Get ZRA receipt status (requires zra:submit or reports:read permission)
router.get('/receipt-status/:saleId', authenticateToken, requireAnyPermission('zra:submit', 'reports:read'), async (req, res) => {
  try {
    const { saleId } = req.params;

    const status = await zraInvoiceService.getReceiptStatus(saleId);

    res.json(status);

  } catch (error) {
    console.error('Receipt Status Error:', error.message);
    
    res.status(500).json({
      error: 'Failed to get receipt status',
      details: error.message
    });
  }
});

/**
 * Get all sales pending ZRA processing
 * GET /api/zra/pending-sales
 */
// Get pending sales for ZRA submission (requires zra:submit permission)
router.get('/pending-sales', authenticateToken, requirePermission('zra:submit'), async (req, res) => {
  try {
    const pendingSales = await zraInvoiceService.getPendingZRASales();

    res.json({
      count: pendingSales.length,
      sales: pendingSales
    });

  } catch (error) {
    console.error('Pending Sales Error:', error.message);
    
    res.status(500).json({
      error: 'Failed to get pending sales',
      details: error.message
    });
  }
});

/**
 * Bulk send multiple sales to ZRA
 * POST /api/zra/bulk-send
 */
// Bulk send multiple sales to ZRA (requires zra:submit permission)
router.post('/bulk-send', authenticateToken, requirePermission('zra:submit'), async (req, res) => {
  try {
    const { saleIds } = req.body;

    if (!Array.isArray(saleIds) || saleIds.length === 0) {
      return res.status(400).json({
        error: 'Array of sale IDs is required'
      });
    }

    console.log(`🔄 Processing ${saleIds.length} sales for ZRA...`);

    const results = [];
    const errors = [];

    for (const saleId of saleIds) {
      try {
        const result = await finalizeSaleFiscally(saleId);
        results.push({
          saleId,
          success: result.success,
          receiptNo: result.sale?.rcptNo,
          message: result.fiscal?.error || 'OK',
        });
      } catch (error) {
        errors.push({
          saleId,
          error: error.message
        });
      }
    }

    res.json({
      message: `Processed ${results.length + errors.length} sales`,
      successful: results.filter(r => r.success).length,
      failed: errors.length,
      results,
      errors
    });

  } catch (error) {
    console.error('Bulk Send Error:', error.message);
    
    res.status(500).json({
      error: 'Failed to process bulk send',
      details: error.message
    });
  }
});

/**
 * Process all pending sales automatically
 * POST /api/zra/process-pending
 */
// Process all pending ZRA submissions (requires zra:submit permission)
router.post('/process-pending', authenticateToken, requirePermission('zra:submit'), async (req, res) => {
  try {
    const pendingSales = await zraInvoiceService.getPendingZRASales();

    if (pendingSales.length === 0) {
      return res.json({
        message: 'No pending sales to process',
        processed: 0
      });
    }

    console.log(`🔄 Auto-processing ${pendingSales.length} pending sales...`);

    const results = [];
    const errors = [];

    for (const sale of pendingSales) {
      try {
        const result = await finalizeSaleFiscally(sale.id);
        results.push({
          saleId: sale.id,
          success: result.success,
          receiptNo: result.sale?.rcptNo
        });
      } catch (error) {
        errors.push({
          saleId: sale.id,
          error: error.message
        });
      }
    }

    res.json({
      message: `Auto-processed ${results.length + errors.length} pending sales`,
      successful: results.filter(r => r.success).length,
      failed: errors.length,
      results,
      errors
    });

  } catch (error) {
    console.error('Process Pending Error:', error.message);
    
    res.status(500).json({
      error: 'Failed to process pending sales',
      details: error.message
    });
  }
});

module.exports = router;
