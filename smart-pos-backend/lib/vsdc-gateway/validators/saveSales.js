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
  const cashDcAmt = Number(payload.cashDcAmt || 0);

  // Order-level (cash) discount is a legitimate, separate ZRA header field —
  // the header total reconciles against the item sum *minus* it, not
  // against the raw item sum directly. cashDcAmt is 0 for any sale with no
  // order-level discount, so this is exactly the prior check in that case.
  if (cashDcAmt < 0) {
    errors.push(`cashDcAmt ${cashDcAmt} cannot be negative`);
  }
  if (cashDcAmt > sumItems + 0.05) {
    errors.push(`cashDcAmt ${cashDcAmt} exceeds the item total ${sumItems}`);
  }

  const expectedTotAmt = sumItems - cashDcAmt;
  if (Math.abs(totAmt - expectedTotAmt) > 0.05 && payload.itemList?.length) {
    errors.push(
      `totAmt ${totAmt} does not reconcile with item sum ${sumItems} minus cashDcAmt ${cashDcAmt} (expected ${expectedTotAmt})`
    );
  }
  return { isValid: errors.length === 0, errors };
}

module.exports = { validateSaveSalesPayload };
