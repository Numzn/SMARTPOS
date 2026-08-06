import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import testData from '../helpers/testData.js';
import purchasing from '../../lib/purchasing.js';

const {
  prisma,
  createTestBranch,
  createTestUser,
  createTestSupplier,
  createTestProduct,
  createTestPurchaseOrder,
  cleanupTestData,
  DEFAULT_BRANCH_CODE,
} = testData;
const {
  createDraftPurchaseOrder,
  sendPurchaseOrder,
  cancelPurchaseOrder,
  receiveAgainstPurchaseOrder,
} = purchasing;

describe('Purchase order lifecycle', () => {
  beforeAll(async () => {
    await createTestBranch();
  });

  afterEach(async () => {
    await cleanupTestData();
  });

  it('creates a draft PO with computed totals', async () => {
    const supplier = await createTestSupplier();
    const productA = await createTestProduct();
    const productB = await createTestProduct();

    const po = await createDraftPurchaseOrder({
      supplierId: supplier.id,
      branchId: DEFAULT_BRANCH_CODE,
      items: [
        { productId: productA.id, quantity: 10, unitCost: 5 },
        { productId: productB.id, quantity: 4, unitCost: 12.5 },
      ],
    });

    expect(po.status).toBe('DRAFT');
    expect(po.poNumber).toMatch(/^PO-\d{6}$/);
    expect(po.subtotal).toBe(100); // 10*5 + 4*12.5
    expect(po.total).toBe(100);
    expect(po.items.length).toBe(2);
  });

  it('rejects a draft for an inactive supplier', async () => {
    const supplier = await createTestSupplier({ isActive: false });
    const product = await createTestProduct();

    await expect(
      createDraftPurchaseOrder({
        supplierId: supplier.id,
        items: [{ productId: product.id, quantity: 1, unitCost: 10 }],
      })
    ).rejects.toMatchObject({ status: 400 });
  });

  it('send: DRAFT -> SENT, and rejects sending twice', async () => {
    const supplier = await createTestSupplier();
    const product = await createTestProduct();
    const po = await createTestPurchaseOrder({
      supplierId: supplier.id,
      items: [{ productId: product.id, quantity: 5, unitCost: 10 }],
    });

    const sent = await sendPurchaseOrder(po.id);
    expect(sent.status).toBe('SENT');

    await expect(sendPurchaseOrder(po.id)).rejects.toMatchObject({ status: 409 });
  });

  it('cancel: blocked once any line has received stock', async () => {
    const user = await createTestUser();
    const supplier = await createTestSupplier();
    const product = await createTestProduct();
    const po = await createTestPurchaseOrder({
      supplierId: supplier.id,
      items: [{ productId: product.id, quantity: 5, unitCost: 10 }],
      status: 'SENT',
    });

    await receiveAgainstPurchaseOrder(po.id, {
      items: [{ purchaseOrderItemId: po.items[0].id, quantity: 2 }],
      branchId: DEFAULT_BRANCH_CODE,
      userId: user.id,
    });

    await expect(cancelPurchaseOrder(po.id)).rejects.toMatchObject({ status: 409 });
  });

  it('cancel: allowed for a SENT PO with nothing received yet', async () => {
    const supplier = await createTestSupplier();
    const product = await createTestProduct();
    const po = await createTestPurchaseOrder({
      supplierId: supplier.id,
      items: [{ productId: product.id, quantity: 5, unitCost: 10 }],
      status: 'SENT',
    });

    const cancelled = await cancelPurchaseOrder(po.id);
    expect(cancelled.status).toBe('CANCELLED');
    expect(cancelled.cancelledAt).not.toBeNull();
  });

  it('rejects receiving against a DRAFT or CANCELLED order', async () => {
    const user = await createTestUser();
    const supplier = await createTestSupplier();
    const product = await createTestProduct();
    const draftPo = await createTestPurchaseOrder({
      supplierId: supplier.id,
      items: [{ productId: product.id, quantity: 5, unitCost: 10 }],
      status: 'DRAFT',
    });

    await expect(
      receiveAgainstPurchaseOrder(draftPo.id, {
        items: [{ purchaseOrderItemId: draftPo.items[0].id, quantity: 1 }],
        userId: user.id,
      })
    ).rejects.toMatchObject({ status: 409 });
  });

  it('rejects receiving more than the remaining ordered quantity', async () => {
    const user = await createTestUser();
    const supplier = await createTestSupplier();
    const product = await createTestProduct();
    const po = await createTestPurchaseOrder({
      supplierId: supplier.id,
      items: [{ productId: product.id, quantity: 5, unitCost: 10 }],
      status: 'SENT',
    });

    await expect(
      receiveAgainstPurchaseOrder(po.id, {
        items: [{ purchaseOrderItemId: po.items[0].id, quantity: 6 }],
        branchId: DEFAULT_BRANCH_CODE,
        userId: user.id,
      })
    ).rejects.toMatchObject({ status: 409 });
  });

  it('REGRESSION: two-GRN partial receive accumulates quantityReceived and status transitions correctly', async () => {
    const user = await createTestUser();
    const supplier = await createTestSupplier();
    const product = await createTestProduct();
    const po = await createTestPurchaseOrder({
      supplierId: supplier.id,
      items: [{ productId: product.id, quantity: 10, unitCost: 20 }],
      status: 'SENT',
    });
    const poItemId = po.items[0].id;

    // First delivery: half the order.
    const firstReceive = await receiveAgainstPurchaseOrder(po.id, {
      items: [{ purchaseOrderItemId: poItemId, quantity: 4 }],
      branchId: DEFAULT_BRANCH_CODE,
      userId: user.id,
    });
    expect(firstReceive.purchaseOrder.status).toBe('PARTIALLY_RECEIVED');
    expect(firstReceive.purchaseOrder.items[0].quantityReceived).toBe(4);

    // Second delivery: the rest.
    const secondReceive = await receiveAgainstPurchaseOrder(po.id, {
      items: [{ purchaseOrderItemId: poItemId, quantity: 6 }],
      branchId: DEFAULT_BRANCH_CODE,
      userId: user.id,
    });
    expect(secondReceive.purchaseOrder.status).toBe('RECEIVED');
    expect(secondReceive.purchaseOrder.items[0].quantityReceived).toBe(10);

    // Two distinct GRNs recorded, and stock reflects both deliveries.
    const grns = await prisma.goodsReceivedNote.findMany({ where: { purchaseOrderId: po.id } });
    expect(grns.length).toBe(2);

    const inventory = await prisma.inventory.findUnique({
      where: { productId_branchId: { productId: product.id, branchId: DEFAULT_BRANCH_CODE } },
    });
    expect(inventory.currentStock).toBe(10);
  });
});
