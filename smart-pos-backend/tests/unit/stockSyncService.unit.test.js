import { describe, it, expect, vi, afterEach } from 'vitest';

const prisma = require('../../lib/prisma');
const vsdcService = require('../../services/vsdcService');
const stockSyncService = require('../../services/stockSyncService');
const testData = require('../helpers/testData.js');

const { createTestCategory, createTestProduct, createTestUser, cleanupTestData } = testData;

async function createMovement({ productId, userId, movementType, quantity, previousStock, newStock, referenceId }) {
  return prisma.stockMovement.create({
    data: {
      productId,
      userId,
      movementType,
      quantity,
      previousStock,
      newStock,
      unitCost: 10,
      totalCost: Math.abs(quantity) * 10,
      referenceType: 'TEST',
      referenceId: referenceId || null,
    },
  });
}

// Section 6.14 (items 27*/29*): the sarTyCd map and the stock-item/stock-
// master payload shapes were both wrong (confirmed against the spec text,
// vsdc-extracted.txt) — corrected 2026-08-12. These tests lock in the fix.
describe('stockSyncService — corrected sarTyCd mapping and VSDC call shape', () => {
  afterEach(async () => {
    await prisma.stockMovement.deleteMany({ where: { referenceType: 'TEST' } });
    await cleanupTestData();
    vi.restoreAllMocks();
    vsdcService.isInitialized = false;
  });

  it('REGRESSION: SALE_OUT maps to sarTyCd 11 (Sale-outgoing), not the old wrong 02 (Purchase-incoming)', async () => {
    const category = await createTestCategory();
    const product = await createTestProduct({ categoryId: category.id, taxType: 'A', zraPackageUnit: 'BX', zraQuantityUnit: 'EA' });
    const user = await createTestUser();
    const movement = await createMovement({
      productId: product.id,
      userId: user.id,
      movementType: 'SALE_OUT',
      quantity: -3,
      previousStock: 10,
      newStock: 7,
    });

    const payload = await stockSyncService.toVsdcPayload({ ...movement, product });

    expect(payload.sarTyCd).toBe('11');
  });

  it('REGRESSION: PURCHASE_IN maps to sarTyCd 02 (Purchase-incoming), not the old wrong 01 (Import-incoming)', async () => {
    const category = await createTestCategory();
    const product = await createTestProduct({ categoryId: category.id, taxType: 'A', zraPackageUnit: 'BX', zraQuantityUnit: 'EA' });
    const user = await createTestUser();
    const movement = await createMovement({
      productId: product.id,
      userId: user.id,
      movementType: 'PURCHASE_IN',
      quantity: 5,
      previousStock: 2,
      newStock: 7,
    });

    const payload = await stockSyncService.toVsdcPayload({ ...movement, product });

    expect(payload.sarTyCd).toBe('02');
  });

  it.each([
    ['ADJUSTMENT_IN', '06'],
    ['ADJUSTMENT_OUT', '16'],
    ['TRANSFER_IN', '04'],
    ['TRANSFER_OUT', '13'],
    ['RETURN_IN', '03'],
    ['RETURN_OUT', '12'],
    ['PRODUCTION_IN', '05'],
    ['PRODUCTION_OUT', '14'],
  ])('REGRESSION: %s maps to the real spec sarTyCd %s', async (movementType, expectedCode) => {
    const category = await createTestCategory();
    const product = await createTestProduct({ categoryId: category.id, taxType: 'A', zraPackageUnit: 'BX', zraQuantityUnit: 'EA' });
    const user = await createTestUser();
    const isOut = movementType.endsWith('_OUT');
    const movement = await createMovement({
      productId: product.id,
      userId: user.id,
      movementType,
      quantity: isOut ? -2 : 2,
      previousStock: 10,
      newStock: isOut ? 8 : 12,
    });

    const payload = await stockSyncService.toVsdcPayload({ ...movement, product });

    expect(payload.sarTyCd).toBe(expectedCode);
  });

  it('RECOUNT has no dedicated spec code — resolves by direction to the nearest Adjustment code', async () => {
    const category = await createTestCategory();
    const product = await createTestProduct({ categoryId: category.id, taxType: 'A', zraPackageUnit: 'BX', zraQuantityUnit: 'EA' });
    const user = await createTestUser();

    const increase = await createMovement({
      productId: product.id, userId: user.id, movementType: 'RECOUNT', quantity: 4, previousStock: 10, newStock: 14,
    });
    const decrease = await createMovement({
      productId: product.id, userId: user.id, movementType: 'RECOUNT', quantity: -4, previousStock: 10, newStock: 6,
    });

    expect((await stockSyncService.toVsdcPayload({ ...increase, product })).sarTyCd).toBe('06');
    expect((await stockSyncService.toVsdcPayload({ ...decrease, product })).sarTyCd).toBe('16');
  });

  it('uses the product\'s own taxType/zraPackageUnit/zraQuantityUnit when set, not a synced default', async () => {
    const category = await createTestCategory();
    const product = await createTestProduct({
      categoryId: category.id,
      taxType: 'B',
      zraPackageUnit: 'BA',
      zraQuantityUnit: 'KG',
    });
    const user = await createTestUser();
    const movement = await createMovement({
      productId: product.id, userId: user.id, movementType: 'SALE_OUT', quantity: -1, previousStock: 5, newStock: 4,
    });

    const payload = await stockSyncService.toVsdcPayload({ ...movement, product });

    expect(payload.vatCatCd).toBe('B');
    expect(payload.pkgUnitCd).toBe('BA');
    expect(payload.qtyUnitCd).toBe('KG');
  });

  it('throws a clear error rather than silently guessing when a product has no explicit codes and none are synced', async () => {
    const category = await createTestCategory();
    const product = await createTestProduct({ categoryId: category.id, taxType: null, zraPackageUnit: null, zraQuantityUnit: null });
    const user = await createTestUser();
    const movement = await createMovement({
      productId: product.id, userId: user.id, movementType: 'SALE_OUT', quantity: -1, previousStock: 5, newStock: 4,
    });
    const zraCodesService = require('../../services/zraCodesService');
    vi.spyOn(zraCodesService, 'fetchAllCodes').mockResolvedValue({ success: false, error: 'simulated sync failure' });

    await expect(stockSyncService.toVsdcPayload({ ...movement, product })).rejects.toThrow(/never been synced/);
  });
});

