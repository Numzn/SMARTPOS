import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import bcrypt from 'bcryptjs';
import testData from '../helpers/testData.js';
import saleFiscal from '../../lib/saleFiscal.js';
import { requestApproval } from '../../lib/approval.js';
import { ensureDefaultBusinessProfile } from '../../lib/ensureBusinessProfile.js';
import { DEFAULT_DISCOUNT_POLICY } from '../../lib/discountPolicy.js';
import zraInvoiceService from '../../services/zraInvoice.js';

const { createTestBranch, createTestUser, createSellableProduct, cleanupTestData, prisma, DEFAULT_BRANCH_CODE } =
  testData;
const { createPendingSale } = saleFiscal;

const APPROVER_PASSWORD = 'approver-test-password-123';

async function createApprover(role) {
  const hash = await bcrypt.hash(APPROVER_PASSWORD, 4); // low cost factor — tests only
  return createTestUser({ role, password: hash });
}

async function setPolicy(overrides) {
  await prisma.businessProfile.update({
    where: { id: 'default' },
    data: { discountPolicy: { ...DEFAULT_DISCOUNT_POLICY, ...overrides } },
  });
}

async function approveDiscount(approverUserId, discountAmount, requesterUserId) {
  const ticket = await requestApproval(prisma, {
    approverUserId,
    requesterUserId,
    credential: APPROVER_PASSWORD,
    method: 'PASSWORD',
    actionType: 'ORDER_DISCOUNT',
    sessionId: null,
    target: { discountAmount },
  });
  return ticket.id;
}

async function fullPriceCheckout(userId, product, discountPercent, extra = {}) {
  return createPendingSale({
    userId,
    branchId: DEFAULT_BRANCH_CODE,
    discount: (product.price * discountPercent) / 100,
    items: [{ productId: product.id, quantity: 1, price: product.price }],
    ...extra,
  });
}

