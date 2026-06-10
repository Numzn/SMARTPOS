/**
 * Mock ZRA VSDC server for local development.
 * Aligns with vsdcService endpoints (default VSDC_URL=http://localhost:8090).
 */
const express = require('express');
const app = express();
const PORT = process.env.MOCK_VSDC_PORT || 8090;

app.use(express.json());

const ok = (extra = {}) => ({
  resultCd: '000',
  resultMsg: 'Success',
  resultDt: new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14),
  ...extra,
});

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

app.post('/api/invoice/submit', (req, res) => {
  const rcptType = req.body.rcptTyCd || 'S';
  const orgInvc = req.body.orgInvcNo || 0;
  console.log(`🧾 Mock VSDC invoice submit (rcptTyCd=${rcptType}, orgInvcNo=${orgInvc})`);
  const invcNo = req.body.invcNo || Date.now();
  res.json(
    ok({
      invcSdcId: `MOCK-SDC-${invcNo}`,
      invcNo,
      rcptNo: rcptType === 'R' ? `MOCK-CRN-${invcNo}` : `MOCK-RCPT-${invcNo}`,
      totRcptNo: 1,
      qrCode: `https://mock.zra.zm/receipt/${invcNo}`,
      sdcId: 'MOCK-SDC-001',
      mrcNo: 'MOCK-MRC-001',
      intrlData: `MOCK-SIGN-${Math.random().toString(36).slice(2, 11)}`,
    })
  );
});

app.post('/api/items/save', (req, res) => {
  console.log('📦 Mock VSDC item save:', req.body.itemCd);
  res.json(
    ok({
      itemCd: req.body.itemCd,
      itemNm: req.body.itemNm,
    })
  );
});

app.post('/api/items/sync', (req, res) => {
  console.log('🔄 Mock VSDC items sync');
  res.json(ok({ itemList: [] }));
});

app.post('/api/stock/save', (req, res) => {
  console.log('📊 Mock VSDC stock save:', req.body.itemCd, req.body.qty);
  res.json(
    ok({
      itemCd: req.body.itemCd,
      sarNo: req.body.sarNo || `MOCK-SAR-${Date.now()}`,
    })
  );
});

// Legacy endpoint (older integrations)
app.post('/trnsSales/saveSales', (req, res) => {
  const ts = Date.now();
  res.json({
    rcptNo: `MOCK-RCPT-${ts}`,
    rcptSign: `MOCK-SIGN-${ts}`,
    qrCode: `https://mock.zra.zm/receipt/${ts}`,
    status: 'SUCCESS',
    timestamp: new Date().toISOString(),
    message: 'Smart Invoice generated successfully',
  });
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
  console.log(`Mock VSDC: http://${HOST}:${PORT} (ping, login, invoice/submit, items/save, stock/save)`);
});
