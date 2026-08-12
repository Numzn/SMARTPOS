const vsdcService = require('../../services/vsdcService');
const transport = require('./transport');
const endpointAdapter = require('./endpointAdapter');
const { buildSaveSalesPayload } = require('./payloadBuilders/saveSales');
const { buildSaveCreditNotePayload } = require('./payloadBuilders/saveCreditNote');
const { validateSaveSalesPayload } = require('./validators/saveSales');
const { withRetry } = require('./retry');
const codesSync = require('./codesSync');
const branchSync = require('./branchSync');

function ctx() {
  return { tpin: vsdcService.tpin, bhfId: vsdcService.bhfId };
}

function mapSaleResponse(data) {
  return {
    invcSdcId: data.invcSdcId || data.sdcId,
    invcNo: data.invcNo,
    intrlData: data.intrlData,
    rcptNo: data.rcptNo,
    totRcptNo: data.totRcptNo,
    vsdcRcptPbctDate: data.vsdcRcptPbctDate || data.resultDt,
    sdcId: data.sdcId,
    mrcNo: data.mrcNo,
    qrCode: data.qrCode || data.qrCodeUrl,
    rcptSign: data.rcptSign,
  };
}

async function ensureReady() {
  if (await vsdcService.isDeviceReady()) return { success: true };
  return vsdcService.ensureDeviceInitialized();
}

async function submitInvoiceData(invoiceData) {
  const ready = await ensureReady();
  if (!ready.success) {
    return { success: false, error: ready.error || 'VSDC not initialized', code: 'VSDC_NOT_INITIALIZED' };
  }

  const isCredit = invoiceData.receiptType === 'R';
  const payload = isCredit
    ? buildSaveCreditNotePayload(invoiceData, ctx())
    : buildSaveSalesPayload(invoiceData, ctx());

  // Validate the real payload in every mode — mock runs must exercise the
  // same checks the sandbox will, or bugs only surface once credentials arrive.
  const validation = validateSaveSalesPayload(payload);
  if (!validation.isValid) {
    return { success: false, error: validation.errors.join(', '), code: 'VALIDATION_ERROR' };
  }

  const path = endpointAdapter.path('salesSave');

  try {
    const result = await withRetry(() => transport.authenticatedPost(path, payload));
    if (!result.success) {
      return {
        success: false,
        error: result.data?.resultMsg || 'VSDC sales save failed',
        code: result.data?.resultCd || 'VSDC_ERROR',
        payload,
      };
    }

    const body = result.data?.data ? { ...result.data, ...result.data.data } : result.data;
    const zraResponse = mapSaleResponse(body);

    // Stock reporting for this sale is NOT done here. It used to be (see
    // git history for postSaleStock, removed 2026-08-12) — but that ran in
    // parallel with services/stockSyncService.js's syncAfterSale(), which
    // fires separately from lib/saleFiscal.js's completeSaleAfterFiscalSuccess()
    // for the exact same sale. Confirmed via full call-graph trace: every
    // completed sale was submitting stock movement data to VSDC *twice*,
    // through two different malformed payloads with contradictory sarTyCd
    // direction codes (one tagged a sale as "incoming purchase"). Removed
    // the gateway-level duplicate; stockSyncService (wired to sales,
    // refunds, adjustments, inventory-core, and expiry) is now the single
    // source of truth for stock reporting, with its own audit logging.
    return {
      success: true,
      message: 'Sales submitted',
      zraResponse,
      payload,
      raw: result.data,
    };
  } catch (err) {
    return { success: false, error: err.message, code: 'TRANSPORT_ERROR', payload };
  }
}

async function lookupInvoice(invcNo) {
  const path = endpointAdapter.path('salesSelect');
  const body = { tpin: vsdcService.tpin, bhfId: vsdcService.bhfId, invcNo: Number(invcNo) };
  const result = await transport.authenticatedPost(path, body);
  return result;
}

module.exports = {
  mode: endpointAdapter.mode,
  isOfficial: endpointAdapter.isOfficial,
  ensureReady,
  submitInvoiceData,
  lookupInvoice,
  syncCodes: codesSync.syncAll,
  selectBranches: branchSync.selectBranches,
  saveBranchUser: branchSync.saveBranchUser,
  saveBranchCustomer: branchSync.saveBranchCustomer,
  selectCustomer: branchSync.selectCustomer,
  buildSaveSalesPayload,
};