describe('Discount authorization (NUMZ POS policy — not a ZRA requirement)', () => {
  beforeAll(async () => {
    await createTestBranch();
    await ensureDefaultBusinessProfile();
  });

  afterEach(async () => {
    await cleanupTestData();
    await setPolicy({}); // restore the strict default between tests
  });

  it.each([1, 5, 10, 50])('cashier + %i%% discount -> DENIED, regardless of size', async (percent) => {
    const cashier = await createTestUser({ role: 'CASHIER' });
    const product = await createSellableProduct({ stock: 10 });

    await expect(fullPriceCheckout(cashier.id, product, percent)).rejects.toMatchObject({
      status: 403,
      code: 'DISCOUNT_NOT_AUTHORIZED',
    });
  });

  it('cashier direct crafted checkout discount is denied even without going through the UI at all', async () => {
    const cashier = await createTestUser({ role: 'CASHIER' });
    const product = await createSellableProduct({ stock: 10 });

    // Simulates a hand-crafted API call with no prior UI interaction.
    await expect(
      createPendingSale({
        userId: cashier.id,
        branchId: DEFAULT_BRANCH_CODE,
        discount: 1, // even a trivial K1 discount
        items: [{ productId: product.id, quantity: 1, price: product.price }],
      })
    ).rejects.toMatchObject({ status: 403, code: 'DISCOUNT_NOT_AUTHORIZED' });
  });

  it('cashier cannot even request a discount while cashierCanRequest=false (the default)', async () => {
    const cashier = await createTestUser({ role: 'CASHIER' });
    const product = await createSellableProduct({ stock: 10 });

    // No approval ticket exists (request path is closed), so this must be
    // denied outright, not fall through to "requires approval".
    await expect(fullPriceCheckout(cashier.id, product, 20)).rejects.toMatchObject({
      status: 403,
      code: 'DISCOUNT_NOT_AUTHORIZED',
    });
  });

  it('manager discount -> ALLOWED directly, no approval ticket needed', async () => {
    const manager = await createTestUser({ role: 'MANAGER' });
    const product = await createSellableProduct({ stock: 10 });

    const sale = await fullPriceCheckout(manager.id, product, 50);

    expect(sale.discount).toBeCloseTo(product.price * 0.5, 4);
    expect(sale.discountApprovedByUserId).toBeNull(); // self-authorized, not "approved by" anyone
  });

  it('admin discount -> ALLOWED directly, any percentage including 100%', async () => {
    const admin = await createTestUser({ role: 'ADMIN' });
    const product = await createSellableProduct({ stock: 10 });

    const sale = await fullPriceCheckout(admin.id, product, 100);

    expect(sale.discount).toBeCloseTo(product.price, 4);
    expect(sale.total).toBeCloseTo(0, 4);
  });

  it('supervisor discount is denied under the default policy (supervisorCanApply=false)', async () => {
    const supervisor = await createTestUser({ role: 'SUPERVISOR' });
    const product = await createSellableProduct({ stock: 10 });

    await expect(fullPriceCheckout(supervisor.id, product, 10)).rejects.toMatchObject({
      status: 403,
      code: 'DISCOUNT_NOT_AUTHORIZED',
    });
  });

  it('supervisor discount is allowed once policy.supervisorCanApply is enabled — configurable, as specified', async () => {
    await setPolicy({ supervisorCanApply: true });
    const supervisor = await createTestUser({ role: 'SUPERVISOR' });
    const product = await createSellableProduct({ stock: 10 });

    const sale = await fullPriceCheckout(supervisor.id, product, 10);
    expect(sale.discount).toBeCloseTo(product.price * 0.1, 4);
  });

  it('a role with request-but-not-apply authority (policy-enabled) must present a valid ticket from an authorized approver', async () => {
    await setPolicy({ cashierCanRequest: true }); // cashierCanApply stays false
    const cashier = await createTestUser({ role: 'CASHIER' });
    const manager = await createApprover('MANAGER');
    const product = await createSellableProduct({ stock: 10 });
    const discountAmount = product.price * 0.2;

    // No ticket yet — still denied, but via the "needs approval" path now,
    // not an outright authorization denial.
    await expect(fullPriceCheckout(cashier.id, product, 20)).rejects.toMatchObject({ status: 403 });

    const discountApprovalId = await approveDiscount(manager.id, discountAmount, cashier.id);
    const sale = await fullPriceCheckout(cashier.id, product, 20, { discountApprovalId });

    expect(sale.discount).toBeCloseTo(discountAmount, 4);
    expect(sale.discountApprovedByUserId).toBe(manager.id);
  });

  it('a self-approval attempt on the discount ticket is denied even for an otherwise-authorized approver', async () => {
    const manager = await createApprover('MANAGER');

    await expect(
      requestApproval(prisma, {
        approverUserId: manager.id,
        requesterUserId: manager.id,
        credential: APPROVER_PASSWORD,
        method: 'PASSWORD',
        actionType: 'ORDER_DISCOUNT',
        sessionId: null,
        target: { discountAmount: 10 },
      })
    ).rejects.toMatchObject({ status: 403, code: 'SELF_APPROVAL_DENIED' });
  });
});

