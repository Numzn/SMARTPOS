const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { authenticateToken, requirePermission, optionalAuth } = require('../middleware/auth');
const auditService = require('../services/auditService');
const { resolveProductStock, DEFAULT_BRANCH } = require('../lib/productStockView');
const { planProductImport, applyProductImport, exportProductsCsv } = require('../lib/productImport');
const {
  registerProductWithVsdc,
  isRegistrationStrict,
  validateRegistrationFields,
} = require('../lib/productRegistration');
const zraCodesService = require('../services/zraCodesService');
const itemCompositionService = require('../services/itemCompositionService');

// Rejects a classification code that isn't a known, currently-usable
// ZraClassificationCode row (i.e. it was never synced, or ZRA has since
// marked it useYn='N'). Closes the free-text gap: the ClassificationPicker
// UI only ever emits codes it got from the synced table, but the API is the
// real enforcement boundary — any direct caller must be held to the same rule.
async function assertUsableClassificationCode(code) {
  if (!code) return null;
  const usable = await zraCodesService.isUsableClassificationCode(code);
  if (!usable) {
    return `'${code}' is not a valid, ZRA-synced classification code. Choose one from the classification picker.`;
  }
  return null;
}

// taxType/zraPackageUnit/zraQuantityUnit are, deliberately, NOT required —
// unlike classification code, forcing these on every save would break the
// 200+ existing products created before this UI existed (confirmed live:
// virtually all have these fields unset and rely on registration-time
// default resolution, which stays intact — see zraCodesService.js
// resolveDefaultCode/getDefaultTaxTypeCode/getDefaultUnitCode). But if a
// value IS submitted, it must be a real, currently-synced code for the
// right class — the API is the enforcement boundary, independent of
// whichever selector (or a direct API call) sent it.
async function assertUsableStandardCode(codeType, code, label) {
  if (!code) return null;
  const usable = await zraCodesService.isUsableStandardCode(codeType, code);
  if (!usable) {
    return `'${code}' is not a valid, ZRA-synced ${label}.`;
  }
  return null;
}

async function assertProductZraCodes({ zraClassificationCode, taxType, zraPackageUnit, zraQuantityUnit }) {
  const errors = (
    await Promise.all([
      assertUsableClassificationCode(zraClassificationCode),
      assertUsableStandardCode('TAX_TYPES', taxType, 'tax type'),
      assertUsableStandardCode('PACKAGING_UNITS', zraPackageUnit, 'package unit'),
      assertUsableStandardCode('UNIT_OF_MEASURE', zraQuantityUnit, 'quantity unit'),
    ])
  ).filter(Boolean);
  return errors;
}

async function registerAfterSave(productId) {
  const registration = await registerProductWithVsdc(productId);
  if (!registration.success && isRegistrationStrict()) {
    const err = new Error(registration.error || 'VSDC item registration failed');
    err.status = 502;
    err.registration = registration;
    throw err;
  }
  return registration;
}

// Get all products with category info (public endpoint with optional auth for enhanced features)
/**
 * Search and pagination are opt-in.
 *
 * The cashier grid fetches the whole catalogue once and filters client-side,
 * which is right for a till you browse. Paginating by default would silently
 * truncate it to the first page mid-service, so `?q=`, `?page=` and `?limit=`
 * only take effect when explicitly asked for, and the response stays a plain
 * array either way. Callers that need server-side search can adopt it without
 * anything else changing.
 */
