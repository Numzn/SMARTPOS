const fs = require('fs')
const path = require('path')

class APIReferenceManager {
  constructor() {
    this.docsPath = path.join(__dirname, 'api-docs')
    this.vsdcSpecPath = path.join(__dirname, 'VSDC-API-Specification-Document-v1.0.8.pdf')
    this.referenceIndex = path.join(this.docsPath, 'vsdc-reference-index.json')
    this.buildLog = path.join(this.docsPath, 'build-log.json')
    this.setupDirectories()
  }

  setupDirectories() {
    if (!fs.existsSync(this.docsPath)) {
      fs.mkdirSync(this.docsPath, { recursive: true })
    }
  }

  // Create reference index with build validation
  createReferenceIndex() {
    console.log('🏗️ Creating VSDC API Reference Index...')
    
    const referenceMap = {
      "version": "1.0.8",
      "lastUpdated": new Date().toISOString(),
      "pdf_location": this.vsdcSpecPath,
      "pdf_exists": fs.existsSync(this.vsdcSpecPath),
      "build_status": "initialized",
      "validation_passed": false,
      "sections": {
        "authentication": {
          "page": "Section 4.1",
          "endpoints": ["/api/login", "/api/authenticate"],
          "implementation_status": "completed",
          "priority": "HIGH",
          "description": "VSDC authentication and session management",
          "implementation_file": "services/vsdcService.js",
          "validation_status": "pending",
          "dependencies": [],
          "tests_passed": false
        },
        "initialization": {
          "page": "Section 4.2", 
          "endpoints": ["/api/initialize", "/api/ping"],
          "implementation_status": "completed",
          "priority": "HIGH",
          "description": "System initialization and health checks",
          "implementation_file": "services/vsdcService.js",
          "validation_status": "pending",
          "dependencies": ["authentication"],
          "tests_passed": false
        },
        "codes_and_constants": {
          "page": "Section 9.1",
          "endpoints": ["/api/codes/tax", "/api/codes/classification"],
          "implementation_status": "completed",
          "priority": "HIGH",
          "description": "ZRA mandatory codes and classifications",
          "implementation_file": "services/zraCodesService.js",
          "validation_status": "pending",
          "dependencies": ["authentication", "initialization"],
          "tests_passed": false
        },
        "audit_trail": {
          "page": "Section 11.1",
          "endpoints": ["/api/audit/log", "/api/audit/query"],
          "implementation_status": "completed",
          "priority": "HIGH",
          "description": "Audit trail and compliance logging",
          "implementation_file": "services/auditService.js",
          "validation_status": "pending",
          "dependencies": [],
          "tests_passed": false
        },
        "branch_management": {
          "page": "Section 7.1",
          "endpoints": ["/api/branch/save", "/api/branch/get"],
          "implementation_status": "completed",
          "priority": "HIGH",
          "description": "Business branch registration and management",
          "implementation_file": "routes/branches.js",
          "validation_status": "pending",
          "dependencies": ["authentication", "audit_trail"],
          "tests_passed": false
        },
        "invoice_submission": {
          "page": "Section 5.1",
          "endpoints": ["/api/invoice/submit", "/api/invoice/validate"],
          "implementation_status": "completed",
          "priority": "HIGH",
          "description": "Smart Invoice submission to ZRA",
          "implementation_file": "services/zraInvoice.js",
          "validation_status": "pending",
          "dependencies": ["authentication", "codes_and_constants", "audit_trail"],
          "tests_passed": false
        },
        "item_management": {
          "page": "Section 6.1",
          "endpoints": ["/api/items/save", "/api/items/sync"],
          "implementation_status": "completed",
          "priority": "HIGH",
          "description": "Item registration and synchronization with ZRA",
          "implementation_file": "services/itemClassificationService.js",
          "validation_status": "not_started",
          "dependencies": ["codes_and_constants", "authentication"],
          "tests_passed": false
        },
        "stock_management": {
          "page": "Section 6.2",
          "endpoints": ["/api/stock/update", "/api/stock/sync"],
          "implementation_status": "completed",
          "priority": "HIGH",
          "description": "Stock movement tracking and reporting",
          "implementation_file": "services/stockSyncService.js",
          "validation_status": "not_started",
          "dependencies": ["item_management", "audit_trail"],
          "tests_passed": false
        },
        "purchase_management": {
          "page": "Section 8.1",
          "endpoints": ["/api/purchase/get", "/api/purchase/manual"],
          "implementation_status": "not_started",
          "priority": "MEDIUM",
          "description": "Purchase transaction management",
          "implementation_file": "routes/purchases.js",
          "validation_status": "not_started",
          "dependencies": ["authentication", "item_management", "audit_trail"],
          "tests_passed": false
        },
        "reporting": {
          "page": "Section 10.1",
          "endpoints": ["/api/reports/transaction", "/api/reports/stock"],
          "implementation_status": "not_started",
          "priority": "MEDIUM",
          "description": "ZRA compliance reporting",
          "implementation_file": "services/zraReportService.js",
          "validation_status": "not_started",
          "dependencies": ["audit_trail", "stock_management", "invoice_submission"],
          "tests_passed": false
        }
      },
      "error_codes": {
        "authentication_errors": "Page 45-47",
        "validation_errors": "Page 48-52", 
        "system_errors": "Page 53-55"
      },
      "data_formats": {
        "request_formats": "Appendix A",
        "response_formats": "Appendix B",
        "date_formats": "Section 3.2",
        "currency_formats": "Section 3.3"
      }
    }

    fs.writeFileSync(this.referenceIndex, JSON.stringify(referenceMap, null, 2))
    
    console.log('✅ VSDC API Reference Index created')
    console.log(`📄 PDF Status: ${referenceMap.pdf_exists ? '✅ Found' : '❌ Missing'}`)
    
    this.initializeBuildLog()
    this.validateCurrentState()
    
    return referenceMap
  }

