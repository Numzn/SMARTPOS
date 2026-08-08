/**
 * Inventory stock-take import/export.
 *
 * Shares the CSV machinery and the plan-then-apply shape with the product
 * importer, but deliberately not its write path. A product import sets fields;
 * a stock change is an *event* — it has to append a StockMovement (the ledger
 * and the cost basis the profit report reads), record a StockAdjustment for
 * the ZRA audit trail, and move batches. So every row here goes through
 * applyStockAdjustment(), the same function the manual adjustment screen uses,
 * rather than writing Inventory.currentStock directly.
 *
 * The file expresses a *counted* quantity, not a delta: "SKU X, counted 42".
 * That is how a stock take actually works — someone counts a shelf. The
 * importer computes the difference and raises the appropriate IN or OUT
 * adjustment, so the audit trail records what really happened.
 */

const prisma = require('./prisma');
const { toRecords, csvCell } = require('./csv');
const { applyStockAdjustment } = require('./inventoryAdjust');

const REQUIRED_HEADERS = ['sku', 'counted'];

const EXPORT_HEADERS = [
  'sku', 'name', 'branch', 'onHand', 'reserved', 'sellable', 'averageCost', 'stockValue', 'counted',
];

const num = (value) => {
  if (value === '' || value == null) return null;
  const n = Number(String(value).replace(/,/g, ''));
  return Number.isFinite(n) ? n : NaN;
};

/**
 * Validate and resolve every row, reporting the delta each would produce.
 * Writes nothing.
 */
async function planInventoryImport(csvText, { branchId = 'main' } = {}) {
  const records = toRecords(csvText, REQUIRED_HEADERS);

  const skus = records.map((r) => r.sku).filter(Boolean);
  const products = await prisma.product.findMany({
    where: { sku: { in: skus } },
    select: {
      id: true,
      sku: true,
      name: true,
      inventory: { where: { branchId }, select: { currentStock: true, reservedStock: true } },
    },
  });
  const bySku = new Map(products.filter((p) => p.sku).map((p) => [p.sku.toLowerCase(), p]));

  const seen = new Map();
  const rows = [];

  for (const record of records) {
    const errors = [];
    const sku = record.sku || '';

    if (!sku) errors.push('sku is required — it is how a row is matched to a product');

    const counted = num(record.counted);
    if (counted === null) errors.push('counted is required');
    else if (Number.isNaN(counted)) errors.push(`counted "${record.counted}" is not a number`);
    else if (counted < 0) errors.push('counted cannot be negative');
    else if (!Number.isInteger(counted)) errors.push('counted must be a whole number of units');

    const unitCost = num(record.unitcost ?? record.averagecost);
    if (Number.isNaN(unitCost)) errors.push(`unitCost "${record.unitcost ?? record.averagecost}" is not a number`);

    if (sku) {
      const dupLine = seen.get(sku.toLowerCase());
      if (dupLine) errors.push(`duplicate sku in file (also on line ${dupLine})`);
      else seen.set(sku.toLowerCase(), record.__line);
    }

    const product = sku ? bySku.get(sku.toLowerCase()) : null;
    if (sku && !product) {
      errors.push(`no product with sku "${sku}" — stock takes can only count products that exist`);
    }

    const onHand = product?.inventory?.[0]?.currentStock ?? 0;
    const reserved = product?.inventory?.[0]?.reservedStock ?? 0;
    const delta = counted != null && !Number.isNaN(counted) ? counted - onHand : null;

    // A count below what is already reserved for in-flight sales cannot be
    // satisfied — those units are promised to transactions mid-flight, and
    // writing the count anyway is how reserved stock drifts out of step with
    // reality.
    if (product && counted != null && !Number.isNaN(counted) && counted < reserved) {
      errors.push(
        `counted ${counted} is below the ${reserved} unit(s) currently reserved by in-flight sales — ` +
        'complete or cancel those first'
      );
    }

    rows.push({
      line: record.__line,
      action: errors.length ? 'error' : delta === 0 ? 'unchanged' : delta > 0 ? 'increase' : 'decrease',
      errors,
      sku,
      productId: product?.id || null,
      productName: product?.name || null,
      onHand,
      reserved,
      counted: Number.isNaN(counted) ? null : counted,
      delta,
      unitCost: unitCost ?? null,
      reason: record.reason || null,
    });
  }

  const counts = (action) => rows.filter((r) => r.action === action).length;

  return {
    branchId,
    totalRows: rows.length,
    summary: {
      increase: counts('increase'),
      decrease: counts('decrease'),
      unchanged: counts('unchanged'),
      error: counts('error'),
      netUnits: rows.filter((r) => r.action !== 'error').reduce((sum, r) => sum + (r.delta || 0), 0),
    },
    rows,
  };
}

/**
 * Apply a stock take. Refuses the whole file if any row is invalid, and skips
 * rows whose count already matches — writing a zero-quantity adjustment would
 * put noise in the audit trail for no reason.
 */
async function applyInventoryImport(csvText, { branchId = 'main', userId, reason } = {}) {
  if (!userId) {
    const err = new Error('userId is required');
    err.status = 400;
    throw err;
  }

  const plan = await planInventoryImport(csvText, { branchId });

  if (plan.summary.error > 0) {
    const err = new Error(
      `${plan.summary.error} row(s) have errors. Nothing was changed — fix them and try again.`
    );
    err.status = 400;
    err.plan = plan;
    throw err;
  }

  const changed = plan.rows.filter((r) => r.action === 'increase' || r.action === 'decrease');

  const applied = await prisma.$transaction(async (tx) => {
    let increased = 0;
    let decreased = 0;

    for (const row of changed) {
      const direction = row.delta > 0 ? 'IN' : 'OUT';
      await applyStockAdjustment(tx, {
        productId: row.productId,
        direction,
        // RECOUNT is the ZRA audit type for a physical stock take, which is
        // what this is — not an arbitrary increase or shrinkage write-off.
        auditType: 'RECOUNT',
        quantity: Math.abs(row.delta),
        reason: row.reason || reason || 'Stock take (CSV import)',
        unitCost: row.unitCost ?? undefined,
        // StockAdjustment.ocrnDt is a DateTime column, not the ZRA yyyymmdd
        // string form — the ZRA formatting happens at submission time.
        ocrnDt: new Date(),
        branchId,
        userId,
      });
      if (direction === 'IN') increased += 1;
      else decreased += 1;
    }

    return { increased, decreased };
  });

  return {
    ...applied,
    unchanged: plan.summary.unchanged,
    totalRows: plan.totalRows,
    netUnits: plan.summary.netUnits,
  };
}

/**
 * Export current stock. `counted` is emitted blank on purpose: this doubles as
 * the stock-take sheet, so someone can print or open it, write the counted
 * figures in, and feed the same file back.
 */
async function exportInventoryCsv({ branchId = 'main' } = {}) {
  const inventory = await prisma.inventory.findMany({
    where: { branchId },
    include: { product: { select: { sku: true, name: true } } },
    orderBy: { product: { name: 'asc' } },
  });

  const rows = inventory.map((i) => [
    i.product?.sku ?? '',
    i.product?.name ?? '',
    i.branchId,
    i.currentStock,
    i.reservedStock ?? 0,
    Math.max(0, i.currentStock - (i.reservedStock ?? 0)),
    i.averageCost ?? '',
    i.totalValue ?? '',
    '', // counted — left for whoever does the count
  ]);

  return [EXPORT_HEADERS, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
}

module.exports = {
  planInventoryImport,
  applyInventoryImport,
  exportInventoryCsv,
  EXPORT_HEADERS,
};
