import { describe, it, expect, vi, afterEach } from 'vitest';

const prisma = require('../../lib/prisma');
const zraCodesService = require('../../services/zraCodesService');

// Backs ClassificationPicker.jsx's type-ahead (Section 5 UI layer, see
// zra-self-checklist.md item 8*). These codes previously reached this
// service already parsed from the ZRA response — see codesSync.js and
// classificationCodes.unit.test.js for the sync-time coverage. These tests
// only cover the new search/validity surface added on top of that table.
async function seedClassification(code, overrides = {}) {
  await prisma.zraClassificationCode.upsert({
    where: { code },
    create: { code, name: overrides.name || `Name for ${code}`, useYn: 'Y', ...overrides },
    update: { name: overrides.name || `Name for ${code}`, useYn: 'Y', ...overrides },
  });
}

async function cleanup(...codes) {
  await prisma.zraClassificationCode.deleteMany({ where: { code: { in: codes } } });
}

describe('zraCodesService.searchItemClassifications', () => {
  afterEach(async () => {
    await cleanup(
      'SEARCH-CODE-1',
      'SEARCH-CODE-2',
      'SEARCH-DEPRECATED',
      'SEARCH-NULL-USEYN',
      ...Array.from({ length: 55 }, (_, i) => `SEARCH-BULK-${i}`)
    );
    vi.restoreAllMocks();
  });

  it('matches by code substring', async () => {
    await seedClassification('SEARCH-CODE-1', { name: 'Widgets and gadgets' });
    const result = await zraCodesService.searchItemClassifications({ q: 'SEARCH-CODE-1' });
    expect(result.success).toBe(true);
    expect(result.classifications.map((c) => c.code)).toContain('SEARCH-CODE-1');
  });

  it('matches by name substring, case-insensitively', async () => {
    await seedClassification('SEARCH-CODE-2', { name: 'Bags of Cement' });
    const result = await zraCodesService.searchItemClassifications({ q: 'cement' });
    expect(result.classifications.map((c) => c.code)).toContain('SEARCH-CODE-2');
  });

  it('excludes a code explicitly marked useYn=N', async () => {
    await seedClassification('SEARCH-DEPRECATED', { name: 'Old deprecated category', useYn: 'N' });
    const result = await zraCodesService.searchItemClassifications({ q: 'deprecated' });
    expect(result.classifications.map((c) => c.code)).not.toContain('SEARCH-DEPRECATED');
  });

  it('includes a code with unset (null) useYn — null is usable, not filtered', async () => {
    await prisma.zraClassificationCode.upsert({
      where: { code: 'SEARCH-NULL-USEYN' },
      create: { code: 'SEARCH-NULL-USEYN', name: 'No useYn set here' },
      update: { useYn: null },
    });
    const result = await zraCodesService.searchItemClassifications({ q: 'SEARCH-NULL-USEYN' });
    expect(result.classifications.map((c) => c.code)).toContain('SEARCH-NULL-USEYN');
  });

  it('caps the result count at 50 even if a larger limit is requested', async () => {
    for (let i = 0; i < 55; i += 1) {
      await seedClassification(`SEARCH-BULK-${i}`, { name: 'Bulk search cap test' });
    }
    const result = await zraCodesService.searchItemClassifications({ q: 'Bulk search cap test', limit: 500 });
    expect(result.classifications.length).toBeLessThanOrEqual(50);
  });

  it('defaults to a limit of 20 when none is given', async () => {
    for (let i = 0; i < 25; i += 1) {
      await seedClassification(`SEARCH-BULK-${i}`, { name: 'Default limit test' });
    }
    const result = await zraCodesService.searchItemClassifications({ q: 'Default limit test' });
    expect(result.classifications.length).toBeLessThanOrEqual(20);
  });

  it('does not trigger a sync when a search term simply has zero matches', async () => {
    const fetchSpy = vi.spyOn(zraCodesService, 'fetchAllCodes');
    const result = await zraCodesService.searchItemClassifications({ q: 'NO-SUCH-CLASSIFICATION-CODE-ANYWHERE' });
    expect(result.success).toBe(true);
    expect(result.classifications).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('zraCodesService.isUsableClassificationCode', () => {
  afterEach(async () => {
    await cleanup('SEARCH-USABLE-CHECK', 'SEARCH-UNUSABLE-CHECK');
  });

  it('returns true for a synced, usable code', async () => {
    await seedClassification('SEARCH-USABLE-CHECK', { useYn: 'Y' });
    await expect(zraCodesService.isUsableClassificationCode('SEARCH-USABLE-CHECK')).resolves.toBe(true);
  });

  it('returns false for a code marked useYn=N', async () => {
    await seedClassification('SEARCH-UNUSABLE-CHECK', { useYn: 'N' });
    await expect(zraCodesService.isUsableClassificationCode('SEARCH-UNUSABLE-CHECK')).resolves.toBe(false);
  });

  it('returns false for a code that was never synced', async () => {
    await expect(zraCodesService.isUsableClassificationCode('NEVER-SYNCED-CODE-XYZ')).resolves.toBe(false);
  });

  it('returns false for empty/falsy input without querying the database', async () => {
    await expect(zraCodesService.isUsableClassificationCode('')).resolves.toBe(false);
    await expect(zraCodesService.isUsableClassificationCode(null)).resolves.toBe(false);
    await expect(zraCodesService.isUsableClassificationCode(undefined)).resolves.toBe(false);
  });
});
