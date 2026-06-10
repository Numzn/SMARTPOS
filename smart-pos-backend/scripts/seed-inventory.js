/**
 * Idempotent inventory seed for existing databases.
 * Usage: node scripts/seed-inventory.js
 */
const { PrismaClient } = require('@prisma/client');
const { getOrCreateInventory } = require('../lib/inventoryStock');

const prisma = new PrismaClient();
const BRANCH = 'main';

const PRODUCT_SEEDS = [
  {
    sku: 'COKE500',
    name: 'Coca Cola 500ml',
    description: 'Refreshing cola drink',
    price: 2.5,
    cost: 1.5,
    barcode: '123456789012',
    category: 'Beverages',
    zraClassificationCode: 'BVRG001',
    minStockLevel: 10,
    qty: 150,
  },
  {
    sku: 'MILK1L',
    name: 'Fresh Milk 1L',
    description: 'Fresh whole milk',
    price: 4.5,
    cost: 3,
    barcode: '123456789014',
    category: 'Dairy',
    zraClassificationCode: 'DARY001',
    minStockLevel: 8,
    hasExpiry: true,
    shelfLifeDays: 7,
    qty: 50,
  },
  {
    sku: 'BREAD01',
    name: 'Bread Loaf',
    description: 'Fresh white bread loaf',
    price: 5,
    cost: 3,
    barcode: '123456789015',
    category: 'Bakery',
    zraClassificationCode: 'BAKY001',
    minStockLevel: 5,
    qty: 80,
  },
  {
    sku: 'SUGAR1K',
    name: 'Sugar 1kg',
    description: 'White granulated sugar',
    price: 12,
    cost: 9,
    barcode: '123456789016',
    category: 'Grocery',
    zraClassificationCode: 'GROC001',
    minStockLevel: 5,
    qty: 40,
  },
  {
    sku: 'OIL2L',
    name: 'Cooking Oil 2L',
    description: 'Vegetable cooking oil',
    price: 35,
    cost: 28,
    barcode: '123456789017',
    category: 'Grocery',
    zraClassificationCode: 'GROC002',
    minStockLevel: 3,
    qty: 25,
  },
  {
    sku: 'LAYS001',
    name: 'Lays Chips Original',
    description: 'Classic potato chips',
    price: 3,
    cost: 2,
    barcode: '123456789013',
    category: 'Snacks',
    zraClassificationCode: 'SNCK001',
    minStockLevel: 5,
    qty: 50,
  },
];

async function ensureCategory(name, description) {
  const existing = await prisma.category.findFirst({ where: { name } });
  if (existing) return existing;
  return prisma.category.create({ data: { name, description } });
}

async function upsertProduct(seed, categoryId) {
  return prisma.product.upsert({
    where: { sku: seed.sku },
    update: {
      name: seed.name,
      price: seed.price,
      cost: seed.cost,
      zraClassificationCode: seed.zraClassificationCode,
      zraItemClassification: seed.zraClassificationCode,
      zraPackageUnit: 'EA',
      zraQuantityUnit: 'EA',
      unit: 'EA',
      minStockLevel: seed.minStockLevel,
    },
    create: {
      name: seed.name,
      description: seed.description,
      price: seed.price,
      cost: seed.cost,
      sku: seed.sku,
      barcode: seed.barcode,
      categoryId,
      minStockLevel: seed.minStockLevel,
      taxRate: 16,
      vatCategoryCode: 'STANDARD',
      zraClassificationCode: seed.zraClassificationCode,
      zraItemClassification: seed.zraClassificationCode,
      zraPackageUnit: 'EA',
      zraQuantityUnit: 'EA',
      unit: 'EA',
      hasExpiry: seed.hasExpiry || false,
      shelfLifeDays: seed.shelfLifeDays || null,
    },
  });
}

async function setInventoryStock(productId, qty, unitCost) {
  await prisma.$transaction(async (tx) => {
    const inventory = await getOrCreateInventory(tx, productId, BRANCH);
    const cost = unitCost || inventory.averageCost || 0;

    await tx.inventory.update({
      where: { id: inventory.id },
      data: {
        currentStock: qty,
        averageCost: cost,
        lastCost: cost,
        totalValue: qty * cost,
        lowStockAlert: qty <= inventory.reorderPoint,
        lastStockedDate: new Date(),
      },
    });

    const existingBatch = await tx.inventoryBatch.findFirst({
      where: { productId, inventoryId: inventory.id },
    });

    if (existingBatch) {
      await tx.inventoryBatch.update({
        where: { id: existingBatch.id },
        data: {
          quantity: qty,
          unitCost: cost,
          totalCost: qty * cost,
          costPrice: cost,
          sellingPrice: cost * 1.2,
          status: 'ACTIVE',
        },
      });
      await tx.inventoryBatch.updateMany({
        where: {
          productId,
          inventoryId: inventory.id,
          id: { not: existingBatch.id },
          status: 'ACTIVE',
        },
        data: { quantity: 0, status: 'SOLD_OUT' },
      });
    } else {
      await tx.inventoryBatch.create({
        data: {
          inventoryId: inventory.id,
          productId,
          batchNumber: `SEED-${Date.now()}`,
          quantity: qty,
          unitCost: cost,
          totalCost: qty * cost,
          costPrice: cost,
          sellingPrice: cost * 1.2,
          status: 'ACTIVE',
        },
      });
    }
  });
}

async function main() {
  console.log('📦 Seeding inventory (idempotent)...');

  const categoryCache = {};
  for (const seed of PRODUCT_SEEDS) {
    if (!categoryCache[seed.category]) {
      categoryCache[seed.category] = await ensureCategory(
        seed.category,
        `${seed.category} products`
      );
    }

    const product = await upsertProduct(seed, categoryCache[seed.category].id);
    await setInventoryStock(product.id, seed.qty, seed.cost);
    console.log(`  ✓ ${seed.sku}: ${seed.qty} units`);
  }

  console.log('✅ Inventory seed complete');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
