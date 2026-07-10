function validateSaveSalesPayload(payload) {
  const errors = [];
  if (!payload.tpin) errors.push('tpin is required');
  if (!payload.bhfId) errors.push('bhfId is required');
  if (!payload.itemList?.length) errors.push('itemList must not be empty');
  if (payload.currencyTyCd && payload.exchangeRt == null) {
    errors.push('exchangeRt required when currencyTyCd is set');
  }
  const totAmt = Number(payload.totAmt || 0);
  const sumItems = (payload.itemList || []).reduce((s, it) => s + Number(it.totAmt || 0), 0);
  if (Math.abs(totAmt - sumItems) > 0.05 && payload.itemList?.length) {
    errors.push(`totAmt ${totAmt} does not match item sum ${sumItems}`);
  }
  return { isValid: errors.length === 0, errors };
}

module.exports = { validateSaveSalesPayload };
