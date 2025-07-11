const axios = require('axios');
const prisma = require('../lib/prisma');

class ZRAInvoiceService {
  constructor() {
    this.vsdcBaseUrl = process.env.VSDC_BASE_URL || 'http://localhost:8090';
  }

  /**
   * Format sale data for ZRA VSDC system
   * @param {Object} sale - Sale object with items and user
   * @returns {Object} Formatted payload for VSDC
   */
  formatSaleForVSDC(sale) {
    return {
      saleId: sale.id,
      cashier: sale.user.email,
      items: sale.saleItems.map(item => ({
        description: item.product.name,
        quantity: item.quantity,
        unitPrice: parseFloat(item.price),
        vatRate: 16 // Standard VAT rate in Zambia
      })),
      total: parseFloat(sale.total),
      subtotal: parseFloat(sale.subtotal),
      tax: parseFloat(sale.tax || 0),
      discount: parseFloat(sale.discount || 0),
      paymentMethod: sale.paymentMethod,
      timestamp: sale.createdAt.toISOString()
    };
  }

  /**
   * Send sale to ZRA VSDC system
   * @param {string} saleId - Sale ID to process
   * @returns {Object} ZRA response or error
   */
  async sendToVSDC(saleId) {
    try {
      // 1. Fetch sale with all related data
      const sale = await prisma.sale.findUnique({
        where: { id: saleId },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              name: true
            }
          },
          saleItems: {
            include: {
              product: {
                select: {
                  id: true,
                  name: true,
                  price: true
                }
              }
            }
          }
        }
      });

      if (!sale) {
        throw new Error(`Sale with ID ${saleId} not found`);
      }

      // Check if already processed
      if (sale.rcptNo) {
        return {
          success: false,
          message: 'Sale already has a ZRA receipt',
          data: sale
        };
      }

      // 2. Format data for VSDC
      const vsdcPayload = this.formatSaleForVSDC(sale);

      console.log('📤 Sending to ZRA VSDC:', JSON.stringify(vsdcPayload, null, 2));

      // 3. Send to mock VSDC server
      const response = await axios.post(
        `${this.vsdcBaseUrl}/trnsSales/saveSales`,
        vsdcPayload,
        {
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'SmartPOS-Backend/1.0'
          },
          timeout: 30000 // 30 seconds timeout
        }
      );

      console.log('📥 ZRA VSDC Response:', response.data);

      // 4. Update sale with ZRA response
      const updatedSale = await prisma.sale.update({
        where: { id: saleId },
        data: {
          rcptNo: response.data.rcptNo,
          rcptSign: response.data.rcptSign,
          qrCode: response.data.qrCode,
          vsdcTimestamp: new Date(response.data.timestamp)
        },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              name: true
            }
          },
          saleItems: {
            include: {
              product: true
            }
          }
        }
      });

      return {
        success: true,
        message: 'Smart Invoice generated successfully',
        data: updatedSale,
        zraResponse: response.data
      };

    } catch (error) {
      console.error('❌ ZRA VSDC Error:', error.message);
      
      if (error.code === 'ECONNREFUSED') {
        throw new Error('VSDC server is not running or unreachable');
      }
      
      if (error.response) {
        throw new Error(`VSDC Error: ${error.response.status} - ${error.response.data?.message || 'Unknown error'}`);
      }
      
      throw error;
    }
  }

  /**
   * Get ZRA receipt status
   * @param {string} saleId - Sale ID to check
   * @returns {Object} Receipt status
   */
  async getReceiptStatus(saleId) {
    try {
      const sale = await prisma.sale.findUnique({
        where: { id: saleId },
        select: {
          id: true,
          rcptNo: true,
          rcptSign: true,
          qrCode: true,
          vsdcTimestamp: true,
          total: true,
          status: true
        }
      });

      if (!sale) {
        throw new Error(`Sale with ID ${saleId} not found`);
      }

      return {
        saleId: sale.id,
        hasReceipt: !!sale.rcptNo,
        receiptNumber: sale.rcptNo,
        signature: sale.rcptSign,
        qrCode: sale.qrCode,
        issuedAt: sale.vsdcTimestamp,
        total: sale.total,
        status: sale.status
      };

    } catch (error) {
      console.error('❌ Receipt Status Error:', error.message);
      throw error;
    }
  }

  /**
   * Get all sales that need ZRA processing
   * @returns {Array} Sales without ZRA receipts
   */
  async getPendingZRASales() {
    try {
      const pendingSales = await prisma.sale.findMany({
        where: {
          rcptNo: null,
          status: 'COMPLETED'
        },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              name: true
            }
          },
          saleItems: {
            include: {
              product: {
                select: {
                  id: true,
                  name: true
                }
              }
            }
          }
        },
        orderBy: {
          createdAt: 'asc'
        }
      });

      return pendingSales;

    } catch (error) {
      console.error('❌ Pending Sales Error:', error.message);
      throw error;
    }
  }
}

module.exports = new ZRAInvoiceService();
