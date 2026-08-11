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

  // Real response shape (VSDC API Spec v1.0.8 §5.2 "Get Code Data", confirmed
  // against the spec's own sample JSON): data.clsList[] groups codes by
  // class — {cdCls, cdClsNm, dtlList: [{cd, cdNm}]}. There is no flat
  // "cdList" anywhere in the spec text — a prior version of this parser
  // assumed a flat array and would have silently imported zero codes
  // against real ZRA (mock-vsdc-server.js was, until this fix, built to the
  // same wrong flat shape, which is why that never surfaced against mock
  // testing). The flat-list branch below is kept only as a defensive
  // fallback, not the expected path.
  const classGroups = res.data?.data?.clsList || res.data?.clsList;
  const flatList = res.data?.data?.cdList || res.data?.cdList || res.data?.data;

  const rows = [];
  if (Array.isArray(classGroups)) {
    for (const group of classGroups) {
      const codeClass = group.cdCls || group.codeClass;
      const details = Array.isArray(group.dtlList) ? group.dtlList : [];
      for (const detail of details) {
        rows.push({ ...detail, cdCls: codeClass });
      }
    }
  } else if (Array.isArray(flatList)) {
    rows.push(...flatList);
  }

  let count = 0;
  for (const row of rows) {
    const code = row.cd || row.code || row.cdVal;
    const name = row.cdNm || row.name || row.cdDesc || '';
    if (!code) continue;
    const codeClass = String(row.cdCls || row.codeClass || 'STANDARD');
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
    const level = row.itemClsLvl ?? row.lvl;
    await prisma.zraClassificationCode.upsert({
      where: { code: String(code) },
      create: {
        code: String(code),
        name: row.itemClsNm || row.name || String(code),
        level: level != null ? Number(level) : null,
        taxTyCd: row.taxTyCd || null,
        mjrTgYn: row.mjrTgYn || null,
        useYn: row.useYn || null,
        raw: row,
      },
      update: {
        name: row.itemClsNm || row.name || String(code),
        level: level != null ? Number(level) : null,
        taxTyCd: row.taxTyCd || null,
        mjrTgYn: row.mjrTgYn || null,
        useYn: row.useYn || null,
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
