import { describe, it, expect, vi, afterEach } from 'vitest';

const vsdcService = require('../../services/vsdcService.js');
const itemManagementService = require('../../services/itemManagement.js');
const itemCompositionService = require('../../services/itemCompositionService.js');
const endpointAdapter = require('../../lib/vsdc-gateway/endpointAdapter.js');
const testData = require('../helpers/testData.js');

const originalMode = process.env.VSDC_MODE;

afterEach(() => {
  if (originalMode === undefined) delete process.env.VSDC_MODE;
  else process.env.VSDC_MODE = originalMode;
  vi.restoreAllMocks();
  vsdcService.isInitialized = false;
});

describe('official VSDC_MODE routes call sites through endpointAdapter, not a hardcoded mock path', () => {
  it('REGRESSION: vsdcService.initialize() posts to endpointAdapter.path("initialize")', async () => {
    process.env.VSDC_MODE = 'official';
    vi.spyOn(vsdcService, 'loadSessionFromFile').mockResolvedValue(false);
    vi.spyOn(vsdcService, 'ping').mockResolvedValue({ success: true });
    vi.spyOn(vsdcService, 'authenticate').mockResolvedValue({ success: true });
    vi.spyOn(vsdcService, 'getDeviceSerial').mockResolvedValue('SERIAL-1');
    vi.spyOn(vsdcService, 'persistDeviceFromInit').mockResolvedValue();
    const requestSpy = vi
      .spyOn(vsdcService, 'makeAuthenticatedRequest')
      .mockResolvedValue({ success: true, data: { resultCd: '000' } });

    await vsdcService.initialize();

    expect(requestSpy).toHaveBeenCalled();
    expect(requestSpy.mock.calls[0][1]).toBe(endpointAdapter.path('initialize'));
    expect(requestSpy.mock.calls[0][1]).toBe('/initializer/selectInitInfo');
  });

  it('REGRESSION: itemManagementService.submitWithRetry posts to endpointAdapter.path("itemSave")', async () => {
    process.env.VSDC_MODE = 'official';
    vsdcService.isInitialized = true;
    const requestSpy = vi
      .spyOn(vsdcService, 'makeAuthenticatedRequest')
      .mockResolvedValue({ success: true, data: { resultCd: '000' } });

    await itemManagementService.submitWithRetry({ itemCd: 'SKU-1' });

    expect(requestSpy).toHaveBeenCalled();
    expect(requestSpy.mock.calls[0][1]).toBe(endpointAdapter.path('itemSave'));
    expect(requestSpy.mock.calls[0][1]).toBe('/items/saveItem');
  });

  it('REGRESSION: itemCompositionService.addComponent posts to endpointAdapter.path("itemComposition")', async () => {
    process.env.VSDC_MODE = 'official';
    vsdcService.isInitialized = true;
    const requestSpy = vi
      .spyOn(vsdcService, 'makeAuthenticatedRequest')
      .mockResolvedValue({ success: true, data: { resultCd: '000' } });
    const category = await testData.createTestCategory();
    const parent = await testData.createTestProduct({ categoryId: category.id });
    const component = await testData.createTestProduct({ categoryId: category.id });

    await itemCompositionService.addComponent(parent.id, component.id, 1);

    expect(requestSpy).toHaveBeenCalled();
    expect(requestSpy.mock.calls[0][1]).toBe(endpointAdapter.path('itemComposition'));
    expect(requestSpy.mock.calls[0][1]).toBe('/items/saveItemComposition');

    await testData.cleanupTestData();
  });

  it('REGRESSION: vsdcService.submitStockIo() posts to endpointAdapter.path("stockItems")', async () => {
    process.env.VSDC_MODE = 'official';
    vi.spyOn(vsdcService, 'ensureDeviceInitialized').mockResolvedValue({ success: true });
    const requestSpy = vi
      .spyOn(vsdcService, 'makeAuthenticatedRequest')
      .mockResolvedValue({ success: true, data: { resultCd: '000' } });

    await vsdcService.submitStockIo({ itemCd: 'SKU-1', qty: 1, sarNo: '1' });

    expect(requestSpy).toHaveBeenCalled();
    expect(requestSpy.mock.calls[0][1]).toBe(endpointAdapter.path('stockItems'));
    expect(requestSpy.mock.calls[0][1]).toBe('/stock/saveStockItems');
  });

  it('in mock mode, the same call sites still resolve to the mock paths', async () => {
    delete process.env.VSDC_MODE;
    vi.spyOn(vsdcService, 'loadSessionFromFile').mockResolvedValue(false);
    vi.spyOn(vsdcService, 'ping').mockResolvedValue({ success: true });
    vi.spyOn(vsdcService, 'authenticate').mockResolvedValue({ success: true });
    vi.spyOn(vsdcService, 'getDeviceSerial').mockResolvedValue('SERIAL-1');
    vi.spyOn(vsdcService, 'persistDeviceFromInit').mockResolvedValue();
    const requestSpy = vi
      .spyOn(vsdcService, 'makeAuthenticatedRequest')
      .mockResolvedValue({ success: true, data: { resultCd: '000' } });

    await vsdcService.initialize();

    expect(requestSpy.mock.calls[0][1]).toBe('/api/initialize');
  });
});
