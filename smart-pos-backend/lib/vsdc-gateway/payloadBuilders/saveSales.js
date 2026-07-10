const NUM = (n, d = 4) => Math.round(Number(n || 0) * 10 ** d) / 10 ** d;
const endpointAdapter = require('../endpointAdapter');

function padDateTime(d = new Date()) {
  const x = d instanceof Date ? d : new Date(d);
  const p = (n) => String(n).padStart(2, '0');
  return (
    `${x.getFullYear()}${p(x.getMonth() + 1)}${p(x.getDate())}` +
    `${p(x.getHours())}${p(x.getMinutes())}${p(x.getSeconds())}`
  );
}

function padDate(d = new Date()) {
  const x = d instanceof Date ? d : new Date(d);
  const p = (n) => String(n).padStart(2, '0');
  return `${x.getFullYear()}${p(x.getMonth() + 1)}${p(x.getDate())}`;
}

const BUCKET_KEYS = ['A', 'B', 'C1', 'C2', 'C3', 'D', 'Rvat', 'E', 'F'];

function emptyBuckets() {
  const o = {};
  for (const k of BUCKET_KEYS) {
    o[`taxblAmt${k}`] = 0;
    o[`taxAmt${k}`] = 0;
  }
  o.taxRtA = 16;
  o.taxRtB = 16;
  o.taxRtC1 = 0;
  o.taxRtC2 = 0;
  o.taxRtC3 = 0;
  o.taxRtD = 0;
  o.taxRtRvat = 16;
  o.taxRtE = 0;
  o.taxRtF = 10;
  o.taxRtIpl1 = 5;
  o.taxRtIpl2 = 0;
  o.taxRtTl = 1.5;
  o.taxRtEcm = 5;
  o.taxRtExeeg = 3;
  o.taxRtTot = 0;
  o.taxblAmtIpl1 = 0;
  o.taxblAmtIpl2 = 0;
  o.taxblAmtTl = 0;
  o.taxblAmtEcm = 0;
  o.taxblAmtExeeg = 0;
  o.taxblAmtTot = 0;
  o.taxAmtIpl1 = 0;
  o.taxAmtIpl2 = 0;
  o.taxAmtTl = 0;
  o.taxAmtEcm = 0;
  o.taxAmtExeeg = 0;
  o.taxAmtTot = 0;
  o.tlAmt = 0;
  return o;
}

function bucketKey(vatCatCd) {
  const c = String(vatCatCd || 'A').toUpperCase();
  if (c === 'RVAT') return 'Rvat';
  if (['C1', 'C2', 'C3'].includes(c)) return c;
  if (['A', 'B', 'D', 'E', 'F'].includes(c)) return c;
  return 'A';
}

function mapPayment(paymentMethod) {
  const m = String(paymentMethod || 'cash').toLowerCase();
  if (m.includes('card')) return '02';
  if (m.includes('bank')) return '03';
  if (m.includes('mobile')) return '04';
  return '01';
}

/**
 * Build official TrnsSalesSaveWrReq from internal invoiceData (zraInvoice shape).
 */
