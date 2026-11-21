/**
 * Forecourt attendant CRUD. Attendant is deliberately NOT a User role — see
 * the schema comment on the Attendant model. Mirrors lib/register.js's
 * createRegister/listRegisters/updateRegister style.
 */

const prisma = require('../prisma');
const { DEFAULT_BRANCH } = require('../inventoryStock');

const VALID_ATTENDANT_STATUSES = ['ACTIVE', 'INACTIVE'];

async function createAttendant({ name, attendantCode, branchId = DEFAULT_BRANCH, userId } = {}) {
  if (!name || !String(name).trim()) {
    const err = new Error('name is required');
    err.status = 400;
    throw err;
  }
  if (!attendantCode || !String(attendantCode).trim()) {
    const err = new Error('attendantCode is required');
    err.status = 400;
    throw err;
  }

  const branch = await prisma.branch.findUnique({ where: { code: branchId } });
  if (!branch) {
    const err = new Error(`No branch with code "${branchId}"`);
    err.status = 400;
    throw err;
  }

  if (userId) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      const err = new Error('User not found');
      err.status = 400;
      throw err;
    }
    const existingAttendant = await prisma.attendant.findUnique({ where: { userId } });
    if (existingAttendant) {
      const err = new Error('User is already linked to another attendant');
      err.status = 400;
      throw err;
    }
  }

  return prisma.attendant.create({
    data: {
      name: String(name).trim(),
      attendantCode: String(attendantCode).trim(),
      branchId,
      userId: userId || null,
    },
  });
}

async function listAttendants({ branchId, includeInactive = false } = {}) {
  return prisma.attendant.findMany({
    where: {
      ...(branchId ? { branchId } : {}),
      // Attendant/Pump gate "active" via an enum status field, unlike
      // Register/Till's boolean isActive (lib/register.js) — deliberately
      // different conventions, not a typo, since AttendantStatus/PumpStatus
      // have a third MAINTENANCE-style state Register/Till don't need.
      ...(includeInactive ? {} : { status: 'ACTIVE' }),
    },
    orderBy: { name: 'asc' },
  });
}

async function updateAttendant(id, { name, status } = {}) {
  const data = {};
  if (name != null) data.name = String(name).trim();
  if (status != null) {
    if (!VALID_ATTENDANT_STATUSES.includes(status)) {
      const err = new Error(`status must be one of: ${VALID_ATTENDANT_STATUSES.join(', ')}`);
      err.status = 400;
      throw err;
    }
    data.status = status;
  }

  const attendant = await prisma.attendant.findUnique({ where: { id } });
  if (!attendant) {
    const err = new Error('Attendant not found');
    err.status = 404;
    throw err;
  }

  return prisma.attendant.update({ where: { id }, data });
}

module.exports = {
  createAttendant,
  listAttendants,
  updateAttendant,
};
