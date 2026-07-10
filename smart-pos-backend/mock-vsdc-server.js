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

const MOCK_CODES = [
  { cdCls: '01', cd: 'A', cdNm: 'VAT Standard Rate', taxRt: 16 },
  { cdCls: '01', cd: 'B', cdNm: 'VAT Zero Rate', taxRt: 0 },
  { cdCls: '01', cd: 'C', cdNm: 'VAT Exempt', taxRt: 0 },
  { cdCls: '03', cd: 'EA', cdNm: 'Each', cdDesc: 'Unit each' },
  { cdCls: '03', cd: 'KG', cdNm: 'Kilogram', cdDesc: 'Kilogram' },
  { cdCls: '04', cd: 'BX', cdNm: 'Box', cdDesc: 'Box' },
  { cdCls: '05', cd: 'ZMW', cdNm: 'Zambian Kwacha', cdDesc: 'Local currency' },
];

const MOCK_CLASSIFICATIONS = [
  { itemClsCd: '50100000', itemClsNm: 'General retail', lvl: 1 },
  { itemClsCd: '50101500', itemClsNm: 'Food and beverages', lvl: 2 },
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
app.post('/trnsSales/selectSales', (req, res) => {
  const invcNo = Number(req.body.invcNo);
  const found = submittedInvoices.get(invcNo);
  if (found) {
    return res.json(ok(found));
  }
  res.json({ resultCd: '001', resultMsg: 'Invoice not found', resultDt: ok().resultDt });
});

const handleCodes = (req, res) => {
  console.log('📋 Mock VSDC codes select');
  res.json(ok({ data: { cdList: MOCK_CODES }, cdList: MOCK_CODES }));
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

app.post('/api/items/sync', (req, res) => {
  console.log('🔄 Mock VSDC items sync');
  res.json(ok({ itemList: [] }));
});

const handleStockSave = (req, res) => {
  console.log('📊 Mock VSDC stock save:', req.body.itemCd, req.body.qty);
  res.json(
    ok({
      itemCd: req.body.itemCd,
      sarNo: req.body.sarNo || `MOCK-SAR-${Date.now()}`,
    })
  );
};

app.post('/api/stock/save', handleStockSave);
app.post('/stock/saveStockItems', handleStockSave);

app.post('/stockMaster/saveStockMaster', (req, res) => {
  console.log('📊 Mock VSDC stock master save:', (req.body.itemList || []).length, 'items');
  res.json(ok({ itemList: req.body.itemList || [] }));
});

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
