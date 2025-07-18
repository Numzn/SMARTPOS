const vsdcService = require('./vsdcService')
const itemClassificationService = require('./itemClassificationService')
const auditService = require('./auditService')
const { PrismaClient } = require('@prisma/client')

/**
 * Stock Synchronization Service - Implementation based on VSDC API Specification v1.0.8
 * Reference: Section 6.2 (Stock Management)
 * 
 * Handles stock movement tracking and synchronization with ZRA for inventory compliance
 */

class StockSyncService {
  constructor() {
    this.prisma = new PrismaClient()
    this.lastSyncDate = null
    
    // Stock movement types as per VSDC specification
    this.movementTypes = {
      PURCHASE: '01',           // Stock in via purchase
      SALE: '02',              // Stock out via sale
      ADJUSTMENT_IN: '03',     // Stock adjustment increase
      ADJUSTMENT_OUT: '04',    // Stock adjustment decrease
      TRANSFER_IN: '05',       // Transfer from another branch
      TRANSFER_OUT: '06',      // Transfer to another branch
      PRODUCTION_IN: '07',     // Manufactured goods
      PRODUCTION_OUT: '08',    // Materials used in production
      DAMAGE_OUT: '09',        // Damaged goods written off
      EXPIRED_OUT: '10',       // Expired goods written off
      RETURN_IN: '11',         // Customer returns
      RETURN_OUT: '12'         // Returns to supplier
    }

    // Stock status codes
    this.stockStatus = {
      AVAILABLE: '01',         // Available for sale
      RESERVED: '02',          // Reserved for orders
      DAMAGED: '03',           // Damaged stock
      EXPIRED: '04',           // Expired stock
      IN_TRANSIT: '05'         // In transit between locations
    }
  }