router.get('/', optionalAuth, async (req, res) => {
  try {
    const branchId = req.query.branchId || DEFAULT_BRANCH;

    const where = { };
    if (req.query.q) {
      const q = String(req.query.q);
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { sku: { contains: q, mode: 'insensitive' } },
        { barcode: { contains: q } },
        { brand: { contains: q, mode: 'insensitive' } },
      ];
    }

    // Only paginate when asked. No default limit — see the note above.
    const hasPaging = req.query.page != null || req.query.limit != null;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 50));

    const products = await prisma.product.findMany({
      where,
      include: {
        category: true,
        inventory: { where: { branchId } },
        InventoryItem: {
          select: {
            quantity: true,
            expiryDate: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      ...(hasPaging ? { skip: (page - 1) * limit, take: limit } : {}),
    });

    if (hasPaging) {
      // Surfaced in a header rather than wrapping the body, so the response
      // stays the same array shape every existing caller already expects.
      res.setHeader('X-Total-Count', String(await prisma.product.count({ where })));
    }

    const productsWithInventory = products.map((product) => {
      const stockView = resolveProductStock(product, branchId);
      return {
        ...product,
        totalQuantity: stockView.totalQuantity,
        stock: stockView.stock,
        // On-hand and reserved alongside the sellable figure, so inventory
        // screens can show "12 on hand, 9 reserved, 3 sellable" rather than a
        // single number that means different things in different places.
        currentStock: stockView.currentStock,
        reservedStock: stockView.reservedStock,
        availableStock: stockView.availableStock,
        hasExpiredItems: stockView.hasExpiredItems,
        hasNearExpiryItems: stockView.hasNearExpiryItems,
        lowStockAlert: stockView.lowStockAlert,
      };
    });

    res.json(productsWithInventory);
  } catch (error) {
    console.error('Error fetching products:', error);
    res.status(500).json({ error: 'Failed to fetch products' });
  }
});


/**
 * GET /api/products/export — the catalogue as CSV, in exactly the shape the
 * importer accepts so an export can be edited and fed straight back in.
 */
