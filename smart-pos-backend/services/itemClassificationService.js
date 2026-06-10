const prisma = require('../lib/prisma');
const itemManagementService = require('./itemManagement');
const {
  registerProductWithVsdc,
  isProductRegistered,
  validateRegistrationFields,
  productToVsdcPayload,
} = require('../lib/productRegistration');
const { getProductClassification } = require('../lib/productRegistrationState');

/**
 * Compatibility facade for VSDC Section 6.1 item registration.
 *
 * Canonical implementation lives in:
 *   - lib/productRegistration.js (gates, status, registerProductWithVsdc)
 *   - services/itemManagement.js (VSDC save/sync payloads)
 *
 * @deprecated Prefer productRegistration + itemManagement directly in new code.
 */
class ItemClassificationService {
  /**
   * Register a product with ZRA VSDC by local product id or item payload.
   */
  async registerItemWithZRA(itemData) {
    if (itemData?.id) {
      const result = await registerProductWithVsdc(itemData.id);
      if (!result.success) {
        return { success: false, error: result.error, code: result.code || 'ZRA_REGISTRATION_FAILED' };
      }
      return {
        success: true,
        zraItemCode: result.itemCode,
        message: 'Item successfully registered with ZRA',
        zraResponse: result.zraResponse,
      };
    }

    const result = await itemManagementService.saveItemToVSDC(itemData);
    if (!result.success) {
      return { success: false, error: result.error, code: result.code || 'ZRA_REGISTRATION_FAILED' };
    }
    return {
      success: true,
      zraItemCode: result.itemCode,
      message: result.message,
      zraResponse: result.zraResponse,
    };
  }

  /** Pull item master updates from VSDC into local products. */
  async synchronizeItems(options = {}) {
    return itemManagementService.syncItemsFromVSDC(options.lastRequestDate || options.lastReqDt || null);
  }

  /** Suggest classification + tax type from product metadata (no VSDC call). */
  async classifyProduct(productData) {
    const classification =
      getProductClassification(productData) ||
      productData.zraClassification ||
      productData.category ||
      null;
    const taxType = productData.taxType || 'A';

    return {
      success: !!classification,
      classification,
      taxType,
      vatApplicable: taxType === 'A',
      vatRate: taxType === 'A' ? 16.0 : 0.0,
      error: classification ? undefined : 'No ZRA classification available',
    };
  }

  validateItemForZRA(itemData) {
    const errors = validateRegistrationFields(itemData);
    const warnings = [];
    if (!itemData.barcode) warnings.push('Barcode recommended for inventory tracking');
    return { isValid: errors.length === 0, errors, warnings };
  }

  async getItemStatus(itemIdentifier) {
    try {
      const product = await prisma.product.findFirst({
        where: {
          OR: [{ id: itemIdentifier }, { sku: itemIdentifier }, { barcode: itemIdentifier }],
        },
      });

      if (!product) {
        return { found: false, message: 'Item not found' };
      }

      return {
        found: true,
        product,
        zraRegistered: isProductRegistered(product),
        registrationStatus: product.zraRegistrationStatus,
        registeredAt: product.zraRegisteredAt,
        classification: getProductClassification(product),
        taxType: product.taxType,
      };
    } catch (error) {
      return { found: false, error: error.message };
    }
  }

  /** @deprecated Use productToVsdcPayload from lib/productRegistration.js */
  toVsdcPayload(product) {
    return productToVsdcPayload(product);
  }
}

module.exports = new ItemClassificationService();