  /**
   * Save stock movement to ZRA VSDC
   * Reference: Section 6.2.1
   */
  async saveStockMovement(movementData) {
    try {
      console.log(`📦 Saving stock movement to ZRA: ${movementData.type}`)
      
      // Validate movement data
      const validation = this.validateStockMovement(movementData)
      if (!validation.isValid) {
        throw new Error(`Invalid movement data: ${validation.errors.join(', ')}`)
      }

      // Get item details
      const itemStatus = await itemClassificationService.getItemStatus(movementData.itemId)
      if (!itemStatus.found) {
        throw new Error(`Item not found: ${movementData.itemId}`)
      }

      if (!itemStatus.zraRegistered) {
        throw new Error(`Item not registered with ZRA: ${itemStatus.product.name}`)
      }

      // Prepare stock data for ZRA
      const zraStockData = {
        tpin: vsdcService.tpin,
        bhfId: vsdcService.bhfId,
        sarNo: this.generateSarNumber(),
        orgSarNo: movementData.originalSarNo || 0,
        regTyCd: this.getRegistrationType(movementData.type),
        custTpin: movementData.customerTpin || null,
        custNm: movementData.customerName || null,
        custBhfId: movementData.customerBranchId || null,
        sarTyCd: this.getStockAdjustmentType(movementData.type),
        ocrnDt: this.formatDate(movementData.date || new Date()),
        totItemCnt: 1,
        totTaxblAmt: parseFloat(movementData.taxableAmount || 0),
        totTaxAmt: parseFloat(movementData.taxAmount || 0),
        totAmt: parseFloat(movementData.totalAmount || 0),
        remark: movementData.remark || '',
        regrId: movementData.registeredBy || 'SYSTEM',
        regrNm: movementData.registeredByName || 'SYSTEM',
        modrId: movementData.modifiedBy || 'SYSTEM',
        modrNm: movementData.modifiedByName || 'SYSTEM',
        itemList: [
          {
            itemSeq: 1,
            itemCd: itemStatus.product.zraItemCode,
            itemClsCd: itemStatus.product.itemClassification,
            itemNm: itemStatus.product.name,
            bcd: itemStatus.product.barcode || null,
            pkgUnitCd: movementData.packageUnit || 'U',
            pkg: parseInt(movementData.packageQuantity || 1),
            qtyUnitCd: movementData.quantityUnit || 'U',
            qty: parseFloat(movementData.quantity),
            prc: parseFloat(movementData.unitPrice || 0),
            splyAmt: parseFloat(movementData.supplyAmount || 0),
            dcRt: parseFloat(movementData.discountRate || 0),
            dcAmt: parseFloat(movementData.discountAmount || 0),
            taxblAmt: parseFloat(movementData.taxableAmount || 0),
            taxTyCd: itemStatus.product.taxType || 'A',
            taxAmt: parseFloat(movementData.taxAmount || 0),
            totAmt: parseFloat(movementData.totalAmount || 0),
            itemExprDt: movementData.expiryDate ? this.formatDate(movementData.expiryDate) : null
          }
        ]
      }

      // Submit to VSDC
      const response = await vsdcService.makeAuthenticatedRequest(
        'POST',
        vsdcService.endpoints.stockSave,
        zraStockData
      )

      if (response.success && response.data.resultCd === '000') {
        console.log(`✅ Stock movement saved to ZRA: ${movementData.type}`)
        
        // Update local stock
        await this.updateLocalStock(movementData, itemStatus.product, zraStockData.sarNo)
        
        // Log audit event
        await auditService.logEvent(auditService.eventTypes.STOCK_ADJUSTMENT, {
          entityType: 'STOCK_MOVEMENT',
          entityId: zraStockData.sarNo,
          action: 'ZRA_SAVE',
          newValues: zraStockData,
          description: `Stock movement saved to ZRA: ${movementData.type}`,
          metadata: {
            itemCode: itemStatus.product.zraItemCode,
            quantity: movementData.quantity,
            movementType: movementData.type,
            sarNumber: zraStockData.sarNo
          }
        })

        return {
          success: true,
          sarNumber: zraStockData.sarNo,
          message: 'Stock movement successfully saved to ZRA',
          zraResponse: response.data
        }
      } else {
        throw new Error(`ZRA stock save failed: ${response.data?.resultMsg || 'Unknown error'}`)
      }
    } catch (error) {
      console.error('❌ ZRA stock movement save failed:', error.message)
      
      // Log failure
      await auditService.logEvent(auditService.eventTypes.STOCK_ADJUSTMENT, {
        entityType: 'STOCK_MOVEMENT',
        action: 'ZRA_SAVE',
        success: false,
        errorMessage: error.message,
        description: `Failed to save stock movement to ZRA: ${movementData.type}`
      })

      return {
        success: false,
        error: error.message,
        code: 'ZRA_STOCK_SAVE_FAILED'
      }
    }
  }

  /**
   * Synchronize stock with ZRA
   * Reference: Section 6.2.2
   */
  async synchronizeStock(options = {}) {
    try {
      console.log('🔄 Synchronizing stock with ZRA...')
      
      const lastReqDt = options.lastRequestDate || this.getLastSyncDate()
      
      const syncPayload = {
        tpin: vsdcService.tpin,
        bhfId: vsdcService.bhfId,
        lastReqDt: lastReqDt
      }

      const response = await vsdcService.makeAuthenticatedRequest(
        'POST',
        vsdcService.endpoints.stockSync,
        syncPayload
      )

      if (response.success && response.data.resultCd === '000') {
        const stockMovements = response.data.stockList || []
        console.log(`📥 Received ${stockMovements.length} stock movements from ZRA`)

        // Process and update local database
        const syncResults = await this.processZRAStockMovements(stockMovements)
        
        this.lastSyncDate = new Date()
        
        // Log sync event
        await auditService.logEvent(auditService.eventTypes.STOCK_SYNC, {
          action: 'STOCK_SYNC',
          description: `Synchronized ${stockMovements.length} stock movements with ZRA`,
          metadata: {
            movementsReceived: stockMovements.length,
            movementsProcessed: syncResults.processed,
            movementsUpdated: syncResults.updated,
            movementsCreated: syncResults.created,
            errors: syncResults.errors
          }
        })

        return {
          success: true,
          movementsReceived: stockMovements.length,
          syncResults,
          lastSyncDate: this.lastSyncDate,
          message: 'Stock synchronized successfully with ZRA'
        }
      } else {
        throw new Error(`Stock sync failed: ${response.data?.resultMsg || 'Unknown error'}`)
      }
    } catch (error) {
      console.error('❌ Stock synchronization failed:', error.message)
      
      await auditService.logEvent(auditService.eventTypes.STOCK_SYNC, {
        action: 'STOCK_SYNC',
        success: false,
        errorMessage: error.message,
        description: 'Failed to synchronize stock with ZRA'
      })

      return {
        success: false,
        error: error.message,
        code: 'STOCK_SYNC_FAILED'
      }
    }
  }