router.get('/export', authenticateToken, requirePermission('products:read'), async (req, res) => {
  try {
    const csv = await exportProductsCsv();
    const filename = `products_${new Date().toISOString().slice(0, 10)}.csv`;

    auditService.safeLog(auditService.eventTypes.DATA_EXPORT, {
      ...auditService.contextFromReq(req),
      entityType: 'PRODUCT',
      action: 'EXPORT_PRODUCTS_CSV',
      description: `Exported the product catalogue to CSV (${filename})`,
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(csv);
  } catch (error) {
    console.error('Error exporting products:', error.message);
    return res.status(error.status || 500).json({ error: error.message || 'Failed to export products' });
  }
});

/**
 * POST /api/products/import — body { csv, commit }.
 *
 * Without commit it only plans: every row validated and classified
 * create/update/error, nothing written. With commit it applies, and refuses
 * the whole file if any row is invalid. Import can rewrite the catalogue a
 * till is actively selling from, so it is preview-first by default.
 */
router.post('/import', authenticateToken, requirePermission('products:write'), async (req, res) => {
  try {
    const { csv, commit, createMissingCategories } = req.body || {};
    if (typeof csv !== 'string' || !csv.trim()) {
      return res.status(400).json({ error: 'No CSV content was provided' });
    }

    if (!commit) {
      return res.json({
        dryRun: true,
        ...(await planProductImport(csv, { createMissingCategories })),
      });
    }

    const result = await applyProductImport(csv, { createMissingCategories });

    auditService.safeLog(auditService.eventTypes.PRODUCT_CREATE, {
      ...auditService.contextFromReq(req),
      entityType: 'PRODUCT',
      action: 'IMPORT_PRODUCTS_CSV',
      newValues: result,
      description: `Imported products from CSV: ${result.created} created, ${result.updated} updated, ` +
        `${result.registration.registered} registered, ${result.registration.failed} registration failure(s), ` +
        `${result.registration.skippedNoCode} without a classification code`,
    });

    return res.json({ dryRun: false, ...result });
  } catch (error) {
    console.error('Error importing products:', error.message);
    return res
      .status(error.status || 500)
      .json({ error: error.message || 'Failed to import products', plan: error.plan });
  }
});

/**
 * POST /api/products/bulk-register — best-effort ZRA registration for every
 * product still stuck at PENDING/FAILED that already has a classification
 * code (from a CSV import or a manual edit). Sequential, capped by `limit`
 * so one call has a bounded worst-case duration — call again to keep
 * working through a large backlog (see `remaining` in the response).
 * Products with no classification code at all are reported, not silently
 * skipped, so the caller knows exactly what still needs fixing.
 */
router.post('/bulk-register', authenticateToken, requirePermission('products:write'), async (req, res) => {
  try {
    const limit = Math.min(500, Math.max(1, parseInt(req.body?.limit, 10) || 200));

    const candidates = await prisma.product.findMany({
      where: { zraRegistrationStatus: { in: ['PENDING', 'FAILED'] } },
      select: { id: true, sku: true, name: true, zraClassificationCode: true, zraItemClassification: true },
      orderBy: { updatedAt: 'asc' },
    });

    const withCode = candidates.filter((p) => p.zraItemClassification || p.zraClassificationCode);
    const noCode = candidates.filter((p) => !p.zraItemClassification && !p.zraClassificationCode);
    const toAttempt = withCode.slice(0, limit);
    const remaining = Math.max(0, withCode.length - toAttempt.length);

    const results = [];
    let registered = 0;
    let failed = 0;
    for (const product of toAttempt) {
      const outcome = await registerProductWithVsdc(product.id);
      if (outcome.success) {
        registered += 1;
        results.push({ productId: product.id, sku: product.sku, name: product.name, status: 'REGISTERED' });
      } else {
        failed += 1;
        results.push({
          productId: product.id,
          sku: product.sku,
          name: product.name,
          status: 'FAILED',
          error: outcome.error,
        });
      }
      // Small pacing delay between calls — matches the existing bulkSaveItems
      // precedent (services/itemManagement.js) so a large batch doesn't
      // hammer VSDC back-to-back.
      if (toAttempt.length > 1) await new Promise((r) => setTimeout(r, 150));
    }

    const response = {
      attempted: toAttempt.length,
      registered,
      failed,
      skippedNoCode: noCode.length,
      remaining,
      results,
      noCodeProducts: noCode.slice(0, 50).map((p) => ({ id: p.id, sku: p.sku, name: p.name })),
    };

    auditService.safeLog(auditService.eventTypes.PRODUCT_BULK_REGISTER, {
      ...auditService.contextFromReq(req),
      entityType: 'PRODUCT',
      action: 'BULK_REGISTER',
      newValues: { attempted: toAttempt.length, registered, failed, skippedNoCode: noCode.length },
      description: `Bulk-registered pending products: ${registered} registered, ${failed} failed, ${noCode.length} skipped (no classification code)`,
    });

    return res.json(response);
  } catch (error) {
    console.error('Error bulk-registering products:', error.message);
    return res.status(500).json({ error: error.message || 'Bulk registration failed' });
  }
});

// Get product by ID (public with optional auth)
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const branchId = req.query.branchId || DEFAULT_BRANCH;

    const product = await prisma.product.findUnique({
      where: { id: req.params.id },
      include: {
        category: true,
        inventory: { where: { branchId } },
        InventoryItem: {
          select: {
            quantity: true,
            expiryDate: true,
            batchNumber: true,
            costPrice: true,
            sellingPrice: true,
          },
        },
      },
    });

    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const stockView = resolveProductStock(product, branchId);

    const productWithInventory = {
      ...product,
      totalQuantity: stockView.totalQuantity,
      stock: stockView.stock,
      currentStock: stockView.currentStock,
      reservedStock: stockView.reservedStock,
      availableStock: stockView.availableStock,
      hasExpiredItems: stockView.hasExpiredItems,
      hasNearExpiryItems: stockView.hasNearExpiryItems,
      lowStockAlert: stockView.lowStockAlert,
    };

    res.json(productWithInventory);
  } catch (error) {
    console.error('Error fetching product:', error);
    res.status(500).json({ error: 'Failed to fetch product' });
  }
});

