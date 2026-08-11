import { describe, it, expect, afterEach } from 'vitest';

const prisma = require('../../lib/prisma');
const zraCodesService = require('../../services/zraCodesService');

async function seedCode(codeClass, code, name, syncedAt) {
  await prisma.zraCode.upsert({
    where: { codeClass_code: { codeClass, code } },
    create: { codeClass, code, name, syncedAt },
    update: { name, syncedAt },
  });
}

async function deleteCode(codeClass, code) {
  await prisma.zraCode.deleteMany({ where: { codeClass, code } });
}

// ZraCode rows have no per-row deprecation flag (unlike ZraClassificationCode's
// useYn) — nor does the real /code/selectCodes response provide one. The
// practical equivalent implemented in zraCodesService.getCurrentCodesForClass:
// a row not touched by the most recent sync for its class is treated as no
// longer offered by ZRA. These tests exercise that heuristic directly.
describe('REGRESSION: zraCodesService.getCurrentCodesForClass freshness heuristic', () => {
  const CLASS = 'TEST-FRESH-01';

  afterEach(async () => {
    await prisma.zraCode.deleteMany({ where: { codeClass: CLASS } });
  });

  it('includes rows synced within the same recent batch', async () => {
    const now = new Date();
    await seedCode(CLASS, 'A', 'Fresh A', now);
    await seedCode(CLASS, 'B', 'Fresh B', new Date(now.getTime() - 1000));

    const rows = await zraCodesService.getCurrentCodesForClass(CLASS);

    expect(rows.map((r) => r.code).sort()).toEqual(['A', 'B']);
  });

  it('excludes a row not touched by the most recent sync for its class', async () => {
    const now = new Date();
    const staleAt = new Date(now.getTime() - 10 * 60 * 1000); // 10 min earlier — outside tolerance
    await seedCode(CLASS, 'CURRENT', 'Still offered', now);
    await seedCode(CLASS, 'STALE', 'No longer in latest sync', staleAt);

    const rows = await zraCodesService.getCurrentCodesForClass(CLASS);
    const codes = rows.map((r) => r.code);

    expect(codes).toContain('CURRENT');
    expect(codes).not.toContain('STALE');
  });

  it('returns an empty array for a class that has never synced anything', async () => {
    const rows = await zraCodesService.getCurrentCodesForClass('TEST-NEVER-SYNCED-CLASS');
    expect(rows).toEqual([]);
  });
});

// Class numbers confirmed against the VSDC API Spec v1.0.8 text — TAX_TYPES
// '04', PACKAGING_UNITS '17', UNIT_OF_MEASURE '10' — see zraCodesService.js's
// CODE_CLASS_MAP comment. These tests seed under the REAL class numbers
// (with TEST-marked codes, cleaned up after) to exercise the actual mapping
// end-to-end, not a substitute class.
describe('REGRESSION: searchTaxTypes/searchPackagingUnits/searchQuantityUnits read the corrected code classes', () => {
  afterEach(async () => {
    await deleteCode('04', 'TEST-TT-1');
    await deleteCode('17', 'TEST-PU-1');
    await deleteCode('10', 'TEST-QU-1');
  });

  it('searchTaxTypes reads class 04 (Taxation Type), not the old wrong 01', async () => {
    await seedCode('04', 'TEST-TT-1', 'Test Tax Type', new Date());

    const result = await zraCodesService.searchTaxTypes();

    expect(result.success).toBe(true);
    expect(result.codes.some((c) => c.code === 'TEST-TT-1')).toBe(true);
  });

  it('searchPackagingUnits reads class 17 (Packaging Unit), not the old wrong 04', async () => {
    await seedCode('17', 'TEST-PU-1', 'Test Packaging Unit', new Date());

    const result = await zraCodesService.searchPackagingUnits();

    expect(result.success).toBe(true);
    expect(result.codes.some((c) => c.code === 'TEST-PU-1')).toBe(true);
  });

  it('searchQuantityUnits reads class 10 (Unit of measures), not the old wrong 03', async () => {
    await seedCode('10', 'TEST-QU-1', 'Test Quantity Unit', new Date());

    const result = await zraCodesService.searchQuantityUnits();

    expect(result.success).toBe(true);
    expect(result.codes.some((c) => c.code === 'TEST-QU-1')).toBe(true);
  });
});

describe('REGRESSION: zraCodesService.isUsableStandardCode', () => {
  const CLASS = 'TEST-USABLE-STD';

  afterEach(async () => {
    await prisma.zraCode.deleteMany({ where: { codeClass: CLASS } });
  });

  it('returns true for a code present in the most recent sync', async () => {
    await seedCode(CLASS, 'GOOD', 'Usable', new Date());

    await expect(zraCodesService.isUsableStandardCode(CLASS, 'GOOD')).resolves.toBe(true);
  });

  it('returns false for a code stale relative to the most recent sync (implied no longer offered)', async () => {
    const now = new Date();
    await seedCode(CLASS, 'FRESH', 'Still current', now);
    await seedCode(CLASS, 'OLD', 'Implied dropped', new Date(now.getTime() - 10 * 60 * 1000));

    await expect(zraCodesService.isUsableStandardCode(CLASS, 'OLD')).resolves.toBe(false);
  });

  it('returns false for a code that was never synced', async () => {
    await expect(zraCodesService.isUsableStandardCode(CLASS, 'NEVER-SYNCED')).resolves.toBe(false);
  });

  it('returns false for falsy input without querying the database', async () => {
    await expect(zraCodesService.isUsableStandardCode(CLASS, '')).resolves.toBe(false);
    await expect(zraCodesService.isUsableStandardCode(CLASS, null)).resolves.toBe(false);
    await expect(zraCodesService.isUsableStandardCode(CLASS, undefined)).resolves.toBe(false);
  });
});
