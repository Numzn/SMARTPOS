import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import testData from '../helpers/testData.js';
import saleFiscal from '../../lib/saleFiscal.js';
import tillLock from '../../lib/tillLock.js';

const { createTestBranch, createTestUser, createTestProduct, cleanupTestData, prisma, DEFAULT_BRANCH_CODE } =
  testData;
const { createPendingSale } = saleFiscal;
const { openSession, scanItem } = tillLock;

async function committedSession(userId, items) {
  const session = await openSession(userId, DEFAULT_BRANCH_CODE);
  for (const item of items) {
    await scanItem(session.id, userId, item);
  }
  return session;
}

// Item 15*/POS Control Phase 1 — checkout validates the submitted cart
// against the till session's server-recorded committed lines, atomically
// with Sale creation. This is the actual enforcement behind "the cart can't
// silently shrink after the customer sees a total": even a hand-crafted
// checkout request can't submit less than what was scanned.
describe('createPendingSale — till-session validation', () => {
  beforeAll(async () => {
    await createTestBranch();
  });

  afterEach(async () => {
    await cleanupTestData();
  });

  it('happy path: submitted items exactly matching the committed session succeed and consume it', async () => {
    const user = await createTestUser();
    const product = await createTestProduct({ price: 20 });
    const session = await committedSession(user.id, [{ productId: product.id, quantity: 5, unitPrice: 20 }]);

    const sale = await createPendingSale({
      userId: user.id,
      branchId: DEFAULT_BRANCH_CODE,
      tillSessionId: session.id,
      items: [{ productId: product.id, quantity: 5, price: 20 }],
    });

    expect(sale.subtotal).toBe(100);

    const refreshedSession = await prisma.cashierCartSession.findUnique({ where: { id: session.id } });
    expect(refreshedSession.status).toBe('CONSUMED');
  });

  it('rejects a checkout submitting fewer items than the committed session (the core fraud scenario)', async () => {
    const user = await createTestUser();
    const productA = await createTestProduct({ price: 20 });
    const productB = await createTestProduct({ price: 30 });
    const session = await committedSession(user.id, [
      { productId: productA.id, quantity: 5, unitPrice: 20 },
      { productId: productB.id, quantity: 1, unitPrice: 30 },
    ]);

    // Cashier "quietly" submits only one of the two committed lines.
    await expect(
      createPendingSale({
        userId: user.id,
        branchId: DEFAULT_BRANCH_CODE,
        tillSessionId: session.id,
        items: [{ productId: productA.id, quantity: 5, price: 20 }],
      })
    ).rejects.toMatchObject({ status: 409 });

    // The session survives the rejected attempt, unchanged, still usable.
    const refreshedSession = await prisma.cashierCartSession.findUnique({ where: { id: session.id } });
    expect(refreshedSession.status).toBe('OPEN');
  });

  it('rejects a checkout submitting a smaller quantity than committed', async () => {
    const user = await createTestUser();
    const product = await createTestProduct({ price: 20 });
    const session = await committedSession(user.id, [{ productId: product.id, quantity: 5, unitPrice: 20 }]);

    await expect(
      createPendingSale({
        userId: user.id,
        branchId: DEFAULT_BRANCH_CODE,
        tillSessionId: session.id,
        items: [{ productId: product.id, quantity: 3, price: 20 }],
      })
    ).rejects.toMatchObject({ status: 409 });
  });

  it('rejects a checkout submitting a different price than committed', async () => {
    const user = await createTestUser();
    const product = await createTestProduct({ price: 20 });
    const session = await committedSession(user.id, [{ productId: product.id, quantity: 5, unitPrice: 20 }]);

    await expect(
      createPendingSale({
        userId: user.id,
        branchId: DEFAULT_BRANCH_CODE,
        tillSessionId: session.id,
        items: [{ productId: product.id, quantity: 5, price: 5 }],
      })
    ).rejects.toMatchObject({ status: 409 });
  });

  it('rejects checkout against a session owned by a different user', async () => {
    const owner = await createTestUser();
    const intruder = await createTestUser();
    const product = await createTestProduct({ price: 20 });
    const session = await committedSession(owner.id, [{ productId: product.id, quantity: 1, unitPrice: 20 }]);

    await expect(
      createPendingSale({
        userId: intruder.id,
        branchId: DEFAULT_BRANCH_CODE,
        tillSessionId: session.id,
        items: [{ productId: product.id, quantity: 1, price: 20 }],
      })
    ).rejects.toMatchObject({ status: 403 });
  });

  it('rejects a second checkout attempt against an already-consumed session (no double-spend)', async () => {
    const user = await createTestUser();
    const product = await createTestProduct({ price: 20 });
    const session = await committedSession(user.id, [{ productId: product.id, quantity: 1, unitPrice: 20 }]);

    await createPendingSale({
      userId: user.id,
      branchId: DEFAULT_BRANCH_CODE,
      tillSessionId: session.id,
      items: [{ productId: product.id, quantity: 1, price: 20 }],
    });

    await expect(
      createPendingSale({
        userId: user.id,
        branchId: DEFAULT_BRANCH_CODE,
        tillSessionId: session.id,
        items: [{ productId: product.id, quantity: 1, price: 20 }],
      })
    ).rejects.toMatchObject({ status: 409 });
  });

  it('a checkout with no tillSessionId at all is unaffected — bare/admin sale creation still works', async () => {
    const user = await createTestUser();
    const product = await createTestProduct({ price: 20 });

    const sale = await createPendingSale({
      userId: user.id,
      branchId: DEFAULT_BRANCH_CODE,
      items: [{ productId: product.id, quantity: 1, price: 20 }],
    });

    expect(sale.subtotal).toBe(20);
  });
});
