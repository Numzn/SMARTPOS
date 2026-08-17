const prisma = require('../lib/prisma')
const crypto = require('crypto')

/**
 * Audit Trail Service - Implementation based on VSDC API Specification v1.0.8
 * Reference: Section 11.1 (Audit Trail and Compliance Logging)
 * 
 * Provides comprehensive audit logging for ZRA compliance
 */

class AuditService {
  constructor() {
    this.prisma = prisma
    
    // Audit event types as per ZRA requirements
    this.eventTypes = {
      // User actions
      USER_LOGIN: 'USER_LOGIN',
      USER_LOGOUT: 'USER_LOGOUT',
      USER_CREATE: 'USER_CREATE',
      USER_UPDATE: 'USER_UPDATE',
      USER_DELETE: 'USER_DELETE',
      USER_ZRA_SYNC: 'USER_ZRA_SYNC',
      
      // Transaction events
      SALE_CREATE: 'SALE_CREATE',
      SALE_UPDATE: 'SALE_UPDATE',
      SALE_CANCEL: 'SALE_CANCEL',
      REFUND_CREATE: 'REFUND_CREATE',
      DEBIT_NOTE_CREATE: 'DEBIT_NOTE_CREATE',
      DISCOUNT_APPROVAL: 'DISCOUNT_APPROVAL',
      TILL_LINE_REVERSAL: 'TILL_LINE_REVERSAL',
      TILL_SESSION_ABANDON: 'TILL_SESSION_ABANDON',
      SUPERVISOR_APPROVAL_GRANTED: 'SUPERVISOR_APPROVAL_GRANTED',
      INVOICE_GENERATE: 'INVOICE_GENERATE',
      INVOICE_SUBMIT: 'INVOICE_SUBMIT',
      INVOICE_CANCEL: 'INVOICE_CANCEL',
      RECEIPT_REPRINT: 'RECEIPT_REPRINT',

      // Catalog events
      PRODUCT_CREATE: 'PRODUCT_CREATE',
      PRODUCT_UPDATE: 'PRODUCT_UPDATE',
      PRODUCT_DELETE: 'PRODUCT_DELETE',
      PRODUCT_BULK_REGISTER: 'PRODUCT_BULK_REGISTER',
      ITEM_SYNC: 'ITEM_SYNC',
      PURCHASE_SYNC: 'PURCHASE_SYNC',
      CATEGORY_CREATE: 'CATEGORY_CREATE',
      CATEGORY_UPDATE: 'CATEGORY_UPDATE',
      CATEGORY_DELETE: 'CATEGORY_DELETE',

      // Inventory events
      STOCK_ADJUSTMENT: 'STOCK_ADJUSTMENT',
      STOCK_RECEIVE: 'STOCK_RECEIVE',
      STOCK_SYNC: 'STOCK_SYNC',

      // Cash register / shift events
      SHIFT_OPEN: 'SHIFT_OPEN',
      SHIFT_CLOSE: 'SHIFT_CLOSE',
      SHIFT_INITIALIZATION_CANCELLED: 'SHIFT_INITIALIZATION_CANCELLED',
      CASH_MOVEMENT: 'CASH_MOVEMENT',
      SAFE_DROP: 'SAFE_DROP',
      SHIFT_END_REQUESTED: 'SHIFT_END_REQUESTED',
      SHIFT_END_AUTHORIZED: 'SHIFT_END_AUTHORIZED',
      Z_REPORT_GENERATED: 'Z_REPORT_GENERATED',
      CASHIER_DECLARATION_SUBMITTED: 'CASHIER_DECLARATION_SUBMITTED',
      SHIFT_RECONCILED: 'SHIFT_RECONCILED',
      SHIFT_VARIANCE_FLAGGED: 'SHIFT_VARIANCE_FLAGGED',
      SHIFT_ADJUSTMENT_CREATED: 'SHIFT_ADJUSTMENT_CREATED',

      // Business management events (customers, suppliers, purchasing)
      CUSTOMER_CREATE: 'CUSTOMER_CREATE',
      CUSTOMER_UPDATE: 'CUSTOMER_UPDATE',
      CUSTOMER_DELETE: 'CUSTOMER_DELETE',
      CUSTOMER_ZRA_SYNC: 'CUSTOMER_ZRA_SYNC',
      SUPPLIER_CREATE: 'SUPPLIER_CREATE',
      SUPPLIER_UPDATE: 'SUPPLIER_UPDATE',
      SUPPLIER_DELETE: 'SUPPLIER_DELETE',
      PURCHASE_ORDER_CREATE: 'PURCHASE_ORDER_CREATE',
      PURCHASE_ORDER_SEND: 'PURCHASE_ORDER_SEND',
      PURCHASE_ORDER_CANCEL: 'PURCHASE_ORDER_CANCEL',
      PURCHASE_ORDER_RECEIVE: 'PURCHASE_ORDER_RECEIVE',
      SUPPLIER_RETURN_CREATE: 'SUPPLIER_RETURN_CREATE',

      // Branch events
      BRANCH_CREATE: 'BRANCH_CREATE',
      BRANCH_UPDATE: 'BRANCH_UPDATE',
      BRANCH_ZRA_SYNC: 'BRANCH_ZRA_SYNC',
      BRANCH_DELETE: 'BRANCH_DELETE',

      // System events
      SYSTEM_START: 'SYSTEM_START',
      SYSTEM_SHUTDOWN: 'SYSTEM_SHUTDOWN',
      BACKUP_CREATE: 'BACKUP_CREATE',
      DATA_EXPORT: 'DATA_EXPORT',
      CONFIG_CHANGE: 'CONFIG_CHANGE',
      SETTINGS_UPDATE: 'SETTINGS_UPDATE',
      
      // ZRA/VSDC events
      VSDC_CONNECT: 'VSDC_CONNECT',
      VSDC_DISCONNECT: 'VSDC_DISCONNECT',
      VSDC_AUTH: 'VSDC_AUTH',
      VSDC_SYNC: 'VSDC_SYNC',
      ZRA_SUBMISSION: 'ZRA_SUBMISSION',
      
      // Security events
      FAILED_LOGIN: 'FAILED_LOGIN',
      PERMISSION_DENIED: 'PERMISSION_DENIED',
      DATA_BREACH_ATTEMPT: 'DATA_BREACH_ATTEMPT',
      UNAUTHORIZED_ACCESS: 'UNAUTHORIZED_ACCESS'
    }

    // Risk levels
    this.riskLevels = {
      LOW: 'LOW',
      MEDIUM: 'MEDIUM',
      HIGH: 'HIGH',
      CRITICAL: 'CRITICAL'
    }
  }

