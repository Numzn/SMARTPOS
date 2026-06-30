const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const vsdcService = require('../services/vsdcService');
const auditService = require('../services/auditService');
const { authenticateToken, requirePermission } = require('../middleware/auth');
const { ensureDefaultBranch } = require('../lib/ensureDefaultBranch');

const UPDATABLE_FIELDS = [
  'name',
  'address',
  'phone',
  'email',
  'managerName',
  'managerPhone',
  'province',
  'district',
];

function actorId(req) {
  return req.user?.userId || req.user?.id || null;
}

async function safeAudit(eventType, payload) {
  try {
    if (auditService?.logEvent) {
      await auditService.logEvent(eventType, payload);
    }
  } catch (err) {
    console.warn('[branches] audit log skipped:', err.message);
  }
}

function pickUpdatable(body) {
  const data = {};
  for (const key of UPDATABLE_FIELDS) {
    if (body[key] !== undefined) data[key] = body[key];
  }
  return data;
}

async function generateBhfId() {
  const rows = await prisma.branch.findMany({ select: { bhfId: true } });
  const used = new Set(rows.map((r) => r.bhfId));
  for (let n = 1; n < 1000; n += 1) {
    const candidate = String(n).padStart(3, '0');
    if (!used.has(candidate)) return candidate;
  }
  throw new Error('No available ZRA branch IDs (bhfId)');
}

async function registerBranchWithZRA(branch) {
  const payload = {
    tpin: vsdcService.tpin,
    bhfId: branch.bhfId,
    bhfNm: branch.name,
    bhfSttsCd: '01',
    prvncNm: branch.province || 'Lusaka',
    dstrtNm: branch.district || 'Lusaka',
    sctrNm: 'Retail',
    locDesc: branch.address,
    mgrNm: branch.managerName || 'Manager',
    mgrTelNo: branch.managerPhone || branch.phone || '',
    mgrEmail: branch.email || '',
    hqYn: branch.code === 'HQ' || branch.code === 'main' ? 'Y' : 'N',
    fstRegYn: 'Y',
    mapngYn: 'N',
    mrcNo: '',
    lastPchsInvcNo: '0',
    lastSaleRcptNo: '0',
    lastInvcNo: '0',
    lastSaleInvcNo: '0',
    lastTradeInvcNo: '0',
    lastProfrmInvcNo: '0',
    lastCopyInvcNo: '0',
  };

  const response = await vsdcService.makeAuthenticatedRequest(
    'POST',
    vsdcService.endpoints.branchSave,
    payload
  );

  if (response.success && response.data?.resultCd === '000') {
    return {
      success: true,
      registrationNumber: response.data.rcptNo || response.data.bhfId || branch.bhfId,
      message: 'Branch registered with ZRA successfully',
    };
  }

  return {
    success: false,
    error: response.data?.resultMsg || response.error || 'ZRA branch registration failed',
  };
}

