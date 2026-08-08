/**
 * Product catalogue CSV import/export.
 *
 * Import is deliberately two-phase: plan, then apply. The plan runs every
 * validation and reports what *would* happen per row without writing anything,
 * so a bad file is caught while it is still harmless rather than after it has
 * half-rewritten the catalogue a till is selling from.
 *
 * Categories are resolved by name because a CSV cannot carry cuids. An unknown
 * category is reported as a row error rather than silently created — quietly
 * inventing categories from typos is how a catalogue turns into a mess.
 */

const prisma = require('./prisma');
const { parseCsv, toRecords: toRecordsShared, csvCell, toCsv } = require('./csv');

const REQUIRED_HEADERS = ['name', 'price'];

const EXPORT_HEADERS = [
  'sku', 'name', 'description', 'category', 'price', 'cost',
  'barcode', 'brand', 'unit', 'taxRate', 'vatCategoryCode', 'isActive',
];

const toRecords = (text) => toRecordsShared(text, REQUIRED_HEADERS);

const num = (value) => {
  if (value === '' || value == null) return null;
  const n = Number(String(value).replace(/,/g, ''));
  return Number.isFinite(n) ? n : NaN;
};

/**
 * Tax rates are stored as a percentage (16 means 16% VAT), but the domain also
 * names its rates: ZRA works in VAT categories, and a "tax" column in a
 * hand-built file very often reads STANDARD rather than 16. Both are
 * meaningful, and rejecting the named form with "not a number" is technically
 * true and practically useless.
 *
 * So a taxRate cell accepts either. A named category resolves to its rate and
 * also sets vatCategoryCode, since that is what the name actually means.
 */
const VAT_CATEGORY_RATES = {
  STANDARD: 16,
  ZERO_RATED: 0,
  ZERO: 0,
  'ZERO RATED': 0,
  EXEMPT: 0,
};

const VAT_CATEGORY_CANONICAL = {
  STANDARD: 'STANDARD',
  ZERO_RATED: 'ZERO_RATED',
  ZERO: 'ZERO_RATED',
  'ZERO RATED': 'ZERO_RATED',
  EXEMPT: 'EXEMPT',
};

/**
 * Returns { rate, vatCategoryCode, error }. A percent sign is tolerated
 * ("16%"), since spreadsheets format tax columns that way constantly.
 */
function parseTaxRate(raw) {
  if (raw === undefined || raw === '') return { rate: undefined, vatCategoryCode: undefined };

  const key = String(raw).trim().toUpperCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ');
  const byName = key in VAT_CATEGORY_RATES ? key : key.replace(/ /g, '_');

  if (byName in VAT_CATEGORY_RATES) {
    return {
      rate: VAT_CATEGORY_RATES[byName],
      vatCategoryCode: VAT_CATEGORY_CANONICAL[byName],
    };
  }

  const n = num(String(raw).replace(/%/g, '').trim());
  if (n === null) return { rate: undefined, vatCategoryCode: undefined };
  if (Number.isNaN(n)) {
    return {
      error:
        `taxRate "${raw}" is not a number or a known VAT category. ` +
        `Use a percentage like 16, or one of: ${Object.keys(VAT_CATEGORY_CANONICAL).join(', ')}`,
    };
  }
  if (n < 0 || n > 100) {
    return { error: `taxRate "${raw}" is out of range — it is a percentage, so 16 means 16%` };
  }
  return { rate: n, vatCategoryCode: undefined };
}

/** Edit distance, capped — only used to suggest a near-miss category name. */
function editDistance(a, b) {
  const s = a.toLowerCase();
  const t = b.toLowerCase();
  const d = Array.from({ length: s.length + 1 }, (_, i) => [i, ...Array(t.length).fill(0)]);
  for (let j = 0; j <= t.length; j += 1) d[0][j] = j;
  for (let i = 1; i <= s.length; i += 1) {
    for (let j = 1; j <= t.length; j += 1) {
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + (s[i - 1] === t[j - 1] ? 0 : 1)
      );
    }
  }
  return d[s.length][t.length];
}

/**
 * Suggests the closest existing category. Deliberately suggests rather than
 * auto-corrects: "Groceries" and "Grocery" are one edit apart but could
 * genuinely be different categories, and silently reassigning a product's
 * category is not a guess worth making on the user's behalf.
 */
