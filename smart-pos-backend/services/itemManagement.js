const axios = require('axios')
const prisma = require('../lib/prisma')
const vsdcService = require('./vsdcService')

/**
 * Enhanced Item Management Service for 100% ZRA Compliance
 * Implements VSDC API Section 6 (Item Management) with full field compliance
 */
class ItemManagementService {
  constructor() {
    this.maxRetries = 3
    this.retryDelay = 1000
    
    // ZRA Tax Types as per VSDC specification
    this.taxTypes = {
      STANDARD: 'A',     // 16% VAT
      ZERO_RATED: 'B',   // 0% VAT
      EXEMPT: 'C',       // Exempt from VAT
      SPECIAL: 'D'       // Special rate
    }
    
    // ZRA Package Units
    this.packageUnits = {
      EACH: 'EA',
      KILOGRAM: 'KG',
      GRAM: 'G',
      LITER: 'L',
      MILLILITER: 'ML',
      METER: 'M',
      CENTIMETER: 'CM',
      PIECE: 'PC',
      BOX: 'BX',
      PACK: 'PK'
    }
  }

  /**
   * Save/Update item in VSDC system with full compliance
   */
  async saveItemToVSDC(productData) {
    try {
      console.log(`📝 Saving item to VSDC: ${productData.name}`)
      
      // Validate required fields
      const validation = this.validateItemData(productData)
      if (!validation.isValid) {
        throw new Error(`Item validation failed: ${validation.errors.join(', ')}`)
      }
      
      // Build VSDC compliant item payload
      const vsdcPayload = {
        tpin: process.env.BUSINESS_TPIN,
        bhfId: process.env.BRANCH_ID || '000',
        itemCd: productData.sku || productData.id,
        itemClsCd: productData.zraItemClassification || '50102303', // Default classification
        itemTyCd: '2', // 1=Raw Material, 2=Finished Product, 3=Service
        itemNm: productData.name,
        itemStdNm: productData.name, // Standard name (same as name)
        orgnNatCd: 'ZM', // Origin country (Zambia)
        pkgUnitCd: productData.zraPackageUnit || this.packageUnits.EACH,
        qtyUnitCd: productData.zraQuantityUnit || this.packageUnits.EACH,
        taxTyCd: productData.taxType || this.taxTypes.STANDARD,
        btchNo: productData.batchNumber || null,
        bcd: productData.barcode || null,
        dftPrc: parseFloat(productData.price),
        grpPrcL1: parseFloat(productData.price), // Group price level 1
        grpPrcL2: parseFloat(productData.price), // Group price level 2
        grpPrcL3: parseFloat(productData.price), // Group price level 3
        grpPrcL4: parseFloat(productData.price), // Group price level 4
        grpPrcL5: parseFloat(productData.price), // Group price level 5
        addInfo: productData.description || '',
        sftyQty: productData.minStock || 0,
        isrcAplcbYn: 'N', // Insurance applicable (Y/N)
        useYn: productData.isActive ? 'Y' : 'N',
        regrNm: 'SYSTEM', // Registrant name
        regrId: 'SYSTEM', // Registrant ID
        modrNm: 'SYSTEM', // Modifier name
        modrId: 'SYSTEM'  // Modifier ID
      }
      
      // Submit to VSDC with retry mechanism
      const result = await this.submitWithRetry(vsdcPayload)
      
      if (result.success) {
        // Update local product with ZRA response
        await this.updateLocalProduct(productData.id, result.data)
        
        console.log(`✅ Item saved to VSDC successfully: ${productData.name}`)
        return {
          success: true,
          itemCode: vsdcPayload.itemCd,
          zraResponse: result.data,
          message: 'Item saved to VSDC successfully'
        }
      } else {
        throw new Error(result.error)
      }
    } catch (error) {
      console.error('❌ Failed to save item to VSDC:', error.message)
      return {
        success: false,
        error: error.message,
        code: 'ITEM_SAVE_FAILED'
      }
    }
  }

