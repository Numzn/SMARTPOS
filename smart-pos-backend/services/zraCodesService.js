const vsdcGateway = require('../lib/vsdc-gateway')
const prisma = require('../lib/prisma')

/**
 * ZRA Codes Service — backed by vsdc-gateway sync + Prisma cache.
 * Reference: VSDC API Specification v1.0.8 Section 9.1
 */

const CODE_CLASS_MAP = {
  TAX_TYPES: '01',
  ITEM_CLASSIFICATION: '02',
  UNIT_OF_MEASURE: '03',
  PACKAGING_UNITS: '04',
  CURRENCY_CODES: '05',
  COUNTRY_CODES: '06',
  INVOICE_TYPES: '07',
  TRANSACTION_TYPES: '08',
}

class ZRACodesService {
  constructor() {
    this.prisma = prisma
    this.lastSyncDate = null
    this.codeTypes = CODE_CLASS_MAP
  }

  async fetchAllCodes() {
    try {
      console.log('📥 Syncing ZRA mandatory codes via gateway...')
      const ready = await vsdcGateway.ensureReady()
      if (!ready.success) {
        throw new Error(ready.error || 'VSDC not initialized')
      }

      const sync = await vsdcGateway.syncCodes()
      this.lastSyncDate = new Date()

      return {
        success: true,
        sync,
        syncDate: this.lastSyncDate,
        message: `Synced ${sync.standard?.count || 0} codes, ${sync.classification?.count || 0} classifications`,
      }
    } catch (error) {
      console.error('❌ Failed to fetch ZRA codes:', error.message)
      return {
        success: false,
        error: error.message,
        code: 'CODES_FETCH_ERROR',
      }
    }
  }

  async fetchCodesByType(codeType) {
    const codeClass = CODE_CLASS_MAP[codeType] || codeType
    const rows = await this.prisma.zraCode.findMany({
      where: { codeClass: String(codeClass) },
      orderBy: { code: 'asc' },
    })
    return rows.map((r) => ({
      code: r.code,
      name: r.name,
      description: r.description,
      rate: r.rate,
      codeClass: r.codeClass,
    }))
  }

  async getTaxTypes() {
    try {
      let taxTypes = await this.getCodesFromDatabase('TAX_TYPES')
      if (!taxTypes.length) {
        await this.fetchAllCodes()
        taxTypes = await this.getCodesFromDatabase('TAX_TYPES')
      }
      const processedTaxTypes = taxTypes.map((tax) => ({
        code: tax.code,
        name: tax.name,
        rate: parseFloat(tax.rate || 0),
        description: tax.description,
        isActive: true,
      }))
      return {
        success: true,
        taxTypes: processedTaxTypes.length ? processedTaxTypes : this.getDefaultTaxTypes(),
        vatRate: this.getVATRate(processedTaxTypes.length ? processedTaxTypes : this.getDefaultTaxTypes()),
        message: `Found ${processedTaxTypes.length} tax types`,
      }
    } catch (error) {
      return {
        success: false,
        error: error.message,
        taxTypes: this.getDefaultTaxTypes(),
      }
    }
  }

  async getItemClassifications() {
    try {
      let rows = await this.prisma.zraClassificationCode.findMany({ orderBy: { code: 'asc' } })
      if (!rows.length) {
        await this.fetchAllCodes()
        rows = await this.prisma.zraClassificationCode.findMany({ orderBy: { code: 'asc' } })
      }
      return {
        success: true,
        classifications: rows.map((item) => ({
          code: item.code,
          name: item.name,
          description: null,
          level: item.level || 1,
          parentCode: null,
        })),
        message: `Found ${rows.length} item classifications`,
      }
    } catch (error) {
      return {
        success: false,
        error: error.message,
        classifications: [],
      }
    }
  }

  async getUnitsOfMeasure() {
    try {
      let units = await this.getCodesFromDatabase('UNIT_OF_MEASURE')
      if (!units.length) {
        await this.fetchAllCodes()
        units = await this.getCodesFromDatabase('UNIT_OF_MEASURE')
      }
      return {
        success: true,
        units: units.length
          ? units.map((unit) => ({
              code: unit.code,
              name: unit.name,
              symbol: unit.code,
              description: unit.description,
            }))
          : this.getDefaultUnits(),
        message: `Found ${units.length} units of measure`,
      }
    } catch (error) {
      return {
        success: false,
        error: error.message,
        units: this.getDefaultUnits(),
      }
    }
  }

  async getCodesFromDatabase(codeType) {
    try {
      const codeClass = CODE_CLASS_MAP[codeType] || codeType
      const codes = await this.prisma.zraCode.findMany({
        where: { codeClass: String(codeClass) },
        orderBy: { code: 'asc' },
      })
      return codes.map((c) => ({
        code: c.code,
        name: c.name,
        description: c.description,
        rate: c.rate,
        level: 1,
        parentCode: null,
        isActive: true,
      }))
    } catch (error) {
      console.warn('⚠️ ZRA codes query failed:', error.message)
      return []
    }
  }

  getLastRequestDate() {
    if (this.lastSyncDate) {
      return this.lastSyncDate.toISOString().split('T')[0].replace(/-/g, '')
    }
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
    return thirtyDaysAgo.toISOString().split('T')[0].replace(/-/g, '')
  }

  getVATRate(taxTypes) {
    const vat = taxTypes.find(
      (tax) =>
        tax.code === 'A' ||
        tax.name.toLowerCase().includes('vat') ||
        tax.name.toLowerCase().includes('value added')
    )
    return vat ? vat.rate : 16.0
  }

  getDefaultTaxTypes() {
    return [
      { code: 'A', name: 'VAT Standard Rate', rate: 16.0, description: 'Value Added Tax' },
      { code: 'B', name: 'VAT Zero Rate', rate: 0.0, description: 'Zero-rated VAT' },
      { code: 'C', name: 'VAT Exempt', rate: 0.0, description: 'VAT Exempt' },
      { code: 'D', name: 'No VAT', rate: 0.0, description: 'Not subject to VAT' },
    ]
  }

  getDefaultUnits() {
    return [
      { code: 'EA', name: 'Each', symbol: 'ea' },
      { code: 'KG', name: 'Kilogram', symbol: 'kg' },
      { code: 'L', name: 'Litre', symbol: 'l' },
      { code: 'M', name: 'Metre', symbol: 'm' },
      { code: 'PC', name: 'Piece', symbol: 'pc' },
    ]
  }

  async forceSyncCodes() {
    this.lastSyncDate = null
    return this.fetchAllCodes()
  }
}

module.exports = new ZRACodesService()
