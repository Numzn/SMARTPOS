const express = require('express');
const router = express.Router();
const auditService = require('../services/auditService');
const { authenticateToken, requirePermission } = require('../middleware/auth');
const { getOrCreateSnapshot, recordReprint } = require('../lib/receipt/snapshot');

const SOURCE_MAP = {
  sales: 'SALE',
  refunds: 'CREDIT_NOTE',
};

/**
 * GET /api/receipts/:sourceType/:sourceId
 * sourceType: sales | refunds
 * query: ?reprint=true — audit reprint and mark COPY
 */
router.get(
  '/:sourceType/:sourceId',
  authenticateToken,
  requirePermission('receipts:read'),
  async (req, res) => {
    try {
      const { sourceType, sourceId } = req.params;
      const mapped = SOURCE_MAP[sourceType];

      if (!mapped) {
        return res.status(400).json({ error: 'Invalid source type. Use sales or refunds.' });
      }

      const isReprint = req.query.reprint === 'true';

      if (isReprint) {
        const { vm, reprintCount } = await recordReprint(mapped, sourceId, {
          printedBy: req.user.name || req.user.email || req.user.userId,
        });

        await auditService.logEvent(auditService.eventTypes.RECEIPT_REPRINT, {
          userId: req.user.userId,
          userRole: req.user.role,
          description: `Receipt reprint #${reprintCount} for ${sourceType}/${sourceId}`,
          entityType: sourceType,
          entityId: sourceId,
          reprintCount,
        });

        return res.json(vm);
      }

      const snapshot = await getOrCreateSnapshot(mapped, sourceId);
      if (!snapshot) {
        return res.status(404).json({ error: 'Receipt not found or fiscal not completed' });
      }

      res.json(snapshot);
    } catch (error) {
      console.error('Receipt fetch error:', error.message);
      res.status(error.status || 500).json({ error: error.message || 'Failed to load receipt' });
    }
  }
);

module.exports = router;
