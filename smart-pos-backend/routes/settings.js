const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { authenticateToken, requirePermission } = require('../middleware/auth');
const auditService = require('../services/auditService');
const { getBusinessProfile, ensureDefaultBusinessProfile } = require('../lib/ensureBusinessProfile');
const { runDatabaseBackup } = require('../lib/backup');

router.get('/business', authenticateToken, requirePermission('settings:read'), async (req, res) => {
  try {
    const profile = await getBusinessProfile();
    res.json(profile);
  } catch (error) {
    console.error('Settings fetch error:', error.message);
    res.status(500).json({ error: 'Failed to load business settings' });
  }
});

router.patch('/business', authenticateToken, requirePermission('settings:write'), async (req, res) => {
  try {
    await ensureDefaultBusinessProfile();

    const { tradingName, tpin, logoUrl, footerLines, showPoweredBy, receiptVersion } = req.body;

    const data = {};
    if (tradingName != null) data.tradingName = String(tradingName);
    if (tpin != null) data.tpin = String(tpin);
    if (logoUrl !== undefined) data.logoUrl = logoUrl || null;
    if (footerLines != null) {
      data.footerLines = Array.isArray(footerLines)
        ? footerLines
        : String(footerLines)
            .split('\n')
            .map((l) => l.trim())
            .filter(Boolean);
    }
    if (showPoweredBy != null) data.showPoweredBy = Boolean(showPoweredBy);
    if (receiptVersion != null) data.receiptVersion = String(receiptVersion);

    const profile = await prisma.businessProfile.update({
      where: { id: 'default' },
      data,
    });

    auditService.safeLog(auditService.eventTypes.SETTINGS_UPDATE, {
      ...auditService.contextFromReq(req),
      entityType: 'BUSINESS_PROFILE',
      entityId: profile.id,
      action: 'UPDATE',
      newValues: Object.keys(data),
      description: `Business settings updated: ${Object.keys(data).join(', ')}`,
    });

    res.json(profile);
  } catch (error) {
    console.error('Settings update error:', error.message);
    res.status(500).json({ error: 'Failed to update business settings' });
  }
});

router.post('/backup', authenticateToken, requirePermission('settings:write'), async (req, res) => {
  try {
    const { userId, userRole } = auditService.contextFromReq(req);
    const result = await runDatabaseBackup({ actor: { userId, userRole } });
    res.json(result);
  } catch (error) {
    console.error('Manual backup error:', error.message);
    res.status(500).json({ error: error.message || 'Backup failed' });
  }
});

module.exports = router;
