/**
 * Mock ZRA VSDC server for local development.
 * Accepts both legacy mock paths and official PDF v1.0.8 paths.
 */
const express = require('express');
const app = express();
const PORT = process.env.MOCK_VSDC_PORT || 8090;

/** invcNo → last successful submit payload (reconciliation lookups) */
const submittedInvoices = new Map();
/** bhfId → branch payload */
const registeredBranches = new Map();

app.use(express.json());

const ok = (extra = {}) => ({
  resultCd: '000',
  resultMsg: 'Success',
  resultDt: new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14),
  ...extra,
});

// Class numbers and codes match the real VSDC API Spec v1.0.8 (§5.2 sample
// response, §6.4/§6.5 "Code Definition" tables) — corrected 2026-08-11.
// Previously this used '01'/'03'/'04' with a flat cdList shape, neither of
// which matches the real spec; see zraCodesService.js's CODE_CLASS_MAP
// comment for the full explanation. Real /code/selectCodes has no per-code
// tax-rate field (dtlList entries are just {cd, cdNm}) — taxRt below is
// deliberately omitted for real classes to avoid inventing a value ZRA
// doesn't actually send here.
const MOCK_CODES = [
  // Tax Type — class '04'
  { cdCls: '04', cd: 'A', cdNm: 'Standard Rated' },
  { cdCls: '04', cd: 'B', cdNm: 'MTV' },
  { cdCls: '04', cd: 'C1', cdNm: 'Exports' },
  { cdCls: '04', cd: 'D', cdNm: 'Exempt' },
  // Units of measure (quantity unit) — class '10'
  { cdCls: '10', cd: 'EA', cdNm: 'Each' },
  { cdCls: '10', cd: 'KG', cdNm: 'Kilo-Gramme' },
  { cdCls: '10', cd: 'L', cdNm: 'Litre' },
  // Packaging Unit — class '17'
  { cdCls: '17', cd: 'BX', cdNm: 'Box' },
  { cdCls: '17', cd: 'BA', cdNm: 'Barrel' },
  { cdCls: '17', cd: 'AM', cdNm: 'Ampoule' },
  // Currency — class number not re-verified against spec (unused by any
  // route today; see zraCodesService.js comment), left as before.
  { cdCls: '05', cd: 'ZMW', cdNm: 'Zambian Kwacha' },
];

const CODE_CLASS_NAMES = {
  '04': 'Taxation Type',
  '10': 'Unit of measures',
  '17': 'Packaging Unit',
  '05': 'Currency',
};

const MOCK_CLASSIFICATIONS = [
  { itemClsCd: '50100000', itemClsNm: 'General retail', itemClsLvl: 1, taxTyCd: 'A', mjrTgYn: 'Y', useYn: 'Y' },
  { itemClsCd: '50101500', itemClsNm: 'Food and beverages', itemClsLvl: 2, taxTyCd: 'B', mjrTgYn: 'N', useYn: 'Y' },
  // Deliberately useYn:'N' — exercises the "don't serve deprecated codes" filter in zraCodesService.getItemClassifications().
  { itemClsCd: '50999999', itemClsNm: 'Deprecated test category', itemClsLvl: 1, taxTyCd: 'A', mjrTgYn: 'N', useYn: 'N' },
];

app.get('/api/ping', (req, res) => {
  res.json(ok({ message: 'Mock VSDC reachable' }));
});

app.post('/api/login', (req, res) => {
  console.log('🔐 Mock VSDC login:', req.body.tpin, req.body.bhfId);
  res.json(
    ok({
      sessionToken: `mock-token-${Date.now()}`,
      sessionId: `mock-session-${Date.now()}`,
    })
  );
});

const initKeys = () => ({
  intrlKey: `MOCK-INTRL-${Date.now()}`,
  signKey: `MOCK-SIGN-KEY-${Date.now()}`,
  cmcKey: `MOCK-CMC-${Date.now()}`,
  sdicId: 'MOCK-SDC-001',
  mrcNo: 'MOCK-MRC-001',
});

const handleInitialize = (req, res) => {
  console.log('🔧 Mock VSDC initialize:', req.body.tpin, req.body.bhfId, req.body.dvcSrlNo);
  const keys = initKeys();
  res.json(
    ok({
      initialized: true,
      ...keys,
      data: { info: keys },
    })
  );
};

app.post('/api/initialize', handleInitialize);
app.post('/initializer/selectInitInfo', handleInitialize);

