const express = require('express');
const router = express.Router();
const prisma = require('../../lib/prisma');
const { authenticateToken, requirePermission } = require('../../middleware/auth');

// Helper functions for expiry
const calculateDaysUntilExpiry = (expiryDate) => {
  if (!expiryDate) return null;
  const today = new Date();
  const expiry = new Date(expiryDate);
  return Math.ceil((expiry - today) / (1000 * 60 * 60 * 24));
};
const getExpiryStatus = (expiryDate) => {
  const daysUntilExpiry = calculateDaysUntilExpiry(expiryDate);
  if (daysUntilExpiry === null) return 'NO_EXPIRY';
  if (daysUntilExpiry < 0) return 'EXPIRED';
  if (daysUntilExpiry <= 1) return 'EXPIRES_TODAY';
  if (daysUntilExpiry <= 3) return 'EXPIRES_SOON';
  if (daysUntilExpiry <= 7) return 'NEAR_EXPIRY';
  return 'FRESH';
};

// Get expiry alerts
router.get('/expiry-alerts', authenticateToken, requirePermission('inventory:read'), async (req, res) => {
  // ...existing code from inventory-enhanced.js (expiry alerts)
});

// Mark batch as expired
router.post('/mark-expired', authenticateToken, requirePermission('inventory:write'), async (req, res) => {
  // ...existing code from inventory-enhanced.js (mark batch expired)
});

module.exports = router;
