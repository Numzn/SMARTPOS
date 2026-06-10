const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { authenticateToken, requirePermission, optionalAuth } = require('../middleware/auth');
const { resolveProductStock, DEFAULT_BRANCH } = require('../lib/productStockView');
const {
  registerProductWithVsdc,
  isRegistrationStrict,
  validateRegistrationFields,
} = require('../lib/productRegistration');

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
router.get('/', optionalAuth, async (req, res) => {
  try {
    const branchId = req.query.branchId || DEFAULT_BRANCH;

    const products = await prisma.product.findMany({
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
    });

    const productsWithInventory = products.map((product) => {
      const stockView = resolveProductStock(product, branchId);
      return {
        ...product,
        totalQuantity: stockView.totalQuantity,
        stock: stockView.stock,
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
  console.log('🚀 POST /products route hit!');
  console.log('🔐 User:', req.user);
  console.log('🛍️ Request body:', JSON.stringify(req.body, null, 2));
  
  try {
    console.log('🛍️ Creating product with data:', JSON.stringify(req.body, null, 2));
    
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
          zraPackageUnit: req.body.zraPackageUnit || 'EA',
          zraQuantityUnit: req.body.zraQuantityUnit || 'EA',
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
        zraPackageUnit: req.body.zraPackageUnit || existingProduct.zraPackageUnit || 'EA',
        zraQuantityUnit: req.body.zraQuantityUnit || existingProduct.zraQuantityUnit || 'EA',
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
      
      // Finally delete the product
      await tx.product.delete({
        where: { id }
      });
    });
    
    console.log('✅ Product deleted successfully:', id);
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

module.exports = router;
