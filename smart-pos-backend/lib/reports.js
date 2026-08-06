/**
 * Phase 4 reporting — read-only aggregation over data the earlier phases
 * already write. No new tables, no new columns: every figure here is derived
 * from Sale/SaleItem, StockMovement, Shift, PurchaseOrder/GRN, and AuditLog.
 *
 * The three original handlers (summary/weekly/transactions) stay inline in
 * routes/reports.js — they predate this file and work; retrofitting them
 * would be churn for no functional gain.
 */

const prisma = require('./prisma');

const COMPLETED = 'COMPLETED';

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d, n) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

/**
 * Shared range resolution. Defaults to the trailing `defaultDays` window
 * ending at the end of today, matching the existing /transactions handler.
 * `endDate` is treated as inclusive of that whole day.
 */
function resolveDateRange({ startDate, endDate } = {}, defaultDays = 30) {
  const end = endDate ? addDays(startOfDay(new Date(endDate)), 1) : addDays(startOfDay(new Date()), 1);
  const start = startDate
    ? startOfDay(new Date(startDate))
    : addDays(startOfDay(new Date()), -(defaultDays - 1));
  return { start, end };
}

function csvCell(value) {
  const s = value == null ? '' : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(headers, rows) {
  return [headers, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
}

const round2 = (n) => parseFloat((n || 0).toFixed(2));

function marginPct(revenue, grossProfit) {
  return revenue > 0 ? round2((grossProfit / revenue) * 100) : 0;
}

/* ------------------------------------------------------------------ *
 * Tax
 * ------------------------------------------------------------------ */

/**
 * VAT liability for the period, split by the product's VAT category. Uses the
 * per-line ZRA amounts (taxblAmt/taxAmt/totAmt) captured at sale time rather
 * than recomputing from the current tax rate — a rate change must never
 * retroactively restate a filed period.
 */
async function getTaxReport(params = {}) {
  const { start, end } = resolveDateRange(params);

  const items = await prisma.saleItem.findMany({
    where: { sale: { status: COMPLETED, createdAt: { gte: start, lt: end } } },
    select: {
      saleId: true,
      taxblAmt: true,
      taxAmt: true,
      totAmt: true,
      product: { select: { vatCategoryCode: true, taxType: true } },
    },
  });

  const buckets = new Map();
  const saleIds = new Set();
  let taxableSales = 0;
  let totalTax = 0;
  let totalSales = 0;

  for (const item of items) {
    saleIds.add(item.saleId);
    const category = item.product?.vatCategoryCode || item.product?.taxType || 'STANDARD';
    const bucket = buckets.get(category) || { category, taxableAmount: 0, taxAmount: 0, totalAmount: 0 };
    bucket.taxableAmount += item.taxblAmt || 0;
    bucket.taxAmount += item.taxAmt || 0;
    bucket.totalAmount += item.totAmt || 0;
    buckets.set(category, bucket);

    taxableSales += item.taxblAmt || 0;
    totalTax += item.taxAmt || 0;
    totalSales += item.totAmt || 0;
  }

  return {
    startDate: start,
    endDate: end,
    summary: {
      taxableSales: round2(taxableSales),
      totalTax: round2(totalTax),
      totalSales: round2(totalSales),
      transactionCount: saleIds.size,
    },
    byCategory: [...buckets.values()]
      .map((b) => ({
        category: b.category,
        taxableAmount: round2(b.taxableAmount),
        taxAmount: round2(b.taxAmount),
        totalAmount: round2(b.totalAmount),
      }))
      .sort((a, b) => b.taxAmount - a.taxAmount),
  };
}

function taxReportCsv(report) {
  return toCsv(
    ['VAT Category', 'Taxable Amount', 'Tax Amount', 'Total Amount'],
    report.byCategory.map((c) => [
      c.category,
      c.taxableAmount.toFixed(2),
      c.taxAmount.toFixed(2),
      c.totalAmount.toFixed(2),
    ])
  );
}

/* ------------------------------------------------------------------ *
 * Profit
 * ------------------------------------------------------------------ */

/**
 * Gross profit for the period. COGS comes from the SALE_OUT stock movements
 * written atomically with sale completion, so it reflects the weighted-average
 * cost at the moment of sale, not today's cost.
 *
 * Caveat worth knowing when reading the output: a sale with no matching
 * SALE_OUT movement (imported/backfilled data, or a sale created outside the
 * normal checkout path) contributes revenue but zero cost, which inflates
 * margin. `salesMissingCostBasis` reports how many such sales are in range so
 * the number can be trusted or discounted accordingly.
 */
async function getProfitReport(params = {}) {
  const { start, end } = resolveDateRange(params);

  const sales = await prisma.sale.findMany({
    where: { status: COMPLETED, createdAt: { gte: start, lt: end } },
    select: { id: true, total: true, tax: true, discount: true },
  });
  const saleIds = sales.map((s) => s.id);

  const revenue = sales.reduce((sum, s) => sum + (s.total || 0), 0);
  const tax = sales.reduce((sum, s) => sum + (s.tax || 0), 0);
  const discount = sales.reduce((sum, s) => sum + (s.discount || 0), 0);

  if (saleIds.length === 0) {
    return {
      startDate: start,
      endDate: end,
      summary: {
        revenue: 0, cogs: 0, grossProfit: 0, marginPct: 0,
        tax: 0, discount: 0, transactionCount: 0, salesMissingCostBasis: 0,
      },
      byProduct: [],
    };
  }

  const movementWhere = {
    movementType: 'SALE_OUT',
    referenceType: 'SALE',
    referenceId: { in: saleIds },
  };

  const [cogsAgg, costByProduct, revenueByProduct, salesWithCost] = await Promise.all([
    prisma.stockMovement.aggregate({ where: movementWhere, _sum: { totalCost: true } }),
    prisma.stockMovement.groupBy({
      by: ['productId'],
      where: movementWhere,
      _sum: { totalCost: true, quantity: true },
    }),
    prisma.saleItem.groupBy({
      by: ['productId'],
      where: { saleId: { in: saleIds } },
      _sum: { total: true, quantity: true },
    }),
    prisma.stockMovement.findMany({
      where: movementWhere,
      select: { referenceId: true },
      distinct: ['referenceId'],
    }),
  ]);

  const cogs = cogsAgg._sum.totalCost || 0;
  const grossProfit = revenue - cogs;

  const costMap = new Map(costByProduct.map((c) => [c.productId, c._sum.totalCost || 0]));
  const productIds = revenueByProduct.map((r) => r.productId);
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, name: true, sku: true },
  });
  const productMap = new Map(products.map((p) => [p.id, p]));

  const byProduct = revenueByProduct
    .map((r) => {
      const lineRevenue = r._sum.total || 0;
      const lineCogs = costMap.get(r.productId) || 0;
      const lineProfit = lineRevenue - lineCogs;
      const product = productMap.get(r.productId);
      return {
        productId: r.productId,
        productName: product?.name || 'Unknown product',
        sku: product?.sku || null,
        unitsSold: r._sum.quantity || 0,
        revenue: round2(lineRevenue),
        cogs: round2(lineCogs),
        grossProfit: round2(lineProfit),
        marginPct: marginPct(lineRevenue, lineProfit),
      };
    })
    .sort((a, b) => b.grossProfit - a.grossProfit)
    .slice(0, 20);

  return {
    startDate: start,
    endDate: end,
    summary: {
      revenue: round2(revenue),
      cogs: round2(cogs),
      grossProfit: round2(grossProfit),
      marginPct: marginPct(revenue, grossProfit),
      tax: round2(tax),
      discount: round2(discount),
      transactionCount: sales.length,
      salesMissingCostBasis: sales.length - salesWithCost.length,
    },
    byProduct,
  };
}