  /**
   * Submit item to VSDC with retry mechanism
   */
  async submitWithRetry(payload, attempt = 1) {
    try {
      // Ensure we have a valid VSDC connection
      if (!vsdcService.isInitialized) {
        await vsdcService.initialize()
      }
      
      const response = await vsdcService.makeAuthenticatedRequest(
        'POST',
        vsdcService.endpoints.itemSave,
        payload
      )
      
      if (response.success && response.data.resultCd === '000') {
        return {
          success: true,
          data: response.data
        }
      } else {
        throw new Error(response.data?.resultMsg || 'Unknown VSDC error')
      }
    } catch (error) {
      console.error(`❌ VSDC item submission attempt ${attempt} failed:`, error.message)
      
      if (attempt < this.maxRetries) {
        console.log(`🔄 Retrying item submission in ${this.retryDelay}ms...`)
        await new Promise(resolve => setTimeout(resolve, this.retryDelay))
        return this.submitWithRetry(payload, attempt + 1)
      }
      
      return {
        success: false,
        error: error.message,
        attempts: attempt
      }
    }
  }

  /**
   * Sync items from VSDC to local database
   */
  async syncItemsFromVSDC(lastReqDt = null) {
    try {
      console.log('🔄 Syncing items from VSDC...')
      
      const syncPayload = {
        tpin: process.env.BUSINESS_TPIN,
        bhfId: process.env.BRANCH_ID || '000',
        lastReqDt: lastReqDt || '20240101000000' // Format: YYYYMMDDHHMMSS
      }
      
      const response = await vsdcService.makeAuthenticatedRequest(
        'POST',
        vsdcService.endpoints.itemsSync,
        syncPayload
      )
      
      if (response.success && response.data.resultCd === '000') {
        const items = response.data.itemList || []
        console.log(`📥 Received ${items.length} items from VSDC`)
        
        // Update local database with synced items
        const syncResults = await this.updateLocalItemsFromSync(items)
        
        return {
          success: true,
          itemsCount: items.length,
          syncResults,
          message: 'Items synced successfully from VSDC'
        }
      } else {
        throw new Error(response.data?.resultMsg || 'Items sync failed')
      }
    } catch (error) {
      console.error('❌ Failed to sync items from VSDC:', error.message)
      return {
        success: false,
        error: error.message,
        code: 'ITEMS_SYNC_FAILED'
      }
    }
  }

  /**
   * Update local products from VSDC sync data
   */
  async updateLocalItemsFromSync(vsdcItems) {
    const results = {
      created: 0,
      updated: 0,
      errors: []
    }
    
    for (const vsdcItem of vsdcItems) {
      try {
        await prisma.product.upsert({
          where: { sku: vsdcItem.itemCd },
          update: {
            name: vsdcItem.itemNm,
            price: parseFloat(vsdcItem.dftPrc),
            barcode: vsdcItem.bcd,
            zraItemClassification: vsdcItem.itemClsCd,
            zraPackageUnit: vsdcItem.pkgUnitCd,
            zraQuantityUnit: vsdcItem.qtyUnitCd,
            taxType: vsdcItem.taxTyCd,
            minStock: parseInt(vsdcItem.sftyQty || 0),
            isActive: vsdcItem.useYn === 'Y',
            updatedAt: new Date()
          },
          create: {
            sku: vsdcItem.itemCd,
            name: vsdcItem.itemNm,
            description: vsdcItem.addInfo,
            price: parseFloat(vsdcItem.dftPrc),
            barcode: vsdcItem.bcd,
            zraItemClassification: vsdcItem.itemClsCd,
            zraPackageUnit: vsdcItem.pkgUnitCd,
            zraQuantityUnit: vsdcItem.qtyUnitCd,
            taxType: vsdcItem.taxTyCd,
            minStock: parseInt(vsdcItem.sftyQty || 0),
            isActive: vsdcItem.useYn === 'Y',
            categoryId: await this.getDefaultCategoryId()
          }
        })
        
        results.updated++
      } catch (error) {
        console.error(`❌ Failed to sync item ${vsdcItem.itemCd}:`, error.message)
        results.errors.push({
          itemCode: vsdcItem.itemCd,
          error: error.message
        })
      }
    }
    
    return results
  }

