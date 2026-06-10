export const VAT_RATE = 0.16;

/**
 * Cart totals — prices are VAT-exclusive (matches CartSection + backend saleFiscal).
 */
export function calculateCartTotals(
  cart = [],
  { discountType = 'percentage', discountValue = '' } = {}
) {
  const subtotal = cart.reduce(
    (sum, item) => sum + Number(item.price) * Number(item.quantity),
    0
  );

  let discount = 0;
  const raw = parseFloat(discountValue);
  if (!Number.isNaN(raw) && raw > 0) {
    if (discountType === 'percentage') {
      discount = (subtotal * Math.min(raw, 100)) / 100;
    } else {
      discount = Math.min(raw, subtotal);
    }
  }

  const taxableAmount = Math.max(0, subtotal - discount);
  const vat = taxableAmount * VAT_RATE;
  const total = taxableAmount + vat;
  const itemCount = cart.reduce((sum, item) => sum + Number(item.quantity), 0);

  return { subtotal, discount, vat, total, itemCount, lineCount: cart.length };
}

export function formatZmw(amount) {
  return new Intl.NumberFormat('en-ZM', {
    style: 'currency',
    currency: 'ZMW',
    minimumFractionDigits: 2,
  }).format(Number.isFinite(amount) ? amount : 0);
}
