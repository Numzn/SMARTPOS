const { buildSaveSalesPayload } = require('./saveSales');

function buildSaveCreditNotePayload(invoiceData, vsdcCtx) {
  return buildSaveSalesPayload(
    {
      ...invoiceData,
      receiptType: 'R',
      salesType: invoiceData.salesType || 'N',
    },
    vsdcCtx
  );
}

module.exports = { buildSaveCreditNotePayload };