  // Initialize build log for tracking
  initializeBuildLog() {
    const buildLog = {
      "project_name": "Smart POS - ZRA Compliance",
      "started": new Date().toISOString(),
      "last_validation": null,
      "build_history": [],
      "validation_results": {},
      "issues_found": [],
      "recommendations": []
    }

    fs.writeFileSync(this.buildLog, JSON.stringify(buildLog, null, 2))
    console.log('📝 Build log initialized')
  }

  // Comprehensive validation of current implementation state
  validateCurrentState() {
    console.log('\n🔍 Validating Current Implementation State...\n')
    
    const index = this.getIndex()
    const results = {
      timestamp: new Date().toISOString(),
      overall_status: 'pending',
      file_checks: {},
      dependency_checks: {},
      issues: [],
      warnings: [],
      recommendations: []
    }

    // Check if files exist and have proper structure
    Object.entries(index.sections).forEach(([section, details]) => {
      if (details.implementation_status !== 'not_started') {
        const filePath = path.join(__dirname, '..', details.implementation_file)
        const fileExists = fs.existsSync(filePath)
        
        results.file_checks[section] = {
          file: details.implementation_file,
          exists: fileExists,
          status: details.implementation_status
        }

        if (!fileExists && details.implementation_status === 'completed') {
          results.issues.push(`❌ File missing: ${details.implementation_file} (marked as completed)`)
        } else if (fileExists) {
          console.log(`✅ ${section}: File exists (${details.implementation_file})`)
        }
      }
    })

    // Check dependencies
    Object.entries(index.sections).forEach(([section, details]) => {
      if (details.dependencies.length > 0) {
        const missingDeps = details.dependencies.filter(dep => {
          const depSection = index.sections[dep]
          return !depSection || depSection.implementation_status === 'not_started'
        })

        if (missingDeps.length > 0 && details.implementation_status !== 'not_started') {
          results.warnings.push(`⚠️ ${section}: Missing dependencies - ${missingDeps.join(', ')}`)
        }
      }
    })

    // Generate recommendations
    this.generateRecommendations(results, index)

    // Save validation results
    this.saveValidationResults(results)

    // Display results
    this.displayValidationResults(results)

    return results
  }

  // Generate build recommendations
  generateRecommendations(results, index) {
    const completed = Object.values(index.sections).filter(s => s.implementation_status === 'completed').length
    const total = Object.keys(index.sections).length
    const progress = Math.round((completed / total) * 100)

    results.recommendations.push(`📊 Current Progress: ${progress}% (${completed}/${total} sections)`)

    // Suggest next steps based on dependencies
    const readyToImplement = Object.entries(index.sections)
      .filter(([_, details]) => {
        return details.implementation_status === 'pending' &&
               details.dependencies.every(dep => 
                 index.sections[dep]?.implementation_status === 'completed'
               )
      })
      .sort((a, b) => (a[1].priority === 'HIGH' ? -1 : 1))

    if (readyToImplement.length > 0) {
      results.recommendations.push(`🎯 Ready to implement: ${readyToImplement[0][0]}`)
      results.recommendations.push(`📖 Reference: ${readyToImplement[0][1].page}`)
    }

    // Check for critical missing components
    const highPriorityPending = Object.entries(index.sections)
      .filter(([_, details]) => details.priority === 'HIGH' && details.implementation_status !== 'completed')

    if (highPriorityPending.length > 0) {
      results.recommendations.push(`🔴 High priority items remaining: ${highPriorityPending.length}`)
    }
  }

