const vsdcGateway = require('../lib/vsdc-gateway')
const prisma = require('../lib/prisma')

/**
 * ZRA Codes Service — backed by vsdc-gateway sync + Prisma cache.
 * Reference: VSDC API Specification v1.0.8 Section 9.1
 */

// Class numbers confirmed directly against VSDC API Spec v1.0.8 §6 "Code
// Definition" (vsdc-extracted.txt) — not guessed. Corrected 2026-08-11:
// TAX_TYPES was '01' (real: '04' — confirmed by the §5.2 sample response,
// cdCls:"04"/cdClsNm:"Taxation Type"); UNIT_OF_MEASURE was '03' (real: '10'
// — §6.5 "refer to class code 10 of /code/selectCodes"); PACKAGING_UNITS
// was '04' (real: '17' — §6.4 "refer to class code 17", and '04' is
// actually Tax Type, so the old value pointed at the wrong category
// entirely). mock-vsdc-server.js was built to match these wrong numbers,
// which is why prior mock-based verification never caught it.
// ITEM_CLASSIFICATION is not a /code/selectCodes class at all — item
// classification is a separate endpoint (/itemClass/selectItemsClass) into
// a different table (ZraClassificationCode); '02' here was never used.
//
// CURRENCY_CODES/COUNTRY_CODES/INVOICE_TYPES/TRANSACTION_TYPES below are
// NOT re-verified as part of this fix — they're dead entries (grep confirms
// zero call sites) left at their original, unverified numbers. Spec section
// 6.6 suggests currency's real class is '33', not '05' — flagged, not
// fixed, since nothing reads these today and confirming the other three
// would be scope creep beyond the tax/unit/packaging fix this required.
const CODE_CLASS_MAP = {
  TAX_TYPES: '04',
  UNIT_OF_MEASURE: '10',
  PACKAGING_UNITS: '17',
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
      // useYn === 'N' means ZRA has explicitly marked the code unusable/
      // deprecated — don't offer it. A null/unset useYn (e.g. rows synced
      // before this field existed) is treated as usable, not filtered.
      const usable = rows.filter((item) => item.useYn !== 'N')
      return {
        success: true,
        classifications: usable.map((item) => ({
          code: item.code,
          name: item.name,
          description: null,
          level: item.level || 1,
          parentCode: null,
          taxTyCd: item.taxTyCd,
          mjrTgYn: item.mjrTgYn,
          useYn: item.useYn,
        })),
        message: `Found ${usable.length} item classifications`,
      }
    } catch (error) {
      return {
        success: false,
        error: error.message,
        classifications: [],
      }
    }
  }

  // Server-side search for the ClassificationPicker UI — unlike
  // getItemClassifications() above (which returns the whole usable set for
  // internal/back-compat callers), this is built for a type-ahead: bounded
  // result count, filters at the DB layer, and never returns a deprecated
  // (useYn='N') code. `q` matches against both the ZRA code and its name so
  // a user can search "cement" or "3011..." interchangeably.
  async searchItemClassifications({ q, limit } = {}) {
    try {
      const take = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 50)
      const term = String(q || '').trim()

      // useYn === 'N' is explicitly deprecated; null/unset is usable (same
      // rule as getItemClassifications) — `not: 'N'` alone would also drop
      // NULL rows under SQL's three-valued logic, so it's spelled out as an OR.
      const usableFilter = { OR: [{ useYn: null }, { useYn: { not: 'N' } }] }
      const where = term
        ? {
            AND: [
              usableFilter,
              { OR: [{ code: { contains: term, mode: 'insensitive' } }, { name: { contains: term, mode: 'insensitive' } }] },
            ],
          }
        : usableFilter

      let rows = await this.prisma.zraClassificationCode.findMany({ where, orderBy: { code: 'asc' }, take })

      // Only auto-sync when the table has genuinely never been populated —
      // an empty *search* result (no match for the term) is a normal, valid
      // outcome and must not trigger a sync loop.
      if (rows.length === 0 && term === '') {
        const total = await this.prisma.zraClassificationCode.count()
        if (total === 0) {
          await this.fetchAllCodes()
          rows = await this.prisma.zraClassificationCode.findMany({ where, orderBy: { code: 'asc' }, take })
        }
      }

      return {
        success: true,
        classifications: rows.map((item) => ({
          code: item.code,
          name: item.name,
          level: item.level || 1,
          taxTyCd: item.taxTyCd,
          mjrTgYn: item.mjrTgYn,
          useYn: item.useYn,
        })),
        message: `Found ${rows.length} item classification${rows.length === 1 ? '' : 's'}`,
      }
    } catch (error) {
      return {
        success: false,
        error: error.message,
        classifications: [],
      }
    }
  }

  // Unlike ZraClassificationCode, ZraCode rows have no per-row deprecation
  // flag — and neither does the real /code/selectCodes response for this
  // data (confirmed against the spec text; standard-code entries are just
  // {cd, cdNm}, no useYn). The practical equivalent of "exclude deprecated"
  // here is "still present in the most recent sync for this class": a row
  // the latest sync run didn't touch was, by implication, no longer in
  // ZRA's response. Rows written by one sync loop land within milliseconds
  // of each other, so a tolerance window (not exact timestamp equality)
  // safely groups a single run together without needing a dedicated
  // sync-run table.
  static SYNC_FRESHNESS_TOLERANCE_MS = 5 * 60 * 1000

  async getCurrentCodesForClass(codeClass) {
    const rows = await this.prisma.zraCode.findMany({ where: { codeClass }, orderBy: { code: 'asc' } })
    if (rows.length === 0) return rows
    const maxSyncedAt = rows.reduce((max, r) => (r.syncedAt > max ? r.syncedAt : max), rows[0].syncedAt)
    const cutoff = new Date(maxSyncedAt.getTime() - ZRACodesService.SYNC_FRESHNESS_TOLERANCE_MS)
    return rows.filter((r) => r.syncedAt >= cutoff)
  }

  // Shared list-and-sync-on-demand logic for the three bounded standard-code
  // selectors (tax type, package unit, quantity unit) — small enumerable
  // lists, unlike classification's thousands of rows, so no search/pagination
  // is needed here, just "give me the current usable set for this class."
  async listCurrentStandardCodes(codeType) {
    try {
      const codeClass = CODE_CLASS_MAP[codeType] || codeType
      let rows = await this.getCurrentCodesForClass(codeClass)
      if (rows.length === 0) {
        const sync = await this.fetchAllCodes()
        if (sync.success) {
          rows = await this.getCurrentCodesForClass(codeClass)
        }
      }
      return {
        success: true,
        codes: rows.map((r) => ({ code: r.code, name: r.name })),
        message: `Found ${rows.length} code${rows.length === 1 ? '' : 's'}`,
      }
    } catch (error) {
      return { success: false, error: error.message, codes: [] }
    }
  }

  async searchTaxTypes() {
    return this.listCurrentStandardCodes('TAX_TYPES')
  }

  async searchPackagingUnits() {
    return this.listCurrentStandardCodes('PACKAGING_UNITS')
  }

  async searchQuantityUnits() {
    return this.listCurrentStandardCodes('UNIT_OF_MEASURE')
  }

  // Validates a taxType/zraPackageUnit/zraQuantityUnit value against the
  // current synced set for its class — the backend enforcement half,
  // independent of whichever UI selector sent it. codeType is one of the
  // CODE_CLASS_MAP keys ('TAX_TYPES', 'PACKAGING_UNITS', 'UNIT_OF_MEASURE').
  async isUsableStandardCode(codeType, code) {
    if (!code) return false
    const codeClass = CODE_CLASS_MAP[codeType] || codeType
    const rows = await this.getCurrentCodesForClass(codeClass)
    return rows.some((r) => r.code === String(code))
  }

  // Validates a code against the synced table before it's allowed onto a
  // product — the enforcement half of "no arbitrary free-text classification
  // codes." Called from routes/products.js on create/update.
  async isUsableClassificationCode(code) {
    if (!code) return false
    const row = await this.prisma.zraClassificationCode.findUnique({ where: { code: String(code) } })
    if (!row) return false
    return row.useYn !== 'N'
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

  /**
   * Strict, fiscal-payload-facing lookup: resolves a default code from the
   * synced ZraCode table for the given class, preferring `preferredCode` if
   * present. Unlike getTaxTypes()/getUnitsOfMeasure() (which fall back to
   * getDefaultTaxTypes()/getDefaultUnits() for UI/informational use), this
   * throws rather than silently substituting a hardcoded value — callers
   * building an actual VSDC item-registration payload must not submit a
   * code that was never confirmed against the synced source of truth.
   */
  async resolveDefaultCode(codeType, preferredCode) {
    let rows = await this.getCodesFromDatabase(codeType)
    if (!rows.length) {
      const sync = await this.fetchAllCodes()
      if (!sync.success) {
        throw new Error(
          `ZRA ${codeType} codes have never been synced and sync failed (${sync.error}). ` +
          `Run POST /api/vsdc/codes/sync before registering items.`
        )
      }
      rows = await this.getCodesFromDatabase(codeType)
    }
    if (!rows.length) {
      throw new Error(
        `ZRA ${codeType} codes are synced but the code class returned zero rows. ` +
        `Cannot resolve a default — check VSDC_MODE and the sync response.`
      )
    }
    const preferred = rows.find((r) => r.code === preferredCode)
    return preferred || rows[0]
  }

  async getDefaultTaxTypeCode() {
    const row = await this.resolveDefaultCode('TAX_TYPES', 'A')
    return row.code
  }

  async getDefaultUnitCode() {
    const row = await this.resolveDefaultCode('UNIT_OF_MEASURE', 'EA')
    return row.code
  }
}

module.exports = new ZRACodesService()
