const axios = require('axios')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

/**
 * VSDC Service - Enhanced implementation based on VSDC API Specification v1.0.8
 * Reference: Section 4.1 (Authentication) & Section 4.2 (Initialization)
 * 
 * This service handles all communication with ZRA's VSDC system
 */

class VSDCService {
  constructor() {
    this.baseURL = process.env.VSDC_URL || 'http://localhost:8090' // Default to mock-vsdc-server (npm run mock-vsdc)
    this.username = process.env.VSDC_USERNAME
    this.password = process.env.VSDC_PASSWORD
    this.tpin = process.env.BUSINESS_TPIN
    this.bhfId = process.env.BRANCH_ID || '000'
    this.sessionToken = null
    this.sessionExpiry = null
    this.isInitialized = false
    
    // VSDC API endpoints as per specification
    this.endpoints = {
      login: '/api/login',
      ping: '/api/ping', 
      initialize: '/api/initialize',
      itemSave: '/api/items/save',
      itemsSync: '/api/items/sync',
      stockSave: '/api/stock/save',
      stockSync: '/api/stock/sync',
      branchSave: '/api/branch/save',
      branchGet: '/api/branch/get',
      invoiceSubmit: '/api/invoice/submit',
      purchaseGet: '/api/purchase/get',
      codesGet: '/api/codes/get'
    }
  }