  /**
   * Process ZRA stock movements and update local database
   */
  async processZRAStockMovements(stockMovements) {
    const results = {
      processed: 0,
      updated: 0,
      created: 0,
      errors: []
    }

    for (const movement of stockMovements) {
      try {
        results.processed++

        // Check if movement already exists
        const existingMovement = await this.prisma.stockMovement.findUnique({
          where: { zraSarNumber: movement.sarNo }
        })

        if (existingMovement) {
          // Update existing movement
          await this.prisma.stockMovement.update({
            where: { id: existingMovement.id },
            data: {
              quantity: parseFloat(movement.qty || 0),
              unitPrice: parseFloat(movement.prc || 0),
              totalAmount: parseFloat(movement.totAmt || 0),
              zraSyncDate: new Date(),
              updatedAt: new Date()
            }
          })
          results.updated++
        } else {
          // Create new movement record
          const product = await this.findProductByZRACode(movement.itemCd)
          if (product) {
            await this.prisma.stockMovement.create({
              data: {
                productId: product.id,
                type: this.mapZRAMovementType(movement.sarTyCd),
                quantity: parseFloat(movement.qty || 0),
                unitPrice: parseFloat(movement.prc || 0),
                totalAmount: parseFloat(movement.totAmt || 0),
                date: this.parseDate(movement.ocrnDt),
                zraSarNumber: movement.sarNo,
                zraSyncDate: new Date(),
                createdBy: movement.regrId || 'SYSTEM'
              }
            })
            results.created++
          }
        }
      } catch (error) {
        console.error(`❌ Error processing stock movement ${movement.sarNo}:`, error.message)
        results.errors.push({
          sarNumber: movement.sarNo,
          itemCode: movement.itemCd,
          error: error.message
        })
      }
    }

    return results
  }

  /**
   * Update local stock after ZRA submission
   */
  async updateLocalStock(movementData, product, sarNumber) {
    try {
      const quantityChange = this.calculateQuantityChange(movementData.type, movementData.quantity)
      
      // Update product quantity
      await this.prisma.product.update({
        where: { id: product.id },
        data: {
          quantity: {
            increment: quantityChange
          },
          lastStockUpdate: new Date()
        }
      })

      // Create stock movement record
      await this.prisma.stockMovement.create({
        data: {
          productId: product.id,
          type: movementData.type,
          quantity: parseFloat(movementData.quantity),
          unitPrice: parseFloat(movementData.unitPrice || 0),
          totalAmount: parseFloat(movementData.totalAmount || 0),
          date: movementData.date || new Date(),
          zraSarNumber: sarNumber,
          reason: movementData.remark || '',
          createdBy: movementData.registeredBy || 'SYSTEM'
        }
      })

      console.log(`📊 Updated local stock for ${product.name}: ${quantityChange > 0 ? '+' : ''}${quantityChange}`)
    } catch (error) {
      console.error('❌ Failed to update local stock:', error.message)
      throw error
    }
  }