// Create new product
// Create new product (requires products:write permission)
router.post('/', authenticateToken, requirePermission('products:write'), async (req, res) => {
  try {
    const {
      name, 
      description, 
      price, 
      cost, 
      sku, 
      barcode, 
      categoryId,
      taxRate,
      isActive,
      // ZRA Compliance fields
      vatCategoryCode,
      zraClassificationCode,
      taxType,
      exciseTaxCode,
      hasExpiry,
      shelfLifeDays,
      // Initial inventory (optional)
      initialQuantity,
      minStockLevel
    } = req.body;

    // Validation
    if (!name || !sku || !price || !categoryId) {
      return res.status(400).json({ 
        error: 'Missing required fields: name, sku, price, and category are required' 
      });
    }

    if (parseFloat(price) <= 0) {
      return res.status(400).json({ 
        error: 'Price must be greater than 0' 
      });
    }

    if (cost && parseFloat(cost) < 0) {
      return res.status(400).json({ 
        error: 'Cost cannot be negative' 
      });
    }

    if (hasExpiry && (!shelfLifeDays || parseInt(shelfLifeDays) <= 0)) {
      return res.status(400).json({ 
        error: 'Shelf life days is required and must be greater than 0 when product has expiry' 
      });
    }

    const draftProduct = {
      sku: sku.trim().toUpperCase(),
      zraClassificationCode: zraClassificationCode?.trim() || null,
      zraItemClassification: zraClassificationCode?.trim() || null,
      zraPackageUnit: req.body.zraPackageUnit || 'EA',
      zraQuantityUnit: req.body.zraQuantityUnit || 'EA',
      unit: req.body.unit || 'EA',
      vatCategoryCode: vatCategoryCode || 'STANDARD',
    };
    const regErrors = validateRegistrationFields(draftProduct);
    if (regErrors.length > 0 && isRegistrationStrict()) {
      return res.status(400).json({
        error: 'Product cannot be saved without VSDC registration fields',
        details: regErrors,
      });
    }

    // Validity-if-present, not required — see assertUsableStandardCode's
    // comment for why taxType/zraPackageUnit/zraQuantityUnit aren't forced.
    // Checked against what was actually submitted, not draftProduct's
    // padded-with-'EA' copy above (that padding exists only to satisfy the
    // pre-existing presence check and must not be validated as if the user
    // chose it).
    const zraCodeErrors = await assertProductZraCodes({
      zraClassificationCode: draftProduct.zraClassificationCode,
      taxType: taxType || null,
      zraPackageUnit: req.body.zraPackageUnit?.trim() || null,
      zraQuantityUnit: req.body.zraQuantityUnit?.trim() || null,
    });
    if (zraCodeErrors.length > 0 && isRegistrationStrict()) {
      return res.status(400).json({
        error: zraCodeErrors.join('; '),
        details: zraCodeErrors,
        code: 'INVALID_ZRA_CODE',
      });
    }

    // Check if SKU is unique
    const existingSku = await prisma.product.findUnique({
      where: { sku }
    });

    if (existingSku) {
      return res.status(400).json({ 
        error: 'SKU already exists. Please use a unique SKU.' 
      });
    }

    // Create product in a transaction to handle inventory
    const result = await prisma.$transaction(async (tx) => {
      // Create the product
      const product = await tx.product.create({
        data: {
          name: name.trim(),
          description: description?.trim() || null,
          price: parseFloat(price),
          cost: cost ? parseFloat(cost) : null,
          sku: sku.trim().toUpperCase(),
          barcode: barcode?.trim() || null,
          categoryId,
          taxRate: taxRate ? parseFloat(taxRate) : 0,
          isActive: isActive !== false, // Default to true
          // ZRA Compliance
          vatCategoryCode: vatCategoryCode || 'STANDARD',
          zraClassificationCode: zraClassificationCode?.trim() || null,
          zraItemClassification: zraClassificationCode?.trim() || null,
          // No hardcoded 'EA' fallback here (unlike the generic `unit` field
          // below, which is a separate, pre-existing concept) — a ZRA
          // package/quantity unit the user never chose should stay null,
          // not silently claim 'EA' was confirmed. Registration-time
          // resolution (zraCodesService.resolveDefaultCode) still supplies
          // a real synced default when these are null; see item 2*/8* in
          // zra-self-checklist.md.
          zraPackageUnit: req.body.zraPackageUnit?.trim() || null,
          zraQuantityUnit: req.body.zraQuantityUnit?.trim() || null,
          taxType: taxType || null,
          unit: req.body.unit || 'EA',
          exciseTaxCode: exciseTaxCode?.trim() || null,
          hasExpiry: hasExpiry || false,
          shelfLifeDays: hasExpiry && shelfLifeDays ? parseInt(shelfLifeDays) : null,
          // Inventory
          minStockLevel: minStockLevel ? parseInt(minStockLevel) : 0
        },
        include: {
          category: true,
          InventoryItem: true
        }
      });

      // 🔥 ALWAYS create inventory record for new products
      const inventory = await tx.inventory.create({
        data: {
          productId: product.id,
          branchId: 'main',
          currentStock: initialQuantity ? parseInt(initialQuantity) : 0,
          minimumStock: minStockLevel ? parseInt(minStockLevel) : 10,
          maximumStock: 1000,
          reorderPoint: minStockLevel ? parseInt(minStockLevel) : 10,
          reorderQuantity: 100,
          averageCost: cost ? parseFloat(cost) : parseFloat(price),
          lastCost: cost ? parseFloat(cost) : parseFloat(price),
          totalValue: (initialQuantity ? parseInt(initialQuantity) : 0) * (cost ? parseFloat(cost) : parseFloat(price)),
          lowStockAlert: (initialQuantity ? parseInt(initialQuantity) : 0) <= (minStockLevel ? parseInt(minStockLevel) : 10),
          excessStockAlert: false
        }
      });

      // Create initial inventory batch if specified
      if (initialQuantity && parseInt(initialQuantity) > 0) {
        const batchQuantity = parseInt(initialQuantity);
        const batchUnitCost = cost ? parseFloat(cost) : parseFloat(price);
        await tx.inventoryBatch.create({
          data: {
            inventoryId: inventory.id,
            productId: product.id,
            quantity: batchQuantity,
            unitCost: batchUnitCost,
            totalCost: batchUnitCost * batchQuantity,
            costPrice: batchUnitCost,
            sellingPrice: parseFloat(price),
            supplier: 'Initial Stock',
            batchNumber: `INIT-${product.sku}-${Date.now()}`,
            expiryDate: hasExpiry && shelfLifeDays ? 
              new Date(Date.now() + parseInt(shelfLifeDays) * 24 * 60 * 60 * 1000) : 
              null
          }
        });
      }

      return { product, inventory };
    });

    let registration;
    try {
      registration = await registerAfterSave(result.product.id);
    } catch (regErr) {
      await prisma.product.delete({ where: { id: result.product.id } }).catch(() => {});
      return res.status(regErr.status || 502).json({
        error: regErr.message,
        registration: regErr.registration,
      });
    }

    const productWithReg = await prisma.product.findUnique({
      where: { id: result.product.id },
      include: { category: true, InventoryItem: true },
    });

    auditService.safeLog(auditService.eventTypes.PRODUCT_CREATE, {
      ...auditService.contextFromReq(req),
      entityType: 'PRODUCT',
      entityId: productWithReg.id,
      action: 'CREATE',
      newValues: { name: productWithReg.name, sku: productWithReg.sku, price: productWithReg.price },
      description: `Product created: ${productWithReg.name} (${productWithReg.sku})`,
    });

    res.status(201).json({
      product: productWithReg,
      inventory: result.inventory,
      registration,
      message: 'Product created successfully',
    });

  } catch (error) {
    console.error('❌ Error creating product:', error);
    console.error('Error details:', {
      message: error.message,
      code: error.code,
      meta: error.meta,
      stack: error.stack
    });
    
    if (error.code === 'P2002') {
      return res.status(400).json({ 
        error: 'A product with this SKU already exists' 
      });
    }
    
    if (error.code === 'P2022') {
      return res.status(400).json({ 
        error: `Database field error: ${error.meta?.column || 'unknown column'} doesn't exist` 
      });
    }
    
    res.status(500).json({ 
      error: 'Failed to create product. Please try again.' 
    });
  }
});

