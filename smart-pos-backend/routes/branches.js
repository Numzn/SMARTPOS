const express = require('express')
const router = express.Router()
const prisma = require('../lib/prisma')
const vsdcService = require('../services/vsdcService')
const auditService = require('../services/auditService')
const { authenticateToken: auth } = require('../middleware/auth')

/**
 * Branch Management Routes - Implementation based on VSDC API Specification v1.0.8
 * Reference: Section 7.1 (Branch Management)
 * 
 * Handles business branch registration and management for ZRA compliance
 */

/**
 * Get all branches
 * GET /api/branches
 */
router.get('/', auth, async (req, res) => {
  try {
    const branches = await prisma.branch.findMany({
      where: {
        isActive: true
      },
      include: {
        _count: {
          select: {
            sales: true,
            users: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    })

    // Enhance with ZRA status
    const enhancedBranches = branches.map(branch => ({
      ...branch,
      salesCount: branch._count.sales,
      usersCount: branch._count.users,
      zraStatus: branch.zraRegistered ? 'REGISTERED' : 'PENDING'
    }))

    await auditService.logEvent(auditService.eventTypes.SYSTEM_START, {
      userId: req.user.id,
      action: 'GET_BRANCHES',
      description: `Retrieved ${branches.length} branches`,
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    })

    res.json({
      success: true,
      branches: enhancedBranches,
      total: branches.length
    })
  } catch (error) {
    console.error('❌ Error fetching branches:', error.message)
    
    await auditService.logEvent(auditService.eventTypes.SYSTEM_START, {
      userId: req.user?.id,
      action: 'GET_BRANCHES',
      success: false,
      errorMessage: error.message,
      ipAddress: req.ip
    })

    res.status(500).json({
      success: false,
      error: 'Failed to fetch branches',
      message: error.message
    })
  }
})

/**
 * Get specific branch
 * GET /api/branches/:id
 */
router.get('/:id', auth, async (req, res) => {
  try {
    const { id } = req.params

    const branch = await prisma.branch.findUnique({
      where: { id },
      include: {
        users: {
          select: {
            id: true,
            username: true,
            role: true,
            isActive: true
          }
        },
        sales: {
          take: 10,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            total: true,
            createdAt: true,
            status: true
          }
        }
      }
    })

    if (!branch) {
      return res.status(404).json({
        success: false,
        error: 'Branch not found'
      })
    }

    // Get ZRA registration status from VSDC
    let zraDetails = null
    try {
      if (branch.zraRegistered && branch.bhfId) {
        const zraResponse = await vsdcService.makeAuthenticatedRequest(
          'GET', 
          `/api/branch/get/${branch.bhfId}`
        )
        if (zraResponse.success) {
          zraDetails = zraResponse.data
        }
      }
    } catch (error) {
      console.warn('⚠️ Could not fetch ZRA details:', error.message)
    }

    res.json({
      success: true,
      branch: {
        ...branch,
        zraDetails,
        recentSales: branch.sales,
        activeUsers: branch.users.filter(u => u.isActive)
      }
    })
  } catch (error) {
    console.error('❌ Error fetching branch:', error.message)
    res.status(500).json({
      success: false,
      error: 'Failed to fetch branch',
      message: error.message
    })
  }
})

/**
 * Create new branch
 * POST /api/branches
 */
router.post('/', auth, async (req, res) => {
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
      autoRegisterZRA = false
    } = req.body

    // Validate required fields
    if (!name || !code || !address) {
      return res.status(400).json({
        success: false,
        error: 'Name, code, and address are required'
      })
    }

    // Check if branch code already exists
    const existingBranch = await prisma.branch.findUnique({
      where: { code }
    })

    if (existingBranch) {
      return res.status(409).json({
        success: false,
        error: 'Branch code already exists'
      })
    }

    // Generate unique branch ID for ZRA
    const bhfId = await generateBranchId(code)

    // Create branch in database
    const branch = await prisma.branch.create({
      data: {
        name,
        code,
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
        createdBy: req.user.id
      }
    })

    // Register with ZRA if requested
    let zraRegistration = null
    if (autoRegisterZRA) {
      try {
        zraRegistration = await registerBranchWithZRA(branch)
        if (zraRegistration.success) {
          await prisma.branch.update({
            where: { id: branch.id },
            data: {
              zraRegistered: true,
              zraRegistrationDate: new Date(),
              zraRegistrationNumber: zraRegistration.registrationNumber
            }
          })
        }
      } catch (error) {
        console.warn('⚠️ ZRA registration failed:', error.message)
        zraRegistration = { success: false, error: error.message }
      }
    }

    // Log audit event
    await auditService.logEvent(auditService.eventTypes.USER_CREATE, {
      userId: req.user.id,
      entityType: 'BRANCH',
      entityId: branch.id,
      action: 'CREATE',
      newValues: branch,
      description: `Branch created: ${name} (${code})`,
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
      metadata: {
        autoRegisterZRA,
        zraRegistrationSuccess: zraRegistration?.success || false
      }
    })

    res.status(201).json({
      success: true,
      branch,
      zraRegistration,
      message: 'Branch created successfully'
    })
  } catch (error) {
    console.error('❌ Error creating branch:', error.message)
    
    await auditService.logEvent(auditService.eventTypes.USER_CREATE, {
      userId: req.user?.id,
      entityType: 'BRANCH',
      action: 'CREATE',
      success: false,
      errorMessage: error.message,
      ipAddress: req.ip
    })

    res.status(500).json({
      success: false,
      error: 'Failed to create branch',
      message: error.message
    })
  }
})

