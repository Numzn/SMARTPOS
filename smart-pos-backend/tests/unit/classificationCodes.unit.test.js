import { describe, it, expect, vi, afterEach } from 'vitest';

const prisma = require('../../lib/prisma');
const transport = require('../../lib/vsdc-gateway/transport');
const codesSync = require('../../lib/vsdc-gateway/codesSync');
const zraCodesService = require('../../services/zraCodesService');

async function deleteCode(code) {
  await prisma.zraClassificationCode.deleteMany({ where: { code } });
}

describe('REGRESSION: codesSync.syncClassificationCodes extracts itemClsLvl/taxTyCd/mjrTgYn/useYn per spec', () => {
  afterEach(async () => {
    await deleteCode('TEST-CLS-1');
    await deleteCode('TEST-CLS-2');
    vi.restoreAllMocks();
  });

  it('persists taxTyCd, mjrTgYn, useYn as first-class fields, not just inside raw', async () => {
    vi.spyOn(transport, 'authenticatedPost').mockResolvedValue({
      success: true,
      data: {
        resultCd: '000',
        data: {
          itemClsList: [
            { itemClsCd: 'TEST-CLS-1', itemClsNm: 'Test Category', itemClsLvl: 2, taxTyCd: 'B', mjrTgYn: 'Y', useYn: 'Y' },
          ],
        },
      },
    });

    await codesSync.syncClassificationCodes();

    const row = await prisma.zraClassificationCode.findUnique({ where: { code: 'TEST-CLS-1' } });
    expect(row.level).toBe(2);
    expect(row.taxTyCd).toBe('B');
    expect(row.mjrTgYn).toBe('Y');
    expect(row.useYn).toBe('Y');
  });

  it('accepts the older mock shape (lvl instead of itemClsLvl) without losing data', async () => {
    vi.spyOn(transport, 'authenticatedPost').mockResolvedValue({
      success: true,
      data: { resultCd: '000', data: { itemClsList: [{ itemClsCd: 'TEST-CLS-2', itemClsNm: 'Legacy shape', lvl: 1 }] } },
    });

    await codesSync.syncClassificationCodes();

    const row = await prisma.zraClassificationCode.findUnique({ where: { code: 'TEST-CLS-2' } });
    expect(row.level).toBe(1);
  });
});

describe('REGRESSION: zraCodesService.getItemClassifications excludes useYn=N codes', () => {
  afterEach(async () => {
    await deleteCode('TEST-USABLE');
    await deleteCode('TEST-DEPRECATED');
    await deleteCode('TEST-UNKNOWN-USEYN');
  });

  it('excludes a code explicitly marked useYn=N', async () => {
    await prisma.zraClassificationCode.upsert({
      where: { code: 'TEST-USABLE' },
      create: { code: 'TEST-USABLE', name: 'Usable', useYn: 'Y' },
      update: { useYn: 'Y' },
    });
    await prisma.zraClassificationCode.upsert({
      where: { code: 'TEST-DEPRECATED' },
      create: { code: 'TEST-DEPRECATED', name: 'Deprecated', useYn: 'N' },
      update: { useYn: 'N' },
    });

    const result = await zraCodesService.getItemClassifications();

    const codes = result.classifications.map((c) => c.code);
    expect(codes).toContain('TEST-USABLE');
    expect(codes).not.toContain('TEST-DEPRECATED');
  });

  it('does NOT exclude a code with unset useYn (null is treated as usable, not filtered)', async () => {
    await prisma.zraClassificationCode.upsert({
      where: { code: 'TEST-UNKNOWN-USEYN' },
      create: { code: 'TEST-UNKNOWN-USEYN', name: 'No useYn set' },
      update: {},
    });

    const result = await zraCodesService.getItemClassifications();

    const codes = result.classifications.map((c) => c.code);
    expect(codes).toContain('TEST-UNKNOWN-USEYN');
  });
});
