import { describe, it, expect, afterEach } from 'vitest';
import endpointAdapter from '../../lib/vsdc-gateway/endpointAdapter.js';

const originalMode = process.env.VSDC_MODE;

afterEach(() => {
  if (originalMode === undefined) delete process.env.VSDC_MODE;
  else process.env.VSDC_MODE = originalMode;
});

describe('endpointAdapter', () => {
  it('defaults to mock mode when VSDC_MODE is unset', () => {
    delete process.env.VSDC_MODE;
    expect(endpointAdapter.mode()).toBe('mock');
    expect(endpointAdapter.isOfficial()).toBe(false);
  });

  it('switches to official mode only when VSDC_MODE=official', () => {
    process.env.VSDC_MODE = 'official';
    expect(endpointAdapter.mode()).toBe('official');
    expect(endpointAdapter.isOfficial()).toBe(true);

    process.env.VSDC_MODE = 'anything-else';
    expect(endpointAdapter.mode()).toBe('mock');
  });

  it('resolves every OFFICIAL key to its spec path (PDF v1.0.8) under VSDC_MODE=official', () => {
    process.env.VSDC_MODE = 'official';
    expect(endpointAdapter.path('initialize')).toBe('/initializer/selectInitInfo');
    expect(endpointAdapter.path('codes')).toBe('/code/selectCodes');
    expect(endpointAdapter.path('itemClass')).toBe('/itemClass/selectItemsClass');
    expect(endpointAdapter.path('itemSave')).toBe('/items/saveItem');
    expect(endpointAdapter.path('itemUpdate')).toBe('/items/updateItem');
    expect(endpointAdapter.path('itemComposition')).toBe('/items/saveItemComposition');
    expect(endpointAdapter.path('salesSave')).toBe('/trnsSales/saveSales');
    expect(endpointAdapter.path('salesSelect')).toBe('/trnsSales/selectSales');
    expect(endpointAdapter.path('stockItems')).toBe('/stock/saveStockItems');
    expect(endpointAdapter.path('stockMaster')).toBe('/stockMaster/saveStockMaster');
    expect(endpointAdapter.path('purchaseGet')).toBe('/trnsPurchase/selectPurchases');
  });

  it('REGRESSION: every MOCK path is distinct from its OFFICIAL counterpart, so mock and official runs are distinguishable', () => {
    for (const key of Object.keys(endpointAdapter.OFFICIAL)) {
      expect(endpointAdapter.MOCK[key], `MOCK.${key} must differ from OFFICIAL.${key}`).not.toBe(
        endpointAdapter.OFFICIAL[key]
      );
    }
  });
});
