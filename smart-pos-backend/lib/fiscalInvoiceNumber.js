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

async function allocateFiscalInvcNo() {
  const key = deviceKey();
  key.dvcSrlNo = await vsdcService.getDeviceSerial();

  const updated = await prisma.$transaction(async (tx) => {
    let device = await tx.vsdcDevice.findUnique({
      where: {
        tpin_bhfId_dvcSrlNo: {
          tpin: key.tpin,
          bhfId: key.bhfId,
          dvcSrlNo: key.dvcSrlNo,
        },
      },
    });

    if (!device) {
      device = await tx.vsdcDevice.create({
        data: {
          tpin: key.tpin,
          bhfId: key.bhfId,
          dvcSrlNo: key.dvcSrlNo,
          lastInvcNo: 0,
        },
      });
    }

    const next = device.lastInvcNo + 1;
    return tx.vsdcDevice.update({
      where: { id: device.id },
      data: { lastInvcNo: next },
    });
  });

  return updated.lastInvcNo;
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
