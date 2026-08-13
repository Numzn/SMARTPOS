function validateUpdateImportItemPayload(payload) {
  const errors = [];
  if (!payload.tpin) errors.push('tpin is required');
  if (!payload.bhfId) errors.push('bhfId is required');
  if (!payload.taskCd) errors.push('taskCd is required');
  const line = payload.importItemList?.[0];
  if (!line) errors.push('importItemList must contain exactly one line');
  if (line && !line.itemClsCd) errors.push('itemClsCd is required — assign a local product with a ZRA classification code');
  if (line && !line.itemCd) errors.push('itemCd is required — assign a local product with a SKU');
  return { isValid: errors.length === 0, errors };
}

module.exports = { validateUpdateImportItemPayload };