  /**
   * Log audit event
   * Reference: Section 11.1.1
   */
  async logEvent(eventType, details = {}) {
    try {
      const auditEntry = {
        id: this.generateAuditId(),
        eventType,
        timestamp: new Date(),
        userId: details.userId || 'SYSTEM',
        userRole: details.userRole || 'SYSTEM',
        ipAddress: details.ipAddress || 'localhost',
        userAgent: details.userAgent || 'SmartPOS-Backend',
        sessionId: details.sessionId || null,
        entityType: details.entityType || null,
        entityId: details.entityId == null ? null : String(details.entityId),
        action: details.action || eventType,
        oldValues: details.oldValues ?? null,
        newValues: details.newValues ?? null,
        description: details.description || '',
        riskLevel: this.determineRiskLevel(eventType, details),
        success: details.success !== false,
        errorMessage: details.errorMessage || null,
        metadata: details.metadata ?? null,
        hash: null // Will be calculated
      }

      // Calculate integrity hash
      auditEntry.hash = this.calculateIntegrityHash(auditEntry)

      // Save to database
      await this.saveAuditEntry(auditEntry)

      // Log high-risk events immediately
      if (auditEntry.riskLevel === this.riskLevels.HIGH || 
          auditEntry.riskLevel === this.riskLevels.CRITICAL) {
        console.warn(`🚨 HIGH RISK AUDIT EVENT: ${eventType}`, {
          user: auditEntry.userId,
          timestamp: auditEntry.timestamp,
          description: auditEntry.description
        })
      }

      return {
        success: true,
        auditId: auditEntry.id,
        timestamp: auditEntry.timestamp
      }
    } catch (error) {
      console.error('❌ Failed to log audit event:', error.message)
      
      // Critical: If audit logging fails, log to file as backup
      this.logToFile(eventType, details, error)
      
      return {
        success: false,
        error: error.message
      }
    }
  }