function suggestCategory(input, names) {
  let best = null;
  let bestDistance = Infinity;
  for (const name of names) {
    const distance = editDistance(input, name);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = name;
    }
  }
  return bestDistance <= Math.max(2, Math.floor(input.length / 3)) ? best : null;
}

/**
 * Distinguishes "the file has no such column" from "the column is there but
 * blank". Absent means leave the existing value alone (undefined, which Prisma
 * drops); blank means the user explicitly cleared it (null).
 *
 * Getting this wrong silently destroys data: a file with only name/price/sku,
 * intended as a price update, would otherwise blank every description, brand
 * and barcode it touched.
 */
const optional = (value) => {
  if (value === undefined) return undefined;
  return value === '' ? null : value;
};

const bool = (value) => {
  // Absent leaves isActive as-is. Defaulting to true here would quietly
  // reactivate deactivated products on any unrelated update.
  if (value === undefined) return undefined;
  if (value === '') return undefined;
  return !['false', '0', 'no', 'n'].includes(String(value).toLowerCase());
};

/**
 * Validate and resolve every row against current data, reporting what would
 * happen. Writes nothing.
 */
async function planProductImport(csvText, { createMissingCategories = false } = {}) {
  const records = toRecords(csvText);

  const [categories, existingProducts] = await Promise.all([
    prisma.category.findMany({ select: { id: true, name: true } }),
    prisma.product.findMany({ select: { id: true, sku: true, barcode: true, name: true } }),
  ]);

  const categoryByName = new Map(categories.map((c) => [c.name.toLowerCase(), c]));
  const productBySku = new Map(
    existingProducts.filter((p) => p.sku).map((p) => [p.sku.toLowerCase(), p])
  );
  const barcodeOwner = new Map(
    existingProducts.filter((p) => p.barcode).map((p) => [p.barcode.toLowerCase(), p])
  );

  const seenSkus = new Map();
  const seenBarcodes = new Map();
  const rows = [];

  for (const record of records) {
    const errors = [];
    const sku = record.sku || '';
    const barcode = record.barcode || '';

    if (!record.name) errors.push('name is required');

    const price = num(record.price);
    if (price === null) errors.push('price is required');
    else if (Number.isNaN(price)) errors.push(`price "${record.price}" is not a number`);
    else if (price < 0) errors.push('price cannot be negative');

    const cost = num(record.cost);
    if (Number.isNaN(cost)) errors.push(`cost "${record.cost}" is not a number`);

    const tax = parseTaxRate(record.taxrate);
    if (tax.error) errors.push(tax.error);

    // Categories are matched by name, case-insensitively. An unknown one is
    // reported with the valid options and a suggestion, rather than a bare
    // "unknown category" that leaves the user guessing — a plural is the
    // commonest miss ("Groceries" against a "Grocery" category).
    let category = null;
    let missingCategoryName = null;
    if (record.category) {
      category = categoryByName.get(record.category.toLowerCase()) || null;
      if (!category) {
        if (createMissingCategories) {
          missingCategoryName = record.category;
        } else {
          const names = categories.map((c) => c.name);
          const suggestion = suggestCategory(record.category, names);
          errors.push(
            `unknown category "${record.category}"` +
            (suggestion ? ` — did you mean "${suggestion}"?` : '') +
            ` Existing categories: ${names.join(', ') || '(none yet)'}.` +
            ' Tick "Create missing categories" to add it during import.'
          );
        }
      }
    }

    // Duplicates inside the file itself, which the database constraint would
    // otherwise surface as an opaque failure halfway through.
    if (sku) {
      const dupLine = seenSkus.get(sku.toLowerCase());
      if (dupLine) errors.push(`duplicate sku in file (also on line ${dupLine})`);
      else seenSkus.set(sku.toLowerCase(), record.__line);
    }
    if (barcode) {
      const dupLine = seenBarcodes.get(barcode.toLowerCase());
      if (dupLine) errors.push(`duplicate barcode in file (also on line ${dupLine})`);
      else seenBarcodes.set(barcode.toLowerCase(), record.__line);
    }

    const existing = sku ? productBySku.get(sku.toLowerCase()) : null;

    // A barcode already belonging to a *different* product would violate the
    // unique constraint.
    if (barcode) {
      const owner = barcodeOwner.get(barcode.toLowerCase());
      if (owner && (!existing || owner.id !== existing.id)) {
        errors.push(`barcode already used by "${owner.name}"`);
      }
    }

    // Creating a product needs a category; updating one can leave it alone.
    // Only complain when no category was supplied at all — if one was given
    // but unrecognised, that is already reported above and repeating it here
    // just makes one problem look like two.
    if (!existing && !category && !missingCategoryName && !record.category) {
      errors.push('category is required for new products');
    }

    rows.push({
      line: record.__line,
      action: errors.length ? 'error' : existing ? 'update' : 'create',
      errors,
      existingId: existing?.id || null,
      newCategoryName: missingCategoryName,
      data: {
        name: record.name,
        sku: optional(record.sku),
        barcode: optional(record.barcode),
        description: optional(record.description),
        brand: optional(record.brand),
        unit: optional(record.unit),
        price,
        cost: cost ?? undefined,
        taxRate: tax.rate,
        // An explicit vatCategoryCode column wins; otherwise a named taxRate
        // (STANDARD, EXEMPT…) implies it.
        vatCategoryCode: optional(record.vatcategorycode) ?? tax.vatCategoryCode,
        isActive: bool(record.isactive),
        categoryId: category?.id || null,
      },
    });
  }

  return {
    totalRows: rows.length,
    summary: {
      create: rows.filter((r) => r.action === 'create').length,
      update: rows.filter((r) => r.action === 'update').length,
      error: rows.filter((r) => r.action === 'error').length,
    },
    rows,
  };
}

