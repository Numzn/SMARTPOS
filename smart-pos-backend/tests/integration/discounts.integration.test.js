import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import bcrypt from 'bcryptjs';
import testData from '../helpers/testData.js';
import saleFiscal from '../../lib/saleFiscal.js';

const { createTestBranch, createTestUser, createSellableProduct, cleanupTestData, DEFAULT_BRANCH_CODE } =
  testData;
const { createPendingSale } = saleFiscal;

const MANAGER_PASSWORD = 'manager-test-password-123';

async function createManager() {
  const hash = await bcrypt.hash(MANAGER_PASSWORD, 4); // low cost factor — tests only
  return createTestUser({ role: 'MANAGER', password: hash });
}

describe('Discount resolution and manager approval', () => {
  beforeAll(async () => {
    await createTestBranch();
  });

  afterEach(async () => {
    await cleanupTestData();
  });

  it('applies a line discount under the product maxDiscount threshold with no approval needed', async () => {
    const user = await createTestUser();
    const product = await createSellableProduct({ stock: 10 });
    await testData.prisma.product.update({ where: { id: product.id }, data: { maxDiscount: 15 } });

    const sale = await createPendingSale({
      userId: user.id,
      branchId: DEFAULT_BRANCH_CODE,
      items: [{ productId: product.id, quantity: 2, price: 100, discountPercent: 10 }],
    });

    expect(sale.discount).toBe(20); // 10% of 200
    expect(sale.discountApprovedByUserId).toBeNull();
    expect(sale.saleItems[0].discount).toBe(20);
  });

  it('rejects a discount above threshold when no approver is supplied', async () => {
    const user = await createTestUser();
    const product = await createSellableProduct({ stock: 10 });
    await testData.prisma.product.update({ where: { id: product.id }, data: { maxDiscount: 10 } });

    await expect(
      createPendingSale({
        userId: user.id,
        branchId: DEFAULT_BRANCH_CODE,
        items: [{ productId: product.id, quantity: 1, price: 100, discountPercent: 25 }],
      })
    ).rejects.toMatchObject({ status: 403 });
  });

  it('rejects approval with a cashier as approver (must be MANAGER/ADMIN)', async () => {
    const user = await createTestUser();
    const otherCashier = await createTestUser({ password: await bcrypt.hash('irrelevant', 4) });
    const product = await createSellableProduct({ stock: 10 });
    await testData.prisma.product.update({ where: { id: product.id }, data: { maxDiscount: 10 } });

    await expect(
      createPendingSale({
        userId: user.id,
        branchId: DEFAULT_BRANCH_CODE,
        items: [{ productId: product.id, quantity: 1, price: 100, discountPercent: 25 }],
        approverUserId: otherCashier.id,
        approverPassword: 'irrelevant',
      })
    ).rejects.toMatchObject({ status: 403 });
  });

  it('rejects approval with a wrong password', async () => {
    const user = await createTestUser();
    const manager = await createManager();
    const product = await createSellableProduct({ stock: 10 });
    await testData.prisma.product.update({ where: { id: product.id }, data: { maxDiscount: 10 } });

    await expect(
      createPendingSale({
        userId: user.id,
        branchId: DEFAULT_BRANCH_CODE,
        items: [{ productId: product.id, quantity: 1, price: 100, discountPercent: 25 }],
        approverUserId: manager.id,
        approverPassword: 'not-the-right-password',
      })
    ).rejects.toMatchObject({ status: 403 });
  });

  it('accepts a discount above threshold when a valid manager approves it', async () => {
    const user = await createTestUser();
    const manager = await createManager();
    const product = await createSellableProduct({ stock: 10 });
    await testData.prisma.product.update({ where: { id: product.id }, data: { maxDiscount: 10 } });

    const sale = await createPendingSale({
      userId: user.id,
      branchId: DEFAULT_BRANCH_CODE,
      items: [{ productId: product.id, quantity: 1, price: 100, discountPercent: 25 }],
      approverUserId: manager.id,
      approverPassword: MANAGER_PASSWORD,
    });

    expect(sale.discount).toBe(25);
    expect(sale.discountApprovedByUserId).toBe(manager.id);
  });

  it('falls back to the default approval threshold when the product has no maxDiscount set', async () => {
    const user = await createTestUser();
    const product = await createSellableProduct({ stock: 10 }); // maxDiscount defaults to 0

    // 5% is under the default 10% floor — should not require approval.
    const okSale = await createPendingSale({
      userId: user.id,
      branchId: DEFAULT_BRANCH_CODE,
      items: [{ productId: product.id, quantity: 1, price: 100, discountPercent: 5 }],
    });
    expect(okSale.discountApprovedByUserId).toBeNull();

    // 15% is over the default 10% floor — should require approval.
    await expect(
      createPendingSale({
        userId: user.id,
        branchId: DEFAULT_BRANCH_CODE,
        items: [{ productId: product.id, quantity: 1, price: 100, discountPercent: 15 }],
      })
    ).rejects.toMatchObject({ status: 403 });
  });

  it('clamps a discount amount larger than the line subtotal instead of going negative', async () => {
    const user = await createTestUser();
    const manager = await createManager();
    const product = await createSellableProduct({ stock: 10 });
    await testData.prisma.product.update({ where: { id: product.id }, data: { maxDiscount: 100 } });

    const sale = await createPendingSale({
      userId: user.id,
      branchId: DEFAULT_BRANCH_CODE,
      items: [{ productId: product.id, quantity: 1, price: 100, discountAmount: 500 }],
      approverUserId: manager.id,
      approverPassword: MANAGER_PASSWORD,
    });

    expect(sale.saleItems[0].discount).toBe(100); // clamped to the line's own subtotal
    expect(sale.discount).toBe(100);
  });

  it('combines multiple line discounts with an order-level discount into Sale.discount', async () => {
    const user = await createTestUser();
    const productA = await createSellableProduct({ stock: 10 });
    const productB = await createSellableProduct({ stock: 10 });
    await testData.prisma.product.update({ where: { id: productA.id }, data: { maxDiscount: 20 } });
    await testData.prisma.product.update({ where: { id: productB.id }, data: { maxDiscount: 20 } });

    const sale = await createPendingSale({
      userId: user.id,
      branchId: DEFAULT_BRANCH_CODE,
      discount: 5, // flat order-level discount, e.g. a loyalty voucher
      items: [
        { productId: productA.id, quantity: 1, price: 100, discountAmount: 10 },
        { productId: productB.id, quantity: 1, price: 100, discountPercent: 10 },
      ],
    });

    // 10 (flat) + 10 (10% of 100) + 5 (order-level) = 25
    expect(sale.discount).toBe(25);
    expect(sale.total).toBe(sale.subtotal + sale.tax - 25);
  });
});
