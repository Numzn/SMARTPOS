const prisma = require('../prisma');
const transport = require('./transport');
const endpointAdapter = require('./endpointAdapter');

function vsdcCtx() {
  const vsdcService = require('../../services/vsdcService');
  return { tpin: vsdcService.tpin, bhfId: vsdcService.bhfId };
}

function lastReqDt(daysAgo = 30) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}000000`;
}

async function syncStandardCodes() {
  const ctx = vsdcCtx();
  const path = endpointAdapter.path('codes');
  const body = { tpin: ctx.tpin, bhfId: ctx.bhfId, lastReqDt: lastReqDt() };

  const res = await transport.authenticatedPost(path, body);
  if (!res.success) {
    throw new Error(res.data?.resultMsg || 'code/selectCodes failed');
  }

  const list = res.data?.data?.cdList || res.data?.cdList || res.data?.data || [];
  const rows = Array.isArray(list) ? list : [];
  let count = 0;
  for (const row of rows) {
    const code = row.cd || row.code || row.cdVal;
    const name = row.cdNm || row.name || row.cdDesc || '';
    if (!code) continue;
    const codeClass = row.cdCls || row.codeClass || 'STANDARD';
    await prisma.zraCode.upsert({
      where: { codeClass_code: { codeClass, code: String(code) } },
      create: {
        codeClass,
        code: String(code),
        name: String(name),
        description: row.cdDesc || null,
        rate: row.taxRt != null ? Number(row.taxRt) : null,
        raw: row,
      },
      update: {
        name: String(name),
        description: row.cdDesc || null,
        rate: row.taxRt != null ? Number(row.taxRt) : null,
        raw: row,
        syncedAt: new Date(),
      },
    });
    count += 1;
  }
  return { count, path };
}

async function syncClassificationCodes() {
  const ctx = vsdcCtx();
  const path = endpointAdapter.path('itemClass');
  const body = { tpin: ctx.tpin, bhfId: ctx.bhfId, lastReqDt: lastReqDt() };

  const res = await transport.authenticatedPost(path, body);
  if (!res.success) {
    throw new Error(res.data?.resultMsg || 'itemClass/selectItemsClass failed');
  }

  const list =
    res.data?.data?.itemClsList || res.data?.itemClsList || res.data?.data || [];
  const rows = Array.isArray(list) ? list : [];
  let count = 0;
  for (const row of rows) {
    const code = row.itemClsCd || row.code;
    if (!code) continue;
    await prisma.zraClassificationCode.upsert({
      where: { code: String(code) },
      create: {
        code: String(code),
        name: row.itemClsNm || row.name || String(code),
        level: row.lvl != null ? Number(row.lvl) : null,
        raw: row,
      },
      update: {
        name: row.itemClsNm || row.name || String(code),
        level: row.lvl != null ? Number(row.lvl) : null,
        raw: row,
        syncedAt: new Date(),
      },
    });
    count += 1;
  }
  return { count, path };
}

async function syncAll() {
  const standard = await syncStandardCodes();
  const classification = await syncClassificationCodes();
  return { standard, classification };
}

module.exports = {
  syncStandardCodes,
  syncClassificationCodes,
  syncAll,
};