  // Save validation results to build log
  saveValidationResults(results) {
    if (fs.existsSync(this.buildLog)) {
      const log = JSON.parse(fs.readFileSync(this.buildLog, 'utf8'))
      log.last_validation = results.timestamp
      log.validation_results = results
      fs.writeFileSync(this.buildLog, JSON.stringify(log, null, 2))
    }
  }

  // Display validation results
  displayValidationResults(results) {
    console.log('\n📋 Validation Results:')
    console.log(`⏰ Timestamp: ${new Date(results.timestamp).toLocaleString()}`)
    
    if (results.issues.length > 0) {
      console.log('\n🚨 Issues Found:')
      results.issues.forEach(issue => console.log(`   ${issue}`))
    }

    if (results.warnings.length > 0) {
      console.log('\n⚠️ Warnings:')
      results.warnings.forEach(warning => console.log(`   ${warning}`))
    }

    console.log('\n💡 Recommendations:')
    results.recommendations.forEach(rec => console.log(`   ${rec}`))

    console.log('\n📁 File Status:')
    Object.entries(results.file_checks).forEach(([section, check]) => {
      const icon = check.exists ? '✅' : '❌'
      console.log(`   ${icon} ${section}: ${check.file} (${check.status})`)
    })
  }

  // Enhanced progress display with validation
  showProgress() {
    const index = this.getIndex()
    if (!index) {
      console.log('❌ No reference index found. Run createReferenceIndex() first.')
      return
    }

    console.log('\n🇿🇲 VSDC API Implementation Progress (Enhanced)\n')
    console.log(`📄 PDF: ${index.pdf_exists ? '✅ Available' : '❌ Missing'} (v${index.version})`)
    console.log(`📅 Last Updated: ${new Date(index.lastUpdated).toLocaleString()}`)
    
    // Run quick validation
    const quickValidation = this.quickValidation()
    console.log(`🔍 Validation Status: ${quickValidation.passed ? '✅ Passed' : '⚠️ Issues Found'}`)
    
    console.log('\n📊 Implementation Status:\n')
    
    Object.entries(index.sections).forEach(([section, details]) => {
      const statusIcon = {
        'completed': '✅',
        'in_progress': '🔄',
        'basic': '⚡',
        'pending': '⏳',
        'not_started': '❌'
      }[details.implementation_status] || '❓'
      
      const priorityIcon = details.priority === 'HIGH' ? '🔴' : 
                          details.priority === 'MEDIUM' ? '🟡' : '🟢'
      
      const fileExists = fs.existsSync(path.join(__dirname, '..', details.implementation_file))
      const fileIcon = fileExists ? '📁' : '❌'
      
      console.log(`${statusIcon} ${section.toUpperCase().replace('_', ' ')}: ${details.implementation_status} ${priorityIcon}`)
      console.log(`   📖 Reference: ${details.page}`)
      console.log(`   🔗 Endpoints: ${details.endpoints.join(', ')}`)
      console.log(`   ${fileIcon} File: ${details.implementation_file}`)
      
      if (details.dependencies.length > 0) {
        const depStatus = details.dependencies.map(dep => {
          const depSection = index.sections[dep]
          return depSection?.implementation_status === 'completed' ? '✅' : '❌'
        }).join('')
        console.log(`   🔗 Dependencies: ${details.dependencies.join(', ')} [${depStatus}]`)
      }
      
      console.log(`   📝 ${details.description}\n`)
    })

    // Show overall statistics
    const stats = this.calculateStats(index)
    console.log('📈 Overall Statistics:')
    console.log(`   🎯 Progress: ${stats.progress}% (${stats.completed}/${stats.total})`)
    console.log(`   🔴 High Priority: ${stats.highPriorityRemaining} remaining`)
    console.log(`   📁 Files Created: ${stats.filesExist}/${stats.totalFiles}`)
  }

