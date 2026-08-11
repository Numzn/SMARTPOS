import { describe, it, expect, vi, afterEach } from 'vitest';

const prisma = require('../../lib/prisma');
const transport = require('../../lib/vsdc-gateway/transport');
const codesSync = require('../../lib/vsdc-gateway/codesSync');

async function deleteCode(codeClass, code) {
  await prisma.zraCode.deleteMany({ where: { codeClass, code } });
}

// codesSync.syncStandardCodes() previously parsed a flat "cdList" that does
// not exist anywhere in the VSDC API Spec v1.0.8 — the real /code/selectCodes
// response nests codes by class: data.clsList[].{cdCls, cdClsNm, dtlList[]}
// (confirmed against the spec's own §5.2 sample JSON). Against a real ZRA
// sandbox the old parser would have silently imported zero codes. These
// tests lock in the corrected parsing.
describe('REGRESSION: codesSync.syncStandardCodes parses the real clsList/dtlList response shape', () => {
  afterEach(async () => {
    await deleteCode('TEST-SC-04', 'A');
    await deleteCode('TEST-SC-10', 'EA');
    await deleteCode('TEST-SC-17', 'BX');
    await deleteCode('TEST-SC-FLAT', 'X');
    vi.restoreAllMocks();
  });

  it('extracts codes from data.clsList[].dtlList[], tagging each with its group cdCls', async () => {
    vi.spyOn(transport, 'authenticatedPost').mockResolvedValue({
      success: true,
      data: {
        resultCd: '000',
        data: {
          clsList: [
            { cdCls: 'TEST-SC-04', cdClsNm: 'Taxation Type', dtlList: [{ cd: 'A', cdNm: 'Standard Rated' }] },
            { cdCls: 'TEST-SC-10', cdClsNm: 'Unit of measures', dtlList: [{ cd: 'EA', cdNm: 'Each' }] },
            { cdCls: 'TEST-SC-17', cdClsNm: 'Packaging Unit', dtlList: [{ cd: 'BX', cdNm: 'Box' }] },
          ],
        },
      },
    });

    const result = await codesSync.syncStandardCodes();

    expect(result.count).toBe(3);
    const tax = await prisma.zraCode.findUnique({ where: { codeClass_code: { codeClass: 'TEST-SC-04', code: 'A' } } });
    const unit = await prisma.zraCode.findUnique({ where: { codeClass_code: { codeClass: 'TEST-SC-10', code: 'EA' } } });
    const pkg = await prisma.zraCode.findUnique({ where: { codeClass_code: { codeClass: 'TEST-SC-17', code: 'BX' } } });
    expect(tax.name).toBe('Standard Rated');
    expect(unit.name).toBe('Each');
    expect(pkg.name).toBe('Box');
  });

  it('does not fabricate a tax rate when the response has none (real spec dtlList carries no taxRt)', async () => {
    vi.spyOn(transport, 'authenticatedPost').mockResolvedValue({
      success: true,
      data: {
        resultCd: '000',
        data: { clsList: [{ cdCls: 'TEST-SC-04', dtlList: [{ cd: 'A', cdNm: 'Standard Rated' }] }] },
      },
    });

    await codesSync.syncStandardCodes();

    const tax = await prisma.zraCode.findUnique({ where: { codeClass_code: { codeClass: 'TEST-SC-04', code: 'A' } } });
    expect(tax.rate).toBeNull();
  });

  it('falls back to a flat cdList shape defensively, if a caller ever sends one', async () => {
    vi.spyOn(transport, 'authenticatedPost').mockResolvedValue({
      success: true,
      data: { resultCd: '000', data: { cdList: [{ cdCls: 'TEST-SC-FLAT', cd: 'X', cdNm: 'Flat shape row' }] } },
    });

    const result = await codesSync.syncStandardCodes();

    expect(result.count).toBe(1);
    const row = await prisma.zraCode.findUnique({ where: { codeClass_code: { codeClass: 'TEST-SC-FLAT', code: 'X' } } });
    expect(row.name).toBe('Flat shape row');
  });

  it('imports zero codes (not a crash) when the response has neither shape', async () => {
    vi.spyOn(transport, 'authenticatedPost').mockResolvedValue({
      success: true,
      data: { resultCd: '000', data: {} },
    });

    const result = await codesSync.syncStandardCodes();

    expect(result.count).toBe(0);
  });
});
