/**
 * VSDC item registration helpers (Section 6.1).
 */

const prisma = require('./prisma');
const {
  getProductClassification,
  markRegistrationFailed,
  markRegistrationSuccess,
} = require('./productRegistrationState');

const VAT_TO_TAX_TYPE = {
  STANDARD: 'A',
  ZERO_RATED: 'B',
  EXEMPT: 'C',
};

function isRegistrationStrict() {
  return process.env.ZRA_REGISTRATION_STRICT !== 'false';
}

function isProductRegistered(product) {
  return product?.zraRegistrationStatus === 'REGISTERED';
}

function productToVsdcPayload(product) {
  const classification = getProductClassification(product);
  const taxType =
    product.taxType ||
    VAT_TO_TAX_TYPE[product.vatCategoryCode] ||
    VAT_TO_TAX_TYPE.STANDARD;

  return {
    id: product.id,
    name: product.name,
    description: product.description,
    price: product.price,
    sku: product.sku,
    barcode: product.barcode,
    isActive: product.isActive,
    zraItemClassification: classification,
    zraClassificationCode: classification,
    zraPackageUnit: product.zraPackageUnit || product.unit || 'EA',
    zraQuantityUnit: product.zraQuantityUnit || product.unit || 'EA',
    taxType,
    minStock: product.minStockLevel ?? 0,
  };
}

function validateRegistrationFields(product) {
  const errors = [];
  if (!product.sku) errors.push('SKU is required for VSDC registration');
  if (!getProductClassification(product)) {
    errors.push('ZRA classification code is required for VSDC registration');
  }
  if (!product.zraPackageUnit && !product.unit) {
    errors.push('Package unit is required for VSDC registration');
  }
  if (!product.zraQuantityUnit && !product.unit) {
    errors.push('Quantity unit is required for VSDC registration');
  }
  return errors;
}

async function registerProductWithVsdc(productId) {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: { category: true },
  });

  if (!product) {
    return { success: false, error: 'Product not found', code: 'PRODUCT_NOT_FOUND' };
  }

  const fieldErrors = validateRegistrationFields(product);
  if (fieldErrors.length > 0) {
    const message = fieldErrors.join('; ');
    await markRegistrationFailed(productId, message);
    return { success: false, error: message, code: 'REGISTRATION_VALIDATION_FAILED' };
  }

  const itemManagementService = require('../services/itemManagement');
  const result = await itemManagementService.saveItemToVSDC(productToVsdcPayload(product));

  if (result.success) {
    return {
      success: true,
      status: 'REGISTERED',
      itemCode: result.itemCode,
      zraResponse: result.zraResponse,
    };
  }

  await markRegistrationFailed(productId, result.error || 'VSDC item save failed');
  return {
    success: false,
    status: 'FAILED',
    error: result.error,
    code: result.code || 'ITEM_SAVE_FAILED',
  };
}

async function assertRegisteredProducts(items, prismaClient = prisma) {
  if (!Array.isArray(items) || items.length === 0) return;

  const unregistered = [];

  for (const item of items) {
    const product = await prismaClient.product.findUnique({
      where: { id: item.productId },
      select: {
        id: true,
        name: true,
        sku: true,
        zraRegistrationStatus: true,
      },
    });

    if (!product || !isProductRegistered(product)) {
      unregistered.push(product?.sku || product?.name || item.productId);
    }
  }

  if (unregistered.length > 0) {
    const err = new Error(
      `Cannot checkout: the following items are not registered with ZRA VSDC: ${unregistered.join(', ')}`
    );
    err.status = 409;
    err.code = 'PRODUCTS_NOT_REGISTERED';
    err.unregistered = unregistered;
    throw err;
  }
}

module.exports = {
  isRegistrationStrict,
  isProductRegistered,
  getProductClassification,
  productToVsdcPayload,
  validateRegistrationFields,
  registerProductWithVsdc,
  assertRegisteredProducts,
  markRegistrationFailed,
  markRegistrationSuccess,
};
