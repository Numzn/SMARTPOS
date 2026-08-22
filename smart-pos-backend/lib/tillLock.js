/**
 * Till-lock — the cashier "committed cart" (POS Control Phase 1). See
 * prisma/schema.prisma's CashierCartSession/CashierCartLine comments:
 * deliberately non-fiscal, never touches VSDC or SaleStatus.
 *
 * Core invariant: committed quantity may only ever increase without
 * approval (scanItem). Decreasing or removing a line (reverseLine) requires
 * a matching, unexpired, unconsumed LINE_REVERSAL approval ticket
 * (lib/approval.js), consumed atomically with the change — never trusts
 * client-side state.
 *
 * Audit logging is done by the route layer, not here — matches
 * lib/purchasing.js/lib/receiving.js, where lib functions mutate data and
 * routes/*.js do the logging after the fact.
 */
const prisma = require('./prisma');
const { DEFAULT_BRANCH } = require('./inventoryStock');
const { consumeApproval } = require('./approval');

function ownershipError() {
  const err = new Error('You do not own this till session');
  err.status = 403;
  return err;
}

async function loadOwnedSession(db, sessionId, userId) {
  const session = await db.cashierCartSession.findUnique({ where: { id: sessionId } });
  if (!session) {
    const err = new Error('Till session not found');
    err.status = 404;
    throw err;
  }
  if (session.userId !== userId) {
    throw ownershipError();
  }
  return session;
}

async function openSession(userId, branchId = DEFAULT_BRANCH) {
  return prisma.cashierCartSession.create({
    data: { userId, branchId, status: 'OPEN' },
  });
}

/**
 * Add a product, or increase an existing active line's quantity. Always
 * free — this can only ever increase what's charged, never a fraud vector.
 *
 * clientScanId (optional) is the till's own locally-generated scan/click
 * identity (see smart-pos-frontend's durable scan journal). When present,
 * replaying the same clientScanId for this session — e.g. the till retrying
 * after it never saw the first response — is a no-op that returns the
 * original result, instead of incrementing quantity a second time. Without
 * it (older/other callers), behavior is unchanged: always applied.
 */
async function scanItem(sessionId, userId, { productId, quantity, unitPrice, clientScanId }) {
  const qty = parseInt(quantity, 10);
  if (!Number.isFinite(qty) || qty <= 0) {
    const err = new Error('quantity must be a positive integer');
    err.status = 400;
    throw err;
  }

  return prisma.$transaction(async (tx) => {
    const session = await loadOwnedSession(tx, sessionId, userId);
    if (session.status !== 'OPEN') {
      const err = new Error(`Cannot scan into a ${session.status.toLowerCase()} till session`);
      err.status = 409;
      throw err;
    }

    if (clientScanId) {
      const priorEvent = await tx.cashierScanEvent.findUnique({
        where: { sessionId_clientScanId: { sessionId, clientScanId } },
      });
      if (priorEvent) {
        // Already applied — return current line state, do not re-increment.
        return tx.cashierCartLine.findUnique({
          where: { sessionId_productId: { sessionId, productId } },
        });
      }
    }

    const existing = await tx.cashierCartLine.findUnique({
      where: { sessionId_productId: { sessionId, productId } },
    });

    let line;
    if (existing && existing.status === 'ACTIVE') {
      line = await tx.cashierCartLine.update({
        where: { id: existing.id },
        data: { quantity: existing.quantity + qty },
      });
    } else if (existing) {
      // A previously-reversed line being re-scanned is a fresh commitment,
      // not an increase on the old (now-dead) one.
      line = await tx.cashierCartLine.update({
        where: { id: existing.id },
        data: { quantity: qty, unitPrice, status: 'ACTIVE' },
      });
    } else {
      line = await tx.cashierCartLine.create({
        data: { sessionId, productId, quantity: qty, unitPrice, status: 'ACTIVE' },
      });
    }

    if (clientScanId) {
      await tx.cashierScanEvent.create({
        data: { sessionId, clientScanId, productId, quantity: qty, unitPrice },
      });
    }

    return line;
  });
}

/**
 * Reduce or fully remove a committed line. Requires a LINE_REVERSAL
 * approval ticket matching this exact session/product/quantity-delta,
 * consumed inside the same transaction as the mutation.
 */
async function reverseLine(sessionId, userId, productId, { toQuantity, approvalId, reasonCode, reasonNote }) {
  const nextQty = parseInt(toQuantity, 10);
  if (!Number.isFinite(nextQty) || nextQty < 0) {
    const err = new Error('toQuantity must be a non-negative integer');
    err.status = 400;
    throw err;
  }
  if (!reasonCode) {
    const err = new Error('A reason is required for a reversal');
    err.status = 400;
    throw err;
  }

  return prisma.$transaction(async (tx) => {
    const session = await loadOwnedSession(tx, sessionId, userId);
    const line = await tx.cashierCartLine.findUnique({
      where: { sessionId_productId: { sessionId, productId } },
    });
    if (!line || line.status !== 'ACTIVE') {
      const err = new Error('No active line for that product in this session');
      err.status = 404;
      throw err;
    }
    if (nextQty >= line.quantity) {
      const err = new Error('A reversal must strictly decrease quantity — use scan to increase');
      err.status = 400;
      throw err;
    }

    const previousQuantity = line.quantity;
    const reducedBy = previousQuantity - nextQty;

    const approver = await consumeApproval(tx, approvalId, {
      actionType: 'LINE_REVERSAL',
      sessionId,
      target: { productId, quantity: reducedBy },
    });

    const updated = await tx.cashierCartLine.update({
      where: { id: line.id },
      data: nextQty === 0 ? { quantity: 0, status: 'REVERSED' } : { quantity: nextQty },
    });

    return { line: updated, previousQuantity, approver, branchId: session.branchId };
  });
}

async function abandonSession(sessionId, userId) {
  return prisma.$transaction(async (tx) => {
    const session = await loadOwnedSession(tx, sessionId, userId);
    if (session.status !== 'OPEN') return session;
    return tx.cashierCartSession.update({
      where: { id: sessionId },
      data: { status: 'ABANDONED' },
    });
  });
}

async function getSessionLines(sessionId, userId) {
  const session = await loadOwnedSession(prisma, sessionId, userId);
  const lines = await prisma.cashierCartLine.findMany({
    where: { sessionId, status: 'ACTIVE' },
    include: { product: { select: { id: true, name: true, sku: true } } },
  });
  return { session, lines };
}

module.exports = { openSession, scanItem, reverseLine, abandonSession, getSessionLines };
