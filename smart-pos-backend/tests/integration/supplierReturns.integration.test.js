import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import testData from '../helpers/testData.js';
import supplierReturnLib from '../../lib/supplierReturn.js';

const {
  prisma,
  createTestBranch,
  createTestUser,
  createTestSupplier,
  createSellableProduct,
  cleanupTestData,
  DEFAULT_BRANCH_CODE,
} = testData;
const { createSupplierReturn } = supplierReturnLib;

describe('Supplier returns', () => {
  beforeAll(async () => {
    await createTestBranch();
  });

  afterEach(async () => {
    await cleanupTestData();
  });

  it('decrements stock and writes a RETURN_OUT movement (first real use of that enum value)', async () => {
    const user = await createTestUser();
    const supplier = await createTestSupplier();
    const product = await createSellableProduct({ stock: 10 });

    const supplierReturn = await createSupplierReturn({
      supplierId: supplier.id,
      branchId: DEFAULT_BRANCH_CODE,
      items: [{ productId: product.id, quantity: 3 }],
      reason: 'Damaged in transit',
      userId: user.id,
    });

    expect(supplierReturn.status).toBe('COMPLETED');
    expect(supplierReturn.returnNumber).toMatch(/^SRET-\d{6}$/);

    const inventory = await prisma.inventory.findUnique({
      where: { productId_branchId: { productId: product.id, branchId: DEFAULT_BRANCH_CODE } },
    });
    expect(inventory.currentStock).toBe(7);

    const movement = await prisma.stockMovement.findFirst({
      where: { productId: product.id, movementType: 'RETURN_OUT' },
    });
    expect(movement).not.toBeNull();
    expect(movement.quantity).toBe(-3);
    expect(movement.referenceType).toBe('SUPPLIER_RETURN');
  });

  it('rejects returning more than is on hand', async () => {
    const user = await createTestUser();
    const supplier = await createTestSupplier();
    const product = await createSellableProduct({ stock: 2 });

    await expect(
      createSupplierReturn({
        supplierId: supplier.id,
        branchId: DEFAULT_BRANCH_CODE,
        items: [{ productId: product.id, quantity: 5 }],
        userId: user.id,
      })
    ).rejects.toMatchObject({ status: 409 });

    const inventory = await prisma.inventory.findUnique({
      where: { productId_branchId: { productId: product.id, branchId: DEFAULT_BRANCH_CODE } },
    });
    expect(inventory.currentStock).toBe(2); // untouched
  });

  it('consumes FIFO batches across two batches at different costs', async () => {
    const { createTestProduct, createTestInventory, createTestBatch } = testData;
    const user = await createTestUser();
    const supplier = await createTestSupplier();
    const product = await createTestProduct();
    // Inventory.currentStock is the source of truth availableUnits() checks
    // against — must reflect the sum of both batches, not just the first.
    await createTestInventory(product.id, { currentStock: 10 });
    await createTestBatch(product.id, { quantity: 5, unitCost: 60 });
    await createTestBatch(product.id, { quantity: 5, unitCost: 80 });

    await createSupplierReturn({
      supplierId: supplier.id,
      branchId: DEFAULT_BRANCH_CODE,
      items: [{ productId: product.id, quantity: 7 }], // spans both batches
      userId: user.id,
    });

    const batches = await prisma.inventoryBatch.findMany({
      where: { productId: product.id },
      orderBy: { unitCost: 'asc' },
    });
    // First (cheaper) batch fully consumed, second partially.
    expect(batches[0].quantity).toBe(0);
    expect(batches[1].quantity).toBe(3);

    const inventory = await prisma.inventory.findUnique({
      where: { productId_branchId: { productId: product.id, branchId: DEFAULT_BRANCH_CODE } },
    });
    expect(inventory.currentStock).toBe(3); // 10 total - 7 returned
  });

  it('rejects a return for an inactive supplier', async () => {
    const user = await createTestUser();
    const supplier = await createTestSupplier({ isActive: false });
    const product = await createSellableProduct({ stock: 5 });

    await expect(
      createSupplierReturn({
        supplierId: supplier.id,
        items: [{ productId: product.id, quantity: 1 }],
        userId: user.id,
      })
    ).rejects.toMatchObject({ status: 400 });
  });

  it('rejects a return with no userId', async () => {
    const supplier = await createTestSupplier();
    const product = await createSellableProduct({ stock: 5 });

    await expect(
      createSupplierReturn({
        supplierId: supplier.id,
        items: [{ productId: product.id, quantity: 1 }],
      })
    ).rejects.toMatchObject({ status: 400 });
  });
});
