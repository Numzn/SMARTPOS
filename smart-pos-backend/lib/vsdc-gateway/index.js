const vsdcService = require('../../services/vsdcService');
const transport = require('./transport');
const endpointAdapter = require('./endpointAdapter');
const { buildSaveSalesPayload } = require('./payloadBuilders/saveSales');
const { buildSaveCreditNotePayload } = require('./payloadBuilders/saveCreditNote');
const { validateSaveSalesPayload } = require('./validators/saveSales');
const { withRetry } = require('./retry');
const codesSync = require('./codesSync');

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

  const validation = validateSaveSalesPayload(
    endpointAdapter.isOfficial()
      ? payload
      : { ...payload, currencyTyCd: 'ZMW', exchangeRt: '1' }
  );
  if (!validation.isValid && endpointAdapter.isOfficial()) {
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

    if (!isCredit) {
      await postSaleStock(payload, body);
    }

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

async function postSaleStock(salesPayload, responseData) {
  try {
    const stockPath = endpointAdapter.path('stockItems');
    const masterPath = endpointAdapter.path('stockMaster');
    const c = ctx();
    const sarNo = responseData.rcptNo || salesPayload.cisInvcNo || Date.now();

    for (const item of salesPayload.itemList || []) {
      const stockBody = {
        tpin: c.tpin,
        bhfId: c.bhfId,
        itemCd: item.itemCd,
        sarTyCd: '11',
        sarNo: String(sarNo),
        qty: -Math.abs(Number(item.qty || 0)),
        totItemCnt: 1,
        regrId: 'SYSTEM',
        regrNm: 'SYSTEM',
        modrId: 'SYSTEM',
        modrNm: 'SYSTEM',
      };
      await transport.authenticatedPost(stockPath, stockBody).catch(() => null);
    }

    const masterBody = {
      tpin: c.tpin,
      bhfId: c.bhfId,
      itemList: (salesPayload.itemList || []).map((item) => ({
        itemCd: item.itemCd,
        qty: -Math.abs(Number(item.qty || 0)),
      })),
    };
    await transport.authenticatedPost(masterPath, masterBody).catch(() => null);
  } catch (e) {
    console.warn('[vsdc-gateway] post-sale stock skipped:', e.message);
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
  buildSaveSalesPayload,
};
