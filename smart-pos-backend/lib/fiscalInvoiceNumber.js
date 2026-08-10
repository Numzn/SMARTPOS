/**
 * Sequential VSDC invoice numbers per registered device (real ZRA requirement).
 * Replaces parseInt(cuid) which yields NaN on production submissions.
 */

const prisma = require('./prisma');
const vsdcService = require('../services/vsdcService');

function deviceKey() {
  return {
    tpin: process.env.BUSINESS_TPIN || vsdcService.tpin,
    bhfId: process.env.BRANCH_ID || vsdcService.bhfId || '000',
    dvcSrlNo: null, // filled async
  };
}

// upsert's increment compiles to `SET last_invc_no = last_invc_no + 1 RETURNING`,
// atomic under READ COMMITTED — unlike the previous findUnique-then-update,
// which let two concurrent callers both compute the same next number.
async function allocateFiscalInvcNo() {
  const key = deviceKey();
  key.dvcSrlNo = await vsdcService.getDeviceSerial();
  const where = {
    tpin_bhfId_dvcSrlNo: {
      tpin: key.tpin,
      bhfId: key.bhfId,
      dvcSrlNo: key.dvcSrlNo,
    },
  };

  try {
    const device = await prisma.vsdcDevice.upsert({
      where,
      create: { tpin: key.tpin, bhfId: key.bhfId, dvcSrlNo: key.dvcSrlNo, lastInvcNo: 1 },
      update: { lastInvcNo: { increment: 1 } },
    });
    return device.lastInvcNo;
  } catch (error) {
    // Two callers raced the initial create; the loser's create failed on the
    // unique index. The row now exists, so retry once as a plain increment.
    if (error.code === 'P2002') {
      const device = await prisma.vsdcDevice.update({
        where,
        data: { lastInvcNo: { increment: 1 } },
      });
      return device.lastInvcNo;
    }
    throw error;
  }
}

function resolveOriginalInvcNo(sale) {
  if (sale?.fiscalInvcNo) return sale.fiscalInvcNo;
  const resp = sale?.vsdcResponse;
  if (resp && typeof resp === 'object') {
    const n = resp.invcNo ?? resp.data?.invcNo;
    if (n != null && !Number.isNaN(Number(n))) return Number(n);
  }
  return 0;
}

module.exports = {
  allocateFiscalInvcNo,
  resolveOriginalInvcNo,
};
