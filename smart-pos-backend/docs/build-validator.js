const apiRef = require('./api-reference-manager')
const fs = require('fs')
const path = require('path')

class BuildValidator {
  constructor() {
    this.projectRoot = path.join(__dirname, '..')
    this.requiredDirs = [
      'services',
      'routes', 
      'docs',
      'docs/api-docs'
    ]
    this.criticalFiles = [
      'package.json',
      'index.js',
      'prisma/schema.prisma'
    ]
  }

  // Complete project validation
  async validateProject() {
    console.log('🔍 Running Complete Project Validation...\n')
    
    const results = {
      timestamp: new Date().toISOString(),
      overall_status: 'unknown',
      checks: {
        project_structure: this.validateProjectStructure(),
        api_reference: this.validateAPIReference(),
        implementation_files: this.validateImplementationFiles(),
        dependencies: this.validateDependencies(),
        database_schema: this.validateDatabaseSchema()
      },
      score: 0,
      recommendations: []
    }

    // Calculate overall score
    const passedChecks = Object.values(results.checks).filter(check => check.passed).length
    const totalChecks = Object.keys(results.checks).length
    results.score = Math.round((passedChecks / totalChecks) * 100)
    
    results.overall_status = results.score >= 80 ? 'excellent' :
                            results.score >= 60 ? 'good' :
                            results.score >= 40 ? 'fair' : 'needs_work'

    this.displayValidationResults(results)
    this.generateRecommendations(results)
    
    return results
  }

  // Validate project structure
  validateProjectStructure() {
    console.log('📁 Checking Project Structure...')
    
    const issues = []
    const warnings = []

    // Check required directories
    this.requiredDirs.forEach(dir => {
      const dirPath = path.join(this.projectRoot, dir)
      if (!fs.existsSync(dirPath)) {
        issues.push(`Missing directory: ${dir}`)
      }
    })

    // Check critical files
    this.criticalFiles.forEach(file => {
      const filePath = path.join(this.projectRoot, file)
      if (!fs.existsSync(filePath)) {
        issues.push(`Missing critical file: ${file}`)
      }
    })

    const passed = issues.length === 0
    console.log(`   ${passed ? '✅' : '❌'} Project Structure: ${passed ? 'Valid' : `${issues.length} issues`}`)

    return {
      name: 'Project Structure',
      passed,
      issues,
      warnings
    }
  }

  // Validate API reference system
  validateAPIReference() {
    console.log('📋 Checking API Reference System...')
    
    const issues = []
    const warnings = []

    // Check if PDF exists
    if (!apiRef.checkPDFExists()) {
      issues.push('VSDC API Specification PDF not found')
    }

    // Check reference index
    const index = apiRef.getIndex()
    if (!index) {
      issues.push('API Reference Index not found')
    } else {
      if (!index.pdf_exists) {
        warnings.push('PDF not accessible through reference system')
      }
    }

    const passed = issues.length === 0
    console.log(`   ${passed ? '✅' : '❌'} API Reference: ${passed ? 'Valid' : `${issues.length} issues`}`)

    return {
      name: 'API Reference System',
      passed,
      issues,
      warnings
    }
  }

  // Validate implementation files
  validateImplementationFiles() {
    console.log('📄 Checking Implementation Files...')
    
    const issues = []
    const warnings = []

    const index = apiRef.getIndex()
    if (index) {
      Object.entries(index.sections).forEach(([section, details]) => {
        if (details.implementation_status === 'completed') {
          const filePath = path.join(this.projectRoot, details.implementation_file)
          if (!fs.existsSync(filePath)) {
            issues.push(`Missing file for completed section: ${details.implementation_file}`)
          } else {
            // Basic file content validation
            const content = fs.readFileSync(filePath, 'utf8')
            if (content.length < 100) {
              warnings.push(`File seems too small: ${details.implementation_file}`)
            }
          }
        }
      })
    }

    const passed = issues.length === 0
    console.log(`   ${passed ? '✅' : '❌'} Implementation Files: ${passed ? 'Valid' : `${issues.length} issues`}`)

    return {
      name: 'Implementation Files',
      passed,
      issues,
      warnings
    }
  }

