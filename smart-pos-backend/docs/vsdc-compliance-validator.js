const fs = require('fs')
const path = require('path')

/**
 * ZRA VSDC PDF Compliance Validator
 * Validates implementations against VSDC API Specification v1.0.8
 */

class VSDCComplianceValidator {
  constructor() {
    this.pdfPath = path.join(__dirname, 'VSDC-API-Specification-Document-v1.0.8.pdf')
    this.servicesPath = path.join(__dirname, '..', 'services')
    this.routesPath = path.join(__dirname, '..', 'routes')
    
    // VSDC Required Data Structures as per PDF Section 3
    this.requiredStructures = {
      stockMovement: {
        mandatory: ['tpin', 'bhfId', 'sarNo', 'sarTyCd', 'ocrnDt', 'totItemCnt', 'totTaxblAmt', 'totTaxAmt', 'totAmt'],
        itemList: ['itemSeq', 'itemCd', 'itemClsCd', 'itemNm', 'qty', 'prc', 'splyAmt', 'taxTyCd', 'taxAmt', 'totAmt']
      },
      itemRegistration: {
        mandatory: ['tpin', 'bhfId', 'itemCd', 'itemClsCd', 'itemTyCd', 'itemNm', 'itemStdNm', 'orgnNatCd', 'pkgUnitCd', 'qtyUnitCd', 'taxTyCd'],
        optional: ['btchNo', 'bcd', 'dftPrc', 'addInfo', 'sftyQty', 'isrcAplcbYn', 'useYn']
      },
      authentication: {
        mandatory: ['tpin', 'bhfId', 'userId', 'userPwd'],
        response: ['resultCd', 'resultMsg', 'resultDt', 'sessionId']
      },
      invoice: {
        mandatory: ['tpin', 'bhfId', 'invcNo', 'orgInvcNo', 'custTpin', 'custNm', 'salesTyCd', 'rcptTyCd', 'pmtTyCd', 'salesSttsCd', 'cfmDt', 'salesDt', 'stockRlsDt'],
        itemList: ['itemSeq', 'itemCd', 'itemClsCd', 'itemNm', 'bcd', 'pkgUnitCd', 'pkg', 'qtyUnitCd', 'qty', 'prc', 'splyAmt', 'dcRt', 'dcAmt', 'isrccCd', 'isrccNm', 'isrcRt', 'isrcAmt', 'taxTyCd', 'taxblAmt', 'taxAmt', 'totAmt']
      }
    }

    // VSDC Error Codes as per PDF Section 12
    this.errorCodes = {
      '000': 'Success',
      '001': 'Invalid request format',
      '002': 'Authentication failed',
      '003': 'Session expired',
      '004': 'Invalid TPIN',
      '005': 'Invalid Branch ID',
      '901': 'System error',
      '902': 'Database error',
      '903': 'Network error'
    }

    // Date formats as per PDF Section 3.2
    this.dateFormats = {
      YYYYMMDD: /^\d{8}$/,
      YYYYMMDDHHMISS: /^\d{14}$/
    }
  }

  /**
   * Validate all implementations against VSDC PDF standards
   */
  async validateCompliance() {
    console.log('🔍 VSDC PDF COMPLIANCE VALIDATION')
    console.log('='.repeat(50))
    
    const results = {
      timestamp: new Date().toISOString(),
      pdfExists: this.checkPDFExists(),
      overallCompliance: 0,
      sections: {},
      criticalIssues: [],
      warnings: [],
      recommendations: []
    }

    // Validate each implementation
    results.sections.stockManagement = await this.validateStockManagement()
    results.sections.itemManagement = await this.validateItemManagement()
    results.sections.authentication = await this.validateAuthentication()
    results.sections.invoiceSubmission = await this.validateInvoiceSubmission()

    // Calculate overall compliance
    const sectionScores = Object.values(results.sections).map(s => s.complianceScore)
    results.overallCompliance = Math.round(sectionScores.reduce((a, b) => a + b, 0) / sectionScores.length)

    // Generate report
    this.generateComplianceReport(results)
    
    return results
  }

