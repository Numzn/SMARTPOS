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

const REQUIRED_HEADERS = ['name', 'price'];

const EXPORT_HEADERS = [
  'sku', 'name', 'description', 'category', 'price', 'cost',
  'barcode', 'brand', 'unit', 'taxRate', 'vatCategoryCode', 'isActive',
];

/**
 * Minimal RFC4180-ish parser: quoted fields, escaped quotes ("" inside a
 * quoted field), embedded commas and newlines, and CRLF or LF line endings.
 * Small enough to own outright rather than take a dependency for one feature.
 */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  const src = String(text ?? '').replace(/^﻿/, ''); // strip BOM from Excel exports

  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];

    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }

  // Trailing field/row when the file doesn't end in a newline.
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  // Drop blank lines — trailing newlines are near-universal in exported files.
  return rows.filter((r) => r.some((cell) => String(cell).trim() !== ''));
}

function toRecords(text) {
  const rows = parseCsv(text);
  if (rows.length === 0) {
    const err = new Error('The file is empty');
    err.status = 400;
    throw err;
  }

  const headers = rows[0].map((h) => String(h).trim());
  const normalised = headers.map((h) => h.toLowerCase());

  const missing = REQUIRED_HEADERS.filter((h) => !normalised.includes(h));
  if (missing.length) {
    const err = new Error(
      `Missing required column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}. ` +
      `Found: ${headers.join(', ') || '(none)'}`
    );
    err.status = 400;
    throw err;
  }

  return rows.slice(1).map((cells, index) => {
    const record = {};
    normalised.forEach((header, i) => {
      record[header] = cells[i] === undefined ? '' : String(cells[i]).trim();
    });
    // +2: one for the header row, one to make it 1-based like a spreadsheet,
    // so a reported row number matches what the user sees in Excel.
    record.__line = index + 2;
    return record;
  });
}

const num = (value) => {
  if (value === '' || value == null) return null;
  const n = Number(String(value).replace(/,/g, ''));
  return Number.isFinite(n) ? n : NaN;
};

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
async function planProductImport(csvText) {
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

    const taxRate = num(record.taxrate);
    if (Number.isNaN(taxRate)) errors.push(`taxRate "${record.taxrate}" is not a number`);

    // Category must already exist. Creating one from a typo would be worse
    // than refusing the row.
    let category = null;
    if (record.category) {
      category = categoryByName.get(record.category.toLowerCase()) || null;
      if (!category) errors.push(`unknown category "${record.category}"`);
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
    if (!existing && !category) {
      errors.push('category is required for new products');
    }

    rows.push({
      line: record.__line,
      action: errors.length ? 'error' : existing ? 'update' : 'create',
      errors,
      existingId: existing?.id || null,
      data: {
        name: record.name,
        sku: optional(record.sku),
        barcode: optional(record.barcode),
        description: optional(record.description),
        brand: optional(record.brand),
        unit: optional(record.unit),
        price,
        cost: cost ?? undefined,
        taxRate: taxRate ?? undefined,
        vatCategoryCode: optional(record.vatcategorycode),
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
async function applyProductImport(csvText) {
  const plan = await planProductImport(csvText);

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

    for (const row of plan.rows) {
      const { categoryId, ...rest } = row.data;
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

    return { created, updated };
  });

  return { ...results, totalRows: plan.totalRows };
}

function csvCell(value) {
  const s = value == null ? '' : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
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
