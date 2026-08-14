const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { authenticateToken, requirePermission } = require('../middleware/auth');
const auditService = require('../services/auditService');
const { getBusinessProfile, ensureDefaultBusinessProfile } = require('../lib/ensureBusinessProfile');
const { runDatabaseBackup } = require('../lib/backup');
const { getDiscountPolicy } = require('../lib/discountPolicy');

const DISCOUNT_POLICY_BOOLEAN_KEYS = [
  'cashierCanApply',
  'cashierCanRequest',
  'supervisorCanApply',
  'managerCanApply',
  'approvalRequired',
];

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

    const { tradingName, tpin, logoUrl, footerLines, showPoweredBy, receiptVersion, discountPolicy } = req.body;

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

    // NUMZ discount authorization policy (not a ZRA requirement — see
    // lib/discountPolicy.js). Server-side validated: only the known boolean
    // keys are accepted (coerced, unrecognized keys rejected outright) and
    // merged over the *current* stored policy, never replaced wholesale, so
    // a partial update can't silently reset unrelated fields to defaults.
    if (discountPolicy != null) {
      if (typeof discountPolicy !== 'object' || Array.isArray(discountPolicy)) {
        return res.status(400).json({ error: 'discountPolicy must be an object' });
      }
      const unknownKeys = Object.keys(discountPolicy).filter(
        (key) => key !== 'discountLimits' && !DISCOUNT_POLICY_BOOLEAN_KEYS.includes(key)
      );
      if (unknownKeys.length) {
        return res.status(400).json({ error: `Unknown discountPolicy field(s): ${unknownKeys.join(', ')}` });
      }
      const currentPolicy = await getDiscountPolicy(prisma);
      const nextPolicy = { ...currentPolicy };
      for (const key of DISCOUNT_POLICY_BOOLEAN_KEYS) {
        if (discountPolicy[key] != null) nextPolicy[key] = Boolean(discountPolicy[key]);
      }
      // discountLimits is reserved for future per-role percentage caps — not
      // enforced yet, but validated as an object if supplied so a malformed
      // value can't silently corrupt the stored policy.
      if (discountPolicy.discountLimits != null) {
        if (typeof discountPolicy.discountLimits !== 'object' || Array.isArray(discountPolicy.discountLimits)) {
          return res.status(400).json({ error: 'discountPolicy.discountLimits must be an object' });
        }
        nextPolicy.discountLimits = discountPolicy.discountLimits;
      }
      data.discountPolicy = nextPolicy;
    }

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