/**
 * Apply a previously computed plan. Refuses outright if any row is invalid:
 * a partially-applied catalogue is harder to reason about than a rejected
 * file, and the user has already seen exactly which rows to fix.
 */
async function applyProductImport(csvText, { createMissingCategories = false } = {}) {
  const plan = await planProductImport(csvText, { createMissingCategories });

  if (plan.summary.error > 0) {
    const err = new Error(
      `${plan.summary.error} row(s) have errors. Nothing was imported — fix them and try again.`
    );
    err.status = 400;
    err.plan = plan;
    throw err;
  }

  const results = await prisma.$transaction(async (tx) => {
    let created = 0;
    let updated = 0;
    let categoriesCreated = 0;

    // Create any opted-in categories first, inside the same transaction, so a
    // later failure rolls them back too rather than leaving orphans behind.
    const newCategoryIds = new Map();
    for (const row of plan.rows) {
      if (!row.newCategoryName) continue;
      const key = row.newCategoryName.toLowerCase();
      if (newCategoryIds.has(key)) continue;
      const category = await tx.category.create({ data: { name: row.newCategoryName } });
      newCategoryIds.set(key, category.id);
      categoriesCreated += 1;
    }

    for (const row of plan.rows) {
      const { categoryId: plannedCategoryId, ...rest } = row.data;
      const categoryId =
        plannedCategoryId ||
        (row.newCategoryName ? newCategoryIds.get(row.newCategoryName.toLowerCase()) : null);
      // undefined keys are dropped by Prisma, so an absent CSV column leaves
      // the existing value alone rather than blanking it.
      const clean = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));

      if (row.action === 'create') {
        await tx.product.create({ data: { ...clean, categoryId } });
        created += 1;
      } else {
        await tx.product.update({
          where: { id: row.existingId },
          data: categoryId ? { ...clean, categoryId } : clean,
        });
        updated += 1;
      }
    }

    return { created, updated, categoriesCreated };
  });

  return { ...results, totalRows: plan.totalRows };
}

/** Export in exactly the shape the importer accepts, so a round-trip works. */
async function exportProductsCsv() {
  const products = await prisma.product.findMany({
    include: { category: { select: { name: true } } },
    orderBy: { name: 'asc' },
  });

  const rows = products.map((p) => [
    p.sku ?? '',
    p.name,
    p.description ?? '',
    p.category?.name ?? '',
    p.price ?? '',
    p.cost ?? '',
    p.barcode ?? '',
    p.brand ?? '',
    p.unit ?? '',
    p.taxRate ?? '',
    p.vatCategoryCode ?? '',
    p.isActive,
  ]);

  return [EXPORT_HEADERS, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
}

module.exports = {
  parseCsv,
  planProductImport,
  applyProductImport,
  exportProductsCsv,
  EXPORT_HEADERS,
};