  /**
   * Fire-and-forget audit log. Never throws, never blocks the caller's
   * request path — logging failures must not break business operations.
   */
  safeLog(eventType, details = {}) {
    Promise.resolve()
      .then(() => this.logEvent(eventType, details))
      .catch((err) => console.warn(`[audit] log skipped (${eventType}):`, err.message))
  }

  /**
   * Extract request/actor context from an Express request for audit details.
   */
  contextFromReq(req = {}) {
    const user = req.user || {}
    return {
      userId: user.userId || user.id || null,
      userRole: user.role || null,
      ipAddress: req.ip || (req.headers && req.headers['x-forwarded-for']) || null,
      userAgent: req.headers && req.headers['user-agent'],
      sessionId: req.headers && req.headers['x-session-id'],
    }
  }

  /**
   * Log user authentication event
   */
  async logUserAuth(userId, success, details = {}) {
    const eventType = success ? this.eventTypes.USER_LOGIN : this.eventTypes.FAILED_LOGIN
    
    return await this.logEvent(eventType, {
      userId,
      success,
      ipAddress: details.ipAddress,
      userAgent: details.userAgent,
      sessionId: details.sessionId,
      description: success ? 'User logged in successfully' : 'Failed login attempt',
      errorMessage: success ? null : details.errorMessage,
      metadata: {
        loginMethod: details.loginMethod || 'password',
        rememberMe: details.rememberMe || false
      }
    })
  }

  /**
   * Log transaction event
   */
  async logTransaction(action, transactionData, userId, details = {}) {
    let eventType
    switch (action) {
      case 'create': eventType = this.eventTypes.SALE_CREATE; break
      case 'update': eventType = this.eventTypes.SALE_UPDATE; break
      case 'cancel': eventType = this.eventTypes.SALE_CANCEL; break
      default: eventType = this.eventTypes.SALE_CREATE
    }

    return await this.logEvent(eventType, {
      userId,
      entityType: 'TRANSACTION',
      entityId: transactionData.id,
      action,
      newValues: transactionData,
      oldValues: details.oldValues,
      description: `Transaction ${action}: ${transactionData.id}`,
      metadata: {
        amount: transactionData.total,
        items: transactionData.items?.length || 0,
        paymentMethod: transactionData.paymentMethod
      },
      ...details
    })
  }

  /**
   * Log invoice event
   */
  async logInvoice(action, invoiceData, userId, details = {}) {
    let eventType
    switch (action) {
      case 'generate': eventType = this.eventTypes.INVOICE_GENERATE; break
      case 'submit': eventType = this.eventTypes.INVOICE_SUBMIT; break
      case 'cancel': eventType = this.eventTypes.INVOICE_CANCEL; break
      default: eventType = this.eventTypes.INVOICE_GENERATE
    }

    return await this.logEvent(eventType, {
      userId,
      entityType: 'INVOICE',
      entityId: invoiceData.invoiceNumber || invoiceData.id,
      action,
      newValues: invoiceData,
      description: `Invoice ${action}: ${invoiceData.invoiceNumber}`,
      metadata: {
        amount: invoiceData.totalAmount,
        vatAmount: invoiceData.vatAmount,
        customerTpin: invoiceData.customerTpin,
        zraSubmitted: invoiceData.zraSubmitted || false
      },
      ...details
    })
  }

