/**
 * Forecourt fuel transactions — read/seed only in Phase 1. POST here stands
 * in for a real pump-dispensing event until actual pump integration lands
 * (later phase); it exercises the full fiscalPolicy -> fiscalAdapter path
 * so seeded data ends up in a real, correct fiscal state. No settlement/
 * clearing endpoints exist yet — see routes/forecourt/index.js.
 */
const express = require('express');
const router = express.Router();
const { authenticateToken, requirePermission } = require('../../middleware/auth');
const auditService = require('../../services/auditService');
const { createFuelTransaction, listFuelTransactions } = require('../../lib/forecourt/fuelTransaction');

router.get('/transactions', authenticateToken, requirePermission('forecourt:read'), async (req, res) => {
  try {
    const transactions = await listFuelTransactions({
      branchId: req.query.branchId,
      attendantId: req.query.attendantId,
      pumpId: req.query.pumpId,
      settlementStatus: req.query.settlementStatus,
      fiscalStatus: req.query.fiscalStatus,
    });
    res.json(transactions);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Failed to load fuel transactions' });
  }
});

router.post('/transactions', authenticateToken, requirePermission('forecourt:write'), async (req, res) => {
  try {
    const transaction = await createFuelTransaction({
      pumpId: req.body?.pumpId,
      attendantId: req.body?.attendantId,
      productId: req.body?.productId,
      volume: req.body?.volume,
      customerId: req.body?.customerId,
      customerType: req.body?.customerType,
      invoiceRequested: req.body?.invoiceRequested,
      shiftId: req.body?.shiftId,
      branchId: req.body?.branchId,
    });

    auditService.safeLog(auditService.eventTypes.FUEL_TRANSACTION_CREATED, {
      ...auditService.contextFromReq(req),
      entityType: 'FUEL_TRANSACTION',
      entityId: transaction.id,
      action: 'CREATE',
      newValues: {
        pumpId: transaction.pumpId,
        attendantId: transaction.attendantId,
        productId: transaction.productId,
        volume: transaction.volume,
        amount: transaction.amount,
        fiscalStatus: transaction.fiscalStatus,
      },
      description: `Fuel transaction ${transaction.id} (${transaction.volume}L) recorded by ${req.user.email || req.user.userId}`,
    });

    res.status(201).json(transaction);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Failed to record fuel transaction' });
  }
});

module.exports = router;
