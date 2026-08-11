import { describe, it, expect, vi, afterEach } from 'vitest';

const prisma = require('../../lib/prisma');
const zraCodesService = require('../../services/zraCodesService');

// itemManagement.js destructures markRegistrationSuccess/markRegistrationFailed
// from productRegistrationState at require-time, so vi.spyOn inside an it()
// block is too late to intercept those calls — same CJS destructuring gap as
// tests/integration/settingsBackup.integration.test.js. Patch the module's
// exports before itemManagement.js is ever required in this file.
const productRegistrationState = require('../../lib/productRegistrationState');
productRegistrationState.markRegistrationSuccess = vi.fn().mockResolvedValue();
productRegistrationState.markRegistrationFailed = vi.fn().mockResolvedValue();

// TAX_TYPES -> codeClass '04', UNIT_OF_MEASURE -> codeClass '10' per
// zraCodesService.js's CODE_CLASS_MAP — confirmed directly against the VSDC
// API Spec v1.0.8 text (§5.2 sample response for tax type, §6.5 "refer to
// class code 10" for units). Corrected 2026-08-11: this file previously
// used '01'/'03', which matched mock-vsdc-server.js's old (also wrong)
// values rather than the real spec — see zraCodesService.js's CODE_CLASS_MAP
// comment for the full story.
async function seedCode(codeClass, code, name) {
  await prisma.zraCode.upsert({
    where: { codeClass_code: { codeClass, code } },
    create: { codeClass, code, name },
    update: { name },
  });
}

async function deleteCode(codeClass, code) {
  await prisma.zraCode.deleteMany({ where: { codeClass, code } });
}

describe('REGRESSION: zraCodesService resolves item-registration defaults from the synced ZraCode table, not a hardcoded guess', () => {
  afterEach(async () => {
    await deleteCode('TEST-TAX', 'A');
    await deleteCode('TEST-TAX', 'Z');
    await deleteCode('TEST-UNIT', 'EA');
    vi.restoreAllMocks();
  });

  it('resolveDefaultCode returns the DB row matching the preferred code, not a hardcoded default', async () => {
    await seedCode('TEST-TAX', 'A', 'Test VAT Standard');
    await seedCode('TEST-TAX', 'Z', 'Test Other');

    const row = await zraCodesService.resolveDefaultCode('TEST-TAX', 'A');

    expect(row.code).toBe('A');
    expect(row.name).toBe('Test VAT Standard');
  });

  it('resolveDefaultCode falls back to the first available row if the preferred code is absent', async () => {
    await seedCode('TEST-TAX', 'Z', 'Test Other');

    const row = await zraCodesService.resolveDefaultCode('TEST-TAX', 'A');

    expect(row.code).toBe('Z');
  });

  it('REGRESSION: throws a clear error rather than silently substituting a hardcoded value when the class has never synced and sync fails', async () => {
    vi.spyOn(zraCodesService, 'fetchAllCodes').mockResolvedValue({
      success: false,
      error: 'VSDC unreachable (simulated)',
    });

    await expect(zraCodesService.resolveDefaultCode('TEST-EMPTY-CLASS', 'A')).rejects.toThrow(
      /never been synced and sync failed/
    );
  });

  it('getDefaultTaxTypeCode reads the real synced code class (04), not a hardcoded object', async () => {
    await seedCode('04', 'A', 'Standard Rated');

    const code = await zraCodesService.getDefaultTaxTypeCode();

    expect(code).toBe('A');
    // Deliberately not deleted in afterEach — real synced data other tests
    // (and the live app) depend on; upsert above is idempotent with
    // whatever a real sync already wrote.
  });

  it('getDefaultUnitCode reads the real synced code class (10), not a hardcoded object', async () => {
    await seedCode('10', 'EA', 'Each');

    const code = await zraCodesService.getDefaultUnitCode();

    expect(code).toBe('EA');
  });
});

describe('REGRESSION: itemManagement.saveItemToVSDC resolves tax/unit codes from the synced table', () => {
  const itemManagementService = require('../../services/itemManagement.js');

  afterEach(() => {
    vi.restoreAllMocks();
    productRegistrationState.markRegistrationSuccess.mockClear();
    productRegistrationState.markRegistrationFailed.mockClear();
  });

  it('uses zraCodesService defaults when the product has no explicit taxType/zraPackageUnit/zraQuantityUnit', async () => {
    vi.spyOn(zraCodesService, 'getDefaultTaxTypeCode').mockResolvedValue('A');
    vi.spyOn(zraCodesService, 'getDefaultUnitCode').mockResolvedValue('EA');
    const submitSpy = vi
      .spyOn(itemManagementService, 'submitWithRetry')
      .mockResolvedValue({ success: true, data: { resultCd: '000' } });

    await itemManagementService.saveItemToVSDC({
      id: 'test-product-1',
      sku: 'TEST-SKU-1',
      name: 'Test Product',
      price: 100,
      zraItemClassification: '1010101',
      unit: 'EA', // Product.unit default — satisfies validateItemData's pkg/qty unit check even when zraPackageUnit/zraQuantityUnit aren't set, matching real product data
    });

    expect(submitSpy).toHaveBeenCalledWith(
      expect.objectContaining({ taxTyCd: 'A', pkgUnitCd: 'EA', qtyUnitCd: 'EA' })
    );
  });

  it('does NOT call zraCodesService when the product already has explicit taxType/zraPackageUnit/zraQuantityUnit set', async () => {
    const taxSpy = vi.spyOn(zraCodesService, 'getDefaultTaxTypeCode');
    const unitSpy = vi.spyOn(zraCodesService, 'getDefaultUnitCode');
    const submitSpy = vi
      .spyOn(itemManagementService, 'submitWithRetry')
      .mockResolvedValue({ success: true, data: { resultCd: '000' } });

    await itemManagementService.saveItemToVSDC({
      id: 'test-product-2',
      sku: 'TEST-SKU-2',
      name: 'Test Product 2',
      price: 100,
      zraItemClassification: '1010101',
      taxType: 'B',
      zraPackageUnit: 'KG',
      zraQuantityUnit: 'KG',
    });

    expect(taxSpy).not.toHaveBeenCalled();
    expect(unitSpy).not.toHaveBeenCalled();
    expect(submitSpy).toHaveBeenCalledWith(
      expect.objectContaining({ taxTyCd: 'B', pkgUnitCd: 'KG', qtyUnitCd: 'KG' })
    );
  });

  it('REGRESSION: propagates a clear failure instead of falling back to a hardcoded tax/unit code when codes were never synced', async () => {
    vi.spyOn(zraCodesService, 'getDefaultTaxTypeCode').mockRejectedValue(
      new Error('ZRA TAX_TYPES codes have never been synced and sync failed')
    );

    const result = await itemManagementService.saveItemToVSDC({
      id: 'test-product-3',
      sku: 'TEST-SKU-3',
      name: 'Test Product 3',
      price: 100,
      zraItemClassification: '1010101',
      unit: 'EA', // Product.unit default — satisfies validateItemData's pkg/qty unit check even when zraPackageUnit/zraQuantityUnit aren't set, matching real product data
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/never been synced/);
    expect(productRegistrationState.markRegistrationFailed).toHaveBeenCalled();
  });
});