  /**
   * Log system event
   */
  async logSystemEvent(eventType, description, details = {}) {
    return await this.logEvent(eventType, {
      userId: 'SYSTEM',
      userRole: 'SYSTEM',
      description,
      metadata: {
        systemVersion: process.env.npm_package_version || '1.0.0',
        nodeVersion: process.version,
        ...details.metadata
      },
      ...details
    })
  }

  /**
   * Get audit trail for entity
   */
  async getAuditTrail(entityType, entityId, options = {}) {
    try {
      const take = Math.min(options.limit || 100, 1000)
      const skip = options.offset || 0

      const where = {}
      if (entityType) where.entityType = entityType
      if (entityId) where.entityId = entityId
      if (options.eventType) where.eventType = options.eventType
      if (options.userId) where.userId = options.userId
      if (options.riskLevel) where.riskLevel = options.riskLevel
      if (options.success != null) where.success = options.success === true || options.success === 'true'
      if (options.startDate || options.endDate) {
        where.timestamp = {}
        if (options.startDate) where.timestamp.gte = new Date(options.startDate)
        if (options.endDate) where.timestamp.lte = new Date(options.endDate)
      }

      const [auditTrail, totalCount] = await Promise.all([
        this.prisma.auditLog.findMany({
          where,
          orderBy: { timestamp: 'desc' },
          take,
          skip,
        }),
        this.prisma.auditLog.count({ where }),
      ])

      return {
        success: true,
        auditTrail,
        totalCount,
      }
    } catch (error) {
      console.error('❌ Failed to get audit trail:', error.message)
      return {
        success: false,
        error: error.message,
        auditTrail: []
      }
    }
  }

  /**
   * Get security events
   */
  async getSecurityEvents(options = {}) {
    try {
      const securityEventTypes = [
        this.eventTypes.FAILED_LOGIN,
        this.eventTypes.PERMISSION_DENIED,
        this.eventTypes.DATA_BREACH_ATTEMPT,
        this.eventTypes.UNAUTHORIZED_ACCESS
      ]

      const take = Math.min(options.limit || 50, 1000)
      const hours = options.hours || 24
      const since = new Date(Date.now() - hours * 60 * 60 * 1000)

      const events = await this.prisma.auditLog.findMany({
        where: {
          eventType: { in: securityEventTypes },
          timestamp: { gte: since },
        },
        orderBy: { timestamp: 'desc' },
        take,
      })

      return {
        success: true,
        securityEvents: events,
        alertCount: events.filter(e => e.riskLevel === this.riskLevels.HIGH ||
                                      e.riskLevel === this.riskLevels.CRITICAL).length
      }
    } catch (error) {
      console.error('❌ Failed to get security events:', error.message)
      return {
        success: false,
        error: error.message,
        securityEvents: []
      }
    }
  }

  /**
   * Verify audit trail integrity
   */
  async verifyIntegrity(startDate, endDate) {
    try {
      console.log('🔍 Verifying audit trail integrity...')

      const entries = await this.prisma.auditLog.findMany({
        where: {
          timestamp: {
            gte: new Date(startDate),
            lte: new Date(endDate),
          },
        },
        orderBy: { timestamp: 'asc' },
      })

      let verifiedCount = 0
      let corruptedEntries = []

      for (const entry of entries) {
        // Recalculate hash and compare
        const calculatedHash = this.calculateIntegrityHash(entry)
        
        if (calculatedHash === entry.hash) {
          verifiedCount++
        } else {
          corruptedEntries.push({
            id: entry.id,
            timestamp: entry.timestamp,
            eventType: entry.eventType,
            expectedHash: entry.hash,
            calculatedHash
          })
        }
      }

      const integrityPercentage = entries.length > 0 ? 
        (verifiedCount / entries.length) * 100 : 100

      return {
        success: true,
        totalEntries: entries.length,
        verifiedEntries: verifiedCount,
        corruptedEntries: corruptedEntries.length,
        integrityPercentage,
        corruptedDetails: corruptedEntries
      }
    } catch (error) {
      console.error('❌ Failed to verify audit integrity:', error.message)
      return {
        success: false,
        error: error.message
      }
    }
  }

