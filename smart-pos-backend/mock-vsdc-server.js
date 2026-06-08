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

app.post('/api/initialize', (req, res) => {
  res.json(ok({ initialized: true }));
});

app.post('/api/invoice/submit', (req, res) => {
  console.log('🧾 Mock VSDC invoice submit');
  const invcNo = req.body.invcNo || Date.now();
  res.json(
    ok({
      invcSdcId: `MOCK-SDC-${invcNo}`,
      invcNo,
      rcptNo: `MOCK-RCPT-${invcNo}`,
      totRcptNo: 1,
      qrCode: `https://mock.zra.zm/receipt/${invcNo}`,
      sdcId: 'MOCK-SDC-001',
      mrcNo: 'MOCK-MRC-001',
      intrlData: `MOCK-SIGN-${Math.random().toString(36).slice(2, 11)}`,
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
  console.log(`Mock VSDC: http://${HOST}:${PORT} (ping, login, invoice/submit)`);
});