  // Quick validation check
  quickValidation() {
    const index = this.getIndex()
    const issues = []

    Object.entries(index.sections).forEach(([section, details]) => {
      if (details.implementation_status === 'completed') {
        const filePath = path.join(__dirname, '..', details.implementation_file)
        if (!fs.existsSync(filePath)) {
          issues.push(`Missing file: ${details.implementation_file}`)
        }
      }
    })

    return {
      passed: issues.length === 0,
      issues: issues
    }
  }

  // Calculate implementation statistics
  calculateStats(index) {
    const sections = Object.values(index.sections)
    const completed = sections.filter(s => s.implementation_status === 'completed').length
    const total = sections.length
    const progress = Math.round((completed / total) * 100)
    const highPriorityRemaining = sections.filter(s => 
      s.priority === 'HIGH' && s.implementation_status !== 'completed'
    ).length
    
    const filesExist = sections.filter(s => {
      if (s.implementation_status === 'not_started') return false
      return fs.existsSync(path.join(__dirname, '..', s.implementation_file))
    }).length
    
    const totalFiles = sections.filter(s => s.implementation_status !== 'not_started').length

    return {
      completed,
      total,
      progress,
      highPriorityRemaining,
      filesExist,
      totalFiles
    }
  }

  // Get index with error handling
  getIndex() {
    try {
      if (fs.existsSync(this.referenceIndex)) {
        return JSON.parse(fs.readFileSync(this.referenceIndex, 'utf8'))
      }
    } catch (error) {
      console.log('❌ Error reading reference index:', error.message)
    }
    return null
  }

  // Enhanced next tasks with validation
  getNextTasks() {
    const index = this.getIndex()
    if (!index) {
      console.log('❌ No reference index found. Run build:init first.')
      return
    }

    console.log('\n🎯 Next Implementation Tasks (Validated & Prioritized):\n')

    const readyToImplement = []
    const blockedTasks = []

    Object.entries(index.sections).forEach(([section, details]) => {
      if (['pending', 'not_started'].includes(details.implementation_status)) {
        const dependenciesMet = details.dependencies && details.dependencies.length > 0 ? 
          details.dependencies.every(dep => 
            index.sections[dep]?.implementation_status === 'completed'
          ) : true

        const task = {
          name: section,
          page: details.page,
          file: details.implementation_file,
          description: details.description,
          priority: details.priority,
          dependencies: details.dependencies || [],
          dependenciesMet
        }

        if (dependenciesMet) {
          readyToImplement.push(task)
        } else {
          blockedTasks.push(task)
        }
      }
    })

    // Sort by priority
    readyToImplement.sort((a, b) => (a.priority === 'HIGH' ? -1 : 1))
    blockedTasks.sort((a, b) => (a.priority === 'HIGH' ? -1 : 1))

    console.log('🟢 READY TO IMPLEMENT:')
    readyToImplement.forEach((task, i) => {
      const priorityIcon = task.priority === 'HIGH' ? '🔴' : '🟡'
      console.log(`   ${i + 1}. ${priorityIcon} ${task.name.replace('_', ' ').toUpperCase()}`)
      console.log(`      📖 Reference: ${task.page}`)
      console.log(`      📁 File: ${task.file}`)
      console.log(`      📝 ${task.description}`)
      if (task.dependencies.length > 0) {
        console.log(`      ✅ Dependencies met: ${task.dependencies.join(', ')}`)
      }
      console.log('')
    })

    if (blockedTasks.length > 0) {
      console.log('🔒 BLOCKED (Missing Dependencies):')
      blockedTasks.forEach((task, i) => {
        const priorityIcon = task.priority === 'HIGH' ? '🔴' : '🟡'
        const missingDeps = task.dependencies.filter(dep => 
          index.sections[dep]?.implementation_status !== 'completed'
        )
        console.log(`   ${i + 1}. ${priorityIcon} ${task.name.replace('_', ' ').toUpperCase()}`)
        console.log(`      ❌ Waiting for: ${missingDeps.join(', ')}`)
        console.log('')
      })
    }

    return { readyToImplement, blockedTasks }
  }

