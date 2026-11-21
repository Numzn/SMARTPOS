/**
 * Forecourt pump CRUD. Pump is deliberately independent of Register/Till —
 * see the schema comment on the Pump model. Mirrors lib/register.js's
 * createRegister/listRegisters/updateRegister style.
 */

const prisma = require('../prisma');
const { DEFAULT_BRANCH } = require('../inventoryStock');

const VALID_PUMP_STATUSES = ['ACTIVE', 'INACTIVE', 'MAINTENANCE'];

async function createPump({ code, name, branchId = DEFAULT_BRANCH } = {}) {
  if (!code || !String(code).trim()) {
    const err = new Error('code is required');
    err.status = 400;
    throw err;
  }

  const branch = await prisma.branch.findUnique({ where: { code: branchId } });
  if (!branch) {
    const err = new Error(`No branch with code "${branchId}"`);
    err.status = 400;
    throw err;
  }

  return prisma.pump.create({
    data: {
      code: String(code).trim(),
      name: name ? String(name).trim() : null,
      branchId,
    },
  });
}

async function listPumps({ branchId, includeInactive = false } = {}) {
  return prisma.pump.findMany({
    where: {
      ...(branchId ? { branchId } : {}),
      // Attendant/Pump gate "active" via an enum status field, unlike
      // Register/Till's boolean isActive (lib/register.js) — deliberately
      // different conventions, not a typo, since AttendantStatus/PumpStatus
      // have a third MAINTENANCE-style state Register/Till don't need.
      ...(includeInactive ? {} : { status: 'ACTIVE' }),
    },
    orderBy: { code: 'asc' },
  });
}

async function updatePump(id, { name, status } = {}) {
  const data = {};
  if (name != null) data.name = String(name).trim();
  if (status != null) {
    if (!VALID_PUMP_STATUSES.includes(status)) {
      const err = new Error(`status must be one of: ${VALID_PUMP_STATUSES.join(', ')}`);
      err.status = 400;
      throw err;
    }
    data.status = status;
  }

  const pump = await prisma.pump.findUnique({ where: { id } });
  if (!pump) {
    const err = new Error('Pump not found');
    err.status = 404;
    throw err;
  }

  return prisma.pump.update({ where: { id }, data });
}

module.exports = {
  createPump,
  listPumps,
  updatePump,
};