describe('vsdcService.submitStockIo — real spec payload shape (POST /stock/saveStockItems)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vsdcService.isInitialized = false;
  });

  it('REGRESSION: wraps the item in itemList[] and includes required top-level fields, not a flat itemCd/qty body', async () => {
    vi.spyOn(vsdcService, 'ensureDeviceInitialized').mockResolvedValue({ success: true });
    const requestSpy = vi
      .spyOn(vsdcService, 'makeAuthenticatedRequest')
      .mockResolvedValue({ success: true, data: { resultCd: '000' } });

    await vsdcService.submitStockIo({
      itemCd: 'SKU-1',
      sarTyCd: '11',
      sarNo: 'SAR-1',
      qty: 3,
      pkgUnitCd: 'BX',
      qtyUnitCd: 'EA',
      vatCatCd: 'A',
      prc: 10,
    });

    expect(requestSpy).toHaveBeenCalled();
    const body = requestSpy.mock.calls[0][2];
    expect(Array.isArray(body.itemList)).toBe(true);
    expect(body.itemList).toHaveLength(1);
    expect(body.itemList[0]).toMatchObject({ itemCd: 'SKU-1', qty: 3, pkgUnitCd: 'BX', qtyUnitCd: 'EA', vatCatCd: 'A' });
    expect(body.itemCd).toBeUndefined();
    expect(body.qty).toBeUndefined();
    expect(body.orgSarNo).toBe(0);
    expect(body.regTyCd).toBe('M');
    expect(body.sarTyCd).toBe('11');
    expect(body.ocrnDt).toMatch(/^\d{8}$/);
    expect(typeof body.totTaxblAmt).toBe('number');
    expect(typeof body.totTaxAmt).toBe('number');
    expect(typeof body.totAmt).toBe('number');
  });

  it('throws when VSDC rejects the submission', async () => {
    vi.spyOn(vsdcService, 'ensureDeviceInitialized').mockResolvedValue({ success: true });
    vi.spyOn(vsdcService, 'makeAuthenticatedRequest').mockResolvedValue({
      success: true,
      data: { resultCd: '999', resultMsg: 'Simulated rejection' },
    });

    await expect(vsdcService.submitStockIo({ itemCd: 'SKU-1', sarTyCd: '11', sarNo: 'SAR-1', qty: 1 })).rejects.toThrow(
      /Simulated rejection/
    );
  });
});

describe('vsdcService.submitStockMaster — real spec payload shape (POST /stockMaster/saveStockMaster)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vsdcService.isInitialized = false;
  });

  it('REGRESSION: sends stockItemList with rsdQty, not the old wrong itemList/qty', async () => {
    vi.spyOn(vsdcService, 'ensureDeviceInitialized').mockResolvedValue({ success: true });
    const requestSpy = vi
      .spyOn(vsdcService, 'makeAuthenticatedRequest')
      .mockResolvedValue({ success: true, data: { resultCd: '000' } });

    await vsdcService.submitStockMaster([{ itemCd: 'SKU-1', rsdQty: 7 }]);

    const body = requestSpy.mock.calls[0][2];
    expect(body.stockItemList).toEqual([{ itemCd: 'SKU-1', rsdQty: 7 }]);
    expect(body.itemList).toBeUndefined();
  });
});

