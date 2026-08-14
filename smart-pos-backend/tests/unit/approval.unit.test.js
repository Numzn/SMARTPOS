import { describe, it, expect, afterEach } from 'vitest';
import bcrypt from 'bcryptjs';
import testData from '../helpers/testData.js';
import { requestApproval, consumeApproval } from '../../lib/approval.js';

const { createTestUser, cleanupTestData, prisma } = testData;

async function hash(secret) {
  return bcrypt.hash(secret, 4); // low cost factor — tests only
}

describe('lib/approval — supervisor step-up tickets', () => {
  afterEach(async () => {
    await cleanupTestData();
  });

  describe('requestApproval', () => {
    it('mints a ticket for an active MANAGER with the correct password', async () => {
      const manager = await createTestUser({ role: 'MANAGER', password: await hash('mgr-pass') });

      const ticket = await requestApproval(prisma, {
        approverUserId: manager.id,
        credential: 'mgr-pass',
        method: 'PASSWORD',
        actionType: 'ORDER_DISCOUNT',
        sessionId: 'session-1',
        target: { discountAmount: 50 },
      });

      expect(ticket.approverUserId).toBe(manager.id);
      expect(ticket.consumedAt).toBeNull();
      expect(ticket.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    it('mints a ticket for an active SUPERVISOR with the correct PIN', async () => {
      const supervisor = await createTestUser({ role: 'SUPERVISOR', pinHash: await hash('1234') });

      const ticket = await requestApproval(prisma, {
        approverUserId: supervisor.id,
        credential: '1234',
        method: 'PIN',
        actionType: 'LINE_REVERSAL',
        sessionId: 'session-1',
        target: { productId: 'prod-1', quantity: 2 },
      });

      expect(ticket.authMethod).toBe('PIN');
      expect(ticket.targetProductId).toBe('prod-1');
      expect(ticket.targetQuantity).toBe(2);
    });

    it('rejects a CASHIER approver — rank too low', async () => {
      const cashier = await createTestUser({ role: 'CASHIER', pinHash: await hash('1234') });

      await expect(
        requestApproval(prisma, {
          approverUserId: cashier.id,
          credential: '1234',
          method: 'PIN',
          actionType: 'LINE_REVERSAL',
          sessionId: 's1',
          target: { productId: 'p1', quantity: 1 },
        })
      ).rejects.toMatchObject({ status: 403 });
    });

    it('rejects an incorrect PIN', async () => {
      const supervisor = await createTestUser({ role: 'SUPERVISOR', pinHash: await hash('1234') });

      await expect(
        requestApproval(prisma, {
          approverUserId: supervisor.id,
          credential: '9999',
          method: 'PIN',
          actionType: 'LINE_REVERSAL',
          sessionId: 's1',
          target: { productId: 'p1', quantity: 1 },
        })
      ).rejects.toMatchObject({ status: 403 });
    });

    it('rejects an inactive approver even with the right credential', async () => {
      const supervisor = await createTestUser({ role: 'SUPERVISOR', pinHash: await hash('1234'), isActive: false });

      await expect(
        requestApproval(prisma, {
          approverUserId: supervisor.id,
          credential: '1234',
          method: 'PIN',
          actionType: 'LINE_REVERSAL',
          sessionId: 's1',
          target: { productId: 'p1', quantity: 1 },
        })
      ).rejects.toMatchObject({ status: 403 });
    });

    it('rejects an approver who has never set a PIN', async () => {
      const supervisor = await createTestUser({ role: 'SUPERVISOR' }); // no pinHash

      await expect(
        requestApproval(prisma, {
          approverUserId: supervisor.id,
          credential: '1234',
          method: 'PIN',
          actionType: 'LINE_REVERSAL',
          sessionId: 's1',
          target: { productId: 'p1', quantity: 1 },
        })
      ).rejects.toMatchObject({ status: 403 });
    });

    it('rejects an unsupported auth method', async () => {
      const supervisor = await createTestUser({ role: 'SUPERVISOR', pinHash: await hash('1234') });

      await expect(
        requestApproval(prisma, {
          approverUserId: supervisor.id,
          credential: '1234',
          method: 'CARD', // not implemented yet
          actionType: 'LINE_REVERSAL',
          sessionId: 's1',
          target: { productId: 'p1', quantity: 1 },
        })
      ).rejects.toMatchObject({ status: 400 });
    });
  });

  describe('consumeApproval', () => {
    async function mintTicket(overrides = {}) {
      const supervisor = await createTestUser({ role: 'SUPERVISOR', pinHash: await hash('1234') });
      const ticket = await requestApproval(prisma, {
        approverUserId: supervisor.id,
        credential: '1234',
        method: 'PIN',
        actionType: 'LINE_REVERSAL',
        sessionId: 'session-A',
        target: { productId: 'prod-1', quantity: 2 },
        ...overrides,
      });
      return { supervisor, ticket };
    }

    it('consumes a matching ticket exactly once and returns the approver', async () => {
      const { supervisor, ticket } = await mintTicket();

      const approver = await consumeApproval(prisma, ticket.id, {
        actionType: 'LINE_REVERSAL',
        sessionId: 'session-A',
        target: { productId: 'prod-1', quantity: 2 },
      });
      expect(approver.id).toBe(supervisor.id);

      const refreshed = await prisma.supervisorApproval.findUnique({ where: { id: ticket.id } });
      expect(refreshed.consumedAt).not.toBeNull();
    });

    it('rejects reusing an already-consumed ticket', async () => {
      const { ticket } = await mintTicket();
      await consumeApproval(prisma, ticket.id, {
        actionType: 'LINE_REVERSAL',
        sessionId: 'session-A',
        target: { productId: 'prod-1', quantity: 2 },
      });

      await expect(
        consumeApproval(prisma, ticket.id, {
          actionType: 'LINE_REVERSAL',
          sessionId: 'session-A',
          target: { productId: 'prod-1', quantity: 2 },
        })
      ).rejects.toMatchObject({ status: 403 });
    });

    it('rejects a ticket used for a different product', async () => {
      const { ticket } = await mintTicket();
      await expect(
        consumeApproval(prisma, ticket.id, {
          actionType: 'LINE_REVERSAL',
          sessionId: 'session-A',
          target: { productId: 'prod-DIFFERENT', quantity: 2 },
        })
      ).rejects.toMatchObject({ status: 403 });
    });

    it('rejects a ticket used for a different quantity', async () => {
      const { ticket } = await mintTicket();
      await expect(
        consumeApproval(prisma, ticket.id, {
          actionType: 'LINE_REVERSAL',
          sessionId: 'session-A',
          target: { productId: 'prod-1', quantity: 999 },
        })
      ).rejects.toMatchObject({ status: 403 });
    });

    it('rejects a ticket used for a different session', async () => {
      const { ticket } = await mintTicket();
      await expect(
        consumeApproval(prisma, ticket.id, {
          actionType: 'LINE_REVERSAL',
          sessionId: 'session-DIFFERENT',
          target: { productId: 'prod-1', quantity: 2 },
        })
      ).rejects.toMatchObject({ status: 403 });
    });

    it('rejects a ticket used for a different action type', async () => {
      const { ticket } = await mintTicket();
      await expect(
        consumeApproval(prisma, ticket.id, {
          actionType: 'ORDER_DISCOUNT',
          sessionId: 'session-A',
          target: { discountAmount: 2 },
        })
      ).rejects.toMatchObject({ status: 403 });
    });

    it('rejects an expired ticket', async () => {
      const { ticket } = await mintTicket();
      await prisma.supervisorApproval.update({
        where: { id: ticket.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      await expect(
        consumeApproval(prisma, ticket.id, {
          actionType: 'LINE_REVERSAL',
          sessionId: 'session-A',
          target: { productId: 'prod-1', quantity: 2 },
        })
      ).rejects.toMatchObject({ status: 403 });
    });

    it('rejects when no approvalId is supplied at all', async () => {
      await expect(
        consumeApproval(prisma, undefined, {
          actionType: 'LINE_REVERSAL',
          sessionId: 'session-A',
          target: { productId: 'prod-1', quantity: 2 },
        })
      ).rejects.toMatchObject({ status: 403 });
    });

    it('rejects an approvalId that does not exist', async () => {
      await expect(
        consumeApproval(prisma, 'nonexistent-ticket-id', {
          actionType: 'LINE_REVERSAL',
          sessionId: 'session-A',
          target: { productId: 'prod-1', quantity: 2 },
        })
      ).rejects.toMatchObject({ status: 403 });
    });

    it('an ORDER_DISCOUNT ticket matches within a small float epsilon', async () => {
      const supervisor = await createTestUser({ role: 'MANAGER', password: await hash('mgr-pass') });
      const ticket = await requestApproval(prisma, {
        approverUserId: supervisor.id,
        credential: 'mgr-pass',
        method: 'PASSWORD',
        actionType: 'ORDER_DISCOUNT',
        sessionId: null,
        target: { discountAmount: 50.004999 },
      });

      const approver = await consumeApproval(prisma, ticket.id, {
        actionType: 'ORDER_DISCOUNT',
        sessionId: null,
        target: { discountAmount: 50.005 },
      });
      expect(approver.id).toBe(supervisor.id);
    });
  });
});
