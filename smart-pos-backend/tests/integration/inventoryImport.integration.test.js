import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import testData from '../helpers/testData.js';
import inventoryImport from '../../lib/inventoryImport.js';

const {
  prisma,
  createTestBranch,
  createTestUser,
  createTestProduct,
  createTestInventory,
  createTestBatch,
  cleanupTestData,
  DEFAULT_BRANCH_CODE,
} = testData;
const { planInventoryImport, applyInventoryImport, exportInventoryCsv } = inventoryImport;

const csv = (...lines) => lines.join('\n');

async function stocked({ stock = 10, unitCost = 5 } = {}) {
  const product = await createTestProduct();
  await createTestInventory(product.id, { currentStock: stock });
  await createTestBatch(product.id, { quantity: stock, unitCost });
  return product;
}

describe('inventory stock-take import', () => {
  beforeAll(async () => {
    await createTestBranch();
  });

  afterEach(async () => {
    await cleanupTestData();
  });

  it('plans the delta between counted and on-hand without writing', async () => {
    const product = await stocked({ stock: 10 });

    const plan = await planInventoryImport(csv('sku,counted', `${product.sku},7`));

    expect(plan.summary).toMatchObject({ decrease: 1, increase: 0, error: 0 });
    expect(plan.rows[0]).toMatchObject({ onHand: 10, counted: 7, delta: -3, action: 'decrease' });

    // Nothing written by a plan.
    const inv = await prisma.inventory.findUnique({
      where: { productId_branchId: { productId: product.id, branchId: DEFAULT_BRANCH_CODE } },
    });
    expect(inv.currentStock).toBe(10);
  });

  it('REGRESSION: a stock take writes the ledger and the ZRA audit trail, not just the stock number', async () => {
    const user = await createTestUser();
    const product = await stocked({ stock: 10 });

    const result = await applyInventoryImport(csv('sku,counted', `${product.sku},14`), {
      userId: user.id,
      branchId: DEFAULT_BRANCH_CODE,
    });
    expect(result).toMatchObject({ increased: 1, decreased: 0, netUnits: 4 });

    const inv = await prisma.inventory.findUnique({
      where: { productId_branchId: { productId: product.id, branchId: DEFAULT_BRANCH_CODE } },
    });
    expect(inv.currentStock).toBe(14);

    // The whole reason this cannot be a bulk UPDATE: these must exist too.
    const movement = await prisma.stockMovement.findFirst({
      where: { productId: product.id, referenceType: 'ADJUSTMENT' },
      orderBy: { createdAt: 'desc' },
    });
    expect(movement).not.toBeNull();
    expect(movement.movementType).toBe('ADJUSTMENT_IN');
    expect(movement.previousStock).toBe(10);
    expect(movement.newStock).toBe(14);
    expect(movement.quantity).toBe(4);

    const adjustment = await prisma.stockAdjustment.findFirst({
      where: { productId: product.id },
      orderBy: { createdAt: 'desc' },
    });
    expect(adjustment).not.toBeNull();
    // A physical count is a RECOUNT, not an arbitrary increase.
    expect(adjustment.adjustmentType).toBe('RECOUNT');
  });

  it('decreasing consumes batches so stock and batch quantities stay in step', async () => {
    const user = await createTestUser();
    const product = await stocked({ stock: 10, unitCost: 5 });

    await applyInventoryImport(csv('sku,counted', `${product.sku},4`), {
      userId: user.id,
      branchId: DEFAULT_BRANCH_CODE,
    });

    const inv = await prisma.inventory.findUnique({
      where: { productId_branchId: { productId: product.id, branchId: DEFAULT_BRANCH_CODE } },
    });
    const batchTotal = await prisma.inventoryBatch.aggregate({
      where: { productId: product.id, status: 'ACTIVE' },
      _sum: { quantity: true },
    });
    expect(inv.currentStock).toBe(4);
    expect(batchTotal._sum.quantity).toBe(4);
  });

  it('skips rows whose count already matches, keeping the audit trail free of no-op entries', async () => {
    const user = await createTestUser();
    const product = await stocked({ stock: 8 });

    const before = await prisma.stockAdjustment.count({ where: { productId: product.id } });
    const result = await applyInventoryImport(csv('sku,counted', `${product.sku},8`), {
      userId: user.id,
      branchId: DEFAULT_BRANCH_CODE,
    });

    expect(result).toMatchObject({ increased: 0, decreased: 0, unchanged: 1 });
    expect(await prisma.stockAdjustment.count({ where: { productId: product.id } })).toBe(before);
  });

  it('REGRESSION: refuses a count below units reserved by in-flight sales', async () => {
    const product = await stocked({ stock: 10 });
    await prisma.inventory.update({
      where: { productId_branchId: { productId: product.id, branchId: DEFAULT_BRANCH_CODE } },
      data: { reservedStock: 6 },
    });

    // Counting 3 when 6 are promised to sales mid-flight would drift reserved
    // stock out of step with reality — the class of bug behind the checkout
    // deadlock.
    const plan = await planInventoryImport(csv('sku,counted', `${product.sku},3`));
    expect(plan.summary.error).toBe(1);
    expect(plan.rows[0].errors.join(' ')).toMatch(/reserved/i);
  });

  it('rejects an unknown sku rather than silently creating stock', async () => {
    const plan = await planInventoryImport(csv('sku,counted', 'TEST-SKU-NOT-A-PRODUCT,5'));
    expect(plan.summary.error).toBe(1);
    expect(plan.rows[0].errors.join(' ')).toMatch(/no product with sku/i);
  });

  it('rejects non-numeric, negative and fractional counts', async () => {
    const product = await stocked({ stock: 5 });
    const plan = await planInventoryImport(
      csv('sku,counted', `${product.sku},abc`, `${product.sku},-1`, `${product.sku},2.5`)
    );
    expect(plan.summary.error).toBe(3);
    expect(plan.rows[0].errors.join(' ')).toMatch(/not a number/);
    expect(plan.rows[1].errors.join(' ')).toMatch(/negative/);
    expect(plan.rows[2].errors.join(' ')).toMatch(/whole number/);
  });

  it('writes nothing at all when any row is invalid', async () => {
    const user = await createTestUser();
    const good = await stocked({ stock: 10 });

    await expect(
      applyInventoryImport(
        csv('sku,counted', `${good.sku},20`, 'TEST-SKU-MISSING-XYZ,5'),
        { userId: user.id, branchId: DEFAULT_BRANCH_CODE }
      )
    ).rejects.toMatchObject({ status: 400 });

    const inv = await prisma.inventory.findUnique({
      where: { productId_branchId: { productId: good.id, branchId: DEFAULT_BRANCH_CODE } },
    });
    expect(inv.currentStock).toBe(10); // the valid row must not have slipped through
  });

  it('requires a userId, since every adjustment is attributed in the audit trail', async () => {
    const product = await stocked({ stock: 5 });
    await expect(
      applyInventoryImport(csv('sku,counted', `${product.sku},6`), { branchId: DEFAULT_BRANCH_CODE })
    ).rejects.toMatchObject({ status: 400 });
  });

  it('export doubles as a stock-take sheet and round-trips back through import', async () => {
    const product = await stocked({ stock: 12 });

    const out = await exportInventoryCsv({ branchId: DEFAULT_BRANCH_CODE });
    const header = out.split('\r\n')[0].split(',');
    expect(header).toEqual(expect.arrayContaining(['sku', 'onHand', 'reserved', 'sellable', 'counted']));

    // counted is deliberately blank for whoever does the count.
    const line = out.split('\r\n').find((l) => l.startsWith(product.sku));
    expect(line.endsWith(',')).toBe(true);

    // Filling it in and feeding it back must validate cleanly.
    const filled = out.replace(line, `${line}12`);
    const plan = await planInventoryImport(filled, { branchId: DEFAULT_BRANCH_CODE });
    expect(plan.summary.error).toBe(0);
  });
});