// Update product
// Update product (requires products:write permission)
router.put('/:id', authenticateToken, requirePermission('products:write'), async (req, res) => {
  try {
    const { 
      name, 
      description, 
      price, 
      cost, 
      sku, 
      barcode, 
      categoryId,
      taxRate,
      isActive,
      // ZRA Compliance fields
      vatCategoryCode,
      zraClassificationCode,
      taxType,
      exciseTaxCode,
      hasExpiry,
      shelfLifeDays,
      minStockLevel
    } = req.body;

    // Validation
    if (!name || !sku || !price || !categoryId) {
      return res.status(400).json({ 
        error: 'Missing required fields: name, sku, price, and category are required' 
      });
    }

    if (parseFloat(price) <= 0) {
      return res.status(400).json({ 
        error: 'Price must be greater than 0' 
      });
    }

    if (cost && parseFloat(cost) < 0) {
      return res.status(400).json({ 
        error: 'Cost cannot be negative' 
      });
    }

    if (hasExpiry && (!shelfLifeDays || parseInt(shelfLifeDays) <= 0)) {
      return res.status(400).json({
        error: 'Shelf life days is required and must be greater than 0 when product has expiry'
      });
    }

    const zraCodeErrors = await assertProductZraCodes({
      zraClassificationCode: zraClassificationCode?.trim(),
      taxType: taxType || null,
      zraPackageUnit: req.body.zraPackageUnit?.trim() || null,
      zraQuantityUnit: req.body.zraQuantityUnit?.trim() || null,
    });
    if (zraCodeErrors.length > 0 && isRegistrationStrict()) {
      return res.status(400).json({
        error: zraCodeErrors.join('; '),
        details: zraCodeErrors,
        code: 'INVALID_ZRA_CODE',
      });
    }

    // Check if SKU is unique (excluding current product)
    const existingSku = await prisma.product.findFirst({
      where: { 
        sku: sku.trim().toUpperCase(),
        NOT: { id: req.params.id }
      }
    });

    if (existingSku) {
      return res.status(400).json({ 
        error: 'SKU already exists. Please use a unique SKU.' 
      });
    }

    // Check if product exists
    const existingProduct = await prisma.product.findUnique({
      where: { id: req.params.id }
    });

    if (!existingProduct) {
      return res.status(404).json({ 
        error: 'Product not found' 
      });
    }

    const updatedProduct = await prisma.product.update({
      where: { id: req.params.id },
      data: {
        name: name.trim(),
        description: description?.trim() || null,
        price: parseFloat(price),
        cost: cost ? parseFloat(cost) : null,
        sku: sku.trim().toUpperCase(),
        barcode: barcode?.trim() || null,
        categoryId,
        taxRate: taxRate ? parseFloat(taxRate) : 0,
        isActive: isActive !== false,
        // ZRA Compliance
        vatCategoryCode: vatCategoryCode || 'STANDARD',
        zraClassificationCode: zraClassificationCode?.trim() || null,
        zraItemClassification: zraClassificationCode?.trim() || null,
        // No hardcoded 'EA' fallback — see the create route's comment above
        // this same field for why. Falls back to the existing stored value
        // (edit-mode preservation) and then null, never a guessed literal.
        zraPackageUnit: req.body.zraPackageUnit?.trim() || existingProduct.zraPackageUnit || null,
        zraQuantityUnit: req.body.zraQuantityUnit?.trim() || existingProduct.zraQuantityUnit || null,
        taxType: taxType || existingProduct.taxType || null,
        exciseTaxCode: exciseTaxCode?.trim() || null,
        zraRegistrationStatus: 'PENDING',
        zraRegistrationError: null,
        hasExpiry: hasExpiry || false,
        shelfLifeDays: hasExpiry && shelfLifeDays ? parseInt(shelfLifeDays) : null,
        // Inventory
        minStockLevel: minStockLevel ? parseInt(minStockLevel) : 0
      },
      include: { 
        category: true,
        InventoryItem: true
      }
    });
    
    let registration;
    try {
      registration = await registerAfterSave(updatedProduct.id);
    } catch (regErr) {
      return res.status(regErr.status || 502).json({
        error: regErr.message,
        product: updatedProduct,
        registration: regErr.registration,
      });
    }

    const productWithReg = await prisma.product.findUnique({
      where: { id: updatedProduct.id },
      include: { category: true, InventoryItem: true },
    });

    auditService.safeLog(auditService.eventTypes.PRODUCT_UPDATE, {
      ...auditService.contextFromReq(req),
      entityType: 'PRODUCT',
      entityId: productWithReg.id,
      action: 'UPDATE',
      oldValues: { name: existingProduct.name, price: existingProduct.price, sku: existingProduct.sku },
      newValues: { name: productWithReg.name, price: productWithReg.price, sku: productWithReg.sku },
      description: `Product updated: ${productWithReg.name} (${productWithReg.sku})`,
    });

    res.json({
      ...productWithReg,
      registration,
      message: 'Product updated successfully',
    });

  } catch (error) {
    console.error('Error updating product:', error);
    
    if (error.code === 'P2002') {
      return res.status(400).json({ 
        error: 'A product with this SKU already exists' 
      });
    }
    
    if (error.code === 'P2025') {
      return res.status(404).json({ 
        error: 'Product not found' 
      });
    }
    
    res.status(500).json({ 
      error: 'Failed to update product. Please try again.' 
    });
  }
});

