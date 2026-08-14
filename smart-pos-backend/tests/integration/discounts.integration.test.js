import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import bcrypt from 'bcryptjs';
import testData from '../helpers/testData.js';
import saleFiscal from '../../lib/saleFiscal.js';
import { requestApproval } from '../../lib/approval.js';

const { createTestBranch, createTestUser, createSellableProduct, cleanupTestData, prisma, DEFAULT_BRANCH_CODE } =
  testData;
const { createPendingSale } = saleFiscal;

const MANAGER_PASSWORD = 'manager-test-password-123';

async function createManager() {
  const hash = await bcrypt.hash(MANAGER_PASSWORD, 4); // low cost factor — tests only
  return createTestUser({ role: 'MANAGER', password: hash });
}

/**
 * Mints an ORDER_DISCOUNT approval ticket the way POST /api/till/approvals
 * would, for tests that call createPendingSale directly (below the route
 * layer). sessionId: null matches this per-line-discount path, which has no
 * till session — see SupervisorApproval's schema comment.
 */
async function approveDiscount(approverUserId, credential, discountAmount) {
  const ticket = await requestApproval(prisma, {
    approverUserId,
    credential,
    method: 'PASSWORD',
    actionType: 'ORDER_DISCOUNT',
    sessionId: null,
    target: { discountAmount },
  });
  return ticket.id;
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

  it('rejects a discount above threshold when no approval ticket is supplied', async () => {
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

  it('rejects an approval ticket request from a cashier as approver (must rank >= SUPERVISOR)', async () => {
    const otherCashier = await createTestUser({ password: await bcrypt.hash('irrelevant', 4) });

    await expect(
      requestApproval(prisma, {
        approverUserId: otherCashier.id,
        credential: 'irrelevant',
        method: 'PASSWORD',
        actionType: 'ORDER_DISCOUNT',
        sessionId: null,
        target: { discountAmount: 25 },
      })
    ).rejects.toMatchObject({ status: 403 });
  });

  it('rejects an approval ticket request with a wrong password', async () => {
    const manager = await createManager();

    await expect(
      requestApproval(prisma, {
        approverUserId: manager.id,
        credential: 'not-the-right-password',
        method: 'PASSWORD',
        actionType: 'ORDER_DISCOUNT',
        sessionId: null,
        target: { discountAmount: 25 },
      })
    ).rejects.toMatchObject({ status: 403 });
  });

  it('accepts a discount above threshold when a valid manager-approved ticket is supplied', async () => {
    const user = await createTestUser();
    const manager = await createManager();
    const product = await createSellableProduct({ stock: 10 });
    await testData.prisma.product.update({ where: { id: product.id }, data: { maxDiscount: 10 } });

    const discountApprovalId = await approveDiscount(manager.id, MANAGER_PASSWORD, 25);

    const sale = await createPendingSale({
      userId: user.id,
      branchId: DEFAULT_BRANCH_CODE,
      items: [{ productId: product.id, quantity: 1, price: 100, discountPercent: 25 }],
      discountApprovalId,
    });

    expect(sale.discount).toBe(25);
    expect(sale.discountApprovedByUserId).toBe(manager.id);
  });

  it('a ticket cannot be reused for a second, different sale', async () => {
    const user = await createTestUser();
    const manager = await createManager();
    const product = await createSellableProduct({ stock: 10 });
    await testData.prisma.product.update({ where: { id: product.id }, data: { maxDiscount: 10 } });

    const discountApprovalId = await approveDiscount(manager.id, MANAGER_PASSWORD, 25);

    await createPendingSale({
      userId: user.id,
      branchId: DEFAULT_BRANCH_CODE,
      items: [{ productId: product.id, quantity: 1, price: 100, discountPercent: 25 }],
      discountApprovalId,
    });

    await expect(
      createPendingSale({
        userId: user.id,
        branchId: DEFAULT_BRANCH_CODE,
        items: [{ productId: product.id, quantity: 1, price: 100, discountPercent: 25 }],
        discountApprovalId,
      })
    ).rejects.toMatchObject({ status: 403 });
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

    // resolveLineDiscount clamps 500 -> 100 (the line's own subtotal) before
    // the approval check runs, so the ticket must match the clamped amount.
    const discountApprovalId = await approveDiscount(manager.id, MANAGER_PASSWORD, 100);

    const sale = await createPendingSale({
      userId: user.id,
      branchId: DEFAULT_BRANCH_CODE,
      items: [{ productId: product.id, quantity: 1, price: 100, discountAmount: 500 }],
      discountApprovalId,
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
      discount: 5, // flat order-level discount, e.g. a loyalty voucher — well under the 10% default threshold
      items: [
        { productId: productA.id, quantity: 1, price: 100, discountAmount: 10 },
        { productId: productB.id, quantity: 1, price: 100, discountPercent: 10 },
      ],
    });

    // 10 (flat) + 10 (10% of 100) + 5 (order-level) = 25
    expect(sale.discount).toBe(25);
    expect(sale.total).toBe(sale.subtotal + sale.tax - 25);
  });

  it('an order-level (cart-wide) discount over 10% of subtotal requires approval even with zero line discounts', async () => {
    const user = await createTestUser();
    const product = await createSellableProduct({ stock: 10 });

    // This is the loophole item 15*/POS-control fixed: a flat cart-level
    // discount with no per-line discount fields used to bypass approval
    // entirely (see lib/saleFiscal.js's orderLevelPercent check).
    await expect(
      createPendingSale({
        userId: user.id,
        branchId: DEFAULT_BRANCH_CODE,
        discount: 50, // 50% of a 100 subtotal
        items: [{ productId: product.id, quantity: 1, price: 100 }],
      })
    ).rejects.toMatchObject({ status: 403 });

    const manager = await createManager();
    const discountApprovalId = await approveDiscount(manager.id, MANAGER_PASSWORD, 50);

    const sale = await createPendingSale({
      userId: user.id,
      branchId: DEFAULT_BRANCH_CODE,
      discount: 50,
      items: [{ productId: product.id, quantity: 1, price: 100 }],
      discountApprovalId,
    });
    expect(sale.discount).toBe(50);
    expect(sale.discountApprovedByUserId).toBe(manager.id);
  });
});
