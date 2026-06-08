const vsdcService = require('./vsdcService')
const prisma = require('../lib/prisma')

/**
 * ZRA Codes Service - Implementation based on VSDC API Specification v1.0.8
 * Reference: Section 9.1 (Codes and Constants)
 * 
 * Manages ZRA mandatory codes, tax types, and item classifications
 */

class ZRACodesService {
  constructor() {
    this.prisma = prisma
    this.lastSyncDate = null
    
    // ZRA Code types as per VSDC specification
    this.codeTypes = {
      TAX_TYPES: '01',           // VAT, Excise, etc.
      ITEM_CLASSIFICATION: '02', // Product categories
      UNIT_OF_MEASURE: '03',     // kg, pcs, litres, etc.
      PACKAGING_UNITS: '04',     // Box, Carton, etc.
      CURRENCY_CODES: '05',      // ZMW, USD, etc.
      COUNTRY_CODES: '06',       // Country of origin
      INVOICE_TYPES: '07',       // Normal, Credit Note, etc.
      TRANSACTION_TYPES: '08'    // Sale, Purchase, etc.
    }
  }

  /**
   * Fetch all mandatory codes from ZRA VSDC
   * Reference: Section 9.1.1
   */
  async fetchAllCodes() {
    try {
      console.log('📥 Fetching ZRA mandatory codes...')
      
      const results = {}
      const errors = []

      // Fetch each code type
      for (const [typeName, typeCode] of Object.entries(this.codeTypes)) {
        try {
          const codes = await this.fetchCodesByType(typeCode)
          results[typeName] = codes
          console.log(`✅ Fetched ${codes.length} ${typeName}`)
        } catch (error) {
          console.error(`❌ Failed to fetch ${typeName}:`, error.message)
          errors.push({ type: typeName, error: error.message })
        }
      }

      // Save to database
      await this.saveCodesDatabase(results)
      
      this.lastSyncDate = new Date()
      
      return {
        success: true,
        codes: results,
        errors: errors.length > 0 ? errors : null,
        syncDate: this.lastSyncDate,
        message: `Successfully synced ${Object.keys(results).length} code types`
      }
    } catch (error) {
      console.error('❌ Failed to fetch ZRA codes:', error.message)
      return {
        success: false,
        error: error.message,
        code: 'CODES_FETCH_ERROR'
      }
    }
  }

  /**
   * Fetch codes by specific type
   * Reference: Section 9.1.2
   */
  async fetchCodesByType(codeType) {
    try {
      const payload = {
        tpin: vsdcService.tpin,
        bhfId: vsdcService.bhfId,
        lastReqDt: this.getLastRequestDate()
      }

      const response = await vsdcService.makeAuthenticatedRequest(
        'POST', 
        `/api/codes/get/${codeType}`, 
        payload
      )

      if (response.success && response.data.resultCd === '000') {
        return response.data.data || []
      } else {
        throw new Error(`Failed to fetch codes: ${response.data?.resultMsg || 'Unknown error'}`)
      }
    } catch (error) {
      throw new Error(`Code fetch error for type ${codeType}: ${error.message}`)
    }
  }

  /**
   * Get tax types and rates
   * Reference: Section 9.1.3
   */
  async getTaxTypes() {
    try {
      // Try to get from database first
      let taxTypes = await this.getCodesFromDatabase('TAX_TYPES')
      
      if (!taxTypes || taxTypes.length === 0) {
        // Fetch from VSDC if not in database
        console.log('🔄 Tax types not found locally, fetching from VSDC...')
        await this.fetchAllCodes()
        taxTypes = await this.getCodesFromDatabase('TAX_TYPES')
      }

      // Process tax types for easier use
      const processedTaxTypes = taxTypes.map(tax => ({
        code: tax.code,
        name: tax.name,
        rate: parseFloat(tax.rate || 0),
        description: tax.description,
        isActive: tax.isActive !== false
      }))

      return {
        success: true,
        taxTypes: processedTaxTypes,
        vatRate: this.getVATRate(processedTaxTypes),
        message: `Found ${processedTaxTypes.length} tax types`
      }
    } catch (error) {
      console.error('❌ Failed to get tax types:', error.message)
      return {
        success: false,
        error: error.message,
        taxTypes: this.getDefaultTaxTypes() // Fallback
      }
    }
  }

  /**
   * Get item classifications
   * Reference: Section 9.1.4
   */
  async getItemClassifications() {
    try {
      let classifications = await this.getCodesFromDatabase('ITEM_CLASSIFICATION')
      
      if (!classifications || classifications.length === 0) {
        console.log('🔄 Item classifications not found locally, fetching from VSDC...')
        await this.fetchAllCodes()
        classifications = await this.getCodesFromDatabase('ITEM_CLASSIFICATION')
      }

      return {
        success: true,
        classifications: classifications.map(item => ({
          code: item.code,
          name: item.name,
          description: item.description,
          level: item.level || 1,
          parentCode: item.parentCode || null
        })),
        message: `Found ${classifications.length} item classifications`
      }
    } catch (error) {
      console.error('❌ Failed to get item classifications:', error.message)
      return {
        success: false,
        error: error.message,
        classifications: []
      }
    }
  }