function buildSaveSalesPayload(invoiceData, vsdcCtx) {
  const tpin = vsdcCtx.tpin;
  const bhfId = vsdcCtx.bhfId;
  const occurredAt = invoiceData.confirmationDate || invoiceData.salesDate || new Date();
  const buckets = emptyBuckets();
  let totTaxblAmt = 0;
  let totTaxAmt = 0;

  const itemList = (invoiceData.items || []).map((item, index) => {
    const vatCatCd = item.taxType || item.vatCatCd || 'A';
    const bk = bucketKey(vatCatCd);
    const vatTaxblAmt = NUM(item.taxableAmount ?? item.taxblAmt ?? 0);
    const vatAmt = NUM(item.taxAmount ?? item.taxAmt ?? 0);
    const totAmt = NUM(item.totalAmount ?? item.totAmt ?? 0);
    const prc = NUM(item.unitPrice ?? item.prc ?? 0);

    buckets[`taxblAmt${bk}`] = NUM(buckets[`taxblAmt${bk}`] + vatTaxblAmt);
    buckets[`taxAmt${bk}`] = NUM(buckets[`taxAmt${bk}`] + vatAmt);
    totTaxblAmt += vatTaxblAmt;
    totTaxAmt += vatAmt;

    return {
      itemSeq: index + 1,
      itemCd: item.itemCode || item.itemCd,
      itemClsCd: item.itemClassification || item.itemClsCd,
      itemNm: item.itemName || item.itemNm,
      bcd: item.barcode || item.bcd || '',
      pkgUnitCd: item.packageUnit || item.pkgUnitCd || 'EA',
      pkg: NUM(item.packageQuantity ?? item.pkg ?? 0, 2),
      qtyUnitCd: item.quantityUnit || item.qtyUnitCd || 'EA',
      qty: NUM(item.quantity ?? item.qty ?? 0, 2),
      prc,
      splyAmt: NUM(item.supplyAmount ?? item.splyAmt ?? prc * (item.quantity || 1)),
      dcRt: NUM(item.discountRate ?? item.dcRt ?? 0, 2),
      dcAmt: NUM(item.discountAmount ?? item.dcAmt ?? 0),
      isrccCd: item.insuranceCode || '',
      isrccNm: item.insuranceName || '',
      isrcRt: NUM(item.insuranceRate ?? 0, 2),
      isrcAmt: NUM(item.insuranceAmount ?? 0),
      vatCatCd,
      exciseTxCatCd: null,
      tlCatCd: null,
      iplCatCd: null,
      vatTaxblAmt,
      vatAmt,
      exciseTaxblAmt: 0,
      tlTaxblAmt: 0,
      iplTaxblAmt: 0,
      iplAmt: 0,
      tlAmt: 0,
      exciseTxAmt: 0,
      totAmt,
    };
  });

  const isCredit = invoiceData.receiptType === 'R';
  const cisInvcNo =
    invoiceData.cisInvcNo ||
    String(invoiceData.invoiceNumber || invoiceData.invcNo || '');

  const payload = {
    tpin,
    bhfId,
    orgInvcNo: Number(invoiceData.originalInvoiceNumber || invoiceData.orgInvcNo || 0),
    cisInvcNo,
    custTpin: invoiceData.customerTpin || null,
    custNm: invoiceData.customerName || 'Walk-in Customer',
    salesTyCd: invoiceData.salesType || 'N',
    rcptTyCd: invoiceData.receiptType || 'S',
    pmtTyCd: mapPayment(invoiceData.paymentMethod),
    salesSttsCd: invoiceData.salesStatus || '02',
    cfmDt: padDateTime(occurredAt),
    salesDt: padDate(occurredAt),
    stockRlsDt: null,
    cnclReqDt: isCredit ? null : padDateTime(occurredAt),
    cnclDt: null,
    rfdDt: isCredit ? padDateTime(invoiceData.refundDate || occurredAt) : null,
    rfdRsnCd: isCredit ? invoiceData.refundReasonCode || '01' : null,
    totItemCnt: itemList.length,
    ...buckets,
    totTaxblAmt: NUM(totTaxblAmt),
    totTaxAmt: NUM(totTaxAmt),
    totAmt: NUM(invoiceData.totalAmount ?? invoiceData.totAmt ?? 0),
    cashDcRt: 0,
    cashDcAmt: 0,
    prchrAcptcYn: 'N',
    remark: invoiceData.remark || '',
    regrId: invoiceData.registeredBy || 'SYSTEM',
    regrNm: invoiceData.registeredByName || 'SYSTEM',
    modrId: invoiceData.modifiedBy || 'SYSTEM',
    modrNm: invoiceData.modifiedByName || 'SYSTEM',
    saleCtyCd: '1',
    lpoNumber: null,
    currencyTyCd: invoiceData.currencyTyCd || 'ZMW',
    exchangeRt: String(invoiceData.exchangeRt ?? 1),
    destnCountryCd: '',
    dbtRsnCd: '',
    invcAdjustReason: '',
    itemList,
  };

  if (!endpointAdapter.isOfficial()) {
    return {
      tpin,
      bhfId,
      invcNo: Number(invoiceData.invoiceNumber),
      orgInvcNo: payload.orgInvcNo,
      custTpin: payload.custTpin,
      custNm: payload.custNm,
      salesTyCd: payload.salesTyCd,
      rcptTyCd: payload.rcptTyCd,
      pmtTyCd: payload.pmtTyCd,
      salesSttsCd: payload.salesSttsCd,
      cfmDt: payload.cfmDt,
      salesDt: payload.salesDt,
      totItemCnt: payload.totItemCnt,
      totTaxblAmt: payload.totTaxblAmt,
      totTaxAmt: payload.totTaxAmt,
      totAmt: payload.totAmt,
      itemList: itemList.map((it) => ({
        itemSeq: it.itemSeq,
        itemCd: it.itemCd,
        itemClsCd: it.itemClsCd,
        itemNm: it.itemNm,
        qty: it.qty,
        prc: it.prc,
        splyAmt: it.splyAmt,
        taxTyCd: it.vatCatCd,
        taxblAmt: it.vatTaxblAmt,
        taxAmt: it.vatAmt,
        totAmt: it.totAmt,
      })),
    };
  }

  return payload;
}

module.exports = {
  buildSaveSalesPayload,
  padDateTime,
  padDate,
};
