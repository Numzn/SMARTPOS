/**
 * jsPDF is loaded on demand rather than imported at module scope. It drags in
 * html2canvas and dompurify (for its unused .html() renderer), which together
 * added ~440 kB to the main bundle — a heavy price on every page load for a
 * button that is pressed occasionally. Dynamic import keeps it in its own
 * chunk, fetched only when someone actually exports.
 */
async function loadPdf() {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);
  return { jsPDF, autoTable };
}

const money = (n) => `K${Number(n || 0).toFixed(2)}`;
const dt = (v) => (v ? new Date(v).toLocaleString() : '—');

/**
 * Shared header: company, branch, shift identity. Returns the y position the
 * caller should continue from, so callers never hardcode offsets that drift
 * when a line is added here.
 */
function drawHeader(doc, shift, title) {
  doc.setFontSize(16);
  doc.text(shift.companyName || 'SmartPOS', 14, 18);

  doc.setFontSize(11);
  doc.text(title, 14, 26);

  doc.setFontSize(9);
  const lines = [
    shift.companyTpin ? `TPIN: ${shift.companyTpin}` : null,
    `Shift: ${shift.shiftNumber || shift.id}`,
    `Branch: ${shift.branchName || shift.branchId}`,
    `Cashier: ${shift.cashier?.name || '—'}`,
    `Opened: ${dt(shift.openedAt)}`,
    shift.closedAt ? `Closed: ${dt(shift.closedAt)}` : `Generated: ${dt(shift.generatedAt)}`,
  ].filter(Boolean);

  lines.forEach((line, i) => doc.text(line, 14, 34 + i * 5));
  return 34 + lines.length * 5 + 4;
}

function section(doc, autoTable, startY, title, rows) {
  autoTable(doc, {
    startY,
    head: [[title, '']],
    body: rows,
    theme: 'striped',
    headStyles: { fillColor: [55, 65, 81] },
    columnStyles: { 1: { halign: 'right' } },
    styles: { fontSize: 9 },
    margin: { left: 14, right: 14 },
  });
  return doc.lastAutoTable.finalY + 6;
}

/** X-report (open shift) or Z-report (closed) as a printable PDF. */
export async function exportShiftReportPdf(report) {
  const { jsPDF, autoTable } = await loadPdf();
  const { shift, sales = {}, cash = {}, salesByMethod = [], cashMovements = [] } = report;
  const isClosed = shift.status === 'CLOSED';
  const doc = new jsPDF();

  let y = drawHeader(doc, shift, isClosed ? 'Z-REPORT (Final Reconciliation)' : 'X-REPORT (Live Snapshot)');

  y = section(doc, autoTable, y, 'Sales Summary', [
    ['Gross Sales', money(sales.grossSales)],
    ['Discounts', `-${money(sales.discounts)}`],
    ['Net Sales', money(sales.netSales)],
    ['Tax (VAT)', money(sales.tax)],
    ['Refunds', `-${money(sales.refunds)}`],
    ['Transactions', String(sales.transactionCount ?? 0)],
    ['Refund Count', String(sales.refundCount ?? 0)],
    ['Cancelled', String(sales.cancelledCount ?? 0)],
  ]);

  y = section(
    doc,
    autoTable,
    y,
    'Payment Summary',
    salesByMethod.length
      ? salesByMethod.map((m) => [m.paymentMethod, money(m._sum?.total)])
      : [['No sales', money(0)]]
  );

  y = section(doc, autoTable, y, 'Cash Movements', [
    ['Opening Float', money(cash.openingFloat)],
    ['Cash Sales', money(cash.cashSales)],
    ['Cash In', money(cash.cashIn)],
    ['Cash Out', `-${money(cash.cashOut)}`],
    ['Paid Out', `-${money(cash.paidOut)}`],
    ['Cash Refunds', `-${money(cash.cashRefunds)}`],
  ]);

  const cashPosition = [['Expected Cash', money(cash.expectedCash)]];
  if (isClosed) {
    cashPosition.push(['Counted Cash', money(cash.countedCash)]);
    cashPosition.push([
      `Variance${cash.variance ? (cash.variance > 0 ? ' (OVER)' : ' (SHORT)') : ''}`,
      money(cash.variance),
    ]);
    if (cash.variancePct != null) cashPosition.push(['Variance %', `${cash.variancePct}%`]);
    if (shift.closedBy?.name) cashPosition.push(['Closed By', shift.closedBy.name]);
  }
  y = section(doc, autoTable, y, 'Cash Position', cashPosition);

  if (cashMovements.length) {
    autoTable(doc, {
      startY: y,
      head: [['Time', 'Type', 'Reason', 'Amount']],
      body: cashMovements.map((m) => [dt(m.createdAt), m.type, m.reason || '—', money(m.amount)]),
      theme: 'grid',
      headStyles: { fillColor: [55, 65, 81] },
      columnStyles: { 3: { halign: 'right' } },
      styles: { fontSize: 8 },
      margin: { left: 14, right: 14 },
    });
    y = doc.lastAutoTable.finalY + 6;
  }

  if (isClosed && shift.closingNotes) {
    doc.setFontSize(9);
    doc.text(`Closing notes: ${shift.closingNotes}`, 14, y);
  }

  doc.save(`${isClosed ? 'z-report' : 'x-report'}_${shift.shiftNumber || shift.id}.pdf`);
}

