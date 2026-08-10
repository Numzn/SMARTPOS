/**
 * Official vs mock VSDC endpoint paths (PDF v1.0.8).
 */

const OFFICIAL = {
  initialize: '/initializer/selectInitInfo',
  codes: '/code/selectCodes',
  itemClass: '/itemClass/selectItemsClass',
  itemSave: '/items/saveItem',
  itemUpdate: '/items/updateItem',
  salesSave: '/trnsSales/saveSales',
  salesSelect: '/trnsSales/selectSales',
  stockItems: '/stock/saveStockItems',
  stockMaster: '/stockMaster/saveStockMaster',
  purchaseGet: '/trnsPurchase/selectPurchases',
};

const MOCK = {
  initialize: '/api/initialize',
  codes: '/api/codes/get',
  itemClass: '/api/itemClass/get',
  itemSave: '/api/items/save',
  itemUpdate: '/api/items/save',
  salesSave: '/api/invoice/submit',
  salesSelect: '/api/sales/select',
  stockItems: '/api/stock/save',
  stockMaster: '/api/stock/save',
  purchaseGet: '/api/purchase/get',
};

function mode() {
  return (process.env.VSDC_MODE || 'mock').toLowerCase() === 'official' ? 'official' : 'mock';
}

function map(key) {
  return mode() === 'official' ? OFFICIAL[key] : MOCK[key];
}

module.exports = {
  mode,
  isOfficial: () => mode() === 'official',
  path: map,
  OFFICIAL,
  MOCK,
};