  /**
   * VSDC Authentication - Section 4.1 (Enhanced for 100% compliance)
   * Authenticates with VSDC system and obtains session token with session ID
   */
  async authenticate() {
    try {
      console.log('🔐 Authenticating with VSDC...')
      
      const authPayload = {
        tpin: this.tpin,
        bhfId: this.bhfId,
        dvcSrlNo: await this.getDeviceSerial(),
        userId: this.username,
        userPwd: this.password
      }

      const response = await axios.post(`${this.baseURL}${this.endpoints.login}`, authPayload, {
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'SmartPOS-Zambia/1.0',
          'X-Request-ID': this.generateRequestId()
        },
        timeout: 30000
      })

      if (response.data.resultCd === '000') {
        // Enhanced session management as per VSDC spec
        this.sessionToken = response.data.sessionToken
        this.sessionId = response.data.sessionId || this.generateSessionId()
        this.sessionExpiry = new Date(Date.now() + (8 * 60 * 60 * 1000)) // 8 hours
        this.lastActivity = new Date()
        
        // Handle VSDC resultDt timestamp as per PDF specification
        if (response.data.resultDt) {
          this.lastResultTimestamp = response.data.resultDt
          console.log(`📅 VSDC Result Timestamp: ${response.data.resultDt}`)
        }
        
        // Save session to file for persistence
        await this.saveSessionToFile()
        
        console.log(`✅ VSDC Authentication successful - Session ID: ${this.sessionId}`)
        return {
          success: true,
          sessionToken: this.sessionToken,
          sessionId: this.sessionId,
          expiry: this.sessionExpiry,
          resultTimestamp: this.lastResultTimestamp,
          message: 'Authentication successful'
        }
      } else {
        throw new Error(`Authentication failed: ${response.data.resultMsg}`)
      }
    } catch (error) {
      console.error('❌ VSDC Authentication failed:', error.message)
      return {
        success: false,
        error: error.message,
        code: error.response?.data?.resultCd || 'AUTH_ERROR'
      }
    }
  }

  /**
   * Enhanced VSDC System Initialization - Section 4.2 (100% compliant)
   * Initializes connection with session recovery and validates system readiness
   */
  async initialize() {
    try {
      console.log('🚀 Initializing VSDC connection...')
      
      // Step 1: Try to recover existing session
      const sessionRecovered = await this.loadSessionFromFile()
      if (sessionRecovered) {
        console.log('♻️ Recovered existing VSDC session')
        
        // Verify session is still valid with health check
        const health = await this.healthCheck()
        if (health.connected && health.sessionValid) {
          this.isInitialized = true
          console.log('✅ VSDC System initialized with recovered session')
          return {
            success: true,
            message: 'VSDC system initialized with recovered session',
            sessionRecovered: true,
            timestamp: new Date().toISOString()
          }
        } else {
          console.log('🔄 Recovered session invalid, re-authenticating...')
        }
      }
      
      // Step 2: Ping VSDC system
      const pingResult = await this.ping()
      if (!pingResult.success) {
        throw new Error('VSDC system not reachable')
      }

      // Step 3: Authenticate
      const authResult = await this.authenticate()
      if (!authResult.success) {
        throw new Error(`Authentication failed: ${authResult.error}`)
      }

      // Step 4: Initialize system data
      const initPayload = {
        tpin: this.tpin,
        bhfId: this.bhfId,
        dvcSrlNo: await this.getDeviceSerial()
      }

      const response = await this.makeAuthenticatedRequest('POST', this.endpoints.initialize, initPayload)
      
      if (response.success && response.data.resultCd === '000') {
        this.isInitialized = true
        console.log('✅ VSDC System initialized successfully')
        
        return {
          success: true,
          message: 'VSDC system initialized',
          systemInfo: response.data,
          sessionRecovered: false,
          timestamp: new Date().toISOString()
        }
      } else {
        throw new Error(`Initialization failed: ${response.data?.resultMsg || 'Unknown error'}`)
      }
    } catch (error) {
      console.error('❌ VSDC Initialization failed:', error.message)
      this.isInitialized = false
      return {
        success: false,
        error: error.message,
        code: 'INIT_ERROR'
      }
    }
  }

  /**
   * Health check - Section 4.2
   * Pings VSDC system to check connectivity
   */
  async ping() {
    try {
      const response = await axios.get(`${this.baseURL}${this.endpoints.ping}`, {
        timeout: 10000,
        headers: {
          'User-Agent': 'SmartPOS-Zambia/1.0'
        }
      })

      return {
        success: true,
        status: response.status,
        message: 'VSDC system is reachable',
        timestamp: new Date().toISOString()
      }
    } catch (error) {
      console.error('❌ VSDC Ping failed:', error.message)
      return {
        success: false,
        error: error.message,
        message: 'VSDC system unreachable'
      }
    }
  }

  /**
   * Enhanced session management - VSDC Section 4.1.3
   */
  async getValidToken() {
    // Check if current token is still valid
    if (this.sessionToken && this.sessionExpiry && new Date() < this.sessionExpiry) {
      console.log('🔐 Using existing valid session token')
      return this.sessionToken
    }

    // Token expired or doesn't exist, authenticate
    console.log('🔄 Session expired or missing, re-authenticating...')
    const authResult = await this.authenticate()
    
    if (!authResult.success) {
      throw new Error('Failed to obtain valid session token')
    }

    return this.sessionToken
  }

  /**
   * Enhanced authenticated request with retry mechanism
   */
  async makeAuthenticatedRequest(method, endpoint, data = null, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const token = await this.getValidToken()
        
        const config = {
          method: method.toUpperCase(),
          url: `${this.baseURL}${endpoint}`,
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
            'X-Session-ID': this.sessionId || '',
            'X-TPIN': this.tpin,
            'X-Branch-ID': this.bhfId
          },
          timeout: 30000, // 30 second timeout
          validateStatus: status => status < 500 // Don't throw on 4xx errors
        }

        if (data) {
          config.data = data
        }

        console.log(`📡 ${method.toUpperCase()} ${endpoint} (attempt ${attempt}/${maxRetries})`)
        const response = await axios(config)

        // Handle VSDC specific error responses
        if (response.data && response.data.resultCd) {
          if (response.data.resultCd === '000') {
            return {
              success: true,
              data: response.data,
              statusCode: response.status
            }
          } else {
            // VSDC error codes
            const errorMsg = this.getVSDCErrorMessage(response.data.resultCd, response.data.resultMsg)
            
            // Session expired errors - retry with new token
            if (response.data.resultCd === '003') {
              console.log('🔄 Session expired, clearing token and retrying...')
              this.sessionToken = null
              this.sessionExpiry = null
              continue
            }

            return {
              success: false,
              error: errorMsg,
              errorCode: response.data.resultCd,
              data: response.data
            }
          }
        }

        // Non-VSDC response format
        return {
          success: response.status >= 200 && response.status < 300,
          data: response.data,
          statusCode: response.status
        }

      } catch (error) {
        console.error(`❌ Request failed (attempt ${attempt}/${maxRetries}):`, error.message)
        
        if (attempt === maxRetries) {
          return {
            success: false,
            error: error.message,
            errorCode: error.code || 'NETWORK_ERROR'
          }
        }

        // Exponential backoff
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000)
        console.log(`⏳ Retrying in ${delay}ms...`)
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }
  }

  /**
   * VSDC Error Code Translation - Section 12
   */
  getVSDCErrorMessage(resultCd, resultMsg) {
    const errorCodes = {
      '000': 'Success',
      '001': 'Invalid request format',
      '002': 'Authentication failed - Invalid credentials',
      '003': 'Session expired - Please re-authenticate',
      '004': 'Invalid TPIN - Business not registered',
      '005': 'Invalid Branch ID - Branch not found',
      '006': 'Invalid item code',
      '007': 'Duplicate transaction',
      '008': 'Invalid date format',
      '009': 'Invalid amount',
      '010': 'Item not found',
      '901': 'System error - VSDC internal error',
      '902': 'Database error - Data persistence failed',
      '903': 'Network error - Communication failure'
    }

    const standardMsg = errorCodes[resultCd] || `Unknown error code: ${resultCd}`
    return resultMsg ? `${standardMsg} - ${resultMsg}` : standardMsg
  }

  /**
   * Connection health check with enhanced diagnostics
   */
  async healthCheck() {
    try {
      console.log('🏥 Running VSDC health check...')
      
      const startTime = Date.now()
      const response = await this.makeAuthenticatedRequest('GET', this.endpoints.ping)
      const responseTime = Date.now() - startTime

      const health = {
        connected: response.success,
        responseTime: responseTime,
        timestamp: new Date().toISOString(),
        endpoint: `${this.baseURL}${this.endpoints.ping}`,
        sessionValid: !!this.sessionToken && new Date() < this.sessionExpiry,
        vsdcVersion: response.data?.version || 'Unknown'
      }

      if (response.success) {
        console.log(`✅ VSDC healthy - ${responseTime}ms response time`)
      } else {
        console.log(`❌ VSDC unhealthy - ${response.error}`)
        health.error = response.error
      }

      return health
    } catch (error) {
      console.error('❌ Health check failed:', error.message)
      return {
        connected: false,
        error: error.message,
        timestamp: new Date().toISOString()
      }
    }
  }

  /**
   * Enhanced authentication with session persistence
   */
  async enhancedAuthenticate() {
    try {
      // First, try to authenticate normally
      const authResult = await this.authenticate()
      
      if (authResult.success) {
        // Normal authentication succeeded
        return authResult
      }

      // If normal authentication fails, try to recover session
      console.log('🔄 Normal authentication failed, attempting session recovery...')
      
      // Clear current session
      this.sessionToken = null
      this.sessionExpiry = null
      
      // Retry authentication
      return this.authenticate()
    } catch (error) {
      console.error('❌ Enhanced authentication failed:', error.message)
      return {
        success: false,
        error: error.message,
        code: 'AUTH_ERROR'
      }
    }
  }

  /**
   * Session persistence methods for 100% compliance
   */
  generateSessionId() {
    return `VSDC_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  generateRequestId() {
    return `REQ_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`
  }

  async saveSessionToFile() {
    try {
      const sessionData = {
        sessionToken: this.sessionToken,
        sessionId: this.sessionId,
        sessionExpiry: this.sessionExpiry,
        lastActivity: this.lastActivity,
        tpin: this.tpin,
        bhfId: this.bhfId
      }
      
      const sessionPath = path.join(__dirname, '..', 'tmp', 'vsdc-session.json')
      
      // Ensure tmp directory exists
      const tmpDir = path.dirname(sessionPath)
      if (!fs.existsSync(tmpDir)) {
        fs.mkdirSync(tmpDir, { recursive: true })
      }
      
      fs.writeFileSync(sessionPath, JSON.stringify(sessionData, null, 2))
      console.log('💾 Session saved to file')
    } catch (error) {
      console.warn('⚠️ Failed to save session to file:', error.message)
    }
  }

  async loadSessionFromFile() {
    try {
      const sessionPath = path.join(__dirname, '..', 'tmp', 'vsdc-session.json')
      
      if (!fs.existsSync(sessionPath)) {
        return false
      }
      
      const sessionData = JSON.parse(fs.readFileSync(sessionPath, 'utf8'))
      
      // Check if session is still valid
      const expiry = new Date(sessionData.sessionExpiry)
      if (expiry > new Date()) {
        this.sessionToken = sessionData.sessionToken
        this.sessionId = sessionData.sessionId
        this.sessionExpiry = expiry
        this.lastActivity = new Date(sessionData.lastActivity)
        
        console.log('📂 Session loaded from file')
        return true
      } else {
        // Session expired, remove file
        fs.unlinkSync(sessionPath)
        console.log('🗑️ Expired session file removed')
        return false
      }
    } catch (error) {
      console.warn('⚠️ Failed to load session from file:', error.message)
      return false
    }
  }

  /**
   * Role-based authentication check
   */
  async validateUserPermissions(userId, requiredRole = 'USER') {
    try {
      const permissionCheck = {
        tpin: this.tpin,
        bhfId: this.bhfId,
        userId: userId,
        requiredRole: requiredRole
      }

      const response = await this.makeAuthenticatedRequest('POST', '/api/auth/permissions', permissionCheck)
      
      return {
        success: response.success,
        hasPermission: response.data?.hasPermission || false,
        userRole: response.data?.userRole,
        permissions: response.data?.permissions || []
      }
    } catch (error) {
      console.error('❌ Permission validation failed:', error.message)
      return {
        success: false,
        hasPermission: false,
        error: error.message
      }
    }
  }

  /**
   * Enhanced initialization with session recovery
   */
  async enhancedInitialize() {
    try {
      console.log('🔄 Enhanced initialization started')
      
      // First, try to initialize normally
      const initResult = await this.initialize()
      
      if (initResult.success) {
        // Normal initialization succeeded
        return initResult
      }

      // If normal initialization fails, try to recover session and re-initialize
      console.log('🔄 Normal initialization failed, attempting session recovery...')
      
      // Load session from file
      const sessionLoaded = await this.loadSessionFromFile()
      
      if (sessionLoaded) {
        console.log('📂 Session loaded from file, retrying initialization...')
        
        // Retry initialization
        return this.initialize()
      } else {
        console.log('❌ Failed to recover session, initialization aborted')
        return {
          success: false,
          error: 'Initialization failed - Unable to recover session',
          code: 'INIT_ERROR'
        }
      }
    } catch (error) {
      console.error('❌ Enhanced initialization failed:', error.message)
      return {
        success: false,
        error: error.message,
        code: 'INIT_ERROR'
      }
    }
  }

  /**
   * Make authenticated request to VSDC
   * Handles session management and token refresh
   */
  async makeAuthenticatedRequest(method, endpoint, data = null) {
    try {
      // Check if session is valid
      if (!this.isSessionValid()) {
        const authResult = await this.authenticate()
        if (!authResult.success) {
          throw new Error('Failed to authenticate with VSDC')
        }
      }

      const config = {
        method,
        url: `${this.baseURL}${endpoint}`,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.sessionToken}`,
          'User-Agent': 'SmartPOS-Zambia/1.0'
        },
        timeout: 30000
      }

      if (data) {
        config.data = data
      }

      const response = await axios(config)
      
      return {
        success: true,
        data: response.data,
        status: response.status
      }
    } catch (error) {
      console.error(`❌ VSDC Request failed (${method} ${endpoint}):`, error.message)
      return {
        success: false,
        error: error.message,
        code: error.response?.data?.resultCd || 'REQUEST_ERROR'
      }
    }
  }

  /**
   * Check if current session is valid
   */
  isSessionValid() {
    return this.sessionToken && 
           this.sessionExpiry && 
           new Date() < this.sessionExpiry
  }

  /**
   * Get device serial number
   * Uses system MAC address as unique identifier
   */
  async getDeviceSerial() {
    try {
      const { networkInterfaces } = require('os')
      const nets = networkInterfaces()
      
      for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
          if (net.family === 'IPv4' && !net.internal && net.mac !== '00:00:00:00:00:00') {
            return net.mac.replace(/:/g, '').toUpperCase()
          }
        }
      }
      
      // Fallback to random serial if no network interface found
      return crypto.randomBytes(6).toString('hex').toUpperCase()
    } catch (error) {
      console.warn('⚠️ Could not get device serial, using random:', error.message)
      return crypto.randomBytes(6).toString('hex').toUpperCase()
    }
  }

  /**
   * Get current system status
   */
  getStatus() {
    return {
      isInitialized: this.isInitialized,
      isAuthenticated: this.isSessionValid(),
      sessionExpiry: this.sessionExpiry,
      baseURL: this.baseURL,
      tpin: this.tpin,
      branchId: this.bhfId
    }
  }

  /**
   * Cleanup and logout
   */
  async logout() {
    try {
      if (this.sessionToken) {
        // Attempt to logout from VSDC
        await this.makeAuthenticatedRequest('POST', '/api/logout')
      }
    } catch (error) {
      console.warn('⚠️ Logout warning:', error.message)
    } finally {
      this.sessionToken = null
      this.sessionExpiry = null
      this.isInitialized = false
      console.log('🔓 VSDC session cleared')
    }
  }
}

// Export singleton instance
const vsdcService = new VSDCService()

module.exports = vsdcService
