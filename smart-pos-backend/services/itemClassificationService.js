const vsdcService = require('./vsdcService')
const zraCodesService = require('./zraCodesService')
const auditService = require('./auditService')
const { PrismaClient } = require('@prisma/client')

/**
 * Item Classification Service - Implementation based on VSDC API Specification v1.0.8
 * Reference: Section 6.1 (Item Management)
 * 
 * Handles item registration and synchronization with ZRA for proper tax classification
 */

class ItemClassificationService {
  constructor() {
    this.prisma = new PrismaClient()
    this.lastSyncDate = null
    
    // ZRA Item types as per VSDC specification
    this.itemTypes = {
      FINISHED_PRODUCT: '1',    // Finished goods for sale
      RAW_MATERIAL: '2',        // Raw materials for production  
      PACKAGING: '3',           // Packaging materials
      SERVICE: '4',             // Services rendered
      DIGITAL_GOODS: '5'        // Digital products
    }

    // Tax categories
    this.taxCategories = {
      STANDARD_VAT: 'A',        // 16% VAT
      ZERO_RATED: 'B',          // 0% VAT
      EXEMPT: 'C',              // VAT Exempt
      NO_VAT: 'D'               // Not subject to VAT
    }
  }

  /**
   * Register item with ZRA VSDC
   * Reference: Section 6.1.1
   */
  async registerItemWithZRA(itemData) {
    try {
      console.log(`📦 Registering item with ZRA: ${itemData.name}`)
      
      // Get ZRA codes first
      const taxTypes = await zraCodesService.getTaxTypes()
      const classifications = await zraCodesService.getItemClassifications()
      const units = await zraCodesService.getUnitsOfMeasure()

      if (!taxTypes.success || !classifications.success || !units.success) {
        throw new Error('Failed to fetch ZRA codes. Cannot register item.')
      }

      // Prepare item data for ZRA
      const zraItemData = {
        tpin: vsdcService.tpin,
        bhfId: vsdcService.bhfId,
        itemCd: this.generateItemCode(itemData),
        itemClsCd: this.getItemClassification(itemData, classifications.classifications),
        itemTyCd: itemData.itemType || this.itemTypes.FINISHED_PRODUCT,
        itemNm: itemData.name,
        itemStdNm: itemData.standardName || itemData.name,
        orgnNatCd: itemData.countryOfOrigin || 'ZM',
        pkgUnitCd: this.getPackagingUnit(itemData, units.units),
        qtyUnitCd: this.getQuantityUnit(itemData, units.units),
        taxTyCd: this.getTaxType(itemData, taxTypes.taxTypes),
        btchNo: itemData.batchNumber || null,
        bcd: itemData.barcode || null,
        dftPrc: parseFloat(itemData.defaultPrice || 0),
        grpPrcL1: parseFloat(itemData.groupPrice1 || 0),
        grpPrcL2: parseFloat(itemData.groupPrice2 || 0),
        grpPrcL3: parseFloat(itemData.groupPrice3 || 0),
        grpPrcL4: parseFloat(itemData.groupPrice4 || 0),
        grpPrcL5: parseFloat(itemData.groupPrice5 || 0),
        addInfo: itemData.additionalInfo || '',
        sftyQty: parseInt(itemData.safetyQuantity || 0),
        isrcAplcbYn: itemData.isInsuranceApplicable ? 'Y' : 'N',
        useYn: 'Y',
        regrNm: itemData.registeredBy || 'SYSTEM',
        regrId: itemData.registeredById || 'SYSTEM',
        modrNm: itemData.modifiedBy || 'SYSTEM',
        modrId: itemData.modifiedById || 'SYSTEM'
      }

      // Submit to VSDC
      const response = await vsdcService.makeAuthenticatedRequest(
        'POST',
        vsdcService.endpoints.itemSave,
        zraItemData
      )

      if (response.success && response.data.resultCd === '000') {
        console.log(`✅ Item registered with ZRA: ${itemData.name}`)
        
        // Log audit event
        await auditService.logEvent(auditService.eventTypes.PRODUCT_CREATE, {
          entityType: 'ITEM',
          entityId: zraItemData.itemCd,
          action: 'ZRA_REGISTER',
          newValues: zraItemData,
          description: `Item registered with ZRA: ${itemData.name}`,
          metadata: {
            zraItemCode: zraItemData.itemCd,
            taxType: zraItemData.taxTyCd,
            classification: zraItemData.itemClsCd
          }
        })

        return {
          success: true,
          zraItemCode: zraItemData.itemCd,
          message: 'Item successfully registered with ZRA',
          zraResponse: response.data
        }
      } else {
        throw new Error(`ZRA registration failed: ${response.data?.resultMsg || 'Unknown error'}`)
      }
    } catch (error) {
      console.error('❌ ZRA item registration failed:', error.message)
      
      // Log failure
      await auditService.logEvent(auditService.eventTypes.PRODUCT_CREATE, {
        entityType: 'ITEM',
        entityId: itemData.code || itemData.name,
        action: 'ZRA_REGISTER',
        success: false,
        errorMessage: error.message,
        description: `Failed to register item with ZRA: ${itemData.name}`
      })

      return {
        success: false,
        error: error.message,
        code: 'ZRA_REGISTRATION_FAILED'
      }
    }
  }

