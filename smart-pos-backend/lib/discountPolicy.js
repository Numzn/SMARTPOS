/**
 * Discount authorization policy — NUMZ POS business policy, NOT a ZRA
 * requirement. ZRA defines only the fiscal *representation* of a discount
 * (dcRt/dcAmt, cashDcRt/cashDcAmt); who is allowed to apply/request/approve
 * one is entirely ours to decide, stored on the existing BusinessProfile
 * singleton (smallest extension of the existing settings architecture —
 * no new tenant/company model introduced here).
 *
 * Default policy is deliberately strict: an existing installation that has
 * never touched this setting gets the safe default (cashier can neither
 * apply nor request), not the old "under 10% is free" behavior.
 */
const prisma = require('./prisma');

const DEFAULT_DISCOUNT_POLICY = {
  cashierCanApply: false,
  cashierCanRequest: false,
  supervisorCanApply: false,
  managerCanApply: true,
  approvalRequired: true,
  // Reserved for future per-role percentage caps — not enforced yet.
  // { CASHIER: 0, SUPERVISOR: null, MANAGER: null, ADMIN: null }
  discountLimits: {},
};

/**
 * Loads the current policy, defensively merged over the safe defaults so a
 * missing/partial/malformed BusinessProfile.discountPolicy JSON can never
 * produce a more permissive result than the default. `db` is either the raw
 * prisma client or an active `tx`.
 */
async function getDiscountPolicy(db = prisma) {
  const profile = await db.businessProfile.findUnique({ where: { id: 'default' } });
  const stored = profile?.discountPolicy && typeof profile.discountPolicy === 'object' ? profile.discountPolicy : {};
  return { ...DEFAULT_DISCOUNT_POLICY, ...stored };
}

/**
 * Whether `role` may apply a discount directly — i.e. is self-authorized,
 * no supervisor-approval ticket needed. ADMIN is always true by rank, not
 * policy-configurable (matches the approved default: "Admin/Owner: YES").
 */
function canApplyDiscount(role, policy) {
  switch (role) {
    case 'ADMIN':
      return true;
    case 'MANAGER':
      return Boolean(policy.managerCanApply);
    case 'SUPERVISOR':
      return Boolean(policy.supervisorCanApply);
    case 'CASHIER':
      return Boolean(policy.cashierCanApply);
    default:
      return false;
  }
}

/**
 * Whether `role` may at least *request* a discount (i.e. type a value and
 * have it go through the existing supervisor-approval-ticket flow at
 * checkout). Apply authority implies request authority trivially.
 */
function canRequestDiscount(role, policy) {
  if (canApplyDiscount(role, policy)) return true;
  if (role === 'CASHIER') return Boolean(policy.cashierCanRequest);
  return false;
}

module.exports = {
  DEFAULT_DISCOUNT_POLICY,
  getDiscountPolicy,
  canApplyDiscount,
  canRequestDiscount,
};
