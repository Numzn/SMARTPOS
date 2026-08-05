import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import testData from '../helpers/testData.js';
import inventoryStock from '../../lib/inventoryStock.js';

const { createTestBranch, createSellableProduct, cleanupTestData, DEFAULT_BRANCH_CODE } = testData;
const { assertSufficientStock } = inventoryStock;

describe('assertSufficientStock', () => {
  beforeAll(async () => {
    await createTestBranch();
  });

  afterEach(async () => {
    await cleanupTestData();
  });

  it('passes when requested quantity is within available stock', async () => {
    const product = await createSellableProduct({ stock: 10 });
    // assertSufficientStock resolves with no return value — this asserts it
    // does not throw, not that it hands back a particular value.
    await expect(
      assertSufficientStock([{ productId: product.id, quantity: 5 }], DEFAULT_BRANCH_CODE)
    ).resolves.toBeUndefined();
  });

  it('rejects with 409 when requested quantity exceeds available stock', async () => {
    const product = await createSellableProduct({ stock: 3 });
    await expect(
      assertSufficientStock([{ productId: product.id, quantity: 4 }], DEFAULT_BRANCH_CODE)
    ).rejects.toMatchObject({ status: 409 });
  });

  it('rejects with 400 on a zero or negative quantity', async () => {
    const product = await createSellableProduct({ stock: 10 });
    await expect(
      assertSufficientStock([{ productId: product.id, quantity: 0 }], DEFAULT_BRANCH_CODE)
    ).rejects.toMatchObject({ status: 400 });

    await expect(
      assertSufficientStock([{ productId: product.id, quantity: -2 }], DEFAULT_BRANCH_CODE)
    ).rejects.toMatchObject({ status: 400 });
  });

  it('rejects with 400 when the items array is empty', async () => {
    await expect(assertSufficientStock([], DEFAULT_BRANCH_CODE)).rejects.toMatchObject({ status: 400 });
  });
});