function profitReportCsv(report) {
  return toCsv(
    ['Product', 'SKU', 'Units Sold', 'Revenue', 'COGS', 'Gross Profit', 'Margin %'],
    report.byProduct.map((p) => [
      p.productName,
      p.sku ?? '',
      p.unitsSold,
      p.revenue.toFixed(2),
      p.cogs.toFixed(2),
      p.grossProfit.toFixed(2),
      p.marginPct.toFixed(2),
    ])
  );
}

/* ------------------------------------------------------------------ *
 * Cash & Shifts (combined)
 * ------------------------------------------------------------------ */

/**
 * Shift history with cash reconciliation. Deliberately one report rather than
 * separate "cash" and "shift" views: a Shift row *is* the cash-drawer session,
 * so both angles read the same columns and the same joins.
 */
async function getShiftHistoryReport(params = {}) {
  const { start, end } = resolveDateRange(params);
  const { userId, status } = params;

  const where = { openedAt: { gte: start, lt: end } };
  if (userId) where.userId = userId;
  if (status) where.status = status;

  const shifts = await prisma.shift.findMany({
    where,
    include: { user: { select: { id: true, name: true, email: true } } },
    orderBy: { openedAt: 'desc' },
  });
  const shiftIds = shifts.map((s) => s.id);

  const [salesByShift, refundsByShift] = shiftIds.length
    ? await Promise.all([
        prisma.sale.groupBy({
          by: ['shiftId'],
          where: { shiftId: { in: shiftIds }, status: COMPLETED },
          _sum: { total: true },
          _count: { _all: true },
        }),
        prisma.refund.groupBy({
          by: ['shiftId'],
          where: { shiftId: { in: shiftIds }, status: COMPLETED },
          _sum: { total: true },
          _count: { _all: true },
        }),
      ])
    : [[], []];

  const salesMap = new Map(salesByShift.map((s) => [s.shiftId, s]));
  const refundsMap = new Map(refundsByShift.map((r) => [r.shiftId, r]));

  const rows = shifts.map((shift) => {
    const sale = salesMap.get(shift.id);
    const refund = refundsMap.get(shift.id);
    const closedAt = shift.closedAt ? new Date(shift.closedAt) : null;
    return {
      id: shift.id,
      cashier: shift.user,
      branchId: shift.branchId,
      status: shift.status,
      openedAt: shift.openedAt,
      closedAt: shift.closedAt,
      durationMinutes: closedAt
        ? Math.round((closedAt - new Date(shift.openedAt)) / 60000)
        : null,
      openingFloat: round2(shift.openingFloat),
      salesCount: sale?._count?._all || 0,
      salesTotal: round2(sale?._sum?.total || 0),
      refundsCount: refund?._count?._all || 0,
      refundsTotal: round2(refund?._sum?.total || 0),
      expectedCash: shift.expectedCash == null ? null : round2(shift.expectedCash),
      countedCash: shift.countedCash == null ? null : round2(shift.countedCash),
      variance: shift.variance == null ? null : round2(shift.variance),
      closingNotes: shift.closingNotes,
    };
  });

  const closed = rows.filter((r) => r.status === 'CLOSED');

  return {
    startDate: start,
    endDate: end,
    summary: {
      shiftCount: rows.length,
      openCount: rows.filter((r) => r.status === 'OPEN').length,
      closedCount: closed.length,
      totalSales: round2(rows.reduce((sum, r) => sum + r.salesTotal, 0)),
      totalRefunds: round2(rows.reduce((sum, r) => sum + r.refundsTotal, 0)),
      totalVariance: round2(closed.reduce((sum, r) => sum + (r.variance || 0), 0)),
      shiftsWithVariance: closed.filter((r) => (r.variance || 0) !== 0).length,
    },
    shifts: rows,
  };
}

