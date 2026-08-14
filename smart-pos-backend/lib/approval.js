/**
 * Supervisor step-up approval — short-lived, single-use, action-bound
 * authorization tickets (SupervisorApproval). Deliberately not a reusable
 * credential: a ticket authorizes exactly one action on one session/target
 * and is consumed atomically inside the same transaction as that action.
 *
 * `requestApproval` is the only place a raw PIN/password is ever checked.
 * Everything downstream (till-lock reversals, order-level discount approval)
 * only ever sees an `approvalId`, never the credential itself.
 */
const bcrypt = require('bcryptjs');
const { ROLE_RANK } = require('../middleware/auth');

const APPROVAL_TTL_MS = 3 * 60 * 1000; // 3 minutes — long enough to type a PIN, short enough not to become a standing credential.

/**
 * Verify an approver's PIN/password and mint an approval ticket bound to one
 * specific action. `db` is either the raw prisma client or an active `tx` —
 * this is normally called standalone (POST /api/till/approvals), outside any
 * other transaction.
 */
async function requestApproval(db, { approverUserId, credential, method, actionType, sessionId, target = {} }) {
  if (!approverUserId || !credential) {
    const err = new Error('Supervisor approval requires approverUserId and a credential');
    err.status = 403;
    throw err;
  }
  if (!['PIN', 'PASSWORD'].includes(method)) {
    const err = new Error(`Unsupported approval method: ${method}`);
    err.status = 400;
    throw err;
  }
  if (!['LINE_REVERSAL', 'ORDER_DISCOUNT'].includes(actionType)) {
    const err = new Error(`Unsupported approval action type: ${actionType}`);
    err.status = 400;
    throw err;
  }

  const approver = await db.user.findUnique({ where: { id: approverUserId } });
  if (!approver || !approver.isActive || (ROLE_RANK[approver.role] ?? -1) < ROLE_RANK.SUPERVISOR) {
    const err = new Error('Approver must be an active supervisor, manager, or admin');
    err.status = 403;
    throw err;
  }

  const secretHash = method === 'PIN' ? approver.pinHash : approver.password;
  if (!secretHash) {
    const err = new Error(method === 'PIN' ? 'Approver has not set a PIN' : 'Approver has no password on file');
    err.status = 403;
    throw err;
  }

  const credentialOk = await bcrypt.compare(credential, secretHash);
  if (!credentialOk) {
    const err = new Error(method === 'PIN' ? 'Incorrect PIN' : 'Incorrect password');
    err.status = 403;
    throw err;
  }

  return db.supervisorApproval.create({
    data: {
      approverUserId: approver.id,
      actionType,
      sessionId,
      targetProductId: target.productId ?? null,
      targetQuantity: target.quantity ?? null,
      targetDiscountAmount: target.discountAmount ?? null,
      authMethod: method,
      expiresAt: new Date(Date.now() + APPROVAL_TTL_MS),
    },
  });
}

function targetsMatch(approval, target = {}) {
  if (approval.actionType === 'LINE_REVERSAL') {
    return approval.targetProductId === (target.productId ?? null) && approval.targetQuantity === (target.quantity ?? null);
  }
  if (approval.actionType === 'ORDER_DISCOUNT') {
    // Currency comparison — allow a tiny epsilon for float accumulation.
    const a = approval.targetDiscountAmount ?? 0;
    const b = target.discountAmount ?? 0;
    return Math.abs(a - b) < 0.01;
  }
  return false;
}

/**
 * Consume a previously-issued ticket for exactly the action/session/target
 * it was minted for. Must be called from inside the same transaction as the
 * action it authorizes — `db` here is expected to be an active `tx`.
 */
async function consumeApproval(tx, approvalId, { actionType, sessionId, target = {} }) {
  // A single stable code for every "you need a fresh approval ticket"
  // outcome (never tried, mismatched, expired, or already used) — lets a
  // caller like CheckoutModal reliably show the approval prompt without
  // fragile string-matching on the message.
  if (!approvalId) {
    const err = new Error(`This action requires supervisor approval (${actionType})`);
    err.status = 403;
    err.code = 'APPROVAL_REQUIRED';
    throw err;
  }

  // Row-lock so two concurrent consumers of the same ticket can't both pass
  // the "not yet consumed" check before either writes consumedAt back.
  const locked = await tx.$queryRaw`SELECT id FROM supervisor_approvals WHERE id = ${approvalId} FOR UPDATE`;
  if (!locked.length) {
    const err = new Error('Approval not found');
    err.status = 403;
    err.code = 'APPROVAL_REQUIRED';
    throw err;
  }

  const approval = await tx.supervisorApproval.findUnique({ where: { id: approvalId } });

  if (approval.actionType !== actionType || approval.sessionId !== sessionId || !targetsMatch(approval, target)) {
    const err = new Error('Approval does not match the requested action');
    err.status = 403;
    err.code = 'APPROVAL_REQUIRED';
    throw err;
  }
  if (approval.consumedAt) {
    const err = new Error('Approval has already been used');
    err.status = 403;
    err.code = 'APPROVAL_REQUIRED';
    throw err;
  }
  if (approval.expiresAt.getTime() < Date.now()) {
    const err = new Error('Approval has expired — request a new one');
    err.status = 403;
    err.code = 'APPROVAL_REQUIRED';
    throw err;
  }

  await tx.supervisorApproval.update({
    where: { id: approvalId },
    data: { consumedAt: new Date() },
  });

  return tx.user.findUnique({ where: { id: approval.approverUserId } });
}

module.exports = { requestApproval, consumeApproval, targetsMatch, APPROVAL_TTL_MS };
