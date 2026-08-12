/**
 * Official vs mock VSDC endpoint paths (PDF v1.0.8).
 */

const OFFICIAL = {
  initialize: '/initializer/selectInitInfo',
  codes: '/code/selectCodes',
  itemClass: '/itemClass/selectItemsClass',
  itemSave: '/items/saveItem',
  itemUpdate: '/items/updateItem',
  // Section 6.5 — OPTIONAL per spec, unlike itemSave. Links a finished
  // product to one raw-material/component item + quantity per call.
  itemComposition: '/items/saveItemComposition',
  salesSave: '/trnsSales/saveSales',
  salesSelect: '/trnsSales/selectSales',
  stockItems: '/stock/saveStockItems',
  stockMaster: '/stockMaster/saveStockMaster',
  purchaseGet: '/trnsPurchase/selectPurchases',
  // Section 5.5 Branch Information + 5.6 Customer Information — endpoint
  // names/paths verified directly against the spec PDF (pdftotext extraction),
  // not inferred from prior code. Note branchUserSave is singular
  // ("saveBrancheUser") per the spec, and customerSelect lives under
  // /customers/, a different namespace than the other /branches/ endpoints.
  branchesSelect: '/branches/selectBranches',
  branchUserSave: '/branches/saveBrancheUser',
  branchCustomerSave: '/branches/saveBrancheCustomers',
  customerSelect: '/customers/selectCustomer',
};

const MOCK = {
  initialize: '/api/initialize',
  codes: '/api/codes/get',
  itemClass: '/api/itemClass/get',
  itemSave: '/api/items/save',
  itemUpdate: '/api/items/save',
  itemComposition: '/api/items/composition/save',
  salesSave: '/api/invoice/submit',
  salesSelect: '/api/sales/select',
  stockItems: '/api/stock/save',
  stockMaster: '/api/stock/save',
  purchaseGet: '/api/purchase/get',
  branchesSelect: '/api/branches/select',
  branchUserSave: '/api/branches/user/save',
  branchCustomerSave: '/api/branches/customer/save',
  customerSelect: '/api/customers/select',
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