describe('Discount fiscal math — item-level and order-level ZRA reconciliation', () => {
  beforeAll(async () => {
    await createTestBranch();
    await ensureDefaultBusinessProfile();
  });

  afterEach(async () => {
    await cleanupTestData();
    await setPolicy({});
  });

  it('no-discount sale: SaleItem totals are unchanged from before this phase (regression)', async () => {
    const manager = await createTestUser({ role: 'MANAGER' });
    const product = await createSellableProduct({ stock: 10 });

    const sale = await createPendingSale({
      userId: manager.id,
      branchId: DEFAULT_BRANCH_CODE,
      items: [{ productId: product.id, quantity: 1, price: product.price }],
    });

    const line = sale.saleItems[0];
    const expectedTax = product.price * 0.16;
    expect(line.discount).toBe(0);
    expect(line.splyAmt).toBeCloseTo(product.price, 4);
    expect(line.taxblAmt).toBeCloseTo(product.price, 4);
    expect(line.taxAmt).toBeCloseTo(expectedTax, 4);
    expect(line.totAmt).toBeCloseTo(product.price + expectedTax, 4);
  });

  it('non-zero item-level discount: dcRt/dcAmt-equivalent (SaleItem.discount) populated, item totAmt reconciles net of it', async () => {
    const manager = await createTestUser({ role: 'MANAGER' });
    const product = await createSellableProduct({ stock: 10 });

    const sale = await createPendingSale({
      userId: manager.id,
      branchId: DEFAULT_BRANCH_CODE,
      items: [{ productId: product.id, quantity: 1, price: product.price, discountPercent: 20 }],
    });

    const line = sale.saleItems[0];
    const expectedDiscount = product.price * 0.2;
    const expectedBase = product.price - expectedDiscount;
    expect(line.discount).toBeCloseTo(expectedDiscount, 4);
    expect(line.taxblAmt).toBeCloseTo(expectedBase, 4);
    expect(line.totAmt).toBeCloseTo(expectedBase * 1.16, 4);
  });

  it('order-level discount is NOT distributed into SaleItem — each line totAmt stays full, only Sale.discount/total reflect it', async () => {
    const manager = await createTestUser({ role: 'MANAGER' });
    const product = await createSellableProduct({ stock: 10 });

    const sale = await fullPriceCheckout(manager.id, product, 50);

    const line = sale.saleItems[0];
    expect(line.discount).toBe(0); // order-level discount never touches the line
    expect(line.totAmt).toBeCloseTo(product.price * 1.16, 4); // full, undiscounted line total
    expect(sale.discount).toBeCloseTo(product.price * 0.5, 4); // the order-level figure lives on Sale
  });

  it('order-level discount maps to cashDcRt/cashDcAmt via zraInvoiceService, header total reconciles against the item sum', async () => {
    const manager = await createTestUser({ role: 'MANAGER' });
    const product = await createSellableProduct({ stock: 10 });
    await prisma.product.update({ where: { id: product.id }, data: { zraClassificationCode: '50101500' } });

    const sale = await fullPriceCheckout(manager.id, product, 50);
    const fullSale = await prisma.sale.findUnique({
      where: { id: sale.id },
      include: { saleItems: { include: { product: true } }, user: true },
    });

    const invoiceData = zraInvoiceService.buildInvoiceDataFromSale(fullSale, { invcNo: 999 });

    const itemTotalSum = invoiceData.items.reduce((s, i) => s + i.totalAmount, 0);
    expect(invoiceData.cashDiscountAmount).toBeGreaterThan(0);
    expect(invoiceData.items[0].discountAmount).toBe(0); // not duplicated into the item
    expect(itemTotalSum - invoiceData.cashDiscountAmount).toBeCloseTo(invoiceData.totalAmount, 4);
  });

  it('100% discount is a legitimate edge case: header total reconciles to 0, no fiscal-math error', async () => {
    const admin = await createTestUser({ role: 'ADMIN' });
    const product = await createSellableProduct({ stock: 10 });
    await prisma.product.update({ where: { id: product.id }, data: { zraClassificationCode: '50101500' } });

    const sale = await fullPriceCheckout(admin.id, product, 100);
    const fullSale = await prisma.sale.findUnique({
      where: { id: sale.id },
      include: { saleItems: { include: { product: true } }, user: true },
    });

    const invoiceData = zraInvoiceService.buildInvoiceDataFromSale(fullSale, { invcNo: 998 });
    const itemTotalSum = invoiceData.items.reduce((s, i) => s + i.totalAmount, 0);

    expect(invoiceData.totalAmount).toBeCloseTo(0, 4);
    expect(itemTotalSum - invoiceData.cashDiscountAmount).toBeCloseTo(0, 4);
  });
});