function shiftHistoryCsv(report) {
  return toCsv(
    ['Cashier', 'Status', 'Opened', 'Closed', 'Duration (min)', 'Opening Float',
      'Sales Count', 'Sales Total', 'Refunds Total', 'Expected Cash', 'Counted Cash', 'Variance'],
    report.shifts.map((s) => [
      s.cashier?.name ?? '',
      s.status,
      new Date(s.openedAt).toISOString(),
      s.closedAt ? new Date(s.closedAt).toISOString() : '',
      s.durationMinutes ?? '',
      s.openingFloat.toFixed(2),
      s.salesCount,
      s.salesTotal.toFixed(2),
      s.refundsTotal.toFixed(2),
      s.expectedCash == null ? '' : s.expectedCash.toFixed(2),
      s.countedCash == null ? '' : s.countedCash.toFixed(2),
      s.variance == null ? '' : s.variance.toFixed(2),
    ])
  );
}

/* ------------------------------------------------------------------ *
 * Purchases
 * ------------------------------------------------------------------ */

/**
 * Purchasing spend for the period. Ordered value comes from PurchaseOrder
 * totals; received value from GRN lines, since an order can be partially
 * received (or never received) and the two figures legitimately differ.
 */
async function getPurchaseReport(params = {}) {
  const { start, end } = resolveDateRange(params);
  const { supplierId } = params;

  const orderWhere = { orderDate: { gte: start, lt: end } };
  if (supplierId) orderWhere.supplierId = supplierId;

  const grnItemWhere = {
    goodsReceivedNote: {
      receivedDate: { gte: start, lt: end },
      ...(supplierId ? { supplierId } : {}),
    },
  };

  const [orders, grnItems] = await Promise.all([
    prisma.purchaseOrder.findMany({
      where: orderWhere,
      include: { supplier: { select: { id: true, name: true } } },
      orderBy: { orderDate: 'desc' },
    }),
    prisma.goodsReceivedNoteItem.findMany({
      where: grnItemWhere,
      select: {
        quantityReceived: true,
        unitCost: true,
        goodsReceivedNote: { select: { supplierId: true } },
      },
    }),
  ]);

  const receivedBySupplier = new Map();
  let totalReceivedValue = 0;
  for (const item of grnItems) {
    const value = (item.quantityReceived || 0) * (item.unitCost || 0);
    totalReceivedValue += value;
    const sid = item.goodsReceivedNote?.supplierId;
    if (sid) receivedBySupplier.set(sid, (receivedBySupplier.get(sid) || 0) + value);
  }

  const supplierBuckets = new Map();
  for (const order of orders) {
    const sid = order.supplierId;
    const bucket = supplierBuckets.get(sid) || {
      supplierId: sid,
      supplierName: order.supplier?.name || 'Unknown supplier',
      orderCount: 0,
      orderValue: 0,
    };
    bucket.orderCount += 1;
    bucket.orderValue += order.total || 0;
    supplierBuckets.set(sid, bucket);
  }
  // Suppliers with receipts in range but no orders raised in range still belong
  // in the spend picture — a delivery against last month's PO is this month's stock.
  for (const [sid, value] of receivedBySupplier) {
    if (!supplierBuckets.has(sid)) {
      supplierBuckets.set(sid, {
        supplierId: sid,
        supplierName: 'Unknown supplier',
        orderCount: 0,
        orderValue: 0,
      });
    }
    supplierBuckets.get(sid).receivedValue = round2(value);
  }

  const bySupplier = [...supplierBuckets.values()]
    .map((b) => ({
      ...b,
      orderValue: round2(b.orderValue),
      receivedValue: round2(b.receivedValue || 0),
    }))
    .sort((a, b) => b.orderValue - a.orderValue);

  const countByStatus = (statuses) => orders.filter((o) => statuses.includes(o.status)).length;

  return {
    startDate: start,
    endDate: end,
    summary: {
      orderCount: orders.length,
      totalOrderValue: round2(orders.reduce((sum, o) => sum + (o.total || 0), 0)),
      openOrders: countByStatus(['DRAFT', 'SENT', 'PARTIALLY_RECEIVED']),
      receivedOrders: countByStatus(['RECEIVED']),
      cancelledOrders: countByStatus(['CANCELLED']),
      totalReceivedValue: round2(totalReceivedValue),
    },
    bySupplier,
    orders: orders.map((o) => ({
      id: o.id,
      poNumber: o.poNumber,
      supplierName: o.supplier?.name || 'Unknown supplier',
      status: o.status,
      orderDate: o.orderDate,
      total: round2(o.total),
    })),
  };
}