const handleInvoiceSubmit = (req, res) => {
  const rcptType = req.body.rcptTyCd || 'S';
  const orgInvc = req.body.orgInvcNo || 0;
  console.log(`🧾 Mock VSDC sales save (rcptTyCd=${rcptType}, orgInvcNo=${orgInvc})`);
  const invcNo = req.body.invcNo || Number(req.body.cisInvcNo) || Date.now();
  const payload = {
    invcSdcId: `MOCK-SDC-${invcNo}`,
    invcNo,
    rcptNo: rcptType === 'R' ? `MOCK-CRN-${invcNo}` : `MOCK-RCPT-${invcNo}`,
    totRcptNo: 1,
    qrCode: `https://mock.zra.zm/receipt/${invcNo}`,
    qrCodeUrl: `https://mock.zra.zm/receipt/${invcNo}`,
    sdcId: 'MOCK-SDC-001',
    mrcNo: 'MOCK-MRC-001',
    intrlData: `MOCK-SIGN-${Math.random().toString(36).slice(2, 11)}`,
    rcptSign: `MOCK-SIGN-${Math.random().toString(36).slice(2, 11)}`,
  };
  submittedInvoices.set(Number(invcNo), payload);
  res.json(ok(payload));
};

app.post('/api/invoice/submit', handleInvoiceSubmit);
app.post('/trnsSales/saveSales', handleInvoiceSubmit);

/** Read-only receipt lookup for fiscal reconciliation */
const handleSelectSales = (req, res) => {
  const invcNo = Number(req.body.invcNo);
  const found = submittedInvoices.get(invcNo);
  if (found) {
    return res.json(ok(found));
  }
  res.json({ resultCd: '001', resultMsg: 'Invoice not found', resultDt: ok().resultDt });
};

app.post('/trnsSales/selectSales', handleSelectSales);
app.post('/api/sales/select', handleSelectSales);

// Real /code/selectCodes groups codes by class: data.clsList[] of
// {cdCls, cdClsNm, dtlList: [{cd, cdNm}]} — see codesSync.js for the parser
// this now needs to match. Built from the flat MOCK_CODES above so the
// legacy /api/codes/get/:type route below can keep using a flat filter.
const handleCodes = (req, res) => {
  console.log('📋 Mock VSDC codes select');
  const byClass = new Map();
  for (const row of MOCK_CODES) {
    if (!byClass.has(row.cdCls)) byClass.set(row.cdCls, []);
    byClass.get(row.cdCls).push({ cd: row.cd, cdNm: row.cdNm });
  }
  const clsList = Array.from(byClass.entries()).map(([cdCls, dtlList]) => ({
    cdCls,
    cdClsNm: CODE_CLASS_NAMES[cdCls] || cdCls,
    dtlList,
  }));
  res.json(ok({ data: { clsList } }));
};

app.post('/code/selectCodes', handleCodes);
app.post('/api/codes/get', handleCodes);
app.post('/api/codes/get/:type', (req, res) => {
  const type = req.params.type;
  const filtered = MOCK_CODES.filter((c) => c.cdCls === type);
  res.json(ok({ data: filtered }));
});

const handleItemClass = (req, res) => {
  console.log('📋 Mock VSDC item class select');
  res.json(ok({ data: { itemClsList: MOCK_CLASSIFICATIONS }, itemClsList: MOCK_CLASSIFICATIONS }));
};

app.post('/itemClass/selectItemsClass', handleItemClass);
app.post('/api/itemClass/get', handleItemClass);

const handleItemSave = (req, res) => {
  console.log('📦 Mock VSDC item save:', req.body.itemCd);
  res.json(
    ok({
      itemCd: req.body.itemCd,
      itemNm: req.body.itemNm,
    })
  );
};

app.post('/api/items/save', handleItemSave);
app.post('/items/saveItem', handleItemSave);

// Save Item Composition (spec §6.5, OPTIONAL) — response has data:null per
// the spec's own sample, unlike item save which echoes itemCd/itemNm.
const handleItemComposition = (req, res) => {
  console.log('🧩 Mock VSDC item composition save:', req.body.itemCd, '<-', req.body.cpstItemCd, 'x', req.body.cpstQty);
  res.json(ok({ data: null }));
};

app.post('/items/saveItemComposition', handleItemComposition);
app.post('/api/items/composition/save', handleItemComposition);

app.post('/api/items/sync', (req, res) => {
  console.log('🔄 Mock VSDC items sync');
  res.json(ok({ itemList: [] }));
});

// Real /stock/saveStockItems response is just {resultCd,resultMsg,resultDt,
// data:null} per the spec's own sample — corrected 2026-08-12, this used to
// echo back itemCd/sarNo fields that don't exist in the real response,
// which is exactly the kind of self-consistent-but-wrong mock that let the
// itemList-wrapper bug ship unnoticed (see services/vsdcService.js
// submitStockIo).
const handleStockSave = (req, res) => {
  const items = req.body.itemList || [];
  console.log('📊 Mock VSDC stock save:', req.body.sarTyCd, items.map((i) => i.itemCd).join(','));
  res.json(ok({ data: null }));
};

app.post('/api/stock/save', handleStockSave);
app.post('/stock/saveStockItems', handleStockSave);

