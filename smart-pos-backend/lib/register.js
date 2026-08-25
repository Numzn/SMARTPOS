/**
 * V1 register/till model — CRUD for the physical/logical checkout station
 * (Register) and its cash drawer (Till). Deliberately simple: no multi-till-
 * per-register support, no till-accountability modes — see the schema
 * comments on Register/Till/Shift for what's intentionally deferred.
 */

const prisma = require('./prisma');
const { DEFAULT_BRANCH } = require('./inventoryStock');

async function createRegister({ code, name, branchId = DEFAULT_BRANCH }) {
  if (!code || !String(code).trim()) {
    const err = new Error('code is required');
    err.status = 400;
    throw err;
  }
  if (!name || !String(name).trim()) {
    const err = new Error('name is required');
    err.status = 400;
    throw err;
  }

  const branch = await prisma.branch.findUnique({ where: { code: branchId } });
  if (!branch) {
    const err = new Error(`No branch with code "${branchId}"`);
    err.status = 400;
    throw err;
  }

  return prisma.register.create({
    data: { code: String(code).trim(), name: String(name).trim(), branchId },
  });
}

async function listRegisters({ branchId, includeInactive = false } = {}) {
  return prisma.register.findMany({
    where: {
      ...(branchId ? { branchId } : {}),
      ...(includeInactive ? {} : { isActive: true }),
    },
    include: { tills: true },
    orderBy: { code: 'asc' },
  });
}

async function updateRegister(id, { name, isActive }) {
  const data = {};
  if (name != null) data.name = String(name).trim();
  if (isActive != null) data.isActive = Boolean(isActive);

  const register = await prisma.register.findUnique({ where: { id } });
  if (!register) {
    const err = new Error('Register not found');
    err.status = 404;
    throw err;
  }

  return prisma.register.update({ where: { id }, data });
}

async function createTill({ code, name, registerId, defaultOpeningFloat = 0 }) {
  if (!code || !String(code).trim()) {
    const err = new Error('code is required');
    err.status = 400;
    throw err;
  }
  if (!name || !String(name).trim()) {
    const err = new Error('name is required');
    err.status = 400;
    throw err;
  }

  const register = await prisma.register.findUnique({ where: { id: registerId } });
  if (!register) {
    const err = new Error('Register not found');
    err.status = 400;
    throw err;
  }

  const float = Number(defaultOpeningFloat);
  if (!Number.isFinite(float) || float < 0) {
    const err = new Error('defaultOpeningFloat must be a non-negative number');
    err.status = 400;
    throw err;
  }

  return prisma.till.create({
    data: { code: String(code).trim(), name: String(name).trim(), registerId, defaultOpeningFloat: float },
  });
}

async function listTills({ registerId, includeInactive = false } = {}) {
  return prisma.till.findMany({
    where: {
      ...(registerId ? { registerId } : {}),
      ...(includeInactive ? {} : { isActive: true }),
    },
    orderBy: { code: 'asc' },
  });
}

async function getTill(id) {
  const till = await prisma.till.findUnique({ where: { id }, include: { register: true } });
  if (!till) {
    const err = new Error('Till not found');
    err.status = 404;
    throw err;
  }
  return till;
}

async function updateTill(id, { name, isActive, defaultOpeningFloat }) {
  const data = {};
  if (name != null) data.name = String(name).trim();
  if (isActive != null) data.isActive = Boolean(isActive);
  if (defaultOpeningFloat != null) {
    const float = Number(defaultOpeningFloat);
    if (!Number.isFinite(float) || float < 0) {
      const err = new Error('defaultOpeningFloat must be a non-negative number');
      err.status = 400;
      throw err;
    }
    data.defaultOpeningFloat = float;
  }

  const till = await prisma.till.findUnique({ where: { id } });
  if (!till) {
    const err = new Error('Till not found');
    err.status = 404;
    throw err;
  }

  return prisma.till.update({ where: { id }, data });
}

module.exports = {
  createRegister,
  listRegisters,
  updateRegister,
  createTill,
  listTills,
  getTill,
  updateTill,
};