/**
 * Update branch
 * PUT /api/branches/:id
 */
router.put('/:id', auth, async (req, res) => {
  try {
    const { id } = req.params
    const updateData = req.body

    // Get existing branch for audit trail
    const existingBranch = await prisma.branch.findUnique({
      where: { id }
    })

    if (!existingBranch) {
      return res.status(404).json({
        success: false,
        error: 'Branch not found'
      })
    }

    // Update branch
    const updatedBranch = await prisma.branch.update({
      where: { id },
      data: {
        ...updateData,
        updatedAt: new Date(),
        updatedBy: req.user.id
      }
    })

    // Update ZRA registration if branch details changed
    let zraUpdate = null
    if (existingBranch.zraRegistered && 
        (updateData.name || updateData.address || updateData.phone)) {
      try {
        zraUpdate = await updateBranchInZRA(updatedBranch)
      } catch (error) {
        console.warn('⚠️ ZRA update failed:', error.message)
        zraUpdate = { success: false, error: error.message }
      }
    }

    // Log audit event
    await auditService.logEvent(auditService.eventTypes.USER_UPDATE, {
      userId: req.user.id,
      entityType: 'BRANCH',
      entityId: id,
      action: 'UPDATE',
      oldValues: existingBranch,
      newValues: updatedBranch,
      description: `Branch updated: ${updatedBranch.name}`,
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
      metadata: {
        zraUpdateSuccess: zraUpdate?.success
      }
    })

    res.json({
      success: true,
      branch: updatedBranch,
      zraUpdate,
      message: 'Branch updated successfully'
    })
  } catch (error) {
    console.error('❌ Error updating branch:', error.message)
    
    await auditService.logEvent(auditService.eventTypes.USER_UPDATE, {
      userId: req.user?.id,
      entityType: 'BRANCH',
      entityId: req.params.id,
      action: 'UPDATE',
      success: false,
      errorMessage: error.message,
      ipAddress: req.ip
    })

    res.status(500).json({
      success: false,
      error: 'Failed to update branch',
      message: error.message
    })
  }
})

/**
 * Register branch with ZRA
 * POST /api/branches/:id/register-zra
 */
router.post('/:id/register-zra', auth, async (req, res) => {
  try {
    const { id } = req.params

    const branch = await prisma.branch.findUnique({
      where: { id }
    })

    if (!branch) {
      return res.status(404).json({
        success: false,
        error: 'Branch not found'
      })
    }

    if (branch.zraRegistered) {
      return res.status(409).json({
        success: false,
        error: 'Branch already registered with ZRA'
      })
    }

    // Register with ZRA
    const zraRegistration = await registerBranchWithZRA(branch)

    if (zraRegistration.success) {
      // Update branch status
      await prisma.branch.update({
        where: { id },
        data: {
          zraRegistered: true,
          zraRegistrationDate: new Date(),
          zraRegistrationNumber: zraRegistration.registrationNumber
        }
      })

      // Log audit event
      await auditService.logEvent(auditService.eventTypes.ZRA_SUBMISSION, {
        userId: req.user.id,
        entityType: 'BRANCH',
        entityId: id,
        action: 'ZRA_REGISTER',
        description: `Branch registered with ZRA: ${branch.name}`,
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
        metadata: {
          registrationNumber: zraRegistration.registrationNumber,
          bhfId: branch.bhfId
        }
      })

      res.json({
        success: true,
        zraRegistration,
        message: 'Branch successfully registered with ZRA'
      })
    } else {
      res.status(400).json({
        success: false,
        error: 'ZRA registration failed',
        details: zraRegistration.error
      })
    }
  } catch (error) {
    console.error('❌ Error registering branch with ZRA:', error.message)
    
    await auditService.logEvent(auditService.eventTypes.ZRA_SUBMISSION, {
      userId: req.user?.id,
      entityType: 'BRANCH',
      entityId: req.params.id,
      action: 'ZRA_REGISTER',
      success: false,
      errorMessage: error.message,
      ipAddress: req.ip
    })

    res.status(500).json({
      success: false,
      error: 'Failed to register branch with ZRA',
      message: error.message
    })
  }
})

