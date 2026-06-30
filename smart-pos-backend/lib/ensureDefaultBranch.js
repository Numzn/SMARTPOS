/**
 * Ensure the default operational branch exists (code main, bhfId from env).
 */

const prisma = require('./prisma');

const DEFAULT_BRANCH_CODE = 'main';

async function ensureDefaultBranch() {
  const bhfId = (process.env.BRANCH_ID || '000').padStart(3, '0').slice(-3);

  return prisma.branch.upsert({
    where: { code: DEFAULT_BRANCH_CODE },
    update: {
      bhfId,
      isActive: true,
    },
    create: {
      id: 'default-main-branch',
      code: DEFAULT_BRANCH_CODE,
      bhfId,
      name: process.env.BRANCH_NAME || 'Main Branch',
      address: process.env.BRANCH_ADDRESS || 'Lusaka, Zambia',
      province: process.env.BRANCH_PROVINCE || 'Lusaka',
      district: process.env.BRANCH_DISTRICT || 'Lusaka',
      isActive: true,
      zraRegistered: false,
    },
  });
}

module.exports = {
  DEFAULT_BRANCH_CODE,
  ensureDefaultBranch,
};
