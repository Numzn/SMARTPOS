/**
 * Default business profile for receipts (singleton id = default).
 */

const prisma = require('./prisma');

const DEFAULT_FOOTER_LINES = [
  'Thank you for shopping!',
  'Returns within 7 days.',
  'For support call: +260 97 123 4567',
];

async function ensureDefaultBusinessProfile() {
  const tpin = process.env.BUSINESS_TPIN || '1000000000';

  return prisma.businessProfile.upsert({
    where: { id: 'default' },
    update: {},
    create: {
      id: 'default',
      tradingName: process.env.BUSINESS_TRADING_NAME || 'NUMZPAY DEMO STORE',
      tpin,
      logoUrl: process.env.BUSINESS_LOGO_URL || null,
      footerLines: DEFAULT_FOOTER_LINES,
      showPoweredBy: true,
      receiptVersion: '1.0',
    },
  });
}

async function getBusinessProfile() {
  let profile = await prisma.businessProfile.findUnique({ where: { id: 'default' } });
  if (!profile) {
    profile = await ensureDefaultBusinessProfile();
  }
  return profile;
}

module.exports = {
  ensureDefaultBusinessProfile,
  getBusinessProfile,
  DEFAULT_FOOTER_LINES,
};
