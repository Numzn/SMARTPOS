import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import testData from '../helpers/testData.js';
import productImport from '../../lib/productImport.js';

const { prisma, createTestBranch, createTestCategory, createTestProduct, cleanupTestData } = testData;
const { parseCsv, planProductImport, applyProductImport, exportProductsCsv } = productImport;
const itemManagementService = require('../../services/itemManagement.js');

const csv = (...lines) => lines.join('\n');

const IMPORT_CLASS_CODE = 'PIMP-BASE-CLASS';

describe('product CSV import', () => {
  let category;

  beforeAll(async () => {
    await createTestBranch();
    await prisma.zraClassificationCode.upsert({
      where: { code: IMPORT_CLASS_CODE },
      create: { code: IMPORT_CLASS_CODE, name: 'Base classification for import tests', useYn: 'Y' },
      update: { useYn: 'Y' },
    });
  });

  afterEach(async () => {
    await prisma.zraCode.deleteMany({ where: { code: { startsWith: 'PIMP-' } } });
    await cleanupTestData();
    vi.restoreAllMocks();
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

  /* ---------------- ZRA registration columns ---------------- */

  function mockVsdcSuccess() {
    vi.spyOn(itemManagementService, 'saveItemToVSDC').mockResolvedValue({
      success: true,
      itemCode: 'ignored-in-mock',
      zraResponse: { resultCd: '000' },
    });
  }

  async function seedCurrentCode(codeClass, code) {
    await prisma.zraCode.upsert({
      where: { codeClass_code: { codeClass, code } },
      create: { codeClass, code, name: `Usable ${code}`, syncedAt: new Date() },
      update: { syncedAt: new Date() },
    });
  }

  it('plans a valid classification/tax/unit code combination cleanly', async () => {
    const cat = await withCategory();
    await seedCurrentCode('04', 'PIMP-TAX-1');
    await seedCurrentCode('17', 'PIMP-PKG-1');
    await seedCurrentCode('10', 'PIMP-QTY-1');

    const plan = await planProductImport(
      csv(
        'name,price,category,sku,zraClassificationCode,taxType,zraPackageUnit,zraQuantityUnit',
        `TEST-Coded,10,${cat.name},TEST-SKU-IMP-CODE-1,${IMPORT_CLASS_CODE},PIMP-TAX-1,PIMP-PKG-1,PIMP-QTY-1`
      )
    );

    expect(plan.summary.error).toBe(0);
    expect(plan.rows[0].data.zraClassificationCode).toBe(IMPORT_CLASS_CODE);
    expect(plan.rows[0].data.zraItemClassification).toBe(IMPORT_CLASS_CODE);
    expect(plan.rows[0].data.taxType).toBe('PIMP-TAX-1');
  });

  it.each([
    ['zraClassificationCode', 'PIMP-MADE-UP-CLASS', 'classification code'],
    ['taxType', 'PIMP-MADE-UP-TAX', 'tax type'],
    ['zraPackageUnit', 'PIMP-MADE-UP-PKG', 'package unit'],
    ['zraQuantityUnit', 'PIMP-MADE-UP-QTY', 'quantity unit'],
  ])('rejects an unrecognised %s as a row error, same as an unknown category', async (column, badValue, label) => {
    const cat = await withCategory();
    const plan = await planProductImport(
      csv(`name,price,category,sku,${column}`, `TEST-Bad,10,${cat.name},TEST-SKU-IMP-BAD-${column},${badValue}`)
    );

    expect(plan.summary.error).toBe(1);
    expect(plan.rows[0].errors.join(' ')).toMatch(new RegExp(`not a valid.*${label}`, 'i'));
  });

  it('a disabled (useYn=N) classification code is rejected the same as an unknown one', async () => {
    const cat = await withCategory();
    const disabledCode = 'PIMP-DISABLED-CLASS';
    await prisma.zraClassificationCode.upsert({
      where: { code: disabledCode },
      create: { code: disabledCode, name: 'Disabled', useYn: 'N' },
      update: { useYn: 'N' },
    });

    const plan = await planProductImport(
      csv('name,price,category,sku,zraClassificationCode', `TEST-Bad,10,${cat.name},TEST-SKU-IMP-DISABLED,${disabledCode}`)
    );

    expect(plan.summary.error).toBe(1);
    expect(plan.rows[0].errors.join(' ')).toMatch(/not a valid.*classification code/i);
    await prisma.zraClassificationCode.delete({ where: { code: disabledCode } }).catch(() => {});
  });

  it('validates many rows referencing the same classification code cleanly (batched lookup, not one query per row)', async () => {
    // Not asserting a call count here — spying directly on a Prisma model
    // delegate method corrupts the shared client singleton across the rest
    // of this file's tests (confirmed: it did, when tried). The batching
    // design itself (one findMany keyed on the distinct codes referenced in
    // the file, not per row) is verified by code review in
    // lib/productImport.js's loadZraCodeValidity; this test just confirms
    // the functional outcome — a 10-row file all referencing the same
    // already-synced code plans cleanly.
    const cat = await withCategory();
    const lines = Array.from(
      { length: 10 },
      (_, i) => `TEST-Row${i},10,${cat.name},TEST-SKU-IMP-BATCH-${i},${IMPORT_CLASS_CODE}`
    );
    const plan = await planProductImport(
      csv('name,price,category,sku,zraClassificationCode', ...lines)
    );

    expect(plan.summary.error).toBe(0);
    expect(plan.rows.every((r) => r.data.zraClassificationCode === IMPORT_CLASS_CODE)).toBe(true);
  });

  it('an absent classification-code column leaves an existing code untouched on update', async () => {
    const cat = await withCategory();
    const existing = await createTestProduct({
      categoryId: cat.id,
      zraClassificationCode: IMPORT_CLASS_CODE,
      zraItemClassification: IMPORT_CLASS_CODE,
    });
    mockVsdcSuccess(); // the row still has a code, so best-effort registration fires for real

    // No zraClassificationCode column at all — a plain price update.
    await applyProductImport(csv('name,price,sku', `Kept,33,${existing.sku}`));

    const updated = await prisma.product.findUnique({ where: { id: existing.id } });
    expect(updated.zraClassificationCode).toBe(IMPORT_CLASS_CODE);
    expect(updated.zraItemClassification).toBe(IMPORT_CLASS_CODE);
  });

  it('a present-but-blank classification-code column explicitly clears both classification fields', async () => {
    const cat = await withCategory();
    const existing = await createTestProduct({
      categoryId: cat.id,
      zraClassificationCode: IMPORT_CLASS_CODE,
      zraItemClassification: IMPORT_CLASS_CODE,
    });

    await applyProductImport(csv('name,price,sku,zraClassificationCode', `Cleared,33,${existing.sku},`));

    const updated = await prisma.product.findUnique({ where: { id: existing.id } });
    expect(updated.zraClassificationCode).toBeNull();
    expect(updated.zraItemClassification).toBeNull();
  });

  it('best-effort registration: a row with a code gets registered, and its DB write is unaffected by another row failing', async () => {
    const cat = await withCategory();
    vi.spyOn(itemManagementService, 'saveItemToVSDC')
      .mockResolvedValueOnce({ success: false, error: 'VSDC rejected this item' })
      .mockResolvedValueOnce({ success: true, itemCode: 'ok', zraResponse: { resultCd: '000' } });

    const result = await applyProductImport(
      csv(
        'name,price,category,sku,zraClassificationCode',
        `TEST-First,10,${cat.name},TEST-SKU-IMP-REG-1,${IMPORT_CLASS_CODE}`,
        `TEST-Second,10,${cat.name},TEST-SKU-IMP-REG-2,${IMPORT_CLASS_CODE}`
      )
    );

    // Both rows are written regardless of registration outcome — a failed
    // registration must never roll back the DB write or abort the batch.
    expect(result.created).toBe(2);
    expect(result.registration).toMatchObject({ attempted: 2, registered: 1, failed: 1, skippedNoCode: 0 });

    // The failure path is handled directly by registerProductWithVsdc
    // (markRegistrationFailed), so it's DB-verifiable here. The success path
    // writes REGISTERED via a call inside the real saveItemToVSDC — which
    // this test replaces entirely with a mock, so that DB write doesn't
    // happen; the `result.registration` summary above (sourced from
    // registerProductWithVsdc's own return value, independent of the DB
    // write) is the correct place to assert the success outcome.
    const first = await prisma.product.findFirst({ where: { sku: 'TEST-SKU-IMP-REG-1' } });
    const second = await prisma.product.findFirst({ where: { sku: 'TEST-SKU-IMP-REG-2' } });
    expect(first).not.toBeNull();
    expect(first.zraRegistrationStatus).toBe('FAILED');
    expect(first.zraRegistrationError).toMatch(/VSDC rejected/);
    expect(second).not.toBeNull();
    expect(result.registration.results.find((r) => r.sku === 'TEST-SKU-IMP-REG-2').status).toBe('REGISTERED');
  });

  it('rows with no classification code are skipped, not attempted, and never call VSDC', async () => {
    const cat = await withCategory();
    const spy = vi.spyOn(itemManagementService, 'saveItemToVSDC');

    const result = await applyProductImport(
      csv('name,price,category,sku', `TEST-NoCode,10,${cat.name},TEST-SKU-IMP-NOCODE-1`)
    );

    expect(result.registration).toMatchObject({ attempted: 0, registered: 0, failed: 0, skippedNoCode: 1 });
    expect(spy).not.toHaveBeenCalled();

    const product = await prisma.product.findFirst({ where: { sku: 'TEST-SKU-IMP-NOCODE-1' } });
    expect(product.zraRegistrationStatus).toBe('PENDING');
  });

  it('REGRESSION: import registration ignores ZRA_REGISTRATION_STRICT — a VSDC failure never rolls back or throws', async () => {
    const cat = await withCategory();
    const original = process.env.ZRA_REGISTRATION_STRICT;
    process.env.ZRA_REGISTRATION_STRICT = 'true';
    vi.spyOn(itemManagementService, 'saveItemToVSDC').mockResolvedValue({
      success: false,
      error: 'simulated VSDC outage',
    });

    try {
      const result = await applyProductImport(
        csv('name,price,category,sku,zraClassificationCode', `TEST-Strict,10,${cat.name},TEST-SKU-IMP-STRICT-1,${IMPORT_CLASS_CODE}`)
      );

      expect(result.created).toBe(1);
      expect(result.registration).toMatchObject({ registered: 0, failed: 1 });
      const product = await prisma.product.findFirst({ where: { sku: 'TEST-SKU-IMP-STRICT-1' } });
      expect(product).not.toBeNull();
      expect(product.zraRegistrationStatus).toBe('FAILED');
    } finally {
      if (original === undefined) delete process.env.ZRA_REGISTRATION_STRICT;
      else process.env.ZRA_REGISTRATION_STRICT = original;
    }
  });

  it('exportProductsCsv includes the new ZRA columns and round-trips a coded product', async () => {
    const cat = await withCategory();
    await createTestProduct({
      categoryId: cat.id,
      zraClassificationCode: IMPORT_CLASS_CODE,
      zraItemClassification: IMPORT_CLASS_CODE,
    });

    const out = await exportProductsCsv();
    const header = out.split('\r\n')[0].split(',');
    expect(header).toEqual(
      expect.arrayContaining(['zraClassificationCode', 'taxType', 'zraPackageUnit', 'zraQuantityUnit'])
    );
    expect(out).toContain(IMPORT_CLASS_CODE);

    const plan = await planProductImport(out);
    expect(plan.summary.error).toBe(0);
  });
});
