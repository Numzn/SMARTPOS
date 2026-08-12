import { describe, it, expect, vi, afterEach } from 'vitest';

const prisma = require('../../lib/prisma');
const vsdcService = require('../../services/vsdcService');
const itemCompositionService = require('../../services/itemCompositionService');
const testData = require('../helpers/testData.js');

const { createTestCategory, createTestProduct, cleanupTestData } = testData;

function mockVsdcSuccess() {
  vsdcService.isInitialized = true;
  return vi.spyOn(vsdcService, 'makeAuthenticatedRequest').mockResolvedValue({
    success: true,
    data: { resultCd: '000', resultMsg: 'It is succeeded' },
  });
}

// Section 6.5 (item 9*, OPTIONAL per spec): a ProductComposition row links a
// finished product to one component + quantity. These tests cover the
// service's validation and the VSDC submit-and-record-outcome flow directly
// (routes/products.js's composition endpoints are covered separately in
// tests/integration/itemComposition.integration.test.js).
describe('itemCompositionService', () => {
  afterEach(async () => {
    await cleanupTestData();
    vi.restoreAllMocks();
    vsdcService.isInitialized = false;
  });

  it('rejects a product being its own component', async () => {
    const category = await createTestCategory();
    const product = await createTestProduct({ categoryId: category.id });

    await expect(itemCompositionService.addComponent(product.id, product.id, 1)).rejects.toThrow(
      /cannot be a component of itself/
    );
  });

  it('rejects a quantity that is not greater than 0', async () => {
    const category = await createTestCategory();
    const parent = await createTestProduct({ categoryId: category.id });
    const component = await createTestProduct({ categoryId: category.id });

    await expect(itemCompositionService.addComponent(parent.id, component.id, 0)).rejects.toThrow(
      /Quantity must be greater than 0/
    );
    await expect(itemCompositionService.addComponent(parent.id, component.id, -3)).rejects.toThrow(
      /Quantity must be greater than 0/
    );
  });

  it('rejects when the parent product has no SKU', async () => {
    const category = await createTestCategory();
    const parent = await createTestProduct({ categoryId: category.id, sku: null });
    const component = await createTestProduct({ categoryId: category.id });

    await expect(itemCompositionService.addComponent(parent.id, component.id, 1)).rejects.toThrow(
      /Parent product .* has no SKU/
    );
  });

  it('rejects when the component product has no SKU', async () => {
    const category = await createTestCategory();
    const parent = await createTestProduct({ categoryId: category.id });
    const component = await createTestProduct({ categoryId: category.id, sku: null });

    await expect(itemCompositionService.addComponent(parent.id, component.id, 1)).rejects.toThrow(
      /Component product .* has no SKU/
    );
  });

  it('rejects a nonexistent parent or component', async () => {
    const category = await createTestCategory();
    const real = await createTestProduct({ categoryId: category.id });

    await expect(itemCompositionService.addComponent('does-not-exist', real.id, 1)).rejects.toThrow(
      /Parent product not found/
    );
    await expect(itemCompositionService.addComponent(real.id, 'does-not-exist', 1)).rejects.toThrow(
      /Component product not found/
    );
  });

  it('on VSDC success, creates the row REGISTERED and sends itemCd/cpstItemCd/cpstQty as the products\' SKUs', async () => {
    const category = await createTestCategory();
    const parent = await createTestProduct({ categoryId: category.id, sku: 'TEST-SKU-PARENT-1' });
    const component = await createTestProduct({ categoryId: category.id, sku: 'TEST-SKU-COMPONENT-1' });
    const requestSpy = mockVsdcSuccess();

    const row = await itemCompositionService.addComponent(parent.id, component.id, 2.5);

    expect(row.zraRegistrationStatus).toBe('REGISTERED');
    expect(row.zraRegisteredAt).toBeTruthy();
    expect(requestSpy).toHaveBeenCalledWith(
      'POST',
      expect.any(String),
      expect.objectContaining({ itemCd: 'TEST-SKU-PARENT-1', cpstItemCd: 'TEST-SKU-COMPONENT-1', cpstQty: 2.5 })
    );

    const persisted = await prisma.productComposition.findUnique({ where: { id: row.id } });
    expect(persisted.quantity).toBe(2.5);
  });

  it('on VSDC failure, records FAILED with the error and rethrows', async () => {
    const category = await createTestCategory();
    const parent = await createTestProduct({ categoryId: category.id });
    const component = await createTestProduct({ categoryId: category.id });
    vsdcService.isInitialized = true;
    vi.spyOn(vsdcService, 'makeAuthenticatedRequest').mockResolvedValue({
      success: true,
      data: { resultCd: '999', resultMsg: 'Simulated VSDC rejection' },
    });

    await expect(itemCompositionService.addComponent(parent.id, component.id, 1)).rejects.toThrow(
      /Simulated VSDC rejection/
    );

    const row = await prisma.productComposition.findFirst({
      where: { parentProductId: parent.id, componentProductId: component.id },
    });
    expect(row.zraRegistrationStatus).toBe('FAILED');
    expect(row.zraRegistrationError).toMatch(/Simulated VSDC rejection/);
  });

  it('re-adding the same parent/component pair updates quantity rather than duplicating (unique constraint)', async () => {
    const category = await createTestCategory();
    const parent = await createTestProduct({ categoryId: category.id });
    const component = await createTestProduct({ categoryId: category.id });
    mockVsdcSuccess();

    await itemCompositionService.addComponent(parent.id, component.id, 1);
    await itemCompositionService.addComponent(parent.id, component.id, 5);

    const rows = await prisma.productComposition.findMany({
      where: { parentProductId: parent.id, componentProductId: component.id },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].quantity).toBe(5);
  });

  it('listComponents returns components with product details, ordered by creation', async () => {
    const category = await createTestCategory();
    const parent = await createTestProduct({ categoryId: category.id });
    const componentA = await createTestProduct({ categoryId: category.id, name: 'Flour' });
    const componentB = await createTestProduct({ categoryId: category.id, name: 'Sugar' });
    mockVsdcSuccess();

    await itemCompositionService.addComponent(parent.id, componentA.id, 1);
    await itemCompositionService.addComponent(parent.id, componentB.id, 2);

    const list = await itemCompositionService.listComponents(parent.id);

    expect(list).toHaveLength(2);
    expect(list.map((c) => c.componentProduct.name)).toEqual(['Flour', 'Sugar']);
  });

  it('removeComponent deletes the row locally without any VSDC call', async () => {
    const category = await createTestCategory();
    const parent = await createTestProduct({ categoryId: category.id });
    const component = await createTestProduct({ categoryId: category.id });
    const requestSpy = mockVsdcSuccess();
    const row = await itemCompositionService.addComponent(parent.id, component.id, 1);
    requestSpy.mockClear();

    await itemCompositionService.removeComponent(row.id);

    expect(requestSpy).not.toHaveBeenCalled();
    const persisted = await prisma.productComposition.findUnique({ where: { id: row.id } });
    expect(persisted).toBeNull();
  });
});