  /**
   * Calculate quantity change based on movement type
   */
  calculateQuantityChange(movementType, quantity) {
    const increaseTypes = [
      this.movementTypes.PURCHASE,
      this.movementTypes.ADJUSTMENT_IN,
      this.movementTypes.TRANSFER_IN,
      this.movementTypes.PRODUCTION_IN,
      this.movementTypes.RETURN_IN
    ]

    const decreaseTypes = [
      this.movementTypes.SALE,
      this.movementTypes.ADJUSTMENT_OUT,
      this.movementTypes.TRANSFER_OUT,
      this.movementTypes.PRODUCTION_OUT,
      this.movementTypes.DAMAGE_OUT,
      this.movementTypes.EXPIRED_OUT,
      this.movementTypes.RETURN_OUT
    ]

    if (increaseTypes.includes(movementType)) {
      return parseFloat(quantity)
    } else if (decreaseTypes.includes(movementType)) {
      return -parseFloat(quantity)
    } else {
      return 0 // Unknown movement type
    }
  }

  /**
   * Validate stock movement data
   */
  validateStockMovement(movementData) {
    const errors = []
    const warnings = []

    // Required fields
    if (!movementData.itemId) errors.push('Item ID is required')
    if (!movementData.type) errors.push('Movement type is required')
    if (!movementData.quantity || movementData.quantity <= 0) {
      errors.push('Valid quantity is required')
    }

    // Validate movement type
    if (movementData.type && !Object.values(this.movementTypes).includes(movementData.type)) {
      errors.push('Invalid movement type')
    }

    // Warnings
    if (!movementData.unitPrice) warnings.push('Unit price recommended for accurate costing')
    if (!movementData.remark) warnings.push('Remark helps with audit trail')

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    }
  }

  /**
   * Get registration type based on movement type
   */
  getRegistrationType(movementType) {
    const purchaseTypes = [this.movementTypes.PURCHASE, this.movementTypes.RETURN_IN]
    const saleTypes = [this.movementTypes.SALE, this.movementTypes.RETURN_OUT]
    
    if (purchaseTypes.includes(movementType)) return 'M' // Manual registration
    if (saleTypes.includes(movementType)) return 'S' // System registration
    return 'M' // Default to manual
  }

  /**
   * Get stock adjustment type
   */
  getStockAdjustmentType(movementType) {
    // Map internal movement types to ZRA stock adjustment types
    const typeMapping = {
      [this.movementTypes.PURCHASE]: '11',
      [this.movementTypes.SALE]: '12',
      [this.movementTypes.ADJUSTMENT_IN]: '02',
      [this.movementTypes.ADJUSTMENT_OUT]: '02',
      [this.movementTypes.TRANSFER_IN]: '11',
      [this.movementTypes.TRANSFER_OUT]: '12',
      [this.movementTypes.PRODUCTION_IN]: '11',
      [this.movementTypes.PRODUCTION_OUT]: '12',
      [this.movementTypes.DAMAGE_OUT]: '02',
      [this.movementTypes.EXPIRED_OUT]: '02',
      [this.movementTypes.RETURN_IN]: '11',
      [this.movementTypes.RETURN_OUT]: '12'
    }

    return typeMapping[movementType] || '02' // Default to adjustment
  }

  /**
   * Generate SAR (Stock Adjustment Record) number
   */
  generateSarNumber() {
    const timestamp = Date.now()
    const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0')
    return parseInt(`${timestamp.toString().slice(-10)}${random}`)
  }

  /**
   * Format date for ZRA
   */
  formatDate(date) {
    const d = new Date(date)
    return d.toISOString().split('T')[0].replace(/-/g, '')
  }

  /**
   * Parse ZRA date format
   */
  parseDate(zraDate) {
    if (!zraDate) return new Date()
    const year = zraDate.substring(0, 4)
    const month = zraDate.substring(4, 6)
    const day = zraDate.substring(6, 8)
    return new Date(`${year}-${month}-${day}`)
  }

  /**
   * Find product by ZRA item code
   */
  async findProductByZRACode(zraItemCode) {
    try {
      return await this.prisma.product.findFirst({
        where: { zraItemCode: zraItemCode }
      })
    } catch (error) {
      console.warn(`⚠️ Could not find product with ZRA code ${zraItemCode}:`, error.message)
      return null
    }
  }

  /**
   * Map ZRA movement type to internal type
   */
  mapZRAMovementType(zraSarTyCd) {
    const mapping = {
      '11': this.movementTypes.PURCHASE,
      '12': this.movementTypes.SALE,
      '02': this.movementTypes.ADJUSTMENT_IN
    }
    
    return mapping[zraSarTyCd] || this.movementTypes.ADJUSTMENT_IN
  }

  /**
   * Get last sync date
   */
  getLastSyncDate() {
    if (this.lastSyncDate) {
      return this.lastSyncDate.toISOString().split('T')[0].replace(/-/g, '')
    }
    // Default to 7 days ago
    const weekAgo = new Date()
    weekAgo.setDate(weekAgo.getDate() - 7)
    return weekAgo.toISOString().split('T')[0].replace(/-/g, '')
  }

  /**
   * Get current stock levels
   */
  async getCurrentStock(options = {}) {
    try {
      const whereClause = {}
      
      if (options.productId) {
        whereClause.id = options.productId
      }
      
      if (options.lowStock) {
        whereClause.quantity = { lte: 10 } // Configurable threshold
      }

      const products = await this.prisma.product.findMany({
        where: whereClause,
        select: {
          id: true,
          name: true,
          code: true,
          zraItemCode: true,
          quantity: true,
          safetyQuantity: true,
          lastStockUpdate: true,
          price: true
        },
        orderBy: { name: 'asc' }
      })

      return {
        success: true,
        products: products.map(product => ({
          ...product,
          stockStatus: this.getStockStatus(product.quantity, product.safetyQuantity),
          isLowStock: product.quantity <= (product.safetyQuantity || 10),
          stockValue: product.quantity * product.price
        })),
        totalItems: products.length,
        lowStockItems: products.filter(p => p.quantity <= (p.safetyQuantity || 10)).length
      }
    } catch (error) {
      console.error('❌ Failed to get current stock:', error.message)
      return {
        success: false,
        error: error.message,
        products: []
      }
    }
  }

  /**
   * Get stock status
   */
  getStockStatus(quantity, safetyQuantity) {
    if (quantity <= 0) return 'OUT_OF_STOCK'
    if (quantity <= (safetyQuantity || 10)) return 'LOW_STOCK'
    return 'IN_STOCK'
  }

  /**
   * Generate stock movement report
   */
  async generateMovementReport(startDate, endDate) {
    try {
      const movements = await this.prisma.stockMovement.findMany({
        where: {
          date: {
            gte: new Date(startDate),
            lte: new Date(endDate)
          }
        },
        include: {
          product: {
            select: {
              name: true,
              code: true,
              zraItemCode: true
            }
          }
        },
        orderBy: { date: 'desc' }
      })

      const summary = {
        totalMovements: movements.length,
        totalValue: movements.reduce((sum, m) => sum + m.totalAmount, 0),
        typeBreakdown: {}
      }

      // Group by movement type
      movements.forEach(movement => {
        if (!summary.typeBreakdown[movement.type]) {
          summary.typeBreakdown[movement.type] = {
            count: 0,
            totalQuantity: 0,
            totalValue: 0
          }
        }
        
        summary.typeBreakdown[movement.type].count++
        summary.typeBreakdown[movement.type].totalQuantity += movement.quantity
        summary.typeBreakdown[movement.type].totalValue += movement.totalAmount
      })

      return {
        success: true,
        movements,
        summary,
        period: { startDate, endDate }
      }
    } catch (error) {
      console.error('❌ Failed to generate movement report:', error.message)
      return {
        success: false,
        error: error.message
      }
    }
  }
}

module.exports = new StockSyncService()