  // Validate dependencies
  validateDependencies() {
    console.log('🔗 Checking Dependencies...')
    
    const issues = []
    const warnings = []

    const index = apiRef.getIndex()
    if (index) {
      Object.entries(index.sections).forEach(([section, details]) => {
        if (details.implementation_status === 'completed' && details.dependencies.length > 0) {
          details.dependencies.forEach(dep => {
            const depSection = index.sections[dep]
            if (!depSection || depSection.implementation_status !== 'completed') {
              issues.push(`${section} depends on incomplete ${dep}`)
            }
          })
        }
      })
    }

    const passed = issues.length === 0
    console.log(`   ${passed ? '✅' : '❌'} Dependencies: ${passed ? 'Valid' : `${issues.length} issues`}`)

    return {
      name: 'Dependencies',
      passed,
      issues,
      warnings
    }
  }

  // Validate database schema
  validateDatabaseSchema() {
    console.log('🗃️ Checking Database Schema...')
    
    const issues = []
    const warnings = []

    const schemaPath = path.join(this.projectRoot, 'prisma/schema.prisma')
    if (fs.existsSync(schemaPath)) {
      const schema = fs.readFileSync(schemaPath, 'utf8')
      
      // Check for ZRA compliance tables
      const requiredModels = ['User', 'Product', 'Category', 'Sale', 'SaleItem']
      requiredModels.forEach(model => {
        if (!schema.includes(`model ${model}`)) {
          issues.push(`Missing required model: ${model}`)
        }
      })

      // Check for ZRA specific fields
      const zraFields = ['invoiceNumber', 'fiscalSignature', 'qrCode']
      zraFields.forEach(field => {
        if (!schema.includes(field)) {
          warnings.push(`Missing ZRA compliance field: ${field}`)
        }
      })
    } else {
      issues.push('Prisma schema file not found')
    }

    const passed = issues.length === 0
    console.log(`   ${passed ? '✅' : '❌'} Database Schema: ${passed ? 'Valid' : `${issues.length} issues`}`)

    return {
      name: 'Database Schema',
      passed,
      issues,
      warnings
    }
  }

  // Display comprehensive results
  displayValidationResults(results) {
    console.log('\n📊 VALIDATION RESULTS SUMMARY\n')
    console.log(`⏰ Timestamp: ${new Date(results.timestamp).toLocaleString()}`)
    console.log(`🎯 Overall Score: ${results.score}% (${results.overall_status.toUpperCase()})`)
    
    const statusIcon = {
      'excellent': '🟢',
      'good': '🟡', 
      'fair': '🟠',
      'needs_work': '🔴'
    }[results.overall_status] || '❓'
    
    console.log(`${statusIcon} Status: ${results.overall_status.toUpperCase()}`)

    console.log('\n📋 Detailed Check Results:')
    Object.values(results.checks).forEach(check => {
      const icon = check.passed ? '✅' : '❌'
      console.log(`   ${icon} ${check.name}: ${check.passed ? 'PASSED' : 'FAILED'}`)
      
      if (check.issues.length > 0) {
        console.log('      🚨 Issues:')
        check.issues.forEach(issue => console.log(`         - ${issue}`))
      }
      
      if (check.warnings.length > 0) {
        console.log('      ⚠️ Warnings:')
        check.warnings.forEach(warning => console.log(`         - ${warning}`))
      }
    })
  }

  // Generate actionable recommendations
  generateRecommendations(results) {
    console.log('\n💡 RECOMMENDATIONS:\n')

    if (results.score >= 80) {
      console.log('🎉 Excellent! Your project is in great shape.')
      console.log('✅ Consider proceeding with the next implementation phase.')
    } else if (results.score >= 60) {
      console.log('👍 Good progress! Address the issues below to improve.')
    } else {
      console.log('⚠️ Project needs attention. Focus on critical issues first.')
    }

    // Specific recommendations based on failed checks
    Object.values(results.checks).forEach(check => {
      if (!check.passed) {
        console.log(`\n🔧 ${check.name} Fixes Needed:`)
        check.issues.forEach(issue => {
          console.log(`   📝 ${issue}`)
        })
      }
    })

    console.log('\n🎯 Next Steps:')
    console.log('   1. Fix critical issues listed above')
    console.log('   2. Run validation again: npm run validate')
    console.log('   3. Check next tasks: npm run tasks')
    console.log('   4. Continue implementation based on priority')
  }
}

// Export for use in scripts
module.exports = new BuildValidator()

// Run if called directly
if (require.main === module) {
  const validator = new BuildValidator()
  validator.validateProject()
}
