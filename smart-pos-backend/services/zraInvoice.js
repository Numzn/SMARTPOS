const vsdcService = require('./vsdcService')
const auditService = require('./auditService')
const { PrismaClient } = require('@prisma/client')

/**
 * ZRA Invoice Service - VSDC PDF Compliant Implementation
 * Reference: VSDC API Specification v1.0.8, Section 5.1 (Smart Invoice)
 * 
 * Handles invoice submission to ZRA for tax compliance
 */

class ZRAInvoiceService {
  constructor() {
    this.prisma = new PrismaClient()
    
    // Sales Types as per VSDC specification
    this.salesTypes = {
      NORMAL: 'N',              // Normal sale
      CREDIT: 'C',              // Credit sale
      CASH: 'S'                 // Cash sale
    }

    // Receipt Types as per VSDC specification
    this.receiptTypes = {
      SALE: 'S',                // Sale receipt
      REFUND: 'R',              // Refund receipt
      TRAINING: 'T'             // Training receipt
    }

    // Payment Types as per VSDC specification
    this.paymentTypes = {
      CASH: '01',               // Cash payment
      CARD: '02',               // Card payment
      BANK_TRANSFER: '03',      // Bank transfer
      MOBILE_MONEY: '04',       // Mobile money
      CREDIT: '05'              // Credit payment
    }

    // Sales Status as per VSDC specification
    this.salesStatus = {
      WAIT_APPROVAL: '01',      // Waiting for approval
      APPROVED: '02',           // Approved
      CANCELLED: '03'           // Cancelled
    }
  }

