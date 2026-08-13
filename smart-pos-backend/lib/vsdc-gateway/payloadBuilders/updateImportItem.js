// Import Item Status (spec §6.17) — the only two values ZRA accepts here.
const APPROVED = '3';
const REJECTED = '4';

/**
 * retrievedImportItem: a RetrievedImportItem row (must have taskCd/dclDe/
 * itemSeq/hsCd already persisted from item 11*'s retrieval).
 * product: the local Product being assigned to this import line — the
 * spec table marks itemClsCd/itemCd as required (Y) on EVERY submitted
 * line regardless of approve/reject, so a product is required for both
 * decisions here, not just approval (there is no "reject, no product"
 * shortcut the real spec fields would allow).
 * decision: 'APPROVED' | 'REJECTED'.
 * actor: {name, id} — modrNm/modrId, the user making the decision.
 */
function buildUpdateImportItemPayload(retrievedImportItem, product, decision, actor, vsdcCtx, remark) {
  const imptItemSttsCd = decision === 'APPROVED' ? APPROVED : REJECTED;
  return {
    tpin: vsdcCtx.tpin,
    bhfId: vsdcCtx.bhfId,
    taskCd: retrievedImportItem.taskCd,
    dclDe: retrievedImportItem.dclDe,
    importItemList: [
      {
        itemSeq: retrievedImportItem.itemSeq,
        hsCd: retrievedImportItem.hsCd,
        itemClsCd: product?.zraClassificationCode || product?.zraItemClassification || null,
        itemCd: product?.sku || null,
        imptItemSttsCd,
        remark: remark || null,
        modrNm: actor?.name || 'SYSTEM',
        modrId: actor?.id || 'SYSTEM',
      },
    ],
  };
}

module.exports = { buildUpdateImportItemPayload, APPROVED, REJECTED };
