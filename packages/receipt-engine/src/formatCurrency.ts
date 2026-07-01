export function formatCurrency(amount: number | null | undefined): string {
  const n = Number(amount ?? 0);
  if (!Number.isFinite(n)) return 'K0.00';
  return `K${n.toFixed(2)}`;
}
