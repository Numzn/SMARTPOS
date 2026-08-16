/**
 * The cashier's physical cash count — submitted independently of the till/
 * POS session, against a shift that has already been through the PIN-gated
 * endShift() (so a ZReport already exists and its expectedClosingCash is
 * already frozen). Deliberately immutable once created: a wrong declaration
 * is corrected via a ShiftAdjustment (lib/shiftAdjustment.js) after
 * reconciliation, never by re-submitting this.
 */

const prisma = require('./prisma');
const { backfillZReport } = require('./shift');

async function submitDeclaration(shiftId, { declaredByUserId, declaredTotal, denominations }) {
  if (!declaredByUserId) {
    const err = new Error('declaredByUserId is required');
    err.status = 400;
    throw err;
  }

  const total = Number(declaredTotal);
  if (!Number.isFinite(total) || total < 0) {
    const err = new Error('declaredTotal must be a non-negative number');
    err.status = 400;
    throw err;
  }

  if (denominations != null) {
    if (!Array.isArray(denominations)) {
      const err = new Error('denominations must be an array of {value, count}');
      err.status = 400;
      throw err;
    }
    for (const d of denominations) {
      if (!Number.isFinite(Number(d?.value)) || !Number.isFinite(Number(d?.count)) || Number(d.count) < 0) {
        const err = new Error('Each denomination entry needs a numeric value and a non-negative count');
        err.status = 400;
        throw err;
      }
    }
  }

  const shift = await prisma.shift.findUnique({ where: { id: shiftId } });
  if (!shift) {
    const err = new Error('Shift not found');
    err.status = 404;
    throw err;
  }
  if (shift.status !== 'PENDING_RECONCILIATION') {
    const err = new Error('A declaration can only be submitted for a shift awaiting reconciliation');
    err.status = 409;
    throw err;
  }
  if (shift.userId !== declaredByUserId) {
    const err = new Error('Only the cashier who worked this shift can submit its declaration');
    err.status = 403;
    throw err;
  }

  // Normally a ZReport already exists by the time a declaration is
  // submitted (endShift() freezes it). The one exception is a shift that
  // reached PENDING_RECONCILIATION before this feature shipped — for that
  // legacy case, backfill here rather than blocking the cashier.
  // authorizedByUserId is a required field (schema), so it's attributed to
  // the cashier submitting the declaration for now; closeShift() reassigns
  // it to the reconciler when the shift is actually closed out, since a
  // cashier authorizing their own Z is only ever a placeholder, not real
  // segregation of duties.
  let zReport = await prisma.zReport.findUnique({ where: { shiftId } });
  if (!zReport) {
    zReport = await prisma.$transaction((tx) => backfillZReport(tx, shiftId, { triggeredByUserId: declaredByUserId }));
  }

  const existing = await prisma.cashierDeclaration.findUnique({ where: { shiftId } });
  if (existing) {
    const err = new Error('A declaration has already been submitted for this shift');
    err.status = 409;
    err.code = 'DECLARATION_ALREADY_SUBMITTED';
    throw err;
  }

  return prisma.cashierDeclaration.create({
    data: {
      shiftId,
      zReportId: zReport.id,
      declaredByUserId,
      declaredTotal: total,
      denominations: denominations ?? null,
    },
  });
}

async function getDeclaration(shiftId) {
  return prisma.cashierDeclaration.findUnique({ where: { shiftId } });
}

module.exports = { submitDeclaration, getDeclaration };