/** Shift Transaction Journal as a landscape PDF (wide table). */
export async function exportShiftJournalPdf(journal) {
  const { jsPDF, autoTable } = await loadPdf();
  const { shift, transactions = [], summary = {} } = journal;
  const doc = new jsPDF({ orientation: 'landscape' });

  doc.setFontSize(14);
  doc.text('SHIFT TRANSACTION JOURNAL', 14, 16);
  doc.setFontSize(9);
  doc.text(
    `Shift: ${shift.shiftNumber || shift.id}   Status: ${shift.status}   ` +
      `Sales: ${summary.sales ?? 0}  Refunds: ${summary.refunds ?? 0}  ` +
      `Cancelled: ${summary.cancelled ?? 0}  Cash movements: ${summary.cashMovements ?? 0}`,
    14,
    23
  );

  autoTable(doc, {
    startY: 28,
    head: [['Time', 'Invoice', 'Receipt', 'Type', 'Customer', 'Cashier', 'Payment', 'Total', 'Tax', 'Status']],
    body: transactions.map((t) => [
      dt(t.time),
      t.invoiceNumber || '—',
      t.receiptNumber || '—',
      t.type,
      t.customer || '—',
      t.cashier || '—',
      t.paymentMethod || '—',
      money(t.total),
      money(t.tax),
      t.status,
    ]),
    theme: 'grid',
    headStyles: { fillColor: [55, 65, 81] },
    columnStyles: { 7: { halign: 'right' }, 8: { halign: 'right' } },
    styles: { fontSize: 7.5 },
    margin: { left: 14, right: 14 },
  });

  doc.save(`shift-journal_${shift.shiftNumber || shift.id}.pdf`);
}

/** Journal as CSV, matching the Phase 4 report export convention. */
export function exportShiftJournalCsv(journal) {
  const cell = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const headers = ['Time', 'Invoice Number', 'Receipt Number', 'Type', 'Customer', 'Cashier', 'Payment Method', 'Total', 'Tax', 'Status', 'Note'];
  const rows = (journal.transactions || []).map((t) => [
    new Date(t.time).toISOString(),
    t.invoiceNumber ?? '',
    t.receiptNumber ?? '',
    t.type,
    t.customer ?? '',
    t.cashier ?? '',
    t.paymentMethod ?? '',
    Number(t.total || 0).toFixed(2),
    Number(t.tax || 0).toFixed(2),
    t.status,
    t.note ?? '',
  ]);
  const csv = [headers, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `shift-journal_${journal.shift?.shiftNumber || journal.shift?.id}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
