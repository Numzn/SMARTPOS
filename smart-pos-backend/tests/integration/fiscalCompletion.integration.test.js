import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import testData from '../helpers/testData.js';
import saleFiscal from '../../lib/saleFiscal.js';

const {
  prisma,
  createTestBranch,
  createTestUser,
  createSellableProduct,
  createTestSale,
  cleanupTestData,
  DEFAULT_BRANCH_CODE,
} = testData;
const { completeSaleAfterFiscalSuccess } = saleFiscal;

describe('completeSaleAfterFiscalSuccess (fiscal completion atomicity)', () => {
  beforeAll(async () => {
    await createTestBranch();
  });

  afterEach(async () => {
    await cleanupTestData();
  });

  it('completes the sale and deducts stock together when both succeed', async () => {
    const user = await createTestUser();
    const product = await createSellableProduct({ stock: 10 });
    const sale = await createTestSale({ userId: user.id, productId: product.id, quantity: 3, price: 100 });

    const completed = await completeSaleAfterFiscalSuccess(
      sale.id,
      { rcptNo: 'TEST-RCPT-1', qrCode: 'QR-1', rcptSign: 'SIGN-1' },
      {},
      DEFAULT_BRANCH_CODE
    );

    expect(completed.status).toBe('COMPLETED');
    expect(completed.rcptNo).toBe('TEST-RCPT-1');

    const inventory = await prisma.inventory.findUnique({
      where: { productId_branchId: { productId: product.id, branchId: DEFAULT_BRANCH_CODE } },
    });
    expect(inventory.currentStock).toBe(7); // 10 - 3

    const movement = await prisma.stockMovement.findFirst({
      where: { referenceType: 'SALE', referenceId: sale.id, movementType: 'SALE_OUT' },
    });
    expect(movement).not.toBeNull();
    expect(movement.quantity).toBe(-3);
  });

  it('is idempotent: calling it again for an already-deducted sale does not double-deduct stock', async () => {
    const user = await createTestUser();
    const product = await createSellableProduct({ stock: 10 });
    const sale = await createTestSale({ userId: user.id, productId: product.id, quantity: 3, price: 100 });

    await completeSaleAfterFiscalSuccess(sale.id, { rcptNo: 'TEST-RCPT-2' }, {}, DEFAULT_BRANCH_CODE);
    await completeSaleAfterFiscalSuccess(sale.id, { rcptNo: 'TEST-RCPT-2' }, {}, DEFAULT_BRANCH_CODE);

    const inventory = await prisma.inventory.findUnique({
      where: { productId_branchId: { productId: product.id, branchId: DEFAULT_BRANCH_CODE } },
    });
    expect(inventory.currentStock).toBe(7); // still only deducted once

    const movements = await prisma.stockMovement.findMany({
      where: { referenceType: 'SALE', referenceId: sale.id, movementType: 'SALE_OUT' },
    });
    expect(movements.length).toBe(1);
  });

  it('REGRESSION: does not leave the sale COMPLETED if stock deduction fails (atomicity)', async () => {
    const user = await createTestUser();
    // Only 2 in stock, but the sale line asks for 5 — deductStockForSale must
    // throw insufficient-stock inside the transaction.
    const product = await createSellableProduct({ stock: 2 });
    const sale = await createTestSale({ userId: user.id, productId: product.id, quantity: 5, price: 100 });

    await expect(
      completeSaleAfterFiscalSuccess(sale.id, { rcptNo: 'TEST-RCPT-3' }, {}, DEFAULT_BRANCH_CODE)
    ).rejects.toThrow(/Insufficient stock/);

    // Before the fix, the sale status update ran outside the stock-deduction
    // transaction and would have committed COMPLETED regardless of this
    // failure. It must now be rolled back together with everything else.
    const reloaded = await prisma.sale.findUnique({ where: { id: sale.id } });
    expect(reloaded.status).toBe('PENDING');
    expect(reloaded.rcptNo).toBeNull();

    const inventory = await prisma.inventory.findUnique({
      where: { productId_branchId: { productId: product.id, branchId: DEFAULT_BRANCH_CODE } },
    });
    expect(inventory.currentStock).toBe(2); // untouched

    const movement = await prisma.stockMovement.findFirst({
      where: { referenceType: 'SALE', referenceId: sale.id },
    });
    expect(movement).toBeNull();
  });

  it('REGRESSION: writes rcptSign and intrlData to separate columns instead of collapsing them', async () => {
    const user = await createTestUser();
    const product = await createSellableProduct({ stock: 10 });
    const sale = await createTestSale({ userId: user.id, productId: product.id, quantity: 1, price: 100 });

    const completed = await completeSaleAfterFiscalSuccess(
      sale.id,
      { rcptNo: 'TEST-RCPT-4', qrCode: 'QR-4', rcptSign: 'SIGN-4', intrlData: 'INTRL-4' },
      {},
      DEFAULT_BRANCH_CODE
    );

    expect(completed.rcptSign).toBe('SIGN-4');
    expect(completed.intrlData).toBe('INTRL-4');
  });

  it('leaves intrlData null when the VSDC payload does not supply one, rather than backfilling from rcptSign', async () => {
    const user = await createTestUser();
    const product = await createSellableProduct({ stock: 10 });
    const sale = await createTestSale({ userId: user.id, productId: product.id, quantity: 1, price: 100 });

    const completed = await completeSaleAfterFiscalSuccess(
      sale.id,
      { rcptNo: 'TEST-RCPT-5', qrCode: 'QR-5', rcptSign: 'SIGN-5' },
      {},
      DEFAULT_BRANCH_CODE
    );

    expect(completed.rcptSign).toBe('SIGN-5');
    expect(completed.intrlData).toBeNull();
  });
});
