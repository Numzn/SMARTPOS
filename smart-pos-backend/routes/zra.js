const express = require('express');
const router = express.Router();
const zraInvoiceService = require('../services/zraInvoice');

/**
 * Send sale to ZRA VSDC for Smart Invoice generation
 * POST /api/zra/send-invoice/:saleId
 */
router.post('/send-invoice/:saleId', async (req, res) => {
  try {
    const { saleId } = req.params;

    if (!saleId) {
      return res.status(400).json({
        error: 'Sale ID is required'
      });
    }

    console.log(`🧾 Processing ZRA invoice for sale: ${saleId}`);

    const result = await zraInvoiceService.sendToVSDC(saleId);

    if (!result.success) {
      return res.status(400).json({
        error: result.message,
        data: result.data
      });
    }

    res.json({
      message: result.message,
      sale: result.data,
      zraResponse: result.zraResponse
    });

  } catch (error) {
    console.error('ZRA Invoice Error:', error.message);
    
    res.status(500).json({
      error: 'Failed to generate Smart Invoice',
      details: error.message
    });
  }
});

/**
 * Get ZRA receipt status for a sale
 * GET /api/zra/receipt-status/:saleId
 */
router.get('/receipt-status/:saleId', async (req, res) => {
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
router.get('/pending-sales', async (req, res) => {
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
router.post('/bulk-send', async (req, res) => {
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
        const result = await zraInvoiceService.sendToVSDC(saleId);
        results.push({
          saleId,
          success: result.success,
          receiptNo: result.data?.rcptNo,
          message: result.message
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
router.post('/process-pending', async (req, res) => {
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
        const result = await zraInvoiceService.sendToVSDC(sale.id);
        results.push({
          saleId: sale.id,
          success: result.success,
          receiptNo: result.data?.rcptNo
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