// Delete product
// Delete product (requires products:delete permission)
router.delete('/:id', authenticateToken, requirePermission('products:delete'), async (req, res) => {
  try {
    const { id } = req.params;
    
    console.log('🗑️ Attempting to delete product:', id);
    
    // Check if product exists
    const product = await prisma.product.findUnique({
      where: { id },
      include: {
        inventory: true,
        saleItems: true,
        InventoryItem: true,
        stockMovements: true
      }
    });
    
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }
    
    // Check if product has any sales history
    if (product.saleItems && product.saleItems.length > 0) {
      return res.status(400).json({ 
        error: 'Cannot delete product with sales history. Consider marking it as inactive instead.' 
      });
    }
    
    // Delete in transaction to handle foreign key constraints
    await prisma.$transaction(async (tx) => {
      // Delete related inventory batches first
      if (product.InventoryItem && product.InventoryItem.length > 0) {
        await tx.inventoryBatch.deleteMany({
          where: { productId: id }
        });
      }
      
      // Delete inventory records
      if (product.inventory && product.inventory.length > 0) {
        await tx.inventory.deleteMany({
          where: { productId: id }
        });
      }
      
      // Delete stock movements
      if (product.stockMovements && product.stockMovements.length > 0) {
        await tx.stockMovement.deleteMany({
          where: { productId: id }
        });
      }
      
      // Delete stock adjustments
      await tx.stockAdjustment.deleteMany({
        where: { productId: id }
      });

      // Delete composition rows on both sides — this product may be a
      // finished product with its own components, or a component used in
      // someone else's composition (no VSDC delete call exists for this;
      // see itemCompositionService.js).
      await tx.productComposition.deleteMany({
        where: { OR: [{ parentProductId: id }, { componentProductId: id }] }
      });

      // Finally delete the product
      await tx.product.delete({
        where: { id }
      });
    });
    
    console.log('✅ Product deleted successfully:', id);
    auditService.safeLog(auditService.eventTypes.PRODUCT_DELETE, {
      ...auditService.contextFromReq(req),
      entityType: 'PRODUCT',
      entityId: id,
      action: 'DELETE',
      oldValues: { name: product.name, sku: product.sku },
      description: `Product deleted: ${product.name} (${product.sku})`,
    });
    res.json({ message: 'Product deleted successfully' });
  } catch (error) {
    console.error('❌ Error deleting product:', error);
    console.error('Error details:', {
      message: error.message,
      code: error.code,
      meta: error.meta,
      stack: error.stack
    });
    
    // Check for specific Prisma errors
    if (error.code === 'P2003') {
      res.status(400).json({ 
        error: 'Cannot delete product due to existing references. Please remove related records first.' 
      });
    } else if (error.code === 'P2025') {
      res.status(404).json({ error: 'Product not found' });
    } else {
      res.status(500).json({ 
        error: 'Failed to delete product',
        details: error.message 
      });
    }
  }
});

