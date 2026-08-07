import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import testData from '../helpers/testData.js';
import saleFiscal from '../../lib/saleFiscal.js';
import inventoryStock from '../../lib/inventoryStock.js';

const {
  prisma,
  createTestBranch,
  createTestUser,
  createTestProduct,
  createTestInventory,
  createTestBatch,
  createTestSale,
  cleanupTestData,
  DEFAULT_BRANCH_CODE,
} = testData;
const { completeSaleAfterFiscalSuccess, reserveStockForSaleRecord } = saleFiscal;
const { availableUnits } = inventoryStock;

async function stockedProduct({ stock, unitCost = 10 }) {
  const product = await createTestProduct();
  await createTestInventory(product.id, { currentStock: stock });
  await createTestBatch(product.id, { quantity: stock, unitCost });
  return product;
}

/**
 * Regression cover for a deadlock where a sale's own stock reservation
 * prevented that same sale from ever completing.
 */
describe('reservation does not block the reserving sale from completing', () => {
  beforeAll(async () => {
    await createTestBranch();
  });

  afterEach(async () => {
    await cleanupTestData();
  });

  it('REGRESSION: a sale for more than half the stock completes after reserving', async () => {
    const user = await createTestUser();
    // The reported shape exactly: 12 on hand, sale for 9.
    const product = await stockedProduct({ stock: 12 });
    const sale = await createTestSale({
      userId: user.id,
      productId: product.id,
      quantity: 9,
      price: 35,
    });

    // Reserve, as the real checkout path does before submitting to VSDC.
    await reserveStockForSaleRecord({ ...sale, saleItems: sale.saleItems }, DEFAULT_BRANCH_CODE);

    const reserved = await prisma.inventory.findUnique({
      where: { productId_branchId: { productId: product.id, branchId: DEFAULT_BRANCH_CODE } },
    });
    expect(reserved.reservedStock).toBe(9);
    // Availability now reads 3 — this is precisely what used to be checked
    // against the 9-unit requirement, and why completion failed forever.
    expect(availableUnits(reserved)).toBe(3);

    const completed = await completeSaleAfterFiscalSuccess(
      sale.id,
      { rcptNo: 'TEST-DEADLOCK-1' },
      {},
      DEFAULT_BRANCH_CODE
    );
    expect(completed.status).toBe('COMPLETED');

    const after = await prisma.inventory.findUnique({
      where: { productId_branchId: { productId: product.id, branchId: DEFAULT_BRANCH_CODE } },
    });
    expect(after.currentStock).toBe(3); // 12 - 9 sold
    expect(after.reservedStock).toBe(0); // reservation consumed, not stranded
  });

  it('completes a sale for the entire stock on hand', async () => {
    const user = await createTestUser();
    const product = await stockedProduct({ stock: 5 });
    const sale = await createTestSale({
      userId: user.id,
      productId: product.id,
      quantity: 5,
      price: 20,
    });
    await reserveStockForSaleRecord({ ...sale, saleItems: sale.saleItems }, DEFAULT_BRANCH_CODE);

    const completed = await completeSaleAfterFiscalSuccess(
      sale.id,
      { rcptNo: 'TEST-DEADLOCK-2' },
      {},
      DEFAULT_BRANCH_CODE
    );
    expect(completed.status).toBe('COMPLETED');

    const after = await prisma.inventory.findUnique({
      where: { productId_branchId: { productId: product.id, branchId: DEFAULT_BRANCH_CODE } },
    });
    expect(after.currentStock).toBe(0);
    expect(after.reservedStock).toBe(0);
  });

  it('still refuses to oversell beyond the physical count', async () => {
    const user = await createTestUser();
    const product = await stockedProduct({ stock: 4 });
    // Never reserved, and asks for more than exists — must still fail.
    const sale = await createTestSale({
      userId: user.id,
      productId: product.id,
      quantity: 10,
      price: 20,
    });

    await expect(
      completeSaleAfterFiscalSuccess(sale.id, { rcptNo: 'TEST-DEADLOCK-3' }, {}, DEFAULT_BRANCH_CODE)
    ).rejects.toMatchObject({ status: 409 });
  });
});