describe('stockSyncService.syncMovementById — calls saveStockItems then saveStockMaster with rsdQty = newStock', () => {
  afterEach(async () => {
    await prisma.stockMovement.deleteMany({ where: { referenceType: 'TEST' } });
    await cleanupTestData();
    vi.restoreAllMocks();
    vsdcService.isInitialized = false;
  });

  it('on success, calls stockItems then stockMaster with the movement\'s resulting (not delta) quantity, and marks synced', async () => {
    const category = await createTestCategory();
    const product = await createTestProduct({ categoryId: category.id, taxType: 'A', zraPackageUnit: 'BX', zraQuantityUnit: 'EA' });
    const user = await createTestUser();
    const movement = await createMovement({
      productId: product.id, userId: user.id, movementType: 'SALE_OUT', quantity: -3, previousStock: 10, newStock: 7,
    });
    vi.spyOn(vsdcService, 'ensureDeviceInitialized').mockResolvedValue({ success: true });
    const requestSpy = vi
      .spyOn(vsdcService, 'makeAuthenticatedRequest')
      .mockResolvedValue({ success: true, data: { resultCd: '000' } });

    const result = await stockSyncService.syncMovementById(movement.id);

    expect(result.ok).toBe(true);
    expect(requestSpy).toHaveBeenCalledTimes(2);
    const masterCallBody = requestSpy.mock.calls[1][2];
    expect(masterCallBody.stockItemList[0].rsdQty).toBe(7); // newStock, not the -3 delta

    const persisted = await prisma.stockMovement.findUnique({ where: { id: movement.id } });
    expect(persisted.zraSyncedAt).toBeTruthy();
    expect(persisted.zraSyncError).toBeNull();
  });

  it('when saveStockItems fails, does not attempt saveStockMaster and records the failure', async () => {
    const category = await createTestCategory();
    const product = await createTestProduct({ categoryId: category.id, taxType: 'A', zraPackageUnit: 'BX', zraQuantityUnit: 'EA' });
    const user = await createTestUser();
    const movement = await createMovement({
      productId: product.id, userId: user.id, movementType: 'SALE_OUT', quantity: -1, previousStock: 5, newStock: 4,
    });
    vi.spyOn(vsdcService, 'ensureDeviceInitialized').mockResolvedValue({ success: true });
    const requestSpy = vi
      .spyOn(vsdcService, 'makeAuthenticatedRequest')
      .mockResolvedValue({ success: true, data: { resultCd: '999', resultMsg: 'Simulated item rejection' } });

    const result = await stockSyncService.syncMovementById(movement.id);

    expect(result.ok).toBe(false);
    expect(requestSpy).toHaveBeenCalledTimes(1);

    const persisted = await prisma.stockMovement.findUnique({ where: { id: movement.id } });
    expect(persisted.zraSyncedAt).toBeNull();
    expect(persisted.zraSyncError).toMatch(/Simulated item rejection/);
  });

  it('when saveStockItems succeeds but saveStockMaster fails, does not mark synced and reports the combined failure', async () => {
    const category = await createTestCategory();
    const product = await createTestProduct({ categoryId: category.id, taxType: 'A', zraPackageUnit: 'BX', zraQuantityUnit: 'EA' });
    const user = await createTestUser();
    const movement = await createMovement({
      productId: product.id, userId: user.id, movementType: 'SALE_OUT', quantity: -1, previousStock: 5, newStock: 4,
    });
    vi.spyOn(vsdcService, 'ensureDeviceInitialized').mockResolvedValue({ success: true });
    vi.spyOn(vsdcService, 'makeAuthenticatedRequest')
      .mockResolvedValueOnce({ success: true, data: { resultCd: '000' } })
      .mockResolvedValueOnce({ success: true, data: { resultCd: '999', resultMsg: 'Simulated master rejection' } });

    const result = await stockSyncService.syncMovementById(movement.id);

    expect(result.ok).toBe(false);

    const persisted = await prisma.stockMovement.findUnique({ where: { id: movement.id } });
    expect(persisted.zraSyncedAt).toBeNull();
    expect(persisted.zraSyncError).toMatch(/saveStockItems succeeded but saveStockMaster failed/);
    expect(persisted.zraSyncError).toMatch(/Simulated master rejection/);
  });
});
