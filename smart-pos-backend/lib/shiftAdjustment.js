/**
 * The only way a recorded variance's story ever changes. Never touches
 * ZReport.expectedClosingCash or CashierDeclaration.declaredTotal — those
 * stay exactly what they were computed/declared as, forever. An adjustment
 * is a separate, additive, audited fact: "here's what management decided
 * about this variance," linked to the shift/Z it concerns.
 */

const prisma = require('./prisma');

async function createAdjustment(shiftId, { adjustedByUserId, reason, resolutionNote }) {
  if (!adjustedByUserId) {
    const err = new Error('adjustedByUserId is required');
    err.status = 400;
    throw err;
  }
  if (!reason || !String(reason).trim()) {
    const err = new Error('reason is required');
    err.status = 400;
    throw err;
  }
  if (!resolutionNote || !String(resolutionNote).trim()) {
    const err = new Error('resolutionNote is required');
    err.status = 400;
    throw err;
  }

  const shift = await prisma.shift.findUnique({ where: { id: shiftId } });
  if (!shift) {
    const err = new Error('Shift not found');
    err.status = 404;
    throw err;
  }
  if (shift.status !== 'CLOSED') {
    const err = new Error('An adjustment can only be recorded against a reconciled (closed) shift');
    err.status = 409;
    throw err;
  }

  const zReport = await prisma.zReport.findUnique({ where: { shiftId } });
  if (!zReport) {
    const err = new Error('No Z report exists for this shift');
    err.status = 409;
    throw err;
  }

  return prisma.shiftAdjustment.create({
    data: {
      shiftId,
      zReportId: zReport.id,
      adjustedByUserId,
      reason: String(reason).trim(),
      resolutionNote: String(resolutionNote).trim(),
    },
  });
}

async function listAdjustments(shiftId) {
  return prisma.shiftAdjustment.findMany({
    where: { shiftId },
    orderBy: { createdAt: 'asc' },
    include: { adjustedBy: { select: { id: true, name: true, email: true } } },
  });
}

module.exports = { createAdjustment, listAdjustments };
