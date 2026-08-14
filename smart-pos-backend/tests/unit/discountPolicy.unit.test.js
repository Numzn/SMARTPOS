import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import testData from '../helpers/testData.js';
import { ensureDefaultBusinessProfile } from '../../lib/ensureBusinessProfile.js';
import { getDiscountPolicy, canApplyDiscount, canRequestDiscount, DEFAULT_DISCOUNT_POLICY } from '../../lib/discountPolicy.js';

const { prisma, cleanupTestData } = testData;

// NUMZ POS discount policy — internal business policy, not a ZRA
// requirement. The default must be strict (cashier can neither apply nor
// request) so an existing installation that never touches this setting
// becomes strict, not permissive.
describe('lib/discountPolicy', () => {
  beforeAll(async () => {
    await ensureDefaultBusinessProfile();
  });

  afterEach(async () => {
    await cleanupTestData();
    // Restore BusinessProfile to the untouched default between tests.
    await prisma.businessProfile.update({ where: { id: 'default' }, data: { discountPolicy: DEFAULT_DISCOUNT_POLICY } });
  });

  describe('getDiscountPolicy', () => {
    it('returns the safe strict default when BusinessProfile has never been customized', async () => {
      const policy = await getDiscountPolicy(prisma);
      expect(policy).toMatchObject(DEFAULT_DISCOUNT_POLICY);
    });

    it('merges a partial stored policy over the defaults rather than replacing it wholesale', async () => {
      await prisma.businessProfile.update({ where: { id: 'default' }, data: { discountPolicy: { managerCanApply: false } } });
      const policy = await getDiscountPolicy(prisma);
      expect(policy.managerCanApply).toBe(false); // overridden
      expect(policy.cashierCanApply).toBe(false); // still the safe default
      expect(policy.approvalRequired).toBe(true); // still the safe default
    });

    it('falls back to the safe defaults if the stored value is malformed (not an object)', async () => {
      await prisma.businessProfile.update({ where: { id: 'default' }, data: { discountPolicy: 'not-an-object' } });
      const policy = await getDiscountPolicy(prisma);
      expect(policy).toMatchObject(DEFAULT_DISCOUNT_POLICY);
    });
  });

  describe('canApplyDiscount', () => {
    it('ADMIN can always apply, regardless of policy', () => {
      expect(canApplyDiscount('ADMIN', { managerCanApply: false, supervisorCanApply: false, cashierCanApply: false })).toBe(true);
    });

    it('MANAGER follows policy.managerCanApply (default true)', () => {
      expect(canApplyDiscount('MANAGER', DEFAULT_DISCOUNT_POLICY)).toBe(true);
      expect(canApplyDiscount('MANAGER', { ...DEFAULT_DISCOUNT_POLICY, managerCanApply: false })).toBe(false);
    });

    it('SUPERVISOR follows policy.supervisorCanApply (default false — strict)', () => {
      expect(canApplyDiscount('SUPERVISOR', DEFAULT_DISCOUNT_POLICY)).toBe(false);
      expect(canApplyDiscount('SUPERVISOR', { ...DEFAULT_DISCOUNT_POLICY, supervisorCanApply: true })).toBe(true);
    });

    it('CASHIER follows policy.cashierCanApply (default false — never threshold-based)', () => {
      expect(canApplyDiscount('CASHIER', DEFAULT_DISCOUNT_POLICY)).toBe(false);
      expect(canApplyDiscount('CASHIER', { ...DEFAULT_DISCOUNT_POLICY, cashierCanApply: true })).toBe(true);
    });

    it('VIEWER or an unknown role can never apply', () => {
      expect(canApplyDiscount('VIEWER', DEFAULT_DISCOUNT_POLICY)).toBe(false);
      expect(canApplyDiscount('SOMETHING_ELSE', DEFAULT_DISCOUNT_POLICY)).toBe(false);
    });
  });

  describe('canRequestDiscount', () => {
    it('apply authority implies request authority', () => {
      expect(canRequestDiscount('MANAGER', DEFAULT_DISCOUNT_POLICY)).toBe(true);
      expect(canRequestDiscount('ADMIN', DEFAULT_DISCOUNT_POLICY)).toBe(true);
    });

    it('CASHIER cannot request by default, even though the field exists for future use', () => {
      expect(canRequestDiscount('CASHIER', DEFAULT_DISCOUNT_POLICY)).toBe(false);
      expect(canRequestDiscount('CASHIER', { ...DEFAULT_DISCOUNT_POLICY, cashierCanRequest: true })).toBe(true);
    });

    it('SUPERVISOR without apply authority still cannot request unless explicitly configured', () => {
      // Only CASHIER has a dedicated "request" toggle today — a SUPERVISOR
      // without apply authority has no request path either, by design (the
      // policy only names cashierCanRequest, per the approved default model).
      expect(canRequestDiscount('SUPERVISOR', DEFAULT_DISCOUNT_POLICY)).toBe(false);
    });
  });
});
