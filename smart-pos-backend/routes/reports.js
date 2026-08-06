const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { authenticateToken, requirePermission } = require('../middleware/auth');
const auditService = require('../services/auditService');
const reportsLib = require('../lib/reports');

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Fiscal states that are not yet successfully submitted to VSDC.
const PENDING_FISCAL_STATUSES = ['PENDING', 'FISCAL_SUBMITTING', 'FISCAL_FAILED'];

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d, n) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

/**
 * GET /api/reports/summary
 * Today's completed-sales totals + live fiscal (VSDC) status.
 */
router.get('/summary', authenticateToken, requirePermission('reports:read'), async (req, res) => {
  try {
    const today = startOfDay(new Date());
    const tomorrow = addDays(today, 1);
    const todayRange = { gte: today, lt: tomorrow };

    const [todayAgg, pending, failed, submittedToday, lastSyncSale] = await Promise.all([
      prisma.sale.aggregate({
        where: { status: 'COMPLETED', createdAt: todayRange },
        _sum: { total: true, tax: true },
        _count: { _all: true },
      }),
      prisma.sale.count({ where: { status: { in: PENDING_FISCAL_STATUSES } } }),
      prisma.sale.count({ where: { status: 'FISCAL_FAILED' } }),
      prisma.sale.count({ where: { status: 'COMPLETED', vsdcTimestamp: todayRange } }),
      prisma.sale.findFirst({
        where: { vsdcTimestamp: { not: null } },
        orderBy: { vsdcTimestamp: 'desc' },
        select: { vsdcTimestamp: true },
      }),
    ]);

    const transactions = todayAgg._count._all || 0;
    const revenue = todayAgg._sum.total || 0;

    res.json({
      today: {
        sales: revenue,
        transactions,
        tax: todayAgg._sum.tax || 0,
        avgTransaction: transactions > 0 ? revenue / transactions : 0,
      },
      fiscal: {
        pending,
        failed,
        submittedToday,
        lastSync: lastSyncSale?.vsdcTimestamp || null,
      },
    });
  } catch (error) {
    console.error('[reports] summary failed:', error.message);
    res.status(500).json({ error: 'Failed to build report summary' });
  }
});

/**
 * GET /api/reports/weekly
 * Completed-sales revenue + transaction count per day for the last 7 days.
 */
router.get('/weekly', authenticateToken, requirePermission('reports:read'), async (req, res) => {
  try {
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 7, 1), 90);
    const today = startOfDay(new Date());
    const rangeStart = addDays(today, -(days - 1));
    const rangeEnd = addDays(today, 1);

    const sales = await prisma.sale.findMany({
      where: { status: 'COMPLETED', createdAt: { gte: rangeStart, lt: rangeEnd } },
      select: { total: true, createdAt: true },
    });

    // Bucket by local calendar day.
    const buckets = [];
    for (let i = 0; i < days; i += 1) {
      const dayStart = addDays(rangeStart, i);
      buckets.push({
        date: dayStart.toISOString().slice(0, 10),
        day: DAY_NAMES[dayStart.getDay()],
        sales: 0,
        transactions: 0,
      });
    }

    for (const sale of sales) {
      const idx = Math.floor((startOfDay(sale.createdAt) - rangeStart) / 86_400_000);
      if (idx >= 0 && idx < buckets.length) {
        buckets[idx].sales += sale.total || 0;
        buckets[idx].transactions += 1;
      }
    }

    res.json({ days, weekly: buckets });
  } catch (error) {
    console.error('[reports] weekly failed:', error.message);
    res.status(500).json({ error: 'Failed to build weekly report' });
  }
});

function csvCell(value) {
  const s = value == null ? '' : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * GET /api/reports/transactions
 * Transaction listing for the given range. JSON by default; ?format=csv
 * streams a downloadable CSV (ZRA-mandated export).
 * query: startDate, endDate (ISO), status, format=csv
 */
router.get('/transactions', authenticateToken, requirePermission('reports:read'), async (req, res) => {
  try {
    const end = req.query.endDate ? new Date(req.query.endDate) : addDays(startOfDay(new Date()), 1);
    const start = req.query.startDate
      ? new Date(req.query.startDate)
      : addDays(startOfDay(new Date()), -29);

    const where = { createdAt: { gte: start, lt: end } };
    if (req.query.status) where.status = req.query.status;

    const sales = await prisma.sale.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        fiscalInvcNo: true,
        rcptNo: true,
        createdAt: true,
        customerName: true,
        customerTpin: true,
        status: true,
        subtotal: true,
        tax: true,
        discount: true,
        total: true,
        paymentMethod: true,
      },
    });

    if (req.query.format === 'csv') {
      const headers = [
        'Invoice No', 'Receipt No', 'Date', 'Customer', 'TPIN',
        'Status', 'Payment', 'Subtotal', 'Tax', 'Discount', 'Total',
      ];
      const rows = sales.map((s) => [
        s.fiscalInvcNo ?? '',
        s.rcptNo ?? '',
        s.createdAt.toISOString(),
        s.customerName ?? '',
        s.customerTpin ?? '',
        s.status,
        s.paymentMethod,
        (s.subtotal ?? 0).toFixed(2),
        (s.tax ?? 0).toFixed(2),
        (s.discount ?? 0).toFixed(2),
        (s.total ?? 0).toFixed(2),
      ]);
      const csv = [headers, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');

      const filename = `transactions_${start.toISOString().slice(0, 10)}_${new Date(end.getTime() - 1).toISOString().slice(0, 10)}.csv`;

      auditService.safeLog(auditService.eventTypes.DATA_EXPORT, {
        ...auditService.contextFromReq(req),
        entityType: 'REPORT',
        action: 'EXPORT_TRANSACTIONS_CSV',
        description: `Exported ${sales.length} transactions to CSV (${filename})`,
      });

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.send(csv);
    }

    return res.json({
      count: sales.length,
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      transactions: sales,
    });
  } catch (error) {
    console.error('[reports] transactions failed:', error.message);
    res.status(500).json({ error: 'Failed to build transactions report' });
  }
});