  /**
   * Synchronize items with ZRA
   * Reference: Section 6.1.2
   */
  async synchronizeItems(options = {}) {
    try {
      console.log('🔄 Synchronizing items with ZRA...')
      
      const lastReqDt = options.lastRequestDate || this.getLastSyncDate()
      
      const syncPayload = {
        tpin: vsdcService.tpin,
        bhfId: vsdcService.bhfId,
        lastReqDt: lastReqDt
      }

      const response = await vsdcService.makeAuthenticatedRequest(
        'POST',
        vsdcService.endpoints.itemsSync,
        syncPayload
      )

      if (response.success && response.data.resultCd === '000') {
        const zraItems = response.data.itemList || []
        console.log(`📥 Received ${zraItems.length} items from ZRA`)

        // Process and update local database
        const syncResults = await this.processZRAItems(zraItems)
        
        this.lastSyncDate = new Date()
        
        // Log sync event
        await auditService.logEvent(auditService.eventTypes.STOCK_SYNC, {
          action: 'ITEMS_SYNC',
          description: `Synchronized ${zraItems.length} items with ZRA`,
          metadata: {
            itemsReceived: zraItems.length,
            itemsProcessed: syncResults.processed,
            itemsUpdated: syncResults.updated,
            itemsCreated: syncResults.created,
            errors: syncResults.errors
          }
        })

        return {
          success: true,
          itemsReceived: zraItems.length,
          syncResults,
          lastSyncDate: this.lastSyncDate,
          message: 'Items synchronized successfully with ZRA'
        }
      } else {
        throw new Error(`Items sync failed: ${response.data?.resultMsg || 'Unknown error'}`)
      }
    } catch (error) {
      console.error('❌ Items synchronization failed:', error.message)
      
      await auditService.logEvent(auditService.eventTypes.STOCK_SYNC, {
        action: 'ITEMS_SYNC',
        success: false,
        errorMessage: error.message,
        description: 'Failed to synchronize items with ZRA'
      })

      return {
        success: false,
        error: error.message,
        code: 'ITEMS_SYNC_FAILED'
      }
    }
  }

  /**
   * Process ZRA items and update local database
   */
  async processZRAItems(zraItems) {
    const results = {
      processed: 0,
      updated: 0,
      created: 0,
      errors: []
    }

    for (const zraItem of zraItems) {
      try {
        results.processed++

        // Check if item exists locally
        const existingProduct = await this.prisma.product.findUnique({
          where: { 
            OR: [
              { zraItemCode: zraItem.itemCd },
              { barcode: zraItem.bcd }
            ]
          }
        })

        if (existingProduct) {
          // Update existing product
          await this.prisma.product.update({
            where: { id: existingProduct.id },
            data: {
              name: zraItem.itemNm,
              zraItemCode: zraItem.itemCd,
              itemClassification: zraItem.itemClsCd,
              taxType: zraItem.taxTyCd,
              barcode: zraItem.bcd,
              defaultPrice: parseFloat(zraItem.dftPrc || 0),
              safetyQuantity: parseInt(zraItem.sftyQty || 0),
              zraSyncDate: new Date(),
              updatedAt: new Date()
            }
          })
          results.updated++
        } else {
          // Create new product
          await this.prisma.product.create({
            data: {
              name: zraItem.itemNm,
              code: this.generateLocalProductCode(),
              zraItemCode: zraItem.itemCd,
              itemClassification: zraItem.itemClsCd,
              taxType: zraItem.taxTyCd,
              barcode: zraItem.bcd,
              price: parseFloat(zraItem.dftPrc || 0),
              defaultPrice: parseFloat(zraItem.dftPrc || 0),
              safetyQuantity: parseInt(zraItem.sftyQty || 0),
              quantity: 0,
              categoryId: await this.getDefaultCategoryId(),
              zraSyncDate: new Date(),
              isActive: true
            }
          })
          results.created++
        }
      } catch (error) {
        console.error(`❌ Error processing ZRA item ${zraItem.itemCd}:`, error.message)
        results.errors.push({
          itemCode: zraItem.itemCd,
          itemName: zraItem.itemNm,
          error: error.message
        })
      }
    }

    return results
  }

  /**
   * Classify product for ZRA compliance
   */
  async classifyProduct(productData) {
    try {
      // Get ZRA classifications
      const classifications = await zraCodesService.getItemClassifications()
      if (!classifications.success) {
        throw new Error('Failed to fetch ZRA classifications')
      }

      // Auto-classify based on product data
      const classification = this.autoClassifyProduct(productData, classifications.classifications)
      const taxType = this.autoAssignTaxType(productData)

      return {
        success: true,
        classification: classification,
        taxType: taxType,
        vatApplicable: taxType === this.taxCategories.STANDARD_VAT,
        vatRate: taxType === this.taxCategories.STANDARD_VAT ? 16.0 : 0.0
      }
    } catch (error) {
      console.error('❌ Product classification failed:', error.message)
      return {
        success: false,
        error: error.message,
        classification: null,
        taxType: this.taxCategories.STANDARD_VAT // Default fallback
      }
    }
  }