  /**
   * Save audit entry to database
   */
  async saveAuditEntry(auditEntry) {
    await this.prisma.auditLog.create({
      data: {
        id: auditEntry.id,
        eventType: auditEntry.eventType,
        timestamp: auditEntry.timestamp,
        userId: auditEntry.userId,
        userRole: auditEntry.userRole,
        ipAddress: auditEntry.ipAddress,
        userAgent: auditEntry.userAgent,
        sessionId: auditEntry.sessionId,
        entityType: auditEntry.entityType,
        entityId: auditEntry.entityId,
        action: auditEntry.action,
        oldValues: auditEntry.oldValues ?? undefined,
        newValues: auditEntry.newValues ?? undefined,
        description: auditEntry.description,
        riskLevel: auditEntry.riskLevel,
        success: auditEntry.success,
        errorMessage: auditEntry.errorMessage,
        metadata: auditEntry.metadata ?? undefined,
        hash: auditEntry.hash,
      },
    })
  }

  /**
   * Determine risk level based on event type and details
   */
  determineRiskLevel(eventType, details) {
    // Critical events
    if ([
      this.eventTypes.DATA_BREACH_ATTEMPT,
      this.eventTypes.UNAUTHORIZED_ACCESS,
      this.eventTypes.INVOICE_CANCEL
    ].includes(eventType)) {
      return this.riskLevels.CRITICAL
    }

    // High risk events
    if ([
      this.eventTypes.FAILED_LOGIN,
      this.eventTypes.PERMISSION_DENIED,
      this.eventTypes.USER_DELETE,
      this.eventTypes.SALE_CANCEL,
      this.eventTypes.REFUND_CREATE,
      this.eventTypes.BRANCH_DELETE,
      this.eventTypes.CONFIG_CHANGE,
      this.eventTypes.SETTINGS_UPDATE
    ].includes(eventType)) {
      return this.riskLevels.HIGH
    }

    // Medium risk events
    if ([
      this.eventTypes.USER_CREATE,
      this.eventTypes.USER_UPDATE,
      this.eventTypes.PRODUCT_DELETE,
      this.eventTypes.CATEGORY_DELETE,
      this.eventTypes.STOCK_ADJUSTMENT
    ].includes(eventType)) {
      return this.riskLevels.MEDIUM
    }

    // Low risk by default
    return this.riskLevels.LOW
  }

  /**
   * Calculate integrity hash for audit entry
   */
  calculateIntegrityHash(entry) {
    const hashInput = [
      entry.id,
      entry.eventType,
      entry.timestamp instanceof Date ? entry.timestamp.toISOString() : entry.timestamp,
      entry.userId,
      entry.entityType || '',
      entry.entityId || '',
      entry.action || '',
      entry.description || ''
    ].join('|')

    return crypto.createHash('sha256').update(hashInput).digest('hex')
  }

  /**
   * Generate unique audit ID
   */
  generateAuditId() {
    const timestamp = Date.now().toString(36)
    const random = crypto.randomBytes(4).toString('hex')
    return `AUD_${timestamp}_${random}`.toUpperCase()
  }

  /**
   * Log to file as backup when database fails
   */
  logToFile(eventType, details, error) {
    try {
      const fs = require('fs')
      const path = require('path')
      
      const logDir = path.join(__dirname, '..', 'logs')
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true })
      }

      const logFile = path.join(logDir, `audit-backup-${new Date().toISOString().split('T')[0]}.log`)
      const logEntry = {
        timestamp: new Date().toISOString(),
        eventType,
        details,
        databaseError: error.message,
        auditId: this.generateAuditId()
      }

      fs.appendFileSync(logFile, JSON.stringify(logEntry) + '\n')
      console.warn('⚠️ Audit logged to backup file:', logFile)
    } catch (fileError) {
      console.error('❌ Critical: Failed to log audit to backup file:', fileError.message)
    }
  }
}

module.exports = new AuditService()
