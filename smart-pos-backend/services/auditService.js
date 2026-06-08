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
      
      // Transaction events
      SALE_CREATE: 'SALE_CREATE',
      SALE_UPDATE: 'SALE_UPDATE',
      SALE_CANCEL: 'SALE_CANCEL',
      INVOICE_GENERATE: 'INVOICE_GENERATE',
      INVOICE_SUBMIT: 'INVOICE_SUBMIT',
      INVOICE_CANCEL: 'INVOICE_CANCEL',
      
      // Inventory events
      PRODUCT_CREATE: 'PRODUCT_CREATE',
      PRODUCT_UPDATE: 'PRODUCT_UPDATE',
      PRODUCT_DELETE: 'PRODUCT_DELETE',
      STOCK_ADJUSTMENT: 'STOCK_ADJUSTMENT',
      STOCK_SYNC: 'STOCK_SYNC',
      
      // System events
      SYSTEM_START: 'SYSTEM_START',
      SYSTEM_SHUTDOWN: 'SYSTEM_SHUTDOWN',
      BACKUP_CREATE: 'BACKUP_CREATE',
      DATA_EXPORT: 'DATA_EXPORT',
      CONFIG_CHANGE: 'CONFIG_CHANGE',
      
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
        entityId: details.entityId || null,
        action: details.action || eventType,
        oldValues: details.oldValues ? JSON.stringify(details.oldValues) : null,
        newValues: details.newValues ? JSON.stringify(details.newValues) : null,
        description: details.description || '',
        riskLevel: this.determineRiskLevel(eventType, details),
        success: details.success !== false,
        errorMessage: details.errorMessage || null,
        metadata: details.metadata ? JSON.stringify(details.metadata) : null,
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
      const limit = options.limit || 100
      const offset = options.offset || 0
      const startDate = options.startDate
      const endDate = options.endDate

      let whereClause = 'WHERE entity_type = $1 AND entity_id = $2'
      let params = [entityType, entityId]
      let paramIndex = 3

      if (startDate) {
        whereClause += ` AND timestamp >= $${paramIndex}`
        params.push(startDate)
        paramIndex++
      }

      if (endDate) {
        whereClause += ` AND timestamp <= $${paramIndex}`
        params.push(endDate)
        paramIndex++
      }

      const query = `
        SELECT * FROM audit_trail 
        ${whereClause}
        ORDER BY timestamp DESC 
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
      `
      params.push(limit, offset)

      const auditEntries = await this.prisma.$queryRawUnsafe(query, ...params)

      return {
        success: true,
        auditTrail: auditEntries.map(entry => ({
          ...entry,
          oldValues: entry.oldValues ? JSON.parse(entry.oldValues) : null,
          newValues: entry.newValues ? JSON.parse(entry.newValues) : null,
          metadata: entry.metadata ? JSON.parse(entry.metadata) : null
        })),
        totalCount: auditEntries.length
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

      const limit = options.limit || 50
      const hours = options.hours || 24

      const query = `
        SELECT * FROM audit_trail 
        WHERE event_type = ANY($1)
        AND timestamp >= NOW() - INTERVAL '${hours} hours'
        ORDER BY timestamp DESC 
        LIMIT $2
      `

      const events = await this.prisma.$queryRawUnsafe(query, securityEventTypes, limit)

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
      
      const query = `
        SELECT id, hash, timestamp, event_type, user_id, entity_type, entity_id
        FROM audit_trail 
        WHERE timestamp BETWEEN $1 AND $2
        ORDER BY timestamp
      `

      const entries = await this.prisma.$queryRawUnsafe(query, startDate, endDate)
      
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
            eventType: entry.event_type,
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
    try {
      const query = `
        INSERT INTO audit_trail (
          id, event_type, timestamp, user_id, user_role, ip_address, 
          user_agent, session_id, entity_type, entity_id, action,
          old_values, new_values, description, risk_level, success,
          error_message, metadata, hash
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19
        )
      `

      await this.prisma.$executeRawUnsafe(query,
        auditEntry.id, auditEntry.eventType, auditEntry.timestamp,
        auditEntry.userId, auditEntry.userRole, auditEntry.ipAddress,
        auditEntry.userAgent, auditEntry.sessionId, auditEntry.entityType,
        auditEntry.entityId, auditEntry.action, auditEntry.oldValues,
        auditEntry.newValues, auditEntry.description, auditEntry.riskLevel,
        auditEntry.success, auditEntry.errorMessage, auditEntry.metadata,
        auditEntry.hash
      )
    } catch (error) {
      // If table doesn't exist, create it
      if (error.message.includes('relation "audit_trail" does not exist')) {
        await this.createAuditTable()
        // Retry the insert
        await this.saveAuditEntry(auditEntry)
      } else {
        throw error
      }
    }
  }

  /**
   * Create audit trail table if it doesn't exist
   */
  async createAuditTable() {
    const createTableSQL = `
      CREATE TABLE IF NOT EXISTS audit_trail (
        id VARCHAR(50) PRIMARY KEY,
        event_type VARCHAR(50) NOT NULL,
        timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
        user_id VARCHAR(50),
        user_role VARCHAR(30),
        ip_address VARCHAR(45),
        user_agent TEXT,
        session_id VARCHAR(100),
        entity_type VARCHAR(50),
        entity_id VARCHAR(50),
        action VARCHAR(50),
        old_values TEXT,
        new_values TEXT,
        description TEXT,
        risk_level VARCHAR(10) DEFAULT 'LOW',
        success BOOLEAN DEFAULT true,
        error_message TEXT,
        metadata TEXT,
        hash VARCHAR(64) NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_trail(timestamp);
      CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_trail(user_id);
      CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_trail(entity_type, entity_id);
      CREATE INDEX IF NOT EXISTS idx_audit_event_type ON audit_trail(event_type);
      CREATE INDEX IF NOT EXISTS idx_audit_risk_level ON audit_trail(risk_level);
    `

    await this.prisma.$executeRawUnsafe(createTableSQL)
    console.log('✅ Audit trail table created')
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
      this.eventTypes.CONFIG_CHANGE
    ].includes(eventType)) {
      return this.riskLevels.HIGH
    }

    // Medium risk events
    if ([
      this.eventTypes.USER_CREATE,
      this.eventTypes.USER_UPDATE,
      this.eventTypes.PRODUCT_DELETE,
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