  /**
   * Check if PDF exists
   */
  checkPDFExists() {
    const exists = fs.existsSync(this.pdfPath)
    if (!exists) {
      console.log('❌ CRITICAL: VSDC PDF not found at:', this.pdfPath)
      console.log('📥 Please download: VSDC-API-Specification-Document-v1.0.8.pdf')
    } else {
      console.log('✅ VSDC PDF found')
    }
    return exists
  }

  /**
   * Validate Stock Management Implementation (Section 6.2)
   */
  async validateStockManagement() {
    console.log('\n📦 Validating Stock Management (Section 6.2)...')
    
    const filePath = path.join(this.servicesPath, 'stockSyncService.js')
    const validation = {
      section: 'Stock Management',
      reference: 'Section 6.2',
      file: 'services/stockSyncService.js',
      fileExists: fs.existsSync(filePath),
      complianceScore: 0,
      issues: [],
      passed: []
    }

    if (!validation.fileExists) {
      validation.issues.push('❌ File missing: stockSyncService.js')
      return validation
    }

    const content = fs.readFileSync(filePath, 'utf8')

    // Check required data structure compliance
    const stockStructure = this.requiredStructures.stockMovement
    
    // Check mandatory fields
    stockStructure.mandatory.forEach(field => {
      if (content.includes(field)) {
        validation.passed.push(`✅ Uses mandatory field: ${field}`)
      } else {
        validation.issues.push(`❌ Missing mandatory field: ${field}`)
      }
    })

    // Check item list structure
    stockStructure.itemList.forEach(field => {
      if (content.includes(field)) {
        validation.passed.push(`✅ Item list includes: ${field}`)
      } else {
        validation.issues.push(`⚠️ Item list missing recommended field: ${field}`)
      }
    })

    // Check VSDC endpoints
    if (content.includes('stockSave') || content.includes('/stock/save')) {
      validation.passed.push('✅ Implements stock save endpoint')
    } else {
      validation.issues.push('❌ Missing stock save endpoint implementation')
    }

    if (content.includes('stockSync') || content.includes('/stock/sync')) {
      validation.passed.push('✅ Implements stock sync endpoint')
    } else {
      validation.issues.push('❌ Missing stock sync endpoint implementation')
    }

    // Check date format compliance
    if (content.includes('formatDate') && content.includes('replace(/-/g, \'\')')) {
      validation.passed.push('✅ Uses VSDC date format (YYYYMMDD)')
    } else {
      validation.issues.push('⚠️ Date format may not comply with VSDC standard')
    }

    // Check error handling
    if (content.includes('resultCd') && content.includes('resultMsg')) {
      validation.passed.push('✅ Handles VSDC error codes properly')
    } else {
      validation.issues.push('⚠️ May not handle VSDC error responses correctly')
    }

    // Calculate compliance score
    const totalChecks = validation.passed.length + validation.issues.length
    validation.complianceScore = Math.round((validation.passed.length / totalChecks) * 100)

    return validation
  }