  /**
   * Submit invoice to ZRA VSDC
   * Reference: Section 5.1.1
   */
  async submitInvoice(invoiceData) {
    try {
      console.log(`📄 Submitting invoice to ZRA: ${invoiceData.invoiceNumber}`)
      
      // Validate invoice data
      const validation = this.validateInvoiceData(invoiceData)
      if (!validation.isValid) {
        throw new Error(`Invalid invoice data: ${validation.errors.join(', ')}`)
      }

      // Prepare VSDC compliant invoice data
      const vsdcInvoiceData = {
        tpin: vsdcService.tpin,
        bhfId: vsdcService.bhfId,
        invcNo: parseInt(invoiceData.invoiceNumber),
        orgInvcNo: invoiceData.originalInvoiceNumber || 0,
        custTpin: invoiceData.customerTpin || null,
        custNm: invoiceData.customerName,
        custBhfId: invoiceData.customerBranchId || '00',
        salesTyCd: invoiceData.salesType || this.salesTypes.NORMAL,
        rcptTyCd: invoiceData.receiptType || this.receiptTypes.SALE,
        pmtTyCd: this.getPaymentType(invoiceData.paymentMethod),
        salesSttsCd: invoiceData.salesStatus || this.salesStatus.APPROVED,
        cfmDt: this.formatDateTime(invoiceData.confirmationDate || new Date()),
        salesDt: this.formatDate(invoiceData.salesDate || new Date()),
        stockRlsDt: invoiceData.stockReleaseDate ? this.formatDate(invoiceData.stockReleaseDate) : null,
        cnclReqDt: invoiceData.cancellationRequestDate ? this.formatDate(invoiceData.cancellationRequestDate) : null,
        cnclDt: invoiceData.cancellationDate ? this.formatDate(invoiceData.cancellationDate) : null,
        rfdDt: invoiceData.refundDate ? this.formatDate(invoiceData.refundDate) : null,
        rfdRsnCd: invoiceData.refundReasonCode || null,
        totItemCnt: invoiceData.items.length,
        totTaxblAmt: parseFloat(invoiceData.totalTaxableAmount),
        totTaxAmt: parseFloat(invoiceData.totalTaxAmount),
        totAmt: parseFloat(invoiceData.totalAmount),
        prcOdr: invoiceData.priceOrder || null,
        remark: invoiceData.remark || '',
        regrId: invoiceData.registeredBy || 'SYSTEM',
        regrNm: invoiceData.registeredByName || 'SYSTEM',
        modrId: invoiceData.modifiedBy || 'SYSTEM',
        modrNm: invoiceData.modifiedByName || 'SYSTEM',
        
        // Item list - VSDC compliant structure
        itemList: invoiceData.items.map((item, index) => ({
          itemSeq: index + 1,
          itemCd: item.itemCode,
          itemClsCd: item.itemClassification,
          itemNm: item.itemName,
          bcd: item.barcode || null,
          pkgUnitCd: item.packageUnit || 'U',
          pkg: parseInt(item.packageQuantity || 1),
          qtyUnitCd: item.quantityUnit || 'U',
          qty: parseFloat(item.quantity),
          prc: parseFloat(item.unitPrice),
          splyAmt: parseFloat(item.supplyAmount),
          dcRt: parseFloat(item.discountRate || 0),
          dcAmt: parseFloat(item.discountAmount || 0),
          isrccCd: item.insuranceCode || null,
          isrccNm: item.insuranceName || null,
          isrcRt: parseFloat(item.insuranceRate || 0),
          isrcAmt: parseFloat(item.insuranceAmount || 0),
          taxTyCd: item.taxType,
          taxblAmt: parseFloat(item.taxableAmount),
          taxAmt: parseFloat(item.taxAmount),
          totAmt: parseFloat(item.totalAmount)
        }))
      }

      // Submit to VSDC
      const response = await vsdcService.makeAuthenticatedRequest(
        'POST',
        vsdcService.endpoints.invoiceSubmit,
        vsdcInvoiceData
      )

      if (response.success && response.data.resultCd === '000') {
        console.log(`✅ Invoice submitted to ZRA: ${invoiceData.invoiceNumber}`)
        
        // Save response data
        const invoiceResponse = {
          invcSdcId: response.data.invcSdcId,
          invcNo: response.data.invcNo,
          intrlData: response.data.intrlData,
          rcptNo: response.data.rcptNo,
          totRcptNo: response.data.totRcptNo,
          vsdcRcptPbctDate: response.data.vsdcRcptPbctDate,
          sdcId: response.data.sdcId,
          mrcNo: response.data.mrcNo,
          qrCode: response.data.qrCode
        }

        // Update local database
        await this.updateLocalInvoice(invoiceData, invoiceResponse)
        
        // Log audit event
        await auditService.logEvent(auditService.eventTypes.INVOICE_SUBMIT, {
          entityType: 'INVOICE',
          entityId: invoiceData.invoiceNumber,
          action: 'ZRA_SUBMIT',
          newValues: vsdcInvoiceData,
          description: `Invoice submitted to ZRA: ${invoiceData.invoiceNumber}`,
          metadata: {
            invcSdcId: invoiceResponse.invcSdcId,
            rcptNo: invoiceResponse.rcptNo,
            qrCode: invoiceResponse.qrCode
          }
        })

        return {
          success: true,
          invoiceNumber: invoiceData.invoiceNumber,
          zraResponse: invoiceResponse,
          message: 'Invoice successfully submitted to ZRA'
        }
      } else {
        throw new Error(`ZRA invoice submission failed: ${response.data?.resultMsg || 'Unknown error'}`)
      }
    } catch (error) {
      console.error('❌ ZRA invoice submission failed:', error.message)
      
      // Log failure
      await auditService.logEvent(auditService.eventTypes.INVOICE_SUBMIT, {
        entityType: 'INVOICE',
        entityId: invoiceData.invoiceNumber,
        action: 'ZRA_SUBMIT',
        success: false,
        errorMessage: error.message,
        description: `Failed to submit invoice to ZRA: ${invoiceData.invoiceNumber}`
      })

      return {
        success: false,
        error: error.message,
        code: 'ZRA_INVOICE_SUBMIT_FAILED'
      }
    }
  }

  /**
   * Submit invoice with retry mechanism - 100% compliance enhancement
   */
  async submitInvoiceWithRetry(invoiceData, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`📄 Invoice submission attempt ${attempt}/${maxRetries}: ${invoiceData.invoiceNumber}`)
        
        const result = await this.submitInvoice(invoiceData)
        
        if (result.success) {
          console.log(`✅ Invoice submitted successfully on attempt ${attempt}`)
          return result
        }
        
        // If this was the last attempt, return the error
        if (attempt === maxRetries) {
          return result
        }
        
        // Check if error is retryable
        if (!this.isRetryableError(result.error)) {
          console.log(`❌ Non-retryable error, stopping attempts: ${result.error}`)
          return result
        }
        
