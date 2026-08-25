import { describe, it, expect, afterEach } from 'vitest';
import bcrypt from 'bcryptjs';
import testData from '../helpers/testData.js';
import shiftLib from '../../lib/shift.js';
import approvalLib from '../../lib/approval.js';

const {
  prisma,
  createTestBranch,
  createTestUser,
  createTestRegister,
  createTestTill,
  cleanupTestData,
  DEFAULT_BRANCH_CODE,
} = testData;
const {
  openShiftForTill,
  getCurrentShiftCashier,
  getOperatingCashier,
  isAuthorizedCashier,
  isShiftParticipant,
  handoverShift,
  endShift,
  recordCashMovement,
  openShift,
  getActiveShiftForTill,
  getCurrentOperatingShiftForUser,
} = shiftLib;
const { requestApproval } = approvalLib;

async function hash(secret) {
  return bcrypt.hash(secret, 4);
}

async function setupTill(defaultOpeningFloat = 0) {
  await createTestBranch();
  const register = await createTestRegister({ branchId: DEFAULT_BRANCH_CODE });
  return createTestTill({ registerId: register.id, defaultOpeningFloat });
}

// V1 register/till model. openShift()/ensureShiftForLogin() (the pre-existing
// (userId, branchId) flow) are covered by cashRegister.integration.test.js
// and shiftInitialization.integration.test.js and are untouched by this work
// — these tests only cover the new parallel path.
describe('lib/shift — V1 register/till model', () => {
  afterEach(async () => {
    await cleanupTestData();
  });

  describe('openShiftForTill', () => {
    it('requires tillId and userId', async () => {
      const till = await setupTill();
      const user = await createTestUser();
      await expect(openShiftForTill({ userId: user.id })).rejects.toMatchObject({ status: 400 });
      await expect(openShiftForTill({ tillId: till.id })).rejects.toMatchObject({ status: 400 });
    });

    it('404s for a non-existent till', async () => {
      const user = await createTestUser();
      await expect(openShiftForTill({ tillId: 'not-real', userId: user.id })).rejects.toMatchObject({ status: 404 });
    });

    it('defaults the opening float to the till\'s own defaultOpeningFloat when not declared', async () => {
      const till = await setupTill(400);
      const user = await createTestUser();
      const shift = await openShiftForTill({ tillId: till.id, userId: user.id });
      expect(shift.openingFloat).toBe(400);
      expect(shift.tillId).toBe(till.id);
      expect(shift.branchId).toBe(DEFAULT_BRANCH_CODE);
    });

    it('a declared opening amount overrides the till default for this specific shift', async () => {
      const till = await setupTill(400);
      const user = await createTestUser();
      const shift = await openShiftForTill({ tillId: till.id, userId: user.id, declaredOpeningCash: 250 });
      expect(shift.openingFloat).toBe(250);

      // The till's own default is untouched by one shift overriding it.
      const refreshedTill = await prisma.till.findUnique({ where: { id: till.id } });
      expect(refreshedTill.defaultOpeningFloat).toBe(400);
    });

    it('creates an OPENING CashierDeclaration recording the physical count', async () => {
      const till = await setupTill(100);
      const user = await createTestUser();
      const shift = await openShiftForTill({ tillId: till.id, userId: user.id, declaredOpeningCash: 100 });

      const declaration = await prisma.cashierDeclaration.findFirst({ where: { shiftId: shift.id, type: 'OPENING' } });
      expect(declaration).toBeTruthy();
      expect(declaration.declaredTotal).toBe(100);
      expect(declaration.declaredByUserId).toBe(user.id);
    });

    it('records the opening cashier in ShiftCashier — the currently-active participant', async () => {
      const till = await setupTill();
      const user = await createTestUser();
      const shift = await openShiftForTill({ tillId: till.id, userId: user.id });

      const current = await getCurrentShiftCashier(shift.id);
      expect(current.userId).toBe(user.id);
      expect(current.endedAt).toBeNull();
    });

    it('rejects opening a second shift on a till that already has an active one', async () => {
      const till = await setupTill();
      const user = await createTestUser();
      await openShiftForTill({ tillId: till.id, userId: user.id });
      const other = await createTestUser();
      await expect(openShiftForTill({ tillId: till.id, userId: other.id })).rejects.toMatchObject({
        status: 409,
        code: 'TILL_ALREADY_HAS_ACTIVE_SHIFT',
      });
    });

    it('two near-simultaneous opens for the same till: exactly one succeeds, the DB has exactly one active shift', async () => {
      const till = await setupTill();
      const users = await Promise.all(Array.from({ length: 5 }, () => createTestUser()));

      // Real concurrent calls (not sequential awaits) — this is what
      // actually exercises the race, since the pre-check inside
      // openShiftForTill runs before the transaction and cannot by itself
      // serialize two callers that both pass it before either commits.
      const results = await Promise.allSettled(users.map((u) => openShiftForTill({ tillId: till.id, userId: u.id })));

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(4);
      for (const r of rejected) {
        expect(r.reason).toMatchObject({ status: 409, code: 'TILL_ALREADY_HAS_ACTIVE_SHIFT' });
      }

      const activeRows = await prisma.shift.findMany({
        where: { tillId: till.id, status: { in: ['OPEN', 'INITIALIZING'] } },
      });
      expect(activeRows).toHaveLength(1);
    });

    it('rejects opening a shift on an inactive till', async () => {
      const till = await setupTill();
      await prisma.till.update({ where: { id: till.id }, data: { isActive: false } });
      const user = await createTestUser();
      await expect(openShiftForTill({ tillId: till.id, userId: user.id })).rejects.toMatchObject({ status: 409 });
    });
  });

  describe('handoverShift', () => {
    it('requires toUserId, a non-negative declaredTotal, and a different incoming cashier', async () => {
      const till = await setupTill();
      const alice = await createTestUser();
      const shift = await openShiftForTill({ tillId: till.id, userId: alice.id });

      await expect(
        handoverShift(shift.id, { fromUserId: alice.id, declaredTotal: 100 })
      ).rejects.toMatchObject({ status: 400 });

      const brian = await createTestUser();
      await expect(
        handoverShift(shift.id, { fromUserId: alice.id, toUserId: brian.id, declaredTotal: -5 })
      ).rejects.toMatchObject({ status: 400 });

      await expect(
        handoverShift(shift.id, { fromUserId: alice.id, toUserId: alice.id, declaredTotal: 100 })
      ).rejects.toMatchObject({ status: 400 });
    });

    it('rejects a handover attempted by anyone other than the shift\'s current cashier', async () => {
      const till = await setupTill();
      const alice = await createTestUser();
      const brian = await createTestUser();
      const mallory = await createTestUser();
      const shift = await openShiftForTill({ tillId: till.id, userId: alice.id });

      // Alice is the current cashier, not Mallory — Mallory attempting a
      // handover (to a distinct third user) must be rejected on ownership,
      // not accidentally short-circuited by some other check.
      await expect(
        handoverShift(shift.id, { fromUserId: mallory.id, toUserId: brian.id, declaredTotal: 100 })
      ).rejects.toMatchObject({ status: 403 });
    });

    it('does NOT close the shift — it stays OPEN, cash movements keep working under the new cashier', async () => {
      const till = await setupTill(100);
      const alice = await createTestUser();
      const brian = await createTestUser();
      const shift = await openShiftForTill({ tillId: till.id, userId: alice.id, declaredOpeningCash: 100 });

      const result = await handoverShift(shift.id, { fromUserId: alice.id, toUserId: brian.id, declaredTotal: 100 });
      expect(result.declaration.expectedCash).toBe(100);
      expect(result.declaration.variance).toBe(0);

      const refreshed = await prisma.shift.findUnique({ where: { id: shift.id } });
      expect(refreshed.status).toBe('OPEN'); // requirement: a declaration never closes the shift

      // Brian can now operate the till.
      await expect(
        recordCashMovement(shift.id, { type: 'CASH_IN', amount: 50, userId: brian.id })
      ).resolves.toBeTruthy();
    });

    it('closes the outgoing ShiftCashier row and opens a new one for the incoming cashier — full handover chain (Alice -> Brian)', async () => {
      const till = await setupTill();
      const alice = await createTestUser();
      const brian = await createTestUser();
      const shift = await openShiftForTill({ tillId: till.id, userId: alice.id });

      await handoverShift(shift.id, { fromUserId: alice.id, toUserId: brian.id, declaredTotal: 0 });

      const current = await getCurrentShiftCashier(shift.id);
      expect(current.userId).toBe(brian.id);

      const aliceTurn = await prisma.shiftCashier.findFirst({ where: { shiftId: shift.id, userId: alice.id } });
      expect(aliceTurn.endedAt).not.toBeNull();

      // Brian can now hand it off again — the chain isn't limited to one swap.
      const carol = await createTestUser();
      await handoverShift(shift.id, { fromUserId: brian.id, toUserId: carol.id, declaredTotal: 0 });
      const finalCurrent = await getCurrentShiftCashier(shift.id);
      expect(finalCurrent.userId).toBe(carol.id);

      const handoverDeclarations = await prisma.cashierDeclaration.findMany({
        where: { shiftId: shift.id, type: 'HANDOVER' },
      });
      expect(handoverDeclarations).toHaveLength(2); // one per handover — many-per-shift is allowed
    });

    it('rejects a handover on a shift with no ShiftCashier history (opened through the legacy flow)', async () => {
      const user = await createTestUser();
      const other = await createTestUser();
      const legacyShift = await testData.createTestShift({ userId: user.id });

      await expect(
        handoverShift(legacyShift.id, { fromUserId: user.id, toUserId: other.id, declaredTotal: 0 })
      ).rejects.toMatchObject({ status: 409, code: 'NO_ACTIVE_SHIFT_CASHIER' });
    });
  });

  describe('endShift closes out the active ShiftCashier row', () => {
    it('sets endedAt on whoever is currently on the shift when it ends', async () => {
      const till = await setupTill();
      const alice = await createTestUser();
      const brian = await createTestUser({ role: 'SUPERVISOR', pinHash: await hash('1234') });
      const shift = await openShiftForTill({ tillId: till.id, userId: alice.id });

      const approval = await requestApproval(prisma, {
        approverUserId: brian.id,
        requesterUserId: alice.id,
        credential: '1234',
        method: 'PIN',
        actionType: 'SHIFT_END',
        sessionId: null,
        target: { shiftId: shift.id },
      });
      await endShift(shift.id, { approvalId: approval.id });

      const current = await getCurrentShiftCashier(shift.id);
      expect(current).toBeNull();
      const aliceTurn = await prisma.shiftCashier.findFirst({ where: { shiftId: shift.id, userId: alice.id } });
      expect(aliceTurn.endedAt).not.toBeNull();
    });

    it('is a no-op for a legacy (userId, branchId) shift with no ShiftCashier rows at all', async () => {
      const user = await createTestUser();
      const supervisor = await createTestUser({ role: 'SUPERVISOR', pinHash: await hash('1234') });
      const legacyShift = await testData.createTestShift({ userId: user.id });

      const approval = await requestApproval(prisma, {
        approverUserId: supervisor.id,
        requesterUserId: user.id,
        credential: '1234',
        method: 'PIN',
        actionType: 'SHIFT_END',
        sessionId: null,
        target: { shiftId: legacyShift.id },
      });
      await expect(endShift(legacyShift.id, { approvalId: approval.id })).resolves.toBeTruthy();
    });
  });

  describe('getCurrentOperatingShiftForUser — the single unified "current shift" resolver', () => {
    it('finds a legacy (userId, branchId) shift, same as getOpenShiftForUser always did', async () => {
      const user = await createTestUser();
      const legacyShift = await openShift({ userId: user.id, branchId: DEFAULT_BRANCH_CODE, openingFloat: 0 });
      const found = await getCurrentOperatingShiftForUser(user.id, DEFAULT_BRANCH_CODE);
      expect(found.id).toBe(legacyShift.id);
    });

    it('finds a till-based shift for whoever the CURRENT ShiftCashier is, not who opened it — the exact case a handover needs to work at all', async () => {
      const till = await setupTill();
      const alice = await createTestUser();
      const brian = await createTestUser();
      const shift = await openShiftForTill({ tillId: till.id, userId: alice.id });
      await handoverShift(shift.id, { fromUserId: alice.id, toUserId: brian.id, declaredTotal: 0 });

      // Brian is now operating it, even though shift.userId is still Alice's id.
      const forBrian = await getCurrentOperatingShiftForUser(brian.id, DEFAULT_BRANCH_CODE);
      expect(forBrian.id).toBe(shift.id);
      expect(forBrian.userId).toBe(alice.id); // Shift.userId is unchanged — "who opened it"

      // Alice's turn already ended — she no longer resolves to this shift.
      const forAlice = await getCurrentOperatingShiftForUser(alice.id, DEFAULT_BRANCH_CODE);
      expect(forAlice).toBeNull();
    });

    it('returns null for a user with neither a legacy shift nor a current ShiftCashier turn', async () => {
      const user = await createTestUser();
      const found = await getCurrentOperatingShiftForUser(user.id, DEFAULT_BRANCH_CODE);
      expect(found).toBeNull();
    });
  });

  describe('getActiveShiftForTill', () => {
    it('returns null when a till has no active shift', async () => {
      const till = await setupTill();
      expect(await getActiveShiftForTill(till.id)).toBeNull();
    });

    it('returns the OPEN shift for a till, and null again once it ends', async () => {
      const till = await setupTill();
      const alice = await createTestUser();
      const supervisor = await createTestUser({ role: 'SUPERVISOR', pinHash: await hash('1234') });
      const shift = await openShiftForTill({ tillId: till.id, userId: alice.id });

      const found = await getActiveShiftForTill(till.id);
      expect(found.id).toBe(shift.id);

      const approval = await requestApproval(prisma, {
        approverUserId: supervisor.id,
        requesterUserId: alice.id,
        credential: '1234',
        method: 'PIN',
        actionType: 'SHIFT_END',
        sessionId: null,
        target: { shiftId: shift.id },
      });
      await endShift(shift.id, { approvalId: approval.id });

      expect(await getActiveShiftForTill(till.id)).toBeNull();
    });
  });

  it('REGRESSION: the two new partial unique indexes exist — their absence would silently allow more than one OPENING/CLOSING declaration, or two concurrently-active cashiers, per shift', async () => {
    const declRows = await prisma.$queryRaw`
      SELECT indexname FROM pg_indexes WHERE indexname IN (
        'cashier_declarations_one_opening_per_shift',
        'cashier_declarations_one_closing_per_shift'
      )
    `;
    expect(declRows).toHaveLength(2);

    const cashierRows = await prisma.$queryRaw`
      SELECT indexdef FROM pg_indexes WHERE indexname = 'shift_cashiers_one_active_per_shift'
    `;
    expect(cashierRows).toHaveLength(1);
    expect(cashierRows[0].indexdef).toContain('"endedAt" IS NULL');
  });

  it('REGRESSION: the shifts_active_till_key partial index exists — its absence would silently allow two active shifts on one till', async () => {
    const rows = await prisma.$queryRaw`
      SELECT indexdef FROM pg_indexes WHERE indexname = 'shifts_active_till_key'
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0].indexdef).toContain('"tillId"');
    expect(rows[0].indexdef).toContain("'OPEN'");
    expect(rows[0].indexdef).toContain("'INITIALIZING'");
  });

  // Corrective work: canRecordMovement(), the /:id/end ownership check, and
  // submitDeclaration() all used to authorize write actions against
  // shift.userId — the original opener — which is wrong for a till-based
  // shift once it's been handed off. These are the lib-level tests for the
  // shared resolution they now all defer to.
  describe('isAuthorizedCashier / getOperatingCashier / isShiftParticipant — centralized active-cashier resolution', () => {
    it('the original opener is authorized before any handover', async () => {
      const till = await setupTill();
      const alice = await createTestUser();
      const shift = await openShiftForTill({ tillId: till.id, userId: alice.id });

      expect(await isAuthorizedCashier(shift, alice.id)).toBe(true);
      const operating = await getOperatingCashier(shift.id);
      expect(operating.userId).toBe(alice.id);
    });

    it('after a handover, only the incoming cashier is authorized — the original opener is not', async () => {
      const till = await setupTill();
      const alice = await createTestUser();
      const brian = await createTestUser();
      const shift = await openShiftForTill({ tillId: till.id, userId: alice.id });
      await handoverShift(shift.id, { fromUserId: alice.id, toUserId: brian.id, declaredTotal: 0 });

      expect(await isAuthorizedCashier(shift, brian.id)).toBe(true);
      expect(await isAuthorizedCashier(shift, alice.id)).toBe(false);
    });

    it('after a second handover, only the newest cashier is authorized — proves this resolves the CURRENT turn, not "any previous cashier"', async () => {
      const till = await setupTill();
      const alice = await createTestUser();
      const brian = await createTestUser();
      const carol = await createTestUser();
      const shift = await openShiftForTill({ tillId: till.id, userId: alice.id });
      await handoverShift(shift.id, { fromUserId: alice.id, toUserId: brian.id, declaredTotal: 0 });
      await handoverShift(shift.id, { fromUserId: brian.id, toUserId: carol.id, declaredTotal: 0 });

      expect(await isAuthorizedCashier(shift, carol.id)).toBe(true);
      expect(await isAuthorizedCashier(shift, brian.id)).toBe(false);
      expect(await isAuthorizedCashier(shift, alice.id)).toBe(false);
    });

    it('once the shift ends, getOperatingCashier still names whoever was operating it right before — authorizing their closing declaration — even though getCurrentShiftCashier goes null', async () => {
      const till = await setupTill();
      const alice = await createTestUser();
      const brian = await createTestUser();
      const supervisor = await createTestUser({ role: 'SUPERVISOR', pinHash: await hash('1234') });
      const shift = await openShiftForTill({ tillId: till.id, userId: alice.id });
      await handoverShift(shift.id, { fromUserId: alice.id, toUserId: brian.id, declaredTotal: 0 });

      const approval = await requestApproval(prisma, {
        approverUserId: supervisor.id,
        requesterUserId: brian.id,
        credential: '1234',
        method: 'PIN',
        actionType: 'SHIFT_END',
        sessionId: null,
        target: { shiftId: shift.id },
      });
      await endShift(shift.id, { approvalId: approval.id });

      expect(await getCurrentShiftCashier(shift.id)).toBeNull();
      const ended = await prisma.shift.findUnique({ where: { id: shift.id } });
      expect(await isAuthorizedCashier(ended, brian.id)).toBe(true);
      expect(await isAuthorizedCashier(ended, alice.id)).toBe(false);
    });

    it('a legacy (userId, branchId) shift with no ShiftCashier history is authorized by shift.userId alone', async () => {
      const alice = await createTestUser();
      const someoneElse = await createTestUser();
      const shift = await openShift({ userId: alice.id, openingFloat: 0 });

      expect(await getOperatingCashier(shift.id)).toBeNull();
      expect(await isAuthorizedCashier(shift, alice.id)).toBe(true);
      expect(await isAuthorizedCashier(shift, someoneElse.id)).toBe(false);
    });

    it('isShiftParticipant is true for everyone who ever held the till, even after their turn ended — the basis for SELF_RECONCILE_DENIED', async () => {
      const till = await setupTill();
      const alice = await createTestUser();
      const brian = await createTestUser();
      const carol = await createTestUser();
      const outsider = await createTestUser();
      const shift = await openShiftForTill({ tillId: till.id, userId: alice.id });
      await handoverShift(shift.id, { fromUserId: alice.id, toUserId: brian.id, declaredTotal: 0 });
      await handoverShift(shift.id, { fromUserId: brian.id, toUserId: carol.id, declaredTotal: 0 });

      expect(await isShiftParticipant(shift.id, alice.id)).toBe(true);
      expect(await isShiftParticipant(shift.id, brian.id)).toBe(true);
      expect(await isShiftParticipant(shift.id, carol.id)).toBe(true);
      expect(await isShiftParticipant(shift.id, outsider.id)).toBe(false);
    });
  });
});
