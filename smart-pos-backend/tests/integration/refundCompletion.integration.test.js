import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import testData from '../helpers/testData.js';
import saleFiscal from '../../lib/saleFiscal.js';
import saleRefund from '../../lib/saleRefund.js';

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
const { completeRefundAfterFiscalSuccess, createPendingRefund } = saleRefund;

async function createCompletedSale({ user, product, quantity, price = 100 }) {
  const sale = await createTestSale({ userId: user.id, productId: product.id, quantity, price });
  return completeSaleAfterFiscalSuccess(sale.id, { rcptNo: `TEST-RCPT-${sale.id}` }, {}, DEFAULT_BRANCH_CODE);
}

describe('refund fiscal completion + validation', () => {
  beforeAll(async () => {
    await createTestBranch();
  });

  afterEach(async () => {
    await cleanupTestData();
  });

  it('completeRefundAfterFiscalSuccess restores stock and completes the refund', async () => {
    const user = await createTestUser();
    const product = await createSellableProduct({ stock: 10 });
    const sale = await createCompletedSale({ user, product, quantity: 4 });

    const pendingRefund = await createPendingRefund(sale.id, {
      userId: user.id,
      items: [{ saleItemId: sale.saleItems[0].id, quantity: 2 }],
    });

    const completed = await completeRefundAfterFiscalSuccess(
      pendingRefund.id,
      { rcptNo: 'TEST-CREDIT-1' },
      {},
      DEFAULT_BRANCH_CODE
    );

    expect(completed.status).toBe('COMPLETED');

    const inventory = await prisma.inventory.findUnique({
      where: { productId_branchId: { productId: product.id, branchId: DEFAULT_BRANCH_CODE } },
    });
    // 10 initial - 4 sold + 2 refunded = 8
    expect(inventory.currentStock).toBe(8);

    const movement = await prisma.stockMovement.findFirst({
      where: { referenceType: 'REFUND', referenceId: pendingRefund.id, movementType: 'RETURN_IN' },
    });
    expect(movement).not.toBeNull();
  });

  it('is idempotent: calling it again for an already-restored refund does not double-restore stock', async () => {
    const user = await createTestUser();
    const product = await createSellableProduct({ stock: 10 });
    const sale = await createCompletedSale({ user, product, quantity: 4 });

    const pendingRefund = await createPendingRefund(sale.id, {
      userId: user.id,
      items: [{ saleItemId: sale.saleItems[0].id, quantity: 2 }],
    });

    await completeRefundAfterFiscalSuccess(pendingRefund.id, { rcptNo: 'TEST-CREDIT-2' }, {}, DEFAULT_BRANCH_CODE);
    await completeRefundAfterFiscalSuccess(pendingRefund.id, { rcptNo: 'TEST-CREDIT-2' }, {}, DEFAULT_BRANCH_CODE);

    const inventory = await prisma.inventory.findUnique({
      where: { productId_branchId: { productId: product.id, branchId: DEFAULT_BRANCH_CODE } },
    });
    expect(inventory.currentStock).toBe(8); // still only restored once
  });

  it('rejects refunding more than was sold (over-refund) with a 409', async () => {
    const user = await createTestUser();
    const product = await createSellableProduct({ stock: 10 });
    const sale = await createCompletedSale({ user, product, quantity: 3 });

    await expect(
      createPendingRefund(sale.id, {
        userId: user.id,
        items: [{ saleItemId: sale.saleItems[0].id, quantity: 5 }],
      })
    ).rejects.toMatchObject({ status: 409 });
  });

  it('rejects a refund on a sale that is not fiscally completed', async () => {
    const user = await createTestUser();
    const product = await createSellableProduct({ stock: 10 });
    const pendingSale = await createTestSale({ userId: user.id, productId: product.id, quantity: 1 });

    await expect(createPendingRefund(pendingSale.id, { userId: user.id })).rejects.toMatchObject({
      status: 400,
    });
  });
});