        // Exponential backoff
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000)
        console.log(`⏳ Retrying in ${delay}ms...`)
        await new Promise(resolve => setTimeout(resolve, delay))
        
      } catch (error) {
        console.error(`❌ Attempt ${attempt} failed:`, error.message)
        
        if (attempt === maxRetries) {
          return {
            success: false,
            error: error.message,
            code: 'INVOICE_SUBMIT_FAILED_ALL_RETRIES'
          }
        }
        
        // Wait before retry
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000)
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }
  }

  /**
   * Check if error is retryable
   */
  isRetryableError(error) {
    const retryableErrors = [
      'NETWORK_ERROR',
      'TIMEOUT',
      'CONNECTION_REFUSED',
      'SERVICE_UNAVAILABLE',
      'ZRA_TIMEOUT',
      'SESSION_EXPIRED'
    ]
    
    return retryableErrors.some(retryableError => 
      error.includes(retryableError) || error.includes(retryableError.toLowerCase())
    )
  }

  /**
   * Bulk invoice processing for multiple invoices
   */
  async submitMultipleInvoices(invoicesData, concurrency = 3) {
    try {
      console.log(`📦 Processing ${invoicesData.length} invoices with concurrency ${concurrency}`)
      
      const results = []
      const chunks = this.chunkArray(invoicesData, concurrency)
      
      for (const chunk of chunks) {
        const chunkPromises = chunk.map(invoiceData => 
          this.submitInvoiceWithRetry(invoiceData)
        )
        
        const chunkResults = await Promise.all(chunkPromises)
        results.push(...chunkResults)
        
        // Small delay between chunks to avoid overwhelming ZRA
        if (chunks.indexOf(chunk) < chunks.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 500))
        }
      }
      
      const successful = results.filter(r => r.success).length
      const failed = results.filter(r => !r.success).length
      
      console.log(`📊 Bulk processing complete: ${successful} successful, ${failed} failed`)
      
      return {
        success: failed === 0,
        total: invoicesData.length,
        successful,
        failed,
        results
      }
    } catch (error) {
      console.error('❌ Bulk invoice processing failed:', error.message)
      return {
        success: false,
        error: error.message,
        results: []
      }
    }
  }

  /**
   * Helper method to chunk array
   */
  chunkArray(array, chunkSize) {
    const chunks = []
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize))
    }
    return chunks
  }

  /**
   * Generate invoice data from sale (enhanced with validation)
   */
  async generateInvoiceDataFromSale(saleId) {
    try {
      console.log(`🛠️ Generating invoice data from sale: ${saleId}`)
      
      // Fetch sale details
      const sale = await this.prisma.sale.findUnique({
        where: { id: saleId },
        include: {
          customer: true,
          items: true
        }
      })
      
      if (!sale) {
        throw new Error(`Sale not found: ${saleId}`)
      }
      
      // Basic validation
      if (!sale.customer || !sale.customer.tpin) {
        throw new Error(`Customer TPIN is required for invoice generation`)
      }
      
      // Map sale to invoice data structure
      const invoiceData = {
        invoiceNumber: sale.id,
        originalInvoiceNumber: sale.originalId || null,
        customerTpin: sale.customer.tpin,
        customerName: sale.customer.name,
        customerBranchId: sale.customer.branchId || '00',
        salesType: sale.salesType || this.salesTypes.NORMAL,
        receiptType: sale.receiptType || this.receiptTypes.SALE,
        paymentMethod: sale.paymentMethod || 'CASH',
        salesStatus: sale.status || this.salesStatus.APPROVED,
        confirmationDate: sale.confirmedAt,
        salesDate: sale.date,
        stockReleaseDate: sale.stockReleasedAt,
        cancellationRequestDate: sale.cancellationRequestedAt,
        cancellationDate: sale.cancelledAt,
        refundDate: sale.refundedAt,
        refundReasonCode: sale.refundReasonCode || null,
        remark: sale.remark || '',
        registeredBy: sale.registeredBy || 'SYSTEM',
        registeredByName: sale.registeredByName || 'SYSTEM',
        modifiedBy: sale.modifiedBy || 'SYSTEM',
        modifiedByName: sale.modifiedByName || 'SYSTEM',
        items: sale.items.map(item => ({
          itemCode: item.productCode,
          itemClassification: item.classification,
          itemName: item.name,
          barcode: item.barcode,
          packageUnit: item.packageUnit,
          packageQuantity: item.packageQuantity,
          quantityUnit: item.quantityUnit,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          supplyAmount: item.supplyAmount,
          discountRate: item.discountRate,
          discountAmount: item.discountAmount,
          insuranceCode: item.insuranceCode,
          insuranceName: item.insuranceName,
          insuranceRate: item.insuranceRate,
          insuranceAmount: item.insuranceAmount,
          taxType: item.taxType,
          taxableAmount: item.taxableAmount,
          taxAmount: item.taxAmount,
          totalAmount: item.totalAmount
        })),
        totalTaxableAmount: sale.items.reduce((sum, item) => sum + parseFloat(item.taxableAmount || 0), 0),
        totalTaxAmount: sale.items.reduce((sum, item) => sum + parseFloat(item.taxAmount || 0), 0),
        totalAmount: sale.items.reduce((sum, item) => sum + parseFloat(item.totalAmount || 0), 0)
      }

      console.log(`✅ Invoice data generated successfully: ${invoiceData.invoiceNumber}`)
      return invoiceData
    } catch (error) {
      console.error('❌ Failed to generate invoice data:', error.message)
      throw error
    }
  }

  /**
   * Submit sale as invoice (enhanced with validation and error handling)
   */
  async submitSaleAsInvoice(saleId) {
    try {
      // Generate invoice data from sale
      const invoiceData = await this.generateInvoiceDataFromSale(saleId)
      
      // Submit invoice with retry mechanism
      const result = await this.submitInvoiceWithRetry(invoiceData)
      
      return result
    } catch (error) {
      console.error('❌ Failed to submit sale as invoice:', error.message)
      return {
        success: false,
        error: error.message,
        code: 'SALE_SUBMIT_AS_INVOICE_FAILED'
      }
    }
  }

  /**
   * Validate invoice data against VSDC requirements
   */
  validateInvoiceData(invoiceData) {
    const errors = []
    const warnings = []

    // Required fields validation
    if (!invoiceData.invoiceNumber) errors.push('Invoice number is required')
    if (!invoiceData.customerName) errors.push('Customer name is required')
    if (!invoiceData.items || invoiceData.items.length === 0) {
      errors.push('Invoice must have at least one item')
    }
    if (!invoiceData.totalAmount || invoiceData.totalAmount <= 0) {
      errors.push('Valid total amount is required')
    }

    // Item validation
    if (invoiceData.items) {
      invoiceData.items.forEach((item, index) => {
        if (!item.itemCode) errors.push(`Item ${index + 1}: Item code is required`)
        if (!item.itemName) errors.push(`Item ${index + 1}: Item name is required`)
        if (!item.quantity || item.quantity <= 0) {
          errors.push(`Item ${index + 1}: Valid quantity is required`)
        }
        if (!item.unitPrice || item.unitPrice <= 0) {
          errors.push(`Item ${index + 1}: Valid unit price is required`)
        }
        if (!item.taxType) warnings.push(`Item ${index + 1}: Tax type recommended`)
      })
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    }
  }

  /**
   * Get payment type code
   */
  getPaymentType(paymentMethod) {
    const mapping = {
      'CASH': this.paymentTypes.CASH,
      'CARD': this.paymentTypes.CARD,
      'CREDIT_CARD': this.paymentTypes.CARD,
      'DEBIT_CARD': this.paymentTypes.CARD,
      'BANK_TRANSFER': this.paymentTypes.BANK_TRANSFER,
      'MOBILE_MONEY': this.paymentTypes.MOBILE_MONEY,
      'CREDIT': this.paymentTypes.CREDIT
    }

    return mapping[paymentMethod?.toUpperCase()] || this.paymentTypes.CASH
  }

  /**
   * Format date for VSDC (YYYYMMDD)
   */
  formatDate(date) {
    const d = new Date(date)
    return d.toISOString().split('T')[0].replace(/-/g, '')
  }

  /**
   * Format datetime for VSDC (YYYYMMDDHHMISS)
   */
  formatDateTime(date) {
    const d = new Date(date)
    return d.toISOString().replace(/[-:T]/g, '').split('.')[0]
  }

  /**
   * Update local invoice with ZRA response
   */
  async updateLocalInvoice(invoiceData, zraResponse) {
    try {
      // Update or create invoice record
      await this.prisma.invoice.upsert({
        where: { invoiceNumber: invoiceData.invoiceNumber.toString() },
        update: {
          zraInvcSdcId: zraResponse.invcSdcId,
          zraRcptNo: zraResponse.rcptNo,
          zraQrCode: zraResponse.qrCode,
          zraSdcId: zraResponse.sdcId,
          zraMrcNo: zraResponse.mrcNo,
          zraSubmittedAt: new Date(),
          updatedAt: new Date()
        },
        create: {
          invoiceNumber: invoiceData.invoiceNumber.toString(),
          customerName: invoiceData.customerName,
          customerTpin: invoiceData.customerTpin,
          totalAmount: parseFloat(invoiceData.totalAmount),
          totalTaxAmount: parseFloat(invoiceData.totalTaxAmount),
          salesDate: new Date(invoiceData.salesDate),
          zraInvcSdcId: zraResponse.invcSdcId,
          zraRcptNo: zraResponse.rcptNo,
          zraQrCode: zraResponse.qrCode,
          zraSdcId: zraResponse.sdcId,
          zraMrcNo: zraResponse.mrcNo,
          zraSubmittedAt: new Date()
        }
      })

      console.log(`💾 Updated local invoice record: ${invoiceData.invoiceNumber}`)
    } catch (error) {
      console.error('❌ Failed to update local invoice:', error.message)
      // Don't throw error here as ZRA submission was successful
    }
  }
}

module.exports = new ZRAInvoiceService()