  // Build confirmation and validation
  confirmBuildStep(section, action = 'implement') {
    console.log(`\n🔨 ${action.toUpperCase()} CONFIRMATION: ${section.toUpperCase().replace('_', ' ')}`)
    
    const sectionDetails = this.getSection(section)
    if (!sectionDetails) {
      console.log('❌ Section not found in reference index')
      return false
    }

    console.log('📋 Pre-build Checklist:')
    console.log(`   📖 PDF Reference: ${sectionDetails.page}`)
    console.log(`   📁 Target File: ${sectionDetails.implementation_file}`)
    console.log(`   🔗 Endpoints: ${sectionDetails.endpoints.join(', ')}`)
    console.log(`   📝 Description: ${sectionDetails.description}`)
    
    if (sectionDetails.dependencies.length > 0) {
      console.log(`   🔗 Dependencies: ${sectionDetails.dependencies.join(', ')}`)
      
      const missingDeps = sectionDetails.dependencies.filter(dep => {
        const depSection = this.getSection(dep)
        return !depSection || depSection.implementation_status !== 'completed'
      })

      if (missingDeps.length > 0) {
        console.log(`   ❌ Missing dependencies: ${missingDeps.join(', ')}`)
        console.log('   🛑 Cannot proceed until dependencies are completed')
        return false
      } else {
        console.log('   ✅ All dependencies satisfied')
      }
    }

    console.log('✅ Ready to proceed with implementation')
    return true
  }

  // Update implementation status with validation
  updateImplementationStatus(section, status) {
    if (!this.confirmBuildStep(section, 'update status')) {
      return false
    }

    if (fs.existsSync(this.referenceIndex)) {
      const index = JSON.parse(fs.readFileSync(this.referenceIndex, 'utf8'))
      if (index.sections[section]) {
        const oldStatus = index.sections[section].implementation_status
        index.sections[section].implementation_status = status
        index.sections[section].validation_status = 'pending'
        index.lastUpdated = new Date().toISOString()
        
        fs.writeFileSync(this.referenceIndex, JSON.stringify(index, null, 2))
        
        console.log(`📝 Updated ${section} status: ${oldStatus} → ${status}`)
        
        // Log the change
        this.logBuildStep(section, 'status_update', { from: oldStatus, to: status })
        
        // Run validation after update
        this.validateCurrentState()
        
        return true
      }
    }
    return false
  }

  // Log build steps
  logBuildStep(section, action, details = {}) {
    if (fs.existsSync(this.buildLog)) {
      const log = JSON.parse(fs.readFileSync(this.buildLog, 'utf8'))
      
      const entry = {
        timestamp: new Date().toISOString(),
        section: section,
        action: action,
        details: details
      }
      
      log.build_history.push(entry)
      fs.writeFileSync(this.buildLog, JSON.stringify(log, null, 2))
    }
  }

  // Show build history
  showBuildHistory() {
    if (fs.existsSync(this.buildLog)) {
      const log = JSON.parse(fs.readFileSync(this.buildLog, 'utf8'))
      
      console.log('\n📜 Build History:')
      console.log(`🚀 Project: ${log.project_name}`)
      console.log(`📅 Started: ${new Date(log.started).toLocaleString()}`)
      
      if (log.build_history.length > 0) {
        console.log('\n🔨 Recent Actions:')
        log.build_history.slice(-10).forEach(entry => {
          console.log(`   ${new Date(entry.timestamp).toLocaleString()}: ${entry.action} - ${entry.section}`)
          if (entry.details && Object.keys(entry.details).length > 0) {
            console.log(`      Details: ${JSON.stringify(entry.details)}`)
          }
        })
      }
    }
  }

  // Check if PDF exists
  checkPDFExists() {
    const exists = fs.existsSync(this.vsdcSpecPath)
    console.log(`📄 VSDC PDF Status: ${exists ? '✅ Found' : '❌ Missing'} at ${this.vsdcSpecPath}`)
    return exists
  }

  // Get specific section reference
  getSection(sectionName) {
    const index = this.getIndex()
    return index?.sections[sectionName] || null
  }

  // Check compliance status with progress calculation
  checkComplianceStatus() {
    const index = this.getIndex()
    if (!index) {
      return {
        progress: 0,
        completedSections: 0,
        totalSections: 0,
        completedComponents: [],
        pendingComponents: []
      }
    }

    const sections = Object.entries(index.sections)
    const completedSections = sections.filter(([_, details]) => 
      details.implementation_status === 'completed'
    )
    const totalSections = sections.length
    const progress = Math.round((completedSections.length / totalSections) * 100)

    const completedComponents = completedSections.map(([name, _]) => 
      name.replace('_', ' ').toUpperCase()
    )

    const pendingComponents = sections
      .filter(([_, details]) => details.implementation_status !== 'completed')
      .map(([name, _]) => name.replace('_', ' ').toUpperCase())

    return {
      progress,
      completedSections: completedSections.length,
      totalSections,
      completedComponents,
      pendingComponents
    }
  }
}

module.exports = new APIReferenceManager()