// Search products
router.get('/search/:query', async (req, res) => {
  try {
    const { query } = req.params;
    
    const products = await prisma.product.findMany({
      where: {
        OR: [
          { name: { contains: query, mode: 'insensitive' } },
          { description: { contains: query, mode: 'insensitive' } },
          { sku: { contains: query, mode: 'insensitive' } },
          { barcode: { contains: query, mode: 'insensitive' } }
        ]
      },
      include: { category: true }
    });
    
    res.json(products);
  } catch (error) {
    console.error('Error searching products:', error);
    res.status(500).json({ error: 'Failed to search products' });
  }
});

// Item Composition (VSDC Section 6.5, item 9* — OPTIONAL per spec).
// Sub-resource of a specific product: "what is product :id made of".
router.get('/:id/composition', authenticateToken, requirePermission('products:read'), async (req, res) => {
  try {
    const components = await itemCompositionService.listComponents(req.params.id);
    res.json({ success: true, components });
  } catch (error) {
    console.error('Error listing item composition:', error);
    res.status(500).json({ success: false, error: 'Failed to list item composition' });
  }
});

router.post('/:id/composition', authenticateToken, requirePermission('products:write'), async (req, res) => {
  try {
    const { componentProductId, quantity } = req.body;
    if (!componentProductId || quantity === undefined || quantity === null) {
      return res.status(400).json({
        success: false,
        error: 'componentProductId and quantity are required',
        code: 'INVALID_INPUT',
      });
    }
    const component = await itemCompositionService.addComponent(req.params.id, componentProductId, quantity);
    res.status(201).json({ success: true, component });
  } catch (error) {
    console.error('Error adding item composition component:', error);
    res.status(400).json({
      success: false,
      error: error.message,
      code: 'ITEM_COMPOSITION_SAVE_FAILED',
      compositionId: error.compositionId || null,
    });
  }
});

router.delete(
  '/:id/composition/:compositionId',
  authenticateToken,
  requirePermission('products:write'),
  async (req, res) => {
    try {
      await itemCompositionService.removeComponent(req.params.compositionId);
      res.json({ success: true, message: 'Component removed' });
    } catch (error) {
      console.error('Error removing item composition component:', error);
      if (error.code === 'P2025') {
        return res.status(404).json({ success: false, error: 'Composition row not found' });
      }
      res.status(500).json({ success: false, error: 'Failed to remove component' });
    }
  }
);

module.exports = router;
