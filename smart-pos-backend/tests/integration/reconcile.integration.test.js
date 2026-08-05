import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import testData from '../helpers/testData.js';
import fiscalReconcile from '../../lib/fiscalReconcile.js';

const {
  createTestBranch,
  createTestUser,
  createSellableProduct,
  createTestSale,
  cleanupTestData,
  DEFAULT_BRANCH_CODE,
} = testData;
const { reconcileStuckPendingSale } = fiscalReconcile;

// Full retry-and-complete coverage for reconcileStuckPendingSale needs a live
// mock VSDC and belongs in the broader e2e suite (scripts/validate-system.js).
// This covers the claim guard added alongside it: two overlapping reconcile
// passes (or a reconcile pass racing a manual retry) must not both attempt to
// finalize the same sale.
describe('reconcileStuckPendingSale claim guard', () => {
  beforeAll(async () => {
    await createTestBranch();
  });

  afterEach(async () => {
    await cleanupTestData();
  });

  it('skips a sale that has already moved out of PENDING (claimed by another pass)', async () => {
    const user = await createTestUser();
    const product = await createSellableProduct({ stock: 10 });
    const sale = await createTestSale({
      userId: user.id,
      productId: product.id,
      quantity: 1,
      status: 'FISCAL_FAILED',
    });

    const action = await reconcileStuckPendingSale(sale, { branchId: DEFAULT_BRANCH_CODE });
    expect(action).toEqual({ saleId: sale.id, action: 'skipped_already_claimed' });
  });

  it('skips a sale that has already completed (claimed by another pass)', async () => {
    const user = await createTestUser();
    const product = await createSellableProduct({ stock: 10 });
    const sale = await createTestSale({
      userId: user.id,
      productId: product.id,
      quantity: 1,
      status: 'COMPLETED',
    });

    const action = await reconcileStuckPendingSale(sale, { branchId: DEFAULT_BRANCH_CODE });
    expect(action).toEqual({ saleId: sale.id, action: 'skipped_already_claimed' });
  });
});