  /**
   * Validate Item Management Implementation (Section 6.1)
   */
  async validateItemManagement() {
    console.log('\n📋 Validating Item Management (Section 6.1)...')
    
    const filePath = path.join(this.servicesPath, 'itemClassificationService.js')
    const validation = {
      section: 'Item Management',
      reference: 'Section 6.1',
      file: 'services/itemClassificationService.js',
      fileExists: fs.existsSync(filePath),
      complianceScore: 0,
      issues: [],
      passed: []
    }

    if (!validation.fileExists) {
      validation.issues.push('❌ File missing: itemClassificationService.js')
      return validation
    }

    const content = fs.readFileSync(filePath, 'utf8')

    // Check required data structure compliance
    const itemStructure = this.requiredStructures.itemRegistration
    
    // Check mandatory fields
    itemStructure.mandatory.forEach(field => {
      if (content.includes(field)) {
        validation.passed.push(`✅ Uses mandatory field: ${field}`)
      } else {
        validation.issues.push(`❌ Missing mandatory field: ${field}`)
      }
    })

    // Check optional fields
    itemStructure.optional.forEach(field => {
      if (content.includes(field)) {
        validation.passed.push(`✅ Includes optional field: ${field}`)
      }
    })

    // Check VSDC endpoints
    if (content.includes('itemSave') || content.includes('/item/save')) {
      validation.passed.push('✅ Implements item save endpoint')
    } else {
      validation.issues.push('❌ Missing item save endpoint implementation')
    }

    if (content.includes('itemSync') || content.includes('/item/sync')) {
      validation.passed.push('✅ Implements item sync endpoint')
    } else {
      validation.issues.push('❌ Missing item sync endpoint implementation')
    }

    // Check tax type compliance
    if (content.includes('taxTyCd') && content.includes('A') && content.includes('B')) {
      validation.passed.push('✅ Uses VSDC tax type codes')
    } else {
      validation.issues.push('⚠️ Tax type codes may not follow VSDC standard')
    }

    // Calculate compliance score
    const totalChecks = validation.passed.length + validation.issues.length
    validation.complianceScore = Math.round((validation.passed.length / totalChecks) * 100)

    return validation
  }

  /**
   * Validate Authentication Implementation (Section 4.1)
   */
  async validateAuthentication() {
    console.log('\n🔐 Validating Authentication (Section 4.1)...')
    
    const filePath = path.join(this.servicesPath, 'vsdcService.js')
    const validation = {
      section: 'Authentication',
      reference: 'Section 4.1',
      file: 'services/vsdcService.js',
      fileExists: fs.existsSync(filePath),
      complianceScore: 0,
      issues: [],
      passed: []
    }

    if (!validation.fileExists) {
      validation.issues.push('❌ File missing: vsdcService.js')
      return validation
    }

    const content = fs.readFileSync(filePath, 'utf8')

    // Check authentication structure
    const authStructure = this.requiredStructures.authentication
    
    authStructure.mandatory.forEach(field => {
      if (content.includes(field)) {
        validation.passed.push(`✅ Uses auth field: ${field}`)
      } else {
        validation.issues.push(`❌ Missing auth field: ${field}`)
      }
    })

    // Check response handling
    authStructure.response.forEach(field => {
      if (content.includes(field)) {
        validation.passed.push(`✅ Handles response field: ${field}`)
      } else {
        validation.issues.push(`⚠️ May not handle response field: ${field}`)
      }
    })

    // Check session management
    if (content.includes('sessionId') && content.includes('authenticate')) {
      validation.passed.push('✅ Implements session management')
    } else {
      validation.issues.push('❌ Session management may be incomplete')
    }

    // Calculate compliance score
    const totalChecks = validation.passed.length + validation.issues.length
    validation.complianceScore = Math.round((validation.passed.length / totalChecks) * 100)

    return validation
  }

  /**
   * Validate Invoice Submission Implementation (Section 5.1)
   */
  async validateInvoiceSubmission() {
    console.log('\n🧾 Validating Invoice Submission (Section 5.1)...')
    
    const filePath = path.join(this.servicesPath, 'zraInvoice.js')
    const validation = {
      section: 'Invoice Submission',
      reference: 'Section 5.1',
      file: 'services/zraInvoice.js',
      fileExists: fs.existsSync(filePath),
      complianceScore: 0,
      issues: [],
      passed: []
    }

    if (!validation.fileExists) {
      validation.issues.push('❌ File missing: zraInvoice.js')
      return validation
    }

    const content = fs.readFileSync(filePath, 'utf8')

    // Check invoice structure
    const invoiceStructure = this.requiredStructures.invoice
    
    invoiceStructure.mandatory.forEach(field => {
      if (content.includes(field)) {
        validation.passed.push(`✅ Uses invoice field: ${field}`)
      } else {
        validation.issues.push(`❌ Missing invoice field: ${field}`)
      }
    })

    // Check item list structure
    invoiceStructure.itemList.slice(0, 10).forEach(field => { // Check first 10 critical fields
      if (content.includes(field)) {
        validation.passed.push(`✅ Invoice item includes: ${field}`)
      } else {
        validation.issues.push(`⚠️ Invoice item missing: ${field}`)
      }
    })

    // Calculate compliance score
    const totalChecks = validation.passed.length + validation.issues.length
    validation.complianceScore = Math.round((validation.passed.length / totalChecks) * 100)

    return validation
  }