function purchaseReportCsv(report) {
  return toCsv(
    ['PO Number', 'Supplier', 'Status', 'Order Date', 'Total'],
    report.orders.map((o) => [
      o.poNumber,
      o.supplierName,
      o.status,
      new Date(o.orderDate).toISOString(),
      o.total.toFixed(2),
    ])
  );
}

/* ------------------------------------------------------------------ *
 * User activity
 * ------------------------------------------------------------------ */

const ACTIVITY_EXPORT_LIMIT = 10000;

/**
 * Who did what, from the audit trail. Summary only — the raw event list is
 * reserved for the CSV export, and capped, because audit volume has no natural
 * per-day ceiling the way sales do.
 */
async function getUserActivityReport(params = {}) {
  const { start, end } = resolveDateRange(params);
  const { userId } = params;

  const where = { timestamp: { gte: start, lt: end } };
  if (userId) where.userId = userId;

  const [byUserRaw, byEventTypeRaw, totalEvents] = await Promise.all([
    prisma.auditLog.groupBy({
      by: ['userId', 'userRole'],
      where,
      _count: { _all: true },
      _max: { timestamp: true },
    }),
    prisma.auditLog.groupBy({
      by: ['eventType'],
      where,
      _count: { _all: true },
    }),
    prisma.auditLog.count({ where }),
  ]);

  const userIds = byUserRaw.map((u) => u.userId).filter(Boolean);
  const users = userIds.length
    ? await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, name: true, email: true },
      })
    : [];
  const userMap = new Map(users.map((u) => [u.id, u]));

  const byUser = byUserRaw
    .map((u) => ({
      userId: u.userId,
      userName: u.userId ? userMap.get(u.userId)?.name || 'Deleted user' : 'System / anonymous',
      role: u.userRole || null,
      eventCount: u._count._all,
      lastActivity: u._max.timestamp,
    }))
    .sort((a, b) => b.eventCount - a.eventCount);

  const byEventType = byEventTypeRaw
    .map((e) => ({ eventType: e.eventType, count: e._count._all }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 15);

  return {
    startDate: start,
    endDate: end,
    summary: {
      totalEvents,
      activeUsers: byUser.filter((u) => u.userId).length,
    },
    byUser,
    byEventType,
  };
}

