import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import testData from '../helpers/testData.js';
import productImport from '../../lib/productImport.js';

const { prisma, createTestBranch, createTestCategory, createTestProduct, cleanupTestData } = testData;
const { parseCsv, planProductImport, applyProductImport, exportProductsCsv } = productImport;

const csv = (...lines) => lines.join('\n');

describe('product CSV import', () => {
  let category;

  beforeAll(async () => {
    await createTestBranch();
  });

  afterEach(async () => {
    await cleanupTestData();
  });

  async function withCategory() {
    category = await createTestCategory();
    return category;
  }

  /* ---------------- parser ---------------- */

  it('parses quoted fields, embedded commas, escaped quotes and CRLF', () => {
    const rows = parseCsv('a,b,c\r\n"x,1","say ""hi""",z\r\n');
    expect(rows).toEqual([
      ['a', 'b', 'c'],
      ['x,1', 'say "hi"', 'z'],
    ]);
  });

  it('ignores a UTF-8 BOM, which Excel exports routinely include', () => {
    const rows = parseCsv('﻿name,price\nWidget,10');
    expect(rows[0]).toEqual(['name', 'price']);
  });

  /* ---------------- planning ---------------- */

  it('plans creates without writing anything', async () => {
    const cat = await withCategory();
    const before = await prisma.product.count();

    const plan = await planProductImport(
      csv('name,price,category,sku', `TEST-Widget,25.50,${cat.name},TEST-SKU-IMP-1`)
    );

    expect(plan.summary).toMatchObject({ create: 1, update: 0, error: 0 });
    expect(plan.rows[0].action).toBe('create');
    // The whole point of the dry run.
    expect(await prisma.product.count()).toBe(before);
  });

  it('classifies a row as an update when the SKU already exists', async () => {
    const cat = await withCategory();
    const existing = await createTestProduct({ categoryId: cat.id });

    const plan = await planProductImport(
      csv('name,price,sku', `Renamed,99,${existing.sku}`)
    );

    expect(plan.summary).toMatchObject({ create: 0, update: 1, error: 0 });
    expect(plan.rows[0].existingId).toBe(existing.id);
  });

  it('reports an unknown category rather than inventing one', async () => {
    const plan = await planProductImport(
      csv('name,price,category', 'TEST-Thing,10,No Such Category')
    );

    expect(plan.summary.error).toBe(1);
    expect(plan.rows[0].errors.join(' ')).toMatch(/unknown category/i);
    expect(await prisma.category.findFirst({ where: { name: 'No Such Category' } })).toBeNull();
  });

  it('catches duplicate SKUs inside the file, naming the conflicting line', async () => {
    const cat = await withCategory();
    const plan = await planProductImport(
      csv(
        'name,price,category,sku',
        `TEST-A,1,${cat.name},TEST-SKU-DUP`,
        `TEST-B,2,${cat.name},TEST-SKU-DUP`
      )
    );

    expect(plan.summary.error).toBe(1);
    expect(plan.rows[1].errors.join(' ')).toMatch(/duplicate sku in file \(also on line 2\)/i);
  });

  it('rejects non-numeric prices and missing names with the spreadsheet line number', async () => {
    const cat = await withCategory();
    const plan = await planProductImport(
      csv('name,price,category', `TEST-Bad,abc,${cat.name}`, `,10,${cat.name}`)
    );

    expect(plan.summary.error).toBe(2);
    expect(plan.rows[0].line).toBe(2); // header is line 1
    expect(plan.rows[0].errors.join(' ')).toMatch(/not a number/);
    expect(plan.rows[1].errors.join(' ')).toMatch(/name is required/);
  });

  it('requires a category for new products but not for updates', async () => {
    const cat = await withCategory();
    const existing = await createTestProduct({ categoryId: cat.id });

    const plan = await planProductImport(
      csv('name,price,sku', 'TEST-New,5,TEST-SKU-NOCAT', `Updated,7,${existing.sku}`)
    );

    expect(plan.rows[0].action).toBe('error');
    expect(plan.rows[0].errors.join(' ')).toMatch(/category is required for new products/i);
    expect(plan.rows[1].action).toBe('update');
  });

  it('rejects a header missing a required column', async () => {
    await expect(planProductImport(csv('name,sku', 'TEST-X,ABC'))).rejects.toMatchObject({
      status: 400,
    });
  });

  /* ---------------- tax rate forms ---------------- */

  it('REGRESSION: accepts a VAT category name in taxRate, not just a number', async () => {
    const cat = await withCategory();

    // The reported failure: a hand-built file with STANDARD under taxRate was
    // rejected as "not a number", which is true but useless — STANDARD is a
    // real VAT category in this domain.
    const plan = await planProductImport(
      csv('name,price,category,sku,taxRate', `TEST-Std,10,${cat.name},TEST-SKU-TAX-1,STANDARD`)
    );

    expect(plan.summary.error).toBe(0);
    expect(plan.rows[0].data.taxRate).toBe(16);
    // The name means a category, so it should set one.
    expect(plan.rows[0].data.vatCategoryCode).toBe('STANDARD');
  });

  it('maps zero-rated and exempt to a zero rate', async () => {
    const cat = await withCategory();
    const plan = await planProductImport(
      csv(
        'name,price,category,sku,taxRate',
        `TEST-Zero,10,${cat.name},TEST-SKU-TAX-2,ZERO_RATED`,
        `TEST-Exempt,10,${cat.name},TEST-SKU-TAX-3,EXEMPT`
      )
    );

    expect(plan.summary.error).toBe(0);
    expect(plan.rows[0].data.taxRate).toBe(0);
    expect(plan.rows[0].data.vatCategoryCode).toBe('ZERO_RATED');
    expect(plan.rows[1].data.vatCategoryCode).toBe('EXEMPT');
  });

  it('tolerates a percent sign, which spreadsheets add constantly', async () => {
    const cat = await withCategory();
    const plan = await planProductImport(
      csv('name,price,category,sku,taxRate', `TEST-Pct,10,${cat.name},TEST-SKU-TAX-4,16%`)
    );
    expect(plan.summary.error).toBe(0);
    expect(plan.rows[0].data.taxRate).toBe(16);
  });

  it('still rejects genuine nonsense in taxRate, and says what is accepted', async () => {
    const cat = await withCategory();
    const plan = await planProductImport(
      csv('name,price,category,sku,taxRate', `TEST-Junk,10,${cat.name},TEST-SKU-TAX-5,banana`)
    );
    expect(plan.summary.error).toBe(1);
    expect(plan.rows[0].errors.join(' ')).toMatch(/STANDARD/);
  });

  /* ---------------- category guidance ---------------- */

  it('suggests the near-miss category and lists the valid ones', async () => {
    const cat = await withCategory(); // "Test Category <suffix>"
    const plan = await planProductImport(
      csv('name,price,category', `TEST-Near,10,${cat.name.slice(0, -1)}`)
    );

    const message = plan.rows[0].errors.join(' ');
    expect(message).toMatch(/did you mean/i);
    expect(message).toContain(cat.name);
  });

  it('reports an unknown category once, not as two stacked problems', async () => {
    const plan = await planProductImport(
      csv('name,price,category', 'TEST-One,10,Nonexistent Category Name')
    );
    // Previously this also emitted "category is required for new products",
    // making a single mistake look like two.
    expect(plan.rows[0].errors.length).toBe(1);
    expect(plan.rows[0].errors[0]).toMatch(/unknown category/i);
  });

  it('creates missing categories only when explicitly opted in', async () => {
    const source = csv('name,price,category,sku', 'TEST-New Cat,10,TEST-Brand New Cat,TEST-SKU-CAT-1');

    const refused = await planProductImport(source);
    expect(refused.summary.error).toBe(1);

    const allowed = await planProductImport(source, { createMissingCategories: true });
    expect(allowed.summary.error).toBe(0);

    const result = await applyProductImport(source, { createMissingCategories: true });
    expect(result.categoriesCreated).toBe(1);
    const made = await prisma.category.findFirst({ where: { name: 'TEST-Brand New Cat' } });
    expect(made).not.toBeNull();
    await prisma.product.deleteMany({ where: { sku: 'TEST-SKU-CAT-1' } });
    await prisma.category.delete({ where: { id: made.id } });
  });

  /* ---------------- applying ---------------- */

  it('applies a valid file, creating and updating in one go', async () => {
    const cat = await withCategory();
    const existing = await createTestProduct({ categoryId: cat.id });

    const result = await applyProductImport(
      csv(
        'name,price,category,sku',
        `TEST-Imported,12.5,${cat.name},TEST-SKU-APPLY-1`,
        `TEST-Updated,44,${cat.name},${existing.sku}`
      )
    );

    expect(result).toMatchObject({ created: 1, updated: 1, totalRows: 2 });

    const created = await prisma.product.findFirst({ where: { sku: 'TEST-SKU-APPLY-1' } });
    expect(created.price).toBe(12.5);
    const updated = await prisma.product.findUnique({ where: { id: existing.id } });
    expect(updated.price).toBe(44);
    expect(updated.name).toBe('TEST-Updated');
  });

  it('REGRESSION: writes nothing at all when any row is invalid', async () => {
    const cat = await withCategory();
    const before = await prisma.product.count();

    // First row is perfectly valid; the second is not.
    await expect(
      applyProductImport(
        csv(
          'name,price,category,sku',
          `TEST-Good,10,${cat.name},TEST-SKU-ATOMIC-1`,
          `TEST-Bad,notanumber,${cat.name},TEST-SKU-ATOMIC-2`
        )
      )
    ).rejects.toMatchObject({ status: 400 });

    // The valid row must not have slipped through — a half-applied catalogue
    // is worse than a rejected file.
    expect(await prisma.product.count()).toBe(before);
    expect(await prisma.product.findFirst({ where: { sku: 'TEST-SKU-ATOMIC-1' } })).toBeNull();
  });

  it('REGRESSION: leaves omitted columns untouched on update rather than blanking them', async () => {
    const cat = await withCategory();
    const existing = await createTestProduct({
      categoryId: cat.id,
      brand: 'TEST-Brand',
      description: 'TEST-Description',
      isActive: false,
    });

    // A price-only update: the file mentions nothing else.
    await applyProductImport(csv('name,price,sku', `Kept,20,${existing.sku}`));

    const updated = await prisma.product.findUnique({ where: { id: existing.id } });
    expect(updated.price).toBe(20);
    // Absent columns must not be treated as "set this to empty".
    expect(updated.brand).toBe('TEST-Brand');
    expect(updated.description).toBe('TEST-Description');
    // And an absent isActive must not silently reactivate the product.
    expect(updated.isActive).toBe(false);
  });

  it('treats a present-but-blank column as an explicit clear', async () => {
    const cat = await withCategory();
    const existing = await createTestProduct({ categoryId: cat.id, brand: 'TEST-Brand' });

    // brand is in the header this time, deliberately empty.
    await applyProductImport(csv('name,price,sku,brand', `Cleared,20,${existing.sku},`));

    const updated = await prisma.product.findUnique({ where: { id: existing.id } });
    expect(updated.brand).toBeNull();
  });

  /* ---------------- export ---------------- */

  it('exports a header the importer accepts, so a round-trip works', async () => {
    const cat = await withCategory();
    await createTestProduct({ categoryId: cat.id });

    const out = await exportProductsCsv();
    const header = out.split('\r\n')[0];

    expect(header.split(',')).toEqual(
      expect.arrayContaining(['sku', 'name', 'category', 'price'])
    );
    // Feeding the export straight back must not produce errors.
    const plan = await planProductImport(out);
    expect(plan.summary.error).toBe(0);
  });
});
