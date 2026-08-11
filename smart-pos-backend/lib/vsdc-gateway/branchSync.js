/**
 * VSDC Section 5.5 (Branch Information) + 5.6 (Customer Information).
 * Endpoints verified directly against the spec PDF, not inferred from
 * prior code — see endpointAdapter.js for the exact paths/citation.
 *
 * Reuses the same transport/endpointAdapter/prisma pattern as codesSync.js.
 * No new VSDC client, no new customer/user models — NUMZ's existing
 * Customer/User/Branch models represent the ZRA-side entities directly
 * (see zra-self-checklist.md Section 4 architecture notes for the mapping).
 */

const prisma = require('../prisma');
const transport = require('./transport');
const endpointAdapter = require('./endpointAdapter');

function vsdcCtx() {
  const vsdcService = require('../../services/vsdcService');
  return { tpin: vsdcService.tpin, bhfId: vsdcService.bhfId };
}

/**
 * GET /branches/selectBranches — pulls ZRA's record of this taxpayer's
 * registered branches and stores it as a reference snapshot on the matching
 * local Branch row (by bhfId). Deliberately does NOT overwrite Branch.name/
 * province/district/etc. — those are foreign-key-critical operational
 * fields (sales.branchId, shifts, ...) and ZRA's copy is something to
 * compare against, not an authority that should silently mutate live
 * records. See schema.prisma Branch.zraBranchSnapshot for the same note.
 */
async function selectBranches() {
  const ctx = vsdcCtx();
  const path = endpointAdapter.path('branchesSelect');
  const body = { tpin: ctx.tpin, bhfId: ctx.bhfId, lastReqDt: '20160523000000' };

  const res = await transport.authenticatedPost(path, body);
  if (!res.success) {
    throw new Error(res.data?.resultMsg || 'branches/selectBranches failed');
  }

  const list = res.data?.data?.bhfList || res.data?.bhfList || [];
  const rows = Array.isArray(list) ? list : [];
  let matched = 0;
  for (const row of rows) {
    const bhfId = row.bhfId;
    if (!bhfId) continue;
    const updated = await prisma.branch.updateMany({
      where: { bhfId: String(bhfId) },
      data: { zraBranchSnapshot: row, zraSnapshotSyncedAt: new Date() },
    });
    if (updated.count > 0) matched += 1;
  }
  return { count: rows.length, matched, path };
}

/**
 * POST /branches/saveBrancheUser — pushes a staff account as a ZRA branch
 * user. `bhfId` comes from the user's assigned Branch (branchId -> code ->
 * Branch.bhfId), which is required by the spec, so a user with no branch
 * assigned cannot be pushed — callers must check that first.
 */
async function saveBranchUser(user, actor) {
  if (!user.branch?.bhfId) {
    throw new Error(`User ${user.id} has no assigned branch (bhfId) — cannot register as a ZRA branch user`);
  }
  const ctx = vsdcCtx();
  const registrant = actor || user;
  const path = endpointAdapter.path('branchUserSave');
  const body = {
    tpin: ctx.tpin,
    bhfId: user.branch.bhfId,
    userId: user.id,
    userNm: user.name || user.email,
    adrs: null,
    useYn: user.isActive ? 'Y' : 'N',
    regrNm: registrant.name || registrant.email || 'SYSTEM',
    regrId: registrant.id || 'SYSTEM',
    modrNm: registrant.name || registrant.email || 'SYSTEM',
    modrId: registrant.id || 'SYSTEM',
  };

  const res = await transport.authenticatedPost(path, body);
  if (!res.success || res.data?.resultCd !== '000') {
    const error = res.data?.resultMsg || 'branches/saveBrancheUser failed';
    await prisma.user.update({
      where: { id: user.id },
      data: { zraSyncError: error, zraSyncResponse: res.data ?? null },
    });
    throw new Error(error);
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { zraSyncedAt: new Date(), zraSyncError: null, zraSyncResponse: res.data },
  });
  return { success: true, path };
}

/**
 * POST /branches/saveBrancheCustomers — pushes a customer to ZRA. custTpin
 * is a *required* field on this endpoint, so a customer with no tpin
 * cannot be pushed — that's the actual business trigger, not "push every
 * customer": only customers an admin/cashier has attached a real TPIN to.
 */
async function saveBranchCustomer(customer, actor) {
  if (!customer.tpin) {
    throw new Error(`Customer ${customer.id} has no TPIN — cannot register as a ZRA branch customer (custTpin is required)`);
  }
  const ctx = vsdcCtx();
  const path = endpointAdapter.path('branchCustomerSave');
  const body = {
    tpin: ctx.tpin,
    bhfId: ctx.bhfId,
    custNo: customer.phone || '',
    custTpin: customer.tpin,
    custNm: customer.name,
    adrs: customer.address || null,
    email: customer.email || null,
    faxNo: null,
    useYn: customer.isActive ? 'Y' : 'N',
    remark: customer.notes || null,
    regrNm: actor?.name || actor?.email || 'SYSTEM',
    regrId: actor?.id || 'SYSTEM',
    modrNm: actor?.name || actor?.email || 'SYSTEM',
    modrId: actor?.id || 'SYSTEM',
  };

  const res = await transport.authenticatedPost(path, body);
  if (!res.success || res.data?.resultCd !== '000') {
    const error = res.data?.resultMsg || 'branches/saveBrancheCustomers failed';
    await prisma.customer.update({
      where: { id: customer.id },
      data: { zraSyncError: error, zraSyncResponse: res.data ?? null },
    });
    throw new Error(error);
  }

  await prisma.customer.update({
    where: { id: customer.id },
    data: { zraSyncedAt: new Date(), zraSyncError: null, zraSyncResponse: res.data },
  });
  return { success: true, path };
}

/**
 * POST /customers/selectCustomer — on-demand lookup by TPIN (not a bulk
 * sync). Used to verify/display a customer's ZRA-registered details when
 * a TPIN is entered.
 */
async function selectCustomer(custmTpin) {
  const ctx = vsdcCtx();
  const path = endpointAdapter.path('customerSelect');
  const body = { tpin: ctx.tpin, bhfId: ctx.bhfId, custmTpin };

  const res = await transport.authenticatedPost(path, body);
  if (!res.success) {
    throw new Error(res.data?.resultMsg || 'customers/selectCustomer failed');
  }

  const list = res.data?.data?.custList || res.data?.custList || [];
  return { found: Array.isArray(list) && list.length > 0, customer: list?.[0] || null, path };
}

module.exports = {
  selectBranches,
  saveBranchUser,
  saveBranchCustomer,
  selectCustomer,
};