async function getUserActivityEvents(params = {}) {
  const { start, end } = resolveDateRange(params);
  const where = { timestamp: { gte: start, lt: end } };
  if (params.userId) where.userId = params.userId;

  return prisma.auditLog.findMany({
    where,
    orderBy: { timestamp: 'desc' },
    take: ACTIVITY_EXPORT_LIMIT,
    select: {
      timestamp: true, eventType: true, userId: true, userRole: true,
      entityType: true, entityId: true, action: true, description: true,
      riskLevel: true, success: true,
    },
  });
}

function userActivityCsv(events) {
  return toCsv(
    ['Timestamp', 'Event Type', 'User ID', 'Role', 'Entity Type', 'Entity ID',
      'Action', 'Risk', 'Success', 'Description'],
    events.map((e) => [
      e.timestamp.toISOString(),
      e.eventType,
      e.userId ?? '',
      e.userRole ?? '',
      e.entityType ?? '',
      e.entityId ?? '',
      e.action ?? '',
      e.riskLevel,
      e.success,
      e.description ?? '',
    ])
  );
}

module.exports = {
  resolveDateRange,
  csvCell,
  toCsv,
  getTaxReport,
  taxReportCsv,
  getProfitReport,
  profitReportCsv,
  getShiftHistoryReport,
  shiftHistoryCsv,
  getPurchaseReport,
  purchaseReportCsv,
  getUserActivityReport,
  getUserActivityEvents,
  userActivityCsv,
  ACTIVITY_EXPORT_LIMIT,
};