  /**
   * Auto-classify product based on name and category
   */
  autoClassifyProduct(productData, classifications) {
    const productName = productData.name.toLowerCase()
    const category = productData.category?.toLowerCase() || ''

    // Basic classification logic
    if (productName.includes('food') || category.includes('food')) {
      return classifications.find(c => c.name.toLowerCase().includes('food'))?.code || '10000000'
    }
    
    if (productName.includes('medicine') || category.includes('medicine')) {
      return classifications.find(c => c.name.toLowerCase().includes('medicine'))?.code || '20000000'
    }
    
    if (productName.includes('service') || category.includes('service')) {
      return classifications.find(c => c.name.toLowerCase().includes('service'))?.code || '90000000'
    }

    // Default classification for general goods
    return '50000000'
  }

  /**
   * Auto-assign tax type based on product data
   */
  autoAssignTaxType(productData) {
    const productName = productData.name.toLowerCase()
    const category = productData.category?.toLowerCase() || ''

    // VAT-exempt items (basic necessities)
    const exemptKeywords = ['bread', 'milk', 'medicine', 'book', 'education']
    if (exemptKeywords.some(keyword => productName.includes(keyword))) {
      return this.taxCategories.EXEMPT
    }

    // Zero-rated items (exports, etc.)
    if (productData.isExport || category.includes('export')) {
      return this.taxCategories.ZERO_RATED
    }

    // Default to standard VAT
    return this.taxCategories.STANDARD_VAT
  }

  /**
   * Generate ZRA item code
   */
  generateItemCode(itemData) {
    const timestamp = Date.now().toString().slice(-8)
    const prefix = itemData.code ? itemData.code.slice(0, 4).toUpperCase() : 'ITEM'
    return `${prefix}${timestamp}`
  }

  /**
   * Get item classification code
   */
  getItemClassification(itemData, classifications) {
    if (itemData.zraClassification) {
      return itemData.zraClassification
    }
    
    // Auto-classify
    return this.autoClassifyProduct(itemData, classifications)
  }

  /**
   * Get packaging unit code
   */
  getPackagingUnit(itemData, units) {
    if (itemData.packagingUnit) {
      const unit = units.find(u => u.code === itemData.packagingUnit || u.name === itemData.packagingUnit)
      return unit ? unit.code : 'CT'
    }
    return 'CT' // Default to Carton
  }

  /**
   * Get quantity unit code
   */
  getQuantityUnit(itemData, units) {
    if (itemData.unit) {
      const unit = units.find(u => u.code === itemData.unit || u.name === itemData.unit)
      return unit ? unit.code : 'U'
    }
    return 'U' // Default to Unit
  }

  /**
   * Get tax type code
   */
  getTaxType(itemData, taxTypes) {
    if (itemData.taxType) {
      return itemData.taxType
    }
    
    // Auto-assign based on classification
    return this.autoAssignTaxType(itemData)
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
   * Generate local product code
   */
  generateLocalProductCode() {
    const timestamp = Date.now().toString().slice(-6)
    return `PRD${timestamp}`
  }

  /**
   * Get default category ID
   */
  async getDefaultCategoryId() {
    try {
      let defaultCategory = await this.prisma.category.findFirst({
        where: { name: 'General' }
      })

      if (!defaultCategory) {
        defaultCategory = await this.prisma.category.create({
          data: {
            name: 'General',
            description: 'Default category for ZRA synced items'
          }
        })
      }

      return defaultCategory.id
    } catch (error) {
      console.warn('⚠️ Could not get default category:', error.message)
      return null
    }
  }

  /**
   * Validate item data for ZRA compliance
   */
  validateItemForZRA(itemData) {
    const errors = []
    const warnings = []

    // Required fields
    if (!itemData.name) errors.push('Item name is required')
    if (!itemData.defaultPrice || itemData.defaultPrice <= 0) {
      errors.push('Valid default price is required')
    }

    // Warnings for better compliance
    if (!itemData.barcode) warnings.push('Barcode recommended for inventory tracking')
    if (!itemData.countryOfOrigin) warnings.push('Country of origin helps with proper classification')

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    }
  }

  /**
   * Get item registration status
   */
  async getItemStatus(itemIdentifier) {
    try {
      const product = await this.prisma.product.findFirst({
        where: {
          OR: [
            { id: itemIdentifier },
            { code: itemIdentifier },
            { zraItemCode: itemIdentifier },
            { barcode: itemIdentifier }
          ]
        }
      })

      if (!product) {
        return {
          found: false,
          message: 'Item not found'
        }
      }

      return {
        found: true,
        product: product,
        zraRegistered: !!product.zraItemCode,
        lastSyncDate: product.zraSyncDate,
        classification: product.itemClassification,
        taxType: product.taxType
      }
    } catch (error) {
      console.error('❌ Error getting item status:', error.message)
      return {
        found: false,
        error: error.message
      }
    }
  }
}

module.exports = new ItemClassificationService()
