const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { authenticateToken, requirePermission, requireRole } = require('../middleware/auth');
const auditService = require('../services/auditService');
const { getBusinessProfile, ensureDefaultBusinessProfile } = require('../lib/ensureBusinessProfile');
const { runDatabaseBackup } = require('../lib/backup');
const { getDiscountPolicy } = require('../lib/discountPolicy');
const { ALL_PERMISSIONS, listRolePermissions, setRolePermission } = require('../lib/permissions');

const VALID_ROLES = ['ADMIN', 'MANAGER', 'SUPERVISOR', 'CASHIER', 'VIEWER'];

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

// Configurable RBAC: read/update the role -> permission matrix. Deliberately
// gated by requireRole('ADMIN') rather than requirePermission('settings:write')
// — editing the permission matrix is a strictly higher-trust action than
// editing business profile fields, and gating it on a *permission* would let
// an ADMIN grant a MANAGER `settings:write` and thereby hand that MANAGER
// the ability to grant itself anything (self-escalation). requireRole keeps
// this specific door ADMIN-only regardless of what settings:write covers.
// This endpoint only ever writes RolePermission rows — it has no path to
// ROLE_RANK or the approval-eligibility logic in lib/approval.js, which stay
// a separate, unmodified system.
router.get('/roles', authenticateToken, requireRole('ADMIN'), async (req, res) => {
  try {
    const rows = await listRolePermissions();
    res.json({ roles: VALID_ROLES, permissions: ALL_PERMISSIONS, grants: rows });
  } catch (error) {
    console.error('Role permissions fetch error:', error.message);
    res.status(500).json({ error: 'Failed to load role permissions' });
  }
});

router.put('/roles/:role', authenticateToken, requireRole('ADMIN'), async (req, res) => {
  try {
    const { role } = req.params;
    if (!VALID_ROLES.includes(role)) {
      return res.status(400).json({ error: `Invalid role: ${role}` });
    }

    const { permission, granted } = req.body;
    if (typeof permission !== 'string' || !permission) {
      return res.status(400).json({ error: 'permission is required' });
    }
    if (typeof granted !== 'boolean') {
      return res.status(400).json({ error: 'granted must be a boolean' });
    }
    if (!ALL_PERMISSIONS.includes(permission)) {
      return res.status(400).json({ error: `Unknown permission: ${permission}` });
    }

    const row = await setRolePermission(role, permission, granted, req.user.userId);

    auditService.safeLog(auditService.eventTypes.SETTINGS_UPDATE, {
      ...auditService.contextFromReq(req),
      entityType: 'ROLE_PERMISSION',
      entityId: `${role}:${permission}`,
      action: 'UPDATE',
      newValues: { role, permission, granted },
      description: `Role permission ${granted ? 'granted' : 'revoked'}: ${role} / ${permission}`,
    });

    res.json(row);
  } catch (error) {
    if (error.code === 'UNKNOWN_ROLE' || error.code === 'UNKNOWN_PERMISSION') {
      return res.status(400).json({ error: error.message });
    }
    console.error('Role permission update error:', error.message);
    res.status(500).json({ error: 'Failed to update role permission' });
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