/** GET /api/branches */
router.get('/', authenticateToken, requirePermission('settings:read'), async (req, res) => {
  try {
    await ensureDefaultBranch();

    const branches = await prisma.branch.findMany({
      where: { isActive: true },
      include: {
        _count: { select: { sales: true, users: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      success: true,
      branches: branches.map((branch) => ({
        ...branch,
        salesCount: branch._count.sales,
        usersCount: branch._count.users,
        zraStatus: branch.zraRegistered ? 'REGISTERED' : 'PENDING',
      })),
      total: branches.length,
    });
  } catch (error) {
    console.error('Error fetching branches:', error.message);
    res.status(500).json({ success: false, error: 'Failed to fetch branches', message: error.message });
  }
});

/** GET /api/branches/:id */
router.get('/:id', authenticateToken, requirePermission('settings:read'), async (req, res) => {
  try {
    const branch = await prisma.branch.findUnique({
      where: { id: req.params.id },
      include: {
        users: {
          select: { id: true, name: true, email: true, role: true, isActive: true },
        },
        sales: {
          take: 10,
          orderBy: { createdAt: 'desc' },
          select: { id: true, total: true, createdAt: true, status: true, rcptNo: true },
        },
        _count: { select: { sales: true, users: true } },
      },
    });

    if (!branch) {
      return res.status(404).json({ success: false, error: 'Branch not found' });
    }

    let zraDetails = null;
    if (branch.zraRegistered && branch.bhfId) {
      try {
        const zraResponse = await vsdcService.makeAuthenticatedRequest(
          'GET',
          `${vsdcService.endpoints.branchGet}/${branch.bhfId}`
        );
        if (zraResponse.success) zraDetails = zraResponse.data;
      } catch (err) {
        console.warn('Could not fetch ZRA branch details:', err.message);
      }
    }

    res.json({
      success: true,
      branch: {
        ...branch,
        salesCount: branch._count.sales,
        usersCount: branch._count.users,
        zraDetails,
        recentSales: branch.sales,
        activeUsers: branch.users.filter((u) => u.isActive),
      },
    });
  } catch (error) {
    console.error('Error fetching branch:', error.message);
    res.status(500).json({ success: false, error: 'Failed to fetch branch', message: error.message });
  }
});

/** POST /api/branches */
router.post('/', authenticateToken, requirePermission('settings:write'), async (req, res) => {
  try {
    const {
      name,
      code,
      address,
      phone,
      email,
      managerName,
      managerPhone,
      province,
      district,
      autoRegisterZRA = false,
    } = req.body;

    if (!name || !code || !address) {
      return res.status(400).json({
        success: false,
        error: 'Name, code, and address are required',
      });
    }

    const normalizedCode = String(code).trim().toLowerCase();
    if (!/^[a-z0-9_-]{2,32}$/.test(normalizedCode)) {
      return res.status(400).json({
        success: false,
        error: 'Branch code must be 2–32 chars (letters, numbers, _ or -)',
      });
    }

    const existingBranch = await prisma.branch.findUnique({ where: { code: normalizedCode } });
    if (existingBranch) {
      return res.status(409).json({ success: false, error: 'Branch code already exists' });
    }

    const bhfId = await generateBhfId();
    const userId = actorId(req);

    const branch = await prisma.branch.create({
      data: {
        name,
        code: normalizedCode,
        bhfId,
        address,
        phone,
        email,
        managerName,
        managerPhone,
        province,
        district,
        isActive: true,
        zraRegistered: false,
        createdBy: userId,
      },
    });

    let zraRegistration = null;
    if (autoRegisterZRA) {
      zraRegistration = await registerBranchWithZRA(branch);
      if (zraRegistration.success) {
        await prisma.branch.update({
          where: { id: branch.id },
          data: {
            zraRegistered: true,
            zraRegistrationDate: new Date(),
            zraRegistrationNumber: zraRegistration.registrationNumber,
          },
        });
      }
    }

    await safeAudit(auditService.eventTypes.USER_CREATE, {
      userId,
      entityType: 'BRANCH',
      entityId: branch.id,
      action: 'CREATE',
      description: `Branch created: ${name} (${normalizedCode})`,
    });

    res.status(201).json({
      success: true,
      branch,
      zraRegistration,
      message: 'Branch created successfully',
    });
  } catch (error) {
    console.error('Error creating branch:', error.message);
    res.status(500).json({ success: false, error: 'Failed to create branch', message: error.message });
  }
});

/** PUT /api/branches/:id */
router.put('/:id', authenticateToken, requirePermission('settings:write'), async (req, res) => {
  try {
    const existingBranch = await prisma.branch.findUnique({ where: { id: req.params.id } });
    if (!existingBranch) {
      return res.status(404).json({ success: false, error: 'Branch not found' });
    }

    const data = pickUpdatable(req.body);
    if (Object.keys(data).length === 0) {
      return res.status(400).json({ success: false, error: 'No updatable fields provided' });
    }

    const updatedBranch = await prisma.branch.update({
      where: { id: req.params.id },
      data: { ...data, updatedBy: actorId(req) },
    });

    let zraUpdate = null;
    if (existingBranch.zraRegistered && (data.name || data.address || data.phone)) {
      zraUpdate = await registerBranchWithZRA(updatedBranch);
    }

    await safeAudit(auditService.eventTypes.USER_UPDATE, {
      userId: actorId(req),
      entityType: 'BRANCH',
      entityId: req.params.id,
      action: 'UPDATE',
      description: `Branch updated: ${updatedBranch.name}`,
    });

    res.json({
      success: true,
      branch: updatedBranch,
      zraUpdate,
      message: 'Branch updated successfully',
    });
  } catch (error) {
    console.error('Error updating branch:', error.message);
    res.status(500).json({ success: false, error: 'Failed to update branch', message: error.message });
  }
});

/** POST /api/branches/:id/register-zra */
router.post(
  '/:id/register-zra',
  authenticateToken,
  requirePermission('zra:submit'),
  async (req, res) => {
    try {
      const branch = await prisma.branch.findUnique({ where: { id: req.params.id } });
      if (!branch) {
        return res.status(404).json({ success: false, error: 'Branch not found' });
      }
      if (branch.zraRegistered) {
        return res.status(409).json({ success: false, error: 'Branch already registered with ZRA' });
      }

      const zraRegistration = await registerBranchWithZRA(branch);
      if (!zraRegistration.success) {
        return res.status(400).json({
          success: false,
          error: 'ZRA registration failed',
          details: zraRegistration.error,
        });
      }

      await prisma.branch.update({
        where: { id: branch.id },
        data: {
          zraRegistered: true,
          zraRegistrationDate: new Date(),
          zraRegistrationNumber: zraRegistration.registrationNumber,
        },
      });

      await safeAudit(auditService.eventTypes.ZRA_SUBMISSION, {
        userId: actorId(req),
        entityType: 'BRANCH',
        entityId: branch.id,
        action: 'ZRA_REGISTER',
        description: `Branch registered with ZRA: ${branch.name}`,
      });

      res.json({
        success: true,
        zraRegistration,
        message: 'Branch successfully registered with ZRA',
      });
    } catch (error) {
      console.error('Error registering branch with ZRA:', error.message);
      res.status(500).json({
        success: false,
        error: 'Failed to register branch with ZRA',
        message: error.message,
      });
    }
  }
);

/** DELETE /api/branches/:id — soft deactivate */
router.delete('/:id', authenticateToken, requirePermission('settings:write'), async (req, res) => {
  try {
    const branch = await prisma.branch.findUnique({ where: { id: req.params.id } });
    if (!branch) {
      return res.status(404).json({ success: false, error: 'Branch not found' });
    }
    if (branch.code === 'main') {
      return res.status(400).json({ success: false, error: 'Cannot deactivate the default main branch' });
    }

    await prisma.branch.update({
      where: { id: branch.id },
      data: {
        isActive: false,
        deactivatedAt: new Date(),
        deactivatedBy: actorId(req),
      },
    });

    await safeAudit(auditService.eventTypes.USER_DELETE, {
      userId: actorId(req),
      entityType: 'BRANCH',
      entityId: branch.id,
      action: 'DEACTIVATE',
      description: `Branch deactivated: ${branch.name}`,
    });

    res.json({ success: true, message: 'Branch deactivated successfully' });
  } catch (error) {
    console.error('Error deactivating branch:', error.message);
    res.status(500).json({ success: false, error: 'Failed to deactivate branch', message: error.message });
  }
});

module.exports = router;