/**
 * Deactivate branch
 * DELETE /api/branches/:id
 */
router.delete('/:id', auth, async (req, res) => {
  try {
    const { id } = req.params

    const branch = await prisma.branch.findUnique({
      where: { id }
    })

    if (!branch) {
      return res.status(404).json({
        success: false,
        error: 'Branch not found'
      })
    }

    // Soft delete - deactivate instead of deleting
    const deactivatedBranch = await prisma.branch.update({
      where: { id },
      data: {
        isActive: false,
        deactivatedAt: new Date(),
        deactivatedBy: req.user.id
      }
    })

    // Log audit event
    await auditService.logEvent(auditService.eventTypes.USER_DELETE, {
      userId: req.user.id,
      entityType: 'BRANCH',
      entityId: id,
      action: 'DEACTIVATE',
      oldValues: branch,
      newValues: deactivatedBranch,
      description: `Branch deactivated: ${branch.name}`,
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    })

    res.json({
      success: true,
      message: 'Branch deactivated successfully'
    })
  } catch (error) {
    console.error('❌ Error deactivating branch:', error.message)
    
    await auditService.logEvent(auditService.eventTypes.USER_DELETE, {
      userId: req.user?.id,
      entityType: 'BRANCH',
      entityId: req.params.id,
      action: 'DEACTIVATE',
      success: false,
      errorMessage: error.message,
      ipAddress: req.ip
    })

    res.status(500).json({
      success: false,
      error: 'Failed to deactivate branch',
      message: error.message
    })
  }
})

/**
 * Helper Functions
 */

/**
 * Generate unique branch ID for ZRA
 */
async function generateBranchId(code) {
  // ZRA branch ID format: 3-digit number
  const existingBranches = await prisma.branch.findMany({
    select: { bhfId: true }
  })

  const existingIds = existingBranches.map(b => parseInt(b.bhfId)).filter(id => !isNaN(id))
  
  let newId = 1
  while (existingIds.includes(newId)) {
    newId++
  }

  return newId.toString().padStart(3, '0')
}

/**
 * Register branch with ZRA VSDC
 * Reference: Section 7.1.1
 */
async function registerBranchWithZRA(branch) {
  try {
    const payload = {
      tpin: vsdcService.tpin,
      bhfId: branch.bhfId,
      bhfNm: branch.name,
      bhfSttsCd: '01', // Active status
      prvncNm: branch.province || 'Lusaka',
      dstrtNm: branch.district || 'Lusaka',
      sctrNm: 'Retail', // Business sector
      locDesc: branch.address,
      mgrNm: branch.managerName || 'Manager',
      mgrTelNo: branch.managerPhone || branch.phone,
      mgrEmail: branch.email || '',
      hqYn: branch.code === 'HQ' ? 'Y' : 'N', // Headquarters flag
      fstRegYn: 'Y', // First registration
      mapngYn: 'N', // Mapping flag
      mrcNo: '', // Merchant number
      lastPchsInvcNo: '0',
      lastSaleRcptNo: '0',
      lastInvcNo: '0',
      lastSaleInvcNo: '0',
      lastTradeInvcNo: '0',
      lastProfrmInvcNo: '0',
      lastCopyInvcNo: '0'
    }

    const response = await vsdcService.makeAuthenticatedRequest(
      'POST',
      vsdcService.endpoints.branchSave,
      payload
    )

    if (response.success && response.data.resultCd === '000') {
      return {
        success: true,
        registrationNumber: response.data.rcptNo || response.data.bhfId,
        message: 'Branch registered with ZRA successfully'
      }
    } else {
      throw new Error(`ZRA registration failed: ${response.data?.resultMsg || 'Unknown error'}`)
    }
  } catch (error) {
    console.error('❌ ZRA branch registration failed:', error.message)
    return {
      success: false,
      error: error.message
    }
  }
}

/**
 * Update branch in ZRA VSDC
 */
async function updateBranchInZRA(branch) {
  try {
    // Use the same registration payload but with updated data
    return await registerBranchWithZRA(branch)
  } catch (error) {
    console.error('❌ ZRA branch update failed:', error.message)
    return {
      success: false,
      error: error.message
    }
  }
}

module.exports = router