  /**
   * Generate compliance report
   */
  generateComplianceReport(results) {
    console.log('\n📊 VSDC COMPLIANCE REPORT')
    console.log('='.repeat(50))
    console.log(`📅 Generated: ${new Date(results.timestamp).toLocaleString()}`)
    console.log(`📄 PDF Status: ${results.pdfExists ? '✅ Available' : '❌ Missing'}`)
    console.log(`🎯 Overall Compliance: ${results.overallCompliance}%`)
    console.log('')

    // Section-by-section results
    Object.values(results.sections).forEach(section => {
      const statusIcon = section.complianceScore >= 80 ? '✅' : 
                        section.complianceScore >= 60 ? '⚠️' : '❌'
      
      console.log(`${statusIcon} ${section.section} (${section.reference}): ${section.complianceScore}%`)
      console.log(`   📁 File: ${section.file}`)
      
      if (section.passed.length > 0) {
        console.log('   ✅ Compliant features:')
        section.passed.slice(0, 3).forEach(item => {
          console.log(`      ${item}`)
        })
        if (section.passed.length > 3) {
          console.log(`      ... and ${section.passed.length - 3} more`)
        }
      }

      if (section.issues.length > 0) {
        console.log('   ⚠️ Issues found:')
        section.issues.forEach(issue => {
          console.log(`      ${issue}`)
        })
      }
      console.log('')
    })

    // Critical recommendations
    console.log('💡 RECOMMENDATIONS:')
    if (results.overallCompliance < 80) {
      console.log('   🔴 CRITICAL: Overall compliance below 80%')
      console.log('   📖 Review VSDC API Specification Document v1.0.8')
      console.log('   🔧 Focus on missing mandatory fields and endpoints')
    }
    
    if (!results.pdfExists) {
      console.log('   📥 Download VSDC PDF for accurate implementation reference')
    }

    // Save report
    const reportPath = path.join(__dirname, 'api-docs', 'compliance-report.json')
    fs.writeFileSync(reportPath, JSON.stringify(results, null, 2))
    console.log(`💾 Report saved: ${reportPath}`)
  }

  /**
   * Quick compliance check
   */
  async quickCheck() {
    console.log('⚡ Quick VSDC Compliance Check')
    console.log('-'.repeat(30))
    
    const checks = [
      { name: 'VSDC PDF', check: () => this.checkPDFExists() },
      { name: 'Stock Service', check: () => fs.existsSync(path.join(this.servicesPath, 'stockSyncService.js')) },
      { name: 'Item Service', check: () => fs.existsSync(path.join(this.servicesPath, 'itemClassificationService.js')) },
      { name: 'VSDC Service', check: () => fs.existsSync(path.join(this.servicesPath, 'vsdcService.js')) },
      { name: 'ZRA Invoice', check: () => fs.existsSync(path.join(this.servicesPath, 'zraInvoice.js')) }
    ]

    let passed = 0
    checks.forEach(check => {
      const result = check.check()
      console.log(`${result ? '✅' : '❌'} ${check.name}`)
      if (result) passed++
    })

    const compliance = Math.round((passed / checks.length) * 100)
    console.log(`\n🎯 Quick Score: ${compliance}%`)
    
    return compliance >= 80
  }
}

// Export for use in other modules
module.exports = new VSDCComplianceValidator()

// Run if called directly
if (require.main === module) {
  const validator = new VSDCComplianceValidator()
  validator.validateCompliance().then(results => {
    process.exit(results.overallCompliance >= 80 ? 0 : 1)
  })
}
