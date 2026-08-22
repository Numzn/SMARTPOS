import { describe, it, expect, afterEach } from 'vitest';
import testData from '../helpers/testData.js';
import tillLock from '../../lib/tillLock.js';
import { requestApproval } from '../../lib/approval.js';
import bcrypt from 'bcryptjs';

const { createTestUser, createTestProduct, cleanupTestData, prisma, DEFAULT_BRANCH_CODE } = testData;
const { openSession, scanItem, reverseLine, abandonSession, getSessionLines } = tillLock;

async function reversalTicket(sessionId, productId, reducedBy) {
  const supervisor = await createTestUser({ role: 'SUPERVISOR', pinHash: await bcrypt.hash('1234', 4) });
  const ticket = await requestApproval(prisma, {
    approverUserId: supervisor.id,
    credential: '1234',
    method: 'PIN',
    actionType: 'LINE_REVERSAL',
    sessionId,
    target: { productId, quantity: reducedBy },
  });
  return ticket.id;
}

describe('lib/tillLock — committed cart', () => {
  afterEach(async () => {
    await cleanupTestData();
  });

  it('openSession creates an OPEN session owned by the given user', async () => {
    const cashier = await createTestUser();
    const session = await openSession(cashier.id, DEFAULT_BRANCH_CODE);
    expect(session.userId).toBe(cashier.id);
    expect(session.status).toBe('OPEN');
  });

  it('scanItem creates a new ACTIVE line', async () => {
    const cashier = await createTestUser();
    const product = await createTestProduct();
    const session = await openSession(cashier.id);

    const line = await scanItem(session.id, cashier.id, { productId: product.id, quantity: 3, unitPrice: 10 });

    expect(line.status).toBe('ACTIVE');
    expect(line.quantity).toBe(3);
    expect(line.unitPrice).toBe(10);
  });

  it('scanning the same product again increases quantity — always free, no approval', async () => {
    const cashier = await createTestUser();
    const product = await createTestProduct();
    const session = await openSession(cashier.id);

    await scanItem(session.id, cashier.id, { productId: product.id, quantity: 3, unitPrice: 10 });
    const line = await scanItem(session.id, cashier.id, { productId: product.id, quantity: 2, unitPrice: 10 });

    expect(line.quantity).toBe(5);
  });

  it('scanItem with a clientScanId is idempotent — replaying the same id does not re-increment', async () => {
    const cashier = await createTestUser();
    const product = await createTestProduct();
    const session = await openSession(cashier.id);

    const first = await scanItem(session.id, cashier.id, {
      productId: product.id,
      quantity: 1,
      unitPrice: 10,
      clientScanId: 'scan-A',
    });
    expect(first.quantity).toBe(1);

    // Simulates the till retrying after it never saw the first response.
    const replay = await scanItem(session.id, cashier.id, {
      productId: product.id,
      quantity: 1,
      unitPrice: 10,
      clientScanId: 'scan-A',
    });
    expect(replay.quantity).toBe(1);
  });

  it('scanItem treats distinct clientScanIds for the same product as distinct legitimate scans', async () => {
    const cashier = await createTestUser();
    const product = await createTestProduct();
    const session = await openSession(cashier.id);

    await scanItem(session.id, cashier.id, { productId: product.id, quantity: 1, unitPrice: 10, clientScanId: 'scan-A' });
    await scanItem(session.id, cashier.id, { productId: product.id, quantity: 1, unitPrice: 10, clientScanId: 'scan-B' });
    const line = await scanItem(session.id, cashier.id, {
      productId: product.id,
      quantity: 1,
      unitPrice: 10,
      clientScanId: 'scan-C',
    });

    // Same barcode/product scanned three times, three different scan
    // identities — must fold to quantity 3, never collapse to 1.
    expect(line.quantity).toBe(3);
  });

  it('scanItem without a clientScanId behaves exactly as before (no idempotency tracking)', async () => {
    const cashier = await createTestUser();
    const product = await createTestProduct();
    const session = await openSession(cashier.id);

    await scanItem(session.id, cashier.id, { productId: product.id, quantity: 1, unitPrice: 10 });
    const line = await scanItem(session.id, cashier.id, { productId: product.id, quantity: 1, unitPrice: 10 });

    expect(line.quantity).toBe(2);
  });

  it('rejects scanning into a session owned by someone else', async () => {
    const owner = await createTestUser();
    const intruder = await createTestUser();
    const product = await createTestProduct();
    const session = await openSession(owner.id);

    await expect(
      scanItem(session.id, intruder.id, { productId: product.id, quantity: 1, unitPrice: 10 })
    ).rejects.toMatchObject({ status: 403 });
  });

  it('rejects a non-positive quantity', async () => {
    const cashier = await createTestUser();
    const product = await createTestProduct();
    const session = await openSession(cashier.id);

    await expect(
      scanItem(session.id, cashier.id, { productId: product.id, quantity: 0, unitPrice: 10 })
    ).rejects.toMatchObject({ status: 400 });
  });

  it('rejects scanning into a session that is already CONSUMED/ABANDONED', async () => {
    const cashier = await createTestUser();
    const product = await createTestProduct();
    const session = await openSession(cashier.id);
    await abandonSession(session.id, cashier.id);

    await expect(
      scanItem(session.id, cashier.id, { productId: product.id, quantity: 1, unitPrice: 10 })
    ).rejects.toMatchObject({ status: 409 });
  });

  it('reverseLine reduces quantity with a valid matching approval ticket', async () => {
    const cashier = await createTestUser();
    const product = await createTestProduct();
    const session = await openSession(cashier.id);
    await scanItem(session.id, cashier.id, { productId: product.id, quantity: 5, unitPrice: 10 });

    const approvalId = await reversalTicket(session.id, product.id, 2); // 5 -> 3, reduced by 2
    const { line, previousQuantity } = await reverseLine(session.id, cashier.id, product.id, {
      toQuantity: 3,
      approvalId,
      reasonCode: 'CUSTOMER_CHANGED_MIND',
    });

    expect(previousQuantity).toBe(5);
    expect(line.quantity).toBe(3);
    expect(line.status).toBe('ACTIVE');
  });

  it('reversing to zero marks the line REVERSED', async () => {
    const cashier = await createTestUser();
    const product = await createTestProduct();
    const session = await openSession(cashier.id);
    await scanItem(session.id, cashier.id, { productId: product.id, quantity: 5, unitPrice: 10 });

    const approvalId = await reversalTicket(session.id, product.id, 5);
    const { line } = await reverseLine(session.id, cashier.id, product.id, {
      toQuantity: 0,
      approvalId,
      reasonCode: 'WRONG_ITEM',
    });

    expect(line.status).toBe('REVERSED');
    expect(line.quantity).toBe(0);
  });

  it('rejects a reversal with no approval ticket', async () => {
    const cashier = await createTestUser();
    const product = await createTestProduct();
    const session = await openSession(cashier.id);
    await scanItem(session.id, cashier.id, { productId: product.id, quantity: 5, unitPrice: 10 });

    await expect(
      reverseLine(session.id, cashier.id, product.id, { toQuantity: 3, reasonCode: 'X' })
    ).rejects.toMatchObject({ status: 403 });
  });

  it('rejects a reversal whose ticket was minted for a different quantity delta', async () => {
    const cashier = await createTestUser();
    const product = await createTestProduct();
    const session = await openSession(cashier.id);
    await scanItem(session.id, cashier.id, { productId: product.id, quantity: 5, unitPrice: 10 });

    // Ticket authorizes reducing by 1, but the request tries to reduce by 2.
    const approvalId = await reversalTicket(session.id, product.id, 1);

    await expect(
      reverseLine(session.id, cashier.id, product.id, { toQuantity: 3, approvalId, reasonCode: 'X' })
    ).rejects.toMatchObject({ status: 403 });
  });

  it('rejects "reversing" upward — must use scan to increase', async () => {
    const cashier = await createTestUser();
    const product = await createTestProduct();
    const session = await openSession(cashier.id);
    await scanItem(session.id, cashier.id, { productId: product.id, quantity: 5, unitPrice: 10 });
    const approvalId = await reversalTicket(session.id, product.id, -2);

    await expect(
      reverseLine(session.id, cashier.id, product.id, { toQuantity: 7, approvalId, reasonCode: 'X' })
    ).rejects.toMatchObject({ status: 400 });
  });

  it('rejects a reversal by someone who does not own the session', async () => {
    const owner = await createTestUser();
    const intruder = await createTestUser();
    const product = await createTestProduct();
    const session = await openSession(owner.id);
    await scanItem(session.id, owner.id, { productId: product.id, quantity: 5, unitPrice: 10 });
    const approvalId = await reversalTicket(session.id, product.id, 2);

    await expect(
      reverseLine(session.id, intruder.id, product.id, { toQuantity: 3, approvalId, reasonCode: 'X' })
    ).rejects.toMatchObject({ status: 403 });
  });

  it('abandonSession is ownership-checked and marks the session ABANDONED', async () => {
    const owner = await createTestUser();
    const intruder = await createTestUser();
    const session = await openSession(owner.id);

    await expect(abandonSession(session.id, intruder.id)).rejects.toMatchObject({ status: 403 });

    const abandoned = await abandonSession(session.id, owner.id);
    expect(abandoned.status).toBe('ABANDONED');
  });

  it('getSessionLines returns only ACTIVE lines and is ownership-checked', async () => {
    const owner = await createTestUser();
    const intruder = await createTestUser();
    const productA = await createTestProduct();
    const productB = await createTestProduct();
    const session = await openSession(owner.id);
    await scanItem(session.id, owner.id, { productId: productA.id, quantity: 2, unitPrice: 5 });
    await scanItem(session.id, owner.id, { productId: productB.id, quantity: 1, unitPrice: 8 });
    const approvalId = await reversalTicket(session.id, productB.id, 1);
    await reverseLine(session.id, owner.id, productB.id, { toQuantity: 0, approvalId, reasonCode: 'X' });

    const { lines } = await getSessionLines(session.id, owner.id);
    expect(lines).toHaveLength(1);
    expect(lines[0].productId).toBe(productA.id);

    await expect(getSessionLines(session.id, intruder.id)).rejects.toMatchObject({ status: 403 });
  });
});