  /**
   * Get units of measure
   * Reference: Section 9.1.5
   */
  async getUnitsOfMeasure() {
    try {
      let units = await this.getCodesFromDatabase('UNIT_OF_MEASURE')
      
      if (!units || units.length === 0) {
        console.log('🔄 Units of measure not found locally, fetching from VSDC...')
        await this.fetchAllCodes()
        units = await this.getCodesFromDatabase('UNIT_OF_MEASURE')
      }

      return {
        success: true,
        units: units.map(unit => ({
          code: unit.code,
          name: unit.name,
          symbol: unit.symbol || unit.code,
          description: unit.description
        })),
        message: `Found ${units.length} units of measure`
      }
    } catch (error) {
      console.error('❌ Failed to get units of measure:', error.message)
      return {
        success: false,
        error: error.message,
        units: this.getDefaultUnits()
      }
    }
  }

  /**
   * Save codes to database
   */
  async saveCodesDatabase(codesData) {
    try {
      console.log('💾 Saving ZRA codes to database...')
      
      for (const [codeType, codes] of Object.entries(codesData)) {
        if (Array.isArray(codes) && codes.length > 0) {
          // Clear existing codes of this type
          await this.prisma.$executeRaw`
            DELETE FROM zra_codes WHERE code_type = ${codeType}
          `
          
          // Insert new codes
          for (const code of codes) {
            await this.prisma.$executeRaw`
              INSERT INTO zra_codes (
                code_type, code, name, description, rate, 
                level, parent_code, is_active, created_at
              ) VALUES (
                ${codeType}, ${code.code}, ${code.name}, 
                ${code.description || ''}, ${code.rate || 0},
                ${code.level || 1}, ${code.parentCode || null},
                ${code.isActive !== false}, NOW()
              )
              ON CONFLICT (code_type, code) 
              DO UPDATE SET 
                name = EXCLUDED.name,
                description = EXCLUDED.description,
                rate = EXCLUDED.rate,
                updated_at = NOW()
            `
          }
        }
      }
      
      console.log('✅ ZRA codes saved to database')
    } catch (error) {
      console.error('❌ Failed to save codes to database:', error.message)
      throw error
    }
  }

  /**
   * Get codes from database
   */
  async getCodesFromDatabase(codeType) {
    try {
      const codes = await this.prisma.$queryRaw`
        SELECT * FROM zra_codes 
        WHERE code_type = ${codeType} 
        AND is_active = true
        ORDER BY code
      `
      return codes
    } catch (error) {
      console.warn('⚠️ Database query failed, table may not exist:', error.message)
      return []
    }
  }

  /**
   * Get last request date for incremental sync
   */
  getLastRequestDate() {
    if (this.lastSyncDate) {
      return this.lastSyncDate.toISOString().split('T')[0].replace(/-/g, '')
    }
    // Default to 30 days ago
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
    return thirtyDaysAgo.toISOString().split('T')[0].replace(/-/g, '')
  }

  /**
   * Get VAT rate from tax types
   */
  getVATRate(taxTypes) {
    const vat = taxTypes.find(tax => 
      tax.code === 'A' || 
      tax.name.toLowerCase().includes('vat') ||
      tax.name.toLowerCase().includes('value added')
    )
    return vat ? vat.rate : 16.0 // Default to 16% VAT for Zambia
  }

  /**
   * Default tax types (fallback)
   */
  getDefaultTaxTypes() {
    return [
      { code: 'A', name: 'VAT Standard Rate', rate: 16.0, description: 'Value Added Tax' },
      { code: 'B', name: 'VAT Zero Rate', rate: 0.0, description: 'Zero-rated VAT' },
      { code: 'C', name: 'VAT Exempt', rate: 0.0, description: 'VAT Exempt' },
      { code: 'D', name: 'No VAT', rate: 0.0, description: 'Not subject to VAT' }
    ]
  }

  /**
   * Default units (fallback)
   */
  getDefaultUnits() {
    return [
      { code: 'U', name: 'Unit', symbol: 'u' },
      { code: 'KG', name: 'Kilogram', symbol: 'kg' },
      { code: 'L', name: 'Litre', symbol: 'l' },
      { code: 'M', name: 'Metre', symbol: 'm' },
      { code: 'PC', name: 'Piece', symbol: 'pc' }
    ]
  }

  /**
   * Force sync from VSDC
   */
  async forceSyncCodes() {
    this.lastSyncDate = null
    return await this.fetchAllCodes()
  }
}

module.exports = new ZRACodesService()
