const NUM = (n, d = 2) => Math.round(Number(n || 0) * 10 ** d) / 10 ** d;

function padDate(d = new Date()) {
  const x = d instanceof Date ? d : new Date(d);
  const p = (n) => String(n).padStart(2, '0');
  return `${x.getFullYear()}${p(x.getMonth() + 1)}${p(x.getDate())}`;
}

// GoodsReceivedNote/PurchaseOrder/Supplier track no payment-method concept
// at all (confirmed: no PaymentMethod field on any of the three models,
// unlike Sale). '02'=CREDIT (spec 6.9. Payment Method) is the most
// defensible default for supplier procurement — trade-credit/on-account is
// the normal B2B pattern, CASH would misrepresent goods received on
// invoice terms — but this IS a documented assumption, not discovered data.
const DEFAULT_PMT_TY_CD = '02';

// GoodsReceivedNoteItem tracks quantityReceived/unitCost only — no
// per-line VAT/IPL/TL/excise computation exists anywhere in the receiving
// path (lib/receiving.js). Fields marked "(Y, pass 0.0 if n/a)" in the
// spec's Save Purchase Request table get 0.0 here, not a fabricated tax
// calculation (same honesty standard as item 27*'s stock-item payload).
function buildItemLine(grnItem, index) {
  const product = grnItem.product || {};
  const qty = NUM(grnItem.quantityReceived);
  const prc = NUM(grnItem.unitCost);
  const splyAmt = NUM(qty * prc);
  return {
    itemSeq: index + 1,
    itemCd: product.sku || null,
    itemClsCd: product.zraClassificationCode || product.zraItemClassification || null,
    itemNm: product.name || null,
    bcd: product.barcode || '',
    spplrItemClsCd: null,
    spplrItemCd: null,
    spplrItemNm: null,
    pkgUnitCd: product.zraPackageUnit || 'EA',
    pkg: 1.0,
    qtyUnitCd: product.zraQuantityUnit || 'EA',
    qty,
    prc,
    splyAmt,
    dcRt: 0.0,
    dcAmt: 0.0,
    iplCatCd: null,
    tlCatCd: null,
    exciseCatCd: null,
    taxblAmt: 0.0,
    vatCatCd: product.taxType || 'A',
    iplTaxblAmt: 0.0,
    tlTaxblAmt: 0.0,
    exciseTaxblAmt: 0.0,
    taxAmt: 0.0,
    iplAmt: 0.0,
    tlAmt: 0.0,
    exciseTxAmt: 0.0,
    totAmt: splyAmt,
  };
}

/**
 * grn must be loaded with:
 *   { include: { supplier: true, items: { include: { product: true } } } }
 * regTyCd is always 'M' (Manual) — see zra-self-checklist.md item 13*'s
 * row for why: we have no reliable signal that a supplier already
 * self-reported this purchase via their own VSDC, so every GRN we push is
 * self-reported. pchsTyCd/rcptTyCd/pchsSttsCd are fixed per spec 6.7/6.12/
 * 6.10 — Normal/Purchase/Approved, since a GRN only exists once goods are
 * physically received (there's no draft/rejected concept for a GRN).
 */
function buildSavePurchasePayload(grn, vsdcCtx) {
  const itemList = (grn.items || []).map(buildItemLine);
  const totAmt = NUM(itemList.reduce((s, i) => s + i.totAmt, 0));
  return {
    tpin: vsdcCtx.tpin,
    bhfId: vsdcCtx.bhfId,
    cisInvcNo: grn.grnNumber,
    orgInvcNo: 0,
    spplrTpin: grn.supplier?.tpin || null,
    spplrBhfId: null,
    spplrNm: grn.supplier?.name || null,
    spplrInvcNo: null,
    regTyCd: 'M',
    pchsTyCd: 'N',
    rcptTyCd: 'P',
    pmtTyCd: DEFAULT_PMT_TY_CD,
    pchsSttsCd: '02',
    pchsDt: padDate(grn.receivedDate),
    cnclReqDt: null,
    cnclDt: null,
    totItemCnt: itemList.length,
    totTaxblAmt: 0.0,
    totTaxAmt: 0.0,
    totAmt,
    itemList,
  };
}

module.exports = { buildSavePurchasePayload, DEFAULT_PMT_TY_CD, padDate };
