/**
 * Shared setup for integration tests: real Prisma client against a real
 * Postgres database (DATABASE_URL), same as production code — no mocking
 * of the ORM or the transaction boundaries under test.
 */

const prisma = require('../../lib/prisma');
const { ensureDefaultBranch, DEFAULT_BRANCH_CODE } = require('../../lib/ensureDefaultBranch');

let counter = 0;
function uniqueSuffix() {
  counter += 1;
  return `${Date.now()}-${counter}`;
}

async function createTestBranch() {
  return ensureDefaultBranch();
}

async function createTestUser(overrides = {}) {
  const suffix = uniqueSuffix();
  return prisma.user.create({
    data: {
      email: `test-user-${suffix}@smartpos.test`,
      name: 'Test User',
      password: 'not-a-real-hash',
      role: 'CASHIER',
      isActive: true,
      branchId: DEFAULT_BRANCH_CODE,
      ...overrides,
    },
  });
}

async function createTestCategory() {
  const suffix = uniqueSuffix();
  return prisma.category.create({
    data: { name: `Test Category ${suffix}` },
  });
}

async function createTestProduct(overrides = {}) {
  const suffix = uniqueSuffix();
  const category = overrides.categoryId ? null : await createTestCategory();
  return prisma.product.create({
    data: {
      name: `Test Product ${suffix}`,
      price: 100,
      cost: 60,
      sku: `TEST-SKU-${suffix}`,
      barcode: `TEST-BARCODE-${suffix}`,
      categoryId: overrides.categoryId || category.id,
      taxRate: 16,
      ...overrides,
    },
  });
}

async function createTestInventory(productId, { currentStock = 10, branchId = DEFAULT_BRANCH_CODE } = {}) {
  return prisma.inventory.create({
    data: {
      productId,
      branchId,
      currentStock,
      reservedStock: 0,
      averageCost: 60,
      lastCost: 60,
    },
  });
}

async function createTestBatch(productId, { quantity = 10, unitCost = 60 } = {}) {
  return prisma.inventoryBatch.create({
    data: {
      productId,
      batchNumber: `TEST-BATCH-${uniqueSuffix()}`,
      quantity,
      unitCost,
      totalCost: quantity * unitCost,
      costPrice: unitCost,
      sellingPrice: unitCost * 1.2,
      status: 'ACTIVE',
    },
  });
}

/**
 * Full product + inventory + FIFO batch fixture, ready to sell against.
 */
async function createSellableProduct({ stock = 10 } = {}) {
  const product = await createTestProduct();
  await createTestInventory(product.id, { currentStock: stock });
  await createTestBatch(product.id, { quantity: stock });
  return product;
}

async function createTestShift({ userId, branchId = DEFAULT_BRANCH_CODE, openingFloat = 0, status = 'OPEN' }) {
  return prisma.shift.create({
    data: { userId, branchId, openingFloat, status },
  });
}

async function createTestSale({
  userId,
  productId,
  quantity = 1,
  price = 100,
  status = 'PENDING',
  branchId = DEFAULT_BRANCH_CODE,
  shiftId = null,
  paymentMethod = 'CASH',
}) {
  const itemTotal = quantity * price;
  const taxAmt = itemTotal * 0.16;
  return prisma.sale.create({
    data: {
      userId,
      branchId,
      total: itemTotal + taxAmt,
      subtotal: itemTotal,
      tax: taxAmt,
      discount: 0,
      paymentMethod,
      status,
      shiftId,
      saleItems: {
        create: [
          {
            productId,
            quantity,
            price,
            total: itemTotal,
            pkg: 1,
            qty: quantity,
            prc: price,
            splyAmt: itemTotal,
            taxblAmt: itemTotal,
            taxAmt,
            totAmt: itemTotal + taxAmt,
          },
        ],
      },
    },
    include: { saleItems: true },
  });
}

/**
 * Delete everything this helper module could plausibly have created, in FK-safe
 * order. Tests call this in afterEach/afterAll — safe to run even if nothing
 * from this run exists (all deletes are scoped to the "TEST-" naming markers
 * this module uses, so it never touches real seeded data).
 */
async function cleanupTestData() {
  await prisma.stockMovement.deleteMany({ where: { product: { sku: { startsWith: 'TEST-SKU-' } } } });
  await prisma.refundItem.deleteMany({ where: { product: { sku: { startsWith: 'TEST-SKU-' } } } });
  await prisma.refund.deleteMany({ where: { originalSale: { user: { email: { contains: '@smartpos.test' } } } } });
  await prisma.saleItem.deleteMany({ where: { product: { sku: { startsWith: 'TEST-SKU-' } } } });
  await prisma.sale.deleteMany({ where: { user: { email: { contains: '@smartpos.test' } } } });
  // Matched by product, not just batchNumber prefix — restoreStockForRefund
  // creates its own "RFD-..." batches on refund, not "TEST-BATCH-" ones.
  await prisma.inventoryBatch.deleteMany({ where: { product: { sku: { startsWith: 'TEST-SKU-' } } } });
  await prisma.inventory.deleteMany({ where: { product: { sku: { startsWith: 'TEST-SKU-' } } } });
  await prisma.product.deleteMany({ where: { sku: { startsWith: 'TEST-SKU-' } } });
  await prisma.category.deleteMany({ where: { name: { startsWith: 'Test Category ' } } });
  // Shift deletion cascades to shift_cash_movements; must happen before the
  // user delete below (Shift.userId is onDelete: Restrict).
  await prisma.shift.deleteMany({ where: { user: { email: { contains: '@smartpos.test' } } } });
  await prisma.user.deleteMany({ where: { email: { contains: '@smartpos.test' } } });
}

module.exports = {
  prisma,
  createTestBranch,
  createTestUser,
  createTestCategory,
  createTestProduct,
  createTestInventory,
  createTestBatch,
  createSellableProduct,
  createTestSale,
  createTestShift,
  cleanupTestData,
  DEFAULT_BRANCH_CODE,
};
