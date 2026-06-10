const vsdcService = require('./vsdcService')
const auditService = require('./auditService')
const prisma = require('../lib/prisma')
const { getProductClassification } = require('../lib/productRegistration')

/**
 * ZRA Invoice Service - VSDC PDF Compliant Implementation
 * Reference: VSDC API Specification v1.0.8, Section 5.1 (Smart Invoice)
 * 
 * Handles invoice submission to ZRA for tax compliance
 */

class ZRAInvoiceService {
  constructor() {
    this.prisma = prisma
    
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
   * Build VSDC invoice payload from a loaded Sale (with saleItems + product).
   */
  buildInvoiceDataFromSale(sale, options = {}) {
    const customerName = options.customerName || 'Walk-in Customer';
    const customerTpin = options.customerTpin || null;

    const items = sale.saleItems.map((line) => {
      const product = line.product;
      const itemClassification = getProductClassification(product);
      if (!itemClassification) {
        throw new Error(
          `Product ${product.sku || product.name} is missing ZRA classification code`
        );
      }
      return {
        itemCode: product.sku || product.id,
        itemClassification,
        itemName: product.name,
        barcode: product.barcode,
        packageUnit: product.zraPackageUnit || product.unit || 'EA',
        packageQuantity: line.pkg ?? 1,
        quantityUnit: product.zraQuantityUnit || product.unit || 'EA',
        quantity: line.qty,
        unitPrice: line.prc,
        supplyAmount: line.splyAmt,
        discountRate: 0,
        discountAmount: 0,
        taxType: product.taxType || 'A',
        taxableAmount: line.taxblAmt,
        taxAmount: line.taxAmt,
        totalAmount: line.totAmt,
      };
    });

    return {
      invoiceNumber: sale.id,
      customerTpin,
      customerName,
      customerBranchId: '00',
      salesType: this.salesTypes.NORMAL,
      receiptType: this.receiptTypes.SALE,
      paymentMethod: sale.paymentMethod,
      salesStatus: this.salesStatus.APPROVED,
      confirmationDate: sale.createdAt,
      salesDate: sale.createdAt,
      items,
      totalTaxableAmount: items.reduce((s, i) => s + i.taxableAmount, 0),
      totalTaxAmount: items.reduce((s, i) => s + i.taxAmount, 0),
      totalAmount: sale.total,
      registeredBy: sale.userId,
      registeredByName: sale.user?.name || sale.user?.email || 'SYSTEM',
    };
  }

  /**
   * Build VSDC credit note payload from a Refund (rcptTyCd=R, orgInvcNo set).
   */
  buildCreditNoteFromRefund(refund, originalSale) {
    const customerName = 'Walk-in Customer';

    const items = refund.refundItems.map((line) => {
      const product = line.product;
      const itemClassification = getProductClassification(product);
      if (!itemClassification) {
        throw new Error(
          `Product ${product.sku || product.name} is missing ZRA classification code`
        );
      }
      return {
        itemCode: product.sku || product.id,
        itemClassification,
        itemName: product.name,
        barcode: product.barcode,
        packageUnit: product.zraPackageUnit || product.unit || 'EA',
        packageQuantity: line.pkg ?? 1,
        quantityUnit: product.zraQuantityUnit || product.unit || 'EA',
        quantity: line.qty,
        unitPrice: line.prc,
        supplyAmount: line.splyAmt,
        discountRate: 0,
        discountAmount: 0,
        taxType: product.taxType || 'A',
        taxableAmount: line.taxblAmt,
        taxAmount: line.taxAmt,
        totalAmount: line.totAmt,
      };
    });

    const orgInvcNo =
      (originalSale.vsdcResponse && originalSale.vsdcResponse.invcNo) ||
      (originalSale.vsdcResponse && originalSale.vsdcResponse.data?.invcNo) ||
      0;

    return {
      invoiceNumber: refund.id,
      originalInvoiceNumber: orgInvcNo,
      customerTpin: null,
      customerName,
      customerBranchId: '00',
      salesType: this.salesTypes.NORMAL,
      receiptType: this.receiptTypes.REFUND,
      paymentMethod: refund.paymentMethod,
      salesStatus: this.salesStatus.APPROVED,
      confirmationDate: refund.createdAt,
      salesDate: refund.createdAt,
      refundDate: new Date(),
      refundReasonCode: refund.reasonCode,
      remark: refund.reason || 'Credit note / refund',
      items,
      totalTaxableAmount: items.reduce((s, i) => s + i.taxableAmount, 0),
      totalTaxAmount: items.reduce((s, i) => s + i.taxAmount, 0),
      totalAmount: refund.total,
      registeredBy: refund.userId,
      registeredByName: refund.user?.name || refund.user?.email || 'SYSTEM',
    };
  }

  /**
   * Load sale and build invoice data for VSDC submission.
   */
  async generateInvoiceDataFromSale(saleId, options = {}) {
    const sale = await this.prisma.sale.findUnique({
      where: { id: saleId },
      include: {
        saleItems: { include: { product: true } },
        user: { select: { id: true, name: true, email: true } },
      },
    });

    if (!sale) {
      throw new Error(`Sale not found: ${saleId}`);
    }

    if (!sale.saleItems.length) {
      throw new Error('Sale has no line items');
    }

    return this.buildInvoiceDataFromSale(sale, options);
  }

  /**
   * Submit sale to VSDC only — does not update sale status or stock (owned by saleFiscal).
   */
  async submitFiscalForSale(saleId, options = {}) {
    const sale = await this.prisma.sale.findUnique({
      where: { id: saleId },
      include: {
        saleItems: { include: { product: true } },
        user: { select: { id: true, name: true, email: true } },
      },
    });

    if (!sale) {
      return { success: false, message: 'Sale not found', data: null };
    }

    if (sale.rcptNo) {
      return {
        success: true,
        message: 'Sale already submitted to ZRA',
        zraResponse: {
          rcptNo: sale.rcptNo,
          qrCode: sale.qrCode,
          rcptSign: sale.rcptSign,
        },
        vsdcRequest: sale.vsdcRequest,
        vsdcResponse: sale.vsdcResponse,
      };
    }

    const ready = await vsdcService.isDeviceReady();
    if (!ready) {
      const init = await vsdcService.ensureDeviceInitialized();
      if (!init.success) {
        return {
          success: false,
          message: init.error || 'VSDC device not initialized',
          code: 'VSDC_NOT_INITIALIZED',
        };
      }
    }

    const invoiceData = this.buildInvoiceDataFromSale(sale, options);
    const vsdcRequest = invoiceData;

    await this.prisma.sale.update({
      where: { id: saleId },
      data: { vsdcRequest },
    });

    const result = await this.submitInvoiceWithRetry(invoiceData);

    const vsdcResponse = result.success
      ? result.zraResponse
      : { error: result.error, code: result.code, resultMsg: result.error };

    if (!result.success) {
      return {
        success: false,
        message: result.error || 'ZRA submission failed',
        vsdcRequest,
        vsdcResponse,
        zraResponse: result,
      };
    }

    return {
      success: true,
      message: result.message || 'Smart Invoice generated successfully',
      zraResponse: result.zraResponse,
      vsdcRequest,
      vsdcResponse,
    };
  }

  /**
   * Submit refund credit note to VSDC — does not update refund status or stock (owned by saleRefund).
   */
  async submitFiscalForRefund(refundId) {
    const refund = await this.prisma.refund.findUnique({
      where: { id: refundId },
      include: {
        refundItems: { include: { product: true } },
        user: { select: { id: true, name: true, email: true } },
        originalSale: true,
      },
    });

    if (!refund) {
      return { success: false, message: 'Refund not found', data: null };
    }

    if (refund.rcptNo) {
      return {
        success: true,
        message: 'Refund already submitted to ZRA',
        zraResponse: {
          rcptNo: refund.rcptNo,
          qrCode: refund.qrCode,
          rcptSign: refund.rcptSign,
        },
        vsdcRequest: refund.vsdcRequest,
        vsdcResponse: refund.vsdcResponse,
      };
    }

    if (!refund.originalSale?.rcptNo) {
      return {
        success: false,
        message: 'Original sale has no fiscal receipt',
        code: 'ORIGINAL_SALE_NOT_FISCAL',
      };
    }

    const ready = await vsdcService.isDeviceReady();
    if (!ready) {
      const init = await vsdcService.ensureDeviceInitialized();
      if (!init.success) {
        return {
          success: false,
          message: init.error || 'VSDC device not initialized',
          code: 'VSDC_NOT_INITIALIZED',
        };
      }
    }

    const invoiceData = this.buildCreditNoteFromRefund(refund, refund.originalSale);
    const vsdcRequest = invoiceData;

    await this.prisma.refund.update({
      where: { id: refundId },
      data: { vsdcRequest },
    });

    const result = await this.submitInvoiceWithRetry(invoiceData);

    const vsdcResponse = result.success
      ? result.zraResponse
      : { error: result.error, code: result.code, resultMsg: result.error };

    if (!result.success) {
      return {
        success: false,
        message: result.error || 'ZRA credit note submission failed',
        vsdcRequest,
        vsdcResponse,
        zraResponse: result,
      };
    }

    return {
      success: true,
      message: result.message || 'Credit note submitted successfully',
      zraResponse: result.zraResponse,
      vsdcRequest,
      vsdcResponse,
    };
  }

  /**
   * Submit a completed sale to ZRA VSDC and persist receipt fields on Sale.
   * @deprecated Prefer saleFiscal.finalizeSaleFiscally for fiscal-lock flow.
   */
  async sendToVSDC(saleId, options = {}) {
    const saleFiscal = require('../lib/saleFiscal');
    const outcome = await saleFiscal.finalizeSaleFiscally(saleId, options);
    if (!outcome.success) {
      return {
        success: false,
        message: outcome.fiscal?.error || 'ZRA submission failed',
        data: outcome.sale,
      };
    }
    return {
      success: true,
      message: 'Smart Invoice generated successfully',
      data: outcome.sale,
      zraResponse: outcome.fiscal,
    };
  }

  /**
   * ZRA receipt status for a sale.
   */
  async getReceiptStatus(saleId) {
    const sale = await this.prisma.sale.findUnique({
      where: { id: saleId },
      select: {
        id: true,
        rcptNo: true,
        rcptSign: true,
        qrCode: true,
        vsdcTimestamp: true,
        status: true,
        total: true,
        createdAt: true,
      },
    });

    if (!sale) {
      throw new Error(`Sale not found: ${saleId}`);
    }

    return {
      saleId: sale.id,
      submitted: Boolean(sale.rcptNo),
      status: sale.rcptNo ? 'SUBMITTED' : 'PENDING',
      rcptNo: sale.rcptNo,
      rcptSign: sale.rcptSign,
      qrCode: sale.qrCode,
      vsdcTimestamp: sale.vsdcTimestamp,
      saleStatus: sale.status,
      total: sale.total,
      createdAt: sale.createdAt,
    };
  }

  /**
   * Completed sales not yet sent to ZRA.
   */
  async getPendingZRASales() {
    return this.prisma.sale.findMany({
      where: {
        rcptNo: null,
        status: { in: ['PENDING', 'FISCAL_FAILED', 'FISCAL_SUBMITTING'] },
      },
      include: {
        saleItems: {
          include: {
            product: { select: { id: true, name: true, sku: true } },
          },
        },
        user: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
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