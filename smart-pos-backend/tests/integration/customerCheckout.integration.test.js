import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import testData from '../helpers/testData.js';
import saleFiscal from '../../lib/saleFiscal.js';

const { createTestBranch, createTestUser, createTestCustomer, createSellableProduct, cleanupTestData, DEFAULT_BRANCH_CODE } =
  testData;
const { createPendingSale } = saleFiscal;

describe('Checkout customer attribution', () => {
  beforeAll(async () => {
    await createTestBranch();
  });

  afterEach(async () => {
    await cleanupTestData();
  });

  it('walk-in sale (no customerId, no customerInfo) is completely unaffected', async () => {
    const user = await createTestUser();
    const product = await createSellableProduct({ stock: 10 });

    const sale = await createPendingSale({
      userId: user.id,
      branchId: DEFAULT_BRANCH_CODE,
      items: [{ productId: product.id, quantity: 1, price: 100 }],
    });

    expect(sale.customerId).toBeNull();
    expect(sale.customerName).toBeNull();
    expect(sale.customerTpin).toBeNull();
  });

  it('customerId only: snapshots name/tpin from the Customer record', async () => {
    const user = await createTestUser();
    const product = await createSellableProduct({ stock: 10 });
    const customer = await createTestCustomer({ name: 'TEST-Customer-Jane', tpin: '1000000001' });

    const sale = await createPendingSale({
      userId: user.id,
      branchId: DEFAULT_BRANCH_CODE,
      customerId: customer.id,
      items: [{ productId: product.id, quantity: 1, price: 100 }],
    });

    expect(sale.customerId).toBe(customer.id);
    expect(sale.customerName).toBe('TEST-Customer-Jane');
    expect(sale.customerTpin).toBe('1000000001');
  });

  it('customerId + explicit customerInfo override: the explicit override wins', async () => {
    const user = await createTestUser();
    const product = await createSellableProduct({ stock: 10 });
    const customer = await createTestCustomer({ name: 'TEST-Customer-Jane', tpin: '1000000001' });

    const sale = await createPendingSale({
      userId: user.id,
      branchId: DEFAULT_BRANCH_CODE,
      customerId: customer.id,
      customerInfo: { name: 'Walk-in Override', tpin: '2000000002' },
      items: [{ productId: product.id, quantity: 1, price: 100 }],
    });

    expect(sale.customerId).toBe(customer.id);
    expect(sale.customerName).toBe('Walk-in Override');
    expect(sale.customerTpin).toBe('2000000002');
  });

  it('rejects a missing customerId', async () => {
    const user = await createTestUser();
    const product = await createSellableProduct({ stock: 10 });

    await expect(
      createPendingSale({
        userId: user.id,
        branchId: DEFAULT_BRANCH_CODE,
        customerId: 'does-not-exist',
        items: [{ productId: product.id, quantity: 1, price: 100 }],
      })
    ).rejects.toMatchObject({ status: 400 });
  });

  it('rejects an inactive customerId', async () => {
    const user = await createTestUser();
    const product = await createSellableProduct({ stock: 10 });
    const customer = await createTestCustomer({ isActive: false });

    await expect(
      createPendingSale({
        userId: user.id,
        branchId: DEFAULT_BRANCH_CODE,
        customerId: customer.id,
        items: [{ productId: product.id, quantity: 1, price: 100 }],
      })
    ).rejects.toMatchObject({ status: 400 });
  });
});