// Real field name is stockItemList, not itemList (§6.14 sample request) —
// corrected 2026-08-12, this previously expected the same wrong field name
// the old caller sent, masking the mismatch.
const handleStockMasterSave = (req, res) => {
  const items = req.body.stockItemList || [];
  console.log('📊 Mock VSDC stock master save:', items.length, 'items');
  res.json(ok({ data: null }));
};

app.post('/stockMaster/saveStockMaster', handleStockMasterSave);
// Mock-mode path (endpointAdapter.js MOCK.stockMaster) — was aliased to
// stockItems' own path until 2026-08-12, see that file's comment.
app.post('/api/stock/master/save', handleStockMasterSave);

// Section 5.5/5.6 spec-verified endpoints (distinct from the legacy
// /api/branch/save + /api/branch/get below, which target a fabricated
// path — see smart-pos-backend/docs/zra-self-checklist.md item 4-7 notes).
const MOCK_ZRA_BRANCHES = [
  { tin: '1000000000', bhfId: '000', bhfNm: 'Headquarter', bhfSttsCd: '01', prvncNm: 'LUSAKA PROVINCE', dstrtNm: null, sctrNm: 'Lusaka', locDesc: null, mgrNm: 'SMART USER', mgrTelNo: '0977000000', mgrEmail: 'smartuser@email.org.zm', hqYn: 'Y' },
];
const mockZraCustomers = new Map(); // custTpin -> customer record

const handleBranchesSelect = (req, res) => {
  console.log('🏢 Mock VSDC selectBranches:', req.body.tpin, req.body.bhfId);
  res.json(ok({ data: { bhfList: MOCK_ZRA_BRANCHES }, bhfList: MOCK_ZRA_BRANCHES }));
};
app.post('/branches/selectBranches', handleBranchesSelect);
app.post('/api/branches/select', handleBranchesSelect);

const handleBranchUserSave = (req, res) => {
  console.log('👤 Mock VSDC saveBrancheUser:', req.body.userId, req.body.userNm);
  res.json(ok(null));
};
app.post('/branches/saveBrancheUser', handleBranchUserSave);
app.post('/api/branches/user/save', handleBranchUserSave);

const handleBranchCustomerSave = (req, res) => {
  console.log('🧑‍🤝‍🧑 Mock VSDC saveBrancheCustomers:', req.body.custTpin, req.body.custNm);
  mockZraCustomers.set(req.body.custTpin, {
    tpin: req.body.tpin,
    bhfId: req.body.bhfId,
    custNo: req.body.custNo,
    custTpin: req.body.custTpin,
    custNm: req.body.custNm,
    adrs: req.body.adrs ?? null,
    telNo: req.body.custNo ?? null,
    email: req.body.email ?? null,
    faxNo: req.body.faxNo ?? null,
    useYn: req.body.useYn || 'Y',
    remark: req.body.remark ?? null,
    regrId: req.body.regrId ?? null,
    regrNm: req.body.regrNm ?? null,
    modrId: req.body.modrId ?? null,
    modrNm: req.body.modrNm ?? null,
  });
  res.json(ok(null));
};
app.post('/branches/saveBrancheCustomers', handleBranchCustomerSave);
app.post('/api/branches/customer/save', handleBranchCustomerSave);

const handleCustomerSelect = (req, res) => {
  console.log('🔍 Mock VSDC selectCustomer:', req.body.custmTpin);
  const found = mockZraCustomers.get(req.body.custmTpin);
  const custList = found ? [found] : [];
  res.json(ok({ data: { custList }, custList }));
};
app.post('/customers/selectCustomer', handleCustomerSelect);
app.post('/api/customers/select', handleCustomerSelect);

app.post('/api/branch/save', (req, res) => {
  const bhfId = String(req.body.bhfId || '000').padStart(3, '0');
  console.log('🏢 Mock VSDC branch save:', bhfId, req.body.bhfNm);
  const payload = {
    bhfId,
    bhfNm: req.body.bhfNm,
    rcptNo: `MOCK-BHF-${bhfId}`,
    ...req.body,
  };
  registeredBranches.set(bhfId, payload);
  res.json(ok(payload));
});

app.get('/api/branch/get/:bhfId', (req, res) => {
  const bhfId = String(req.params.bhfId || '').padStart(3, '0');
  const found = registeredBranches.get(bhfId);
  if (found) {
    return res.json(ok(found));
  }
  res.json({ resultCd: '001', resultMsg: 'Branch not found', resultDt: ok().resultDt });
});

app.get('/health', (req, res) => {
  res.json({
    message: 'Mock ZRA VSDC Server is running',
    port: PORT,
    timestamp: new Date().toISOString(),
  });
});

const HOST = process.env.HOST || '0.0.0.0';
app.listen(PORT, HOST, () => {
  console.log(
    `Mock VSDC: http://${HOST}:${PORT} (mock + official path shims, saveSales, codes, stock)`
  );
});