  /**
   * Get ZRA item classification codes
   */
  async getItemClassificationCodes() {
    try {
      const response = await vsdcService.makeAuthenticatedRequest(
        'POST',
        vsdcService.endpoints.codesGet,
        {
          tpin: process.env.BUSINESS_TPIN,
          bhfId: process.env.BRANCH_ID || '000',
          cdCls: '04' // Item classification codes
        }
      )
      
      if (response.success && response.data.resultCd === '000') {
        return {
          success: true,
          codes: response.data.clsList || [],
          message: 'Classification codes retrieved successfully'
        }
      } else {
        throw new Error(response.data?.resultMsg || 'Failed to get classification codes')
      }
    } catch (error) {
      console.error('❌ Failed to get classification codes:', error.message)
      return {
        success: false,
        error: error.message,
        code: 'CLASSIFICATION_CODES_FAILED'
      }
    }
  }

  /**
   * Validate item data against VSDC requirements
   */
  validateItemData(productData) {
    const errors = []
    const warnings = []
    
    // Required fields validation
    if (!productData.name) errors.push('Product name is required')
    if (!productData.price || productData.price <= 0) {
      errors.push('Valid product price is required')
    }
    
    // ZRA specific validations
    if (!productData.zraItemClassification) {
      warnings.push('ZRA item classification code recommended for compliance')
    }
    if (!productData.taxType) {
      warnings.push('Tax type should be specified for accurate tax calculation')
    }
    if (!productData.zraPackageUnit) {
      warnings.push('Package unit recommended for ZRA reporting')
    }
    
    // Barcode validation
    if (productData.barcode && !this.isValidBarcode(productData.barcode)) {
      warnings.push('Barcode format may not be ZRA compliant')
    }
    
    return {
      isValid: errors.length === 0,
      errors,
      warnings
    }
  }

  /**
   * Validate barcode format
   */
  isValidBarcode(barcode) {
    // Basic barcode validation - you can enhance this based on ZRA requirements
    return /^[0-9]{8,13}$/.test(barcode) // UPC/EAN format
  }

  /**
   * Update local product with ZRA response data
   */
  async updateLocalProduct(productId, zraResponse) {
    try {
      await prisma.product.update({
        where: { id: productId },
        data: {
          // Store ZRA specific data or mapping as needed
          updatedAt: new Date()
        }
      })
    } catch (error) {
      console.error('❌ Failed to update local product:', error.message)
      // Don't throw error as VSDC submission was successful
    }
  }

  /**
   * Get default category ID for synced items
   */
  async getDefaultCategoryId() {
    try {
      let defaultCategory = await prisma.category.findFirst({
        where: { name: 'General' }
      })
      
      if (!defaultCategory) {
        defaultCategory = await prisma.category.create({
          data: {
            name: 'General',
            description: 'Default category for VSDC synced items'
          }
        })
      }
      
      return defaultCategory.id
    } catch (error) {
      console.error('❌ Failed to get default category:', error.message)
      throw error
    }
  }

  /**
   * Bulk save multiple items to VSDC
   */
  async bulkSaveItems(products) {
    const results = {
      successful: [],
      failed: [],
      totalCount: products.length
    }
    
    console.log(`📦 Bulk saving ${products.length} items to VSDC...`)
    
    for (const product of products) {
      try {
        const result = await this.saveItemToVSDC(product)
        
        if (result.success) {
          results.successful.push({
            productId: product.id,
            itemCode: result.itemCode
          })
        } else {
          results.failed.push({
            productId: product.id,
            error: result.error
          })
        }
        
        // Small delay between submissions to avoid overwhelming VSDC
        await new Promise(resolve => setTimeout(resolve, 200))
      } catch (error) {
        results.failed.push({
          productId: product.id,
          error: error.message
        })
      }
    }
    
    console.log(`✅ Bulk save completed: ${results.successful.length} successful, ${results.failed.length} failed`)
    
    return results
  }
}

module.exports = new ItemManagementService()
