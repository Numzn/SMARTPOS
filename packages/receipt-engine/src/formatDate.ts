const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function toDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

export function formatReceiptDate(value: string | Date): string {
  const d = toDate(value);
  const day = String(d.getDate()).padStart(2, '0');
  const month = MONTHS[d.getMonth()];
  const year = d.getFullYear();
  return `${day}-${month}-${year}`;
}

export function formatReceiptTime(value: string | Date): string {
  const d = toDate(value);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

export function formatInvoiceNo(fiscalInvcNo: number | null | undefined): string | null {
  if (fiscalInvcNo == null || !Number.isFinite(fiscalInvcNo)) return null;
  return `INV-${String(Math.floor(fiscalInvcNo)).padStart(6, '0')}`;
}