/* ------------------------------------------------------------------ *
 * Phase 4 reports — aggregation lives in lib/reports.js; these handlers
 * only parse query params, pick JSON vs CSV, and audit the export.
 * ------------------------------------------------------------------ */

/**
 * Wires one report function to a route: JSON by default, CSV on ?format=csv.
 * Only the CSV branch is audit-logged — an export leaves the system, a page
 * view doesn't, and logging every view would bury the real signal.
 */
function reportHandler({ permission, name, build, buildCsv, filenamePrefix, csvSource }) {
  return [
    authenticateToken,
    requirePermission(permission),
    async (req, res) => {
      try {
        const params = {
          startDate: req.query.startDate,
          endDate: req.query.endDate,
          userId: req.query.userId,
          supplierId: req.query.supplierId,
          status: req.query.status,
        };

        const report = await build(params);

        if (req.query.format === 'csv') {
          const source = csvSource ? await csvSource(params) : report;
          const csv = buildCsv(source);
          const stamp = new Date().toISOString().slice(0, 10);
          const filename = `${filenamePrefix}_${stamp}.csv`;

          auditService.safeLog(auditService.eventTypes.DATA_EXPORT, {
            ...auditService.contextFromReq(req),
            entityType: 'REPORT',
            action: `EXPORT_${name}_CSV`,
            description: `Exported ${name.toLowerCase().replace(/_/g, ' ')} report to CSV (${filename})`,
          });

          res.setHeader('Content-Type', 'text/csv; charset=utf-8');
          res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
          return res.send(csv);
        }

        return res.json(report);
      } catch (error) {
        console.error(`[reports] ${name.toLowerCase()} failed:`, error.message);
        return res.status(error.status || 500).json({ error: `Failed to build ${name.toLowerCase().replace(/_/g, ' ')} report` });
      }
    },
  ];
}

/** GET /api/reports/tax — VAT liability by category. */
router.get('/tax', ...reportHandler({
  permission: 'reports:read',
  name: 'TAX',
  build: reportsLib.getTaxReport,
  buildCsv: reportsLib.taxReportCsv,
  filenamePrefix: 'tax_report',
}));

/** GET /api/reports/profit — revenue vs COGS from SALE_OUT movements. */
router.get('/profit', ...reportHandler({
  permission: 'reports:read',
  name: 'PROFIT',
  build: reportsLib.getProfitReport,
  buildCsv: reportsLib.profitReportCsv,
  filenamePrefix: 'profit_report',
}));

/** GET /api/reports/shifts — combined cash reconciliation + shift history. */
router.get('/shifts', ...reportHandler({
  permission: 'reports:read',
  name: 'SHIFTS',
  build: reportsLib.getShiftHistoryReport,
  buildCsv: reportsLib.shiftHistoryCsv,
  filenamePrefix: 'shift_report',
}));

/** GET /api/reports/purchases — supplier spend, ordered vs received. */
router.get('/purchases', ...reportHandler({
  permission: 'reports:read',
  name: 'PURCHASES',
  build: reportsLib.getPurchaseReport,
  buildCsv: reportsLib.purchaseReportCsv,
  filenamePrefix: 'purchase_report',
}));

/**
 * GET /api/reports/user-activity — audit-trail summary.
 * Gated on audit:read, not reports:read: a VIEWER can see business numbers
 * but has no business reading who did what. The CSV exports the raw event
 * list rather than the summary, capped in lib/reports.js.
 */
router.get('/user-activity', ...reportHandler({
  permission: 'audit:read',
  name: 'USER_ACTIVITY',
  build: reportsLib.getUserActivityReport,
  buildCsv: reportsLib.userActivityCsv,
  csvSource: reportsLib.getUserActivityEvents,
  filenamePrefix: 'user_activity',
}));

module.exports = router;
