#!/usr/bin/env node
/**
 * ZRA sandbox smoke test (official VSDC_MODE=official).
 * Usage:
 *   VSDC_MODE=official VSDC_URL=... TPIN=... BHF_ID=... node scripts/sandbox-smoke.js
 *
 * Do not commit sandbox credentials — set via environment only.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const axios = require('axios');

const VSDC_URL = (process.env.VSDC_URL || '').replace(/\/$/, '');
const BASE_PATH = (process.env.VSDC_BASE_PATH || '').replace(/^\//, '').replace(/\/$/, '');
const TPIN = process.env.TPIN || process.env.ZRA_TPIN;
const BHF_ID = process.env.BHF_ID || process.env.ZRA_BHF_ID || '000';
const DVC_SRL_NO = process.env.DVC_SRL_NO || process.env.ZRA_DEVICE_SERIAL;

function baseUrl() {
  if (!VSDC_URL) throw new Error('VSDC_URL is required');
  return BASE_PATH ? `${VSDC_URL}/${BASE_PATH}` : VSDC_URL;
}

function url(path) {
  return `${baseUrl()}${path.startsWith('/') ? path : `/${path}`}`;
}

const ok = (step, detail) => console.log(`[PASS] ${step} — ${detail}`);
const fail = (step, err) => {
  console.error(`[FAIL] ${step} — ${err}`);
  process.exit(1);
};

async function post(path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await axios.post(url(path), body, { headers, timeout: 120000 });
  return res.data;
}

async function main() {
  if ((process.env.VSDC_MODE || 'mock').toLowerCase() !== 'official') {
    console.warn('Warning: VSDC_MODE is not official — this script targets ZRA sandbox UAT.');
  }
  if (!TPIN) fail('config', 'TPIN (or ZRA_TPIN) env var required');

  console.log('\n=== ZRA Sandbox Smoke Test ===\n');
  console.log(`Target: ${baseUrl()}\n`);

  let token;
  try {
    const login = await post('/api/login', { tpin: TPIN, bhfId: BHF_ID, dvcSrlNo: DVC_SRL_NO });
    if (login.resultCd !== '000') fail('login', login.resultMsg || 'login failed');
    token = login.sessionToken;
    ok('login', 'session established');
  } catch (e) {
    fail('login', e.message);
  }

  try {
    const init = await post(
      '/initializer/selectInitInfo',
      { tpin: TPIN, bhfId: BHF_ID, dvcSrlNo: DVC_SRL_NO },
      token
    );
    if (init.resultCd !== '000') fail('initialize', init.resultMsg || 'init failed');
    ok('initialize', 'device initialized');
  } catch (e) {
    fail('initialize', e.message);
  }

  try {
    const codes = await post(
      '/code/selectCodes',
      { tpin: TPIN, bhfId: BHF_ID, lastReqDt: '20200101000000' },
      token
    );
    if (codes.resultCd !== '000') fail('codes', codes.resultMsg || 'codes failed');
    const list = codes.data?.cdList || codes.cdList || [];
    ok('codes', `${Array.isArray(list) ? list.length : 0} codes`);
  } catch (e) {
    fail('codes', e.message);
  }

  try {
    const cls = await post(
      '/itemClass/selectItemsClass',
      { tpin: TPIN, bhfId: BHF_ID, lastReqDt: '20200101000000' },
      token
    );
    if (cls.resultCd !== '000') fail('classifications', cls.resultMsg || 'class failed');
    ok('classifications', 'item classes fetched');
  } catch (e) {
    fail('classifications', e.message);
  }

  const testItemCd = `SMOKE-${Date.now()}`;
  try {
    const item = await post(
      '/items/saveItem',
      {
        tpin: TPIN,
        bhfId: BHF_ID,
        itemCd: testItemCd,
        itemClsCd: '50100000',
        itemNm: 'Sandbox Smoke Item',
        itemTyCd: '2',
        orgnNatCd: 'ZM',
        pkgUnitCd: 'EA',
        qtyUnitCd: 'EA',
        taxTyCd: 'A',
        dftPrc: 11.6,
        useYn: 'Y',
        regrId: 'SMOKE',
        regrNm: 'SMOKE',
        modrId: 'SMOKE',
        modrNm: 'SMOKE',
      },
      token
    );
    if (item.resultCd !== '000') fail('saveItem', item.resultMsg || 'item save failed');
    ok('saveItem', testItemCd);
  } catch (e) {
    fail('saveItem', e.message);
  }

  const cisInvcNo = String(Date.now());
  try {
    const sale = await post(
      '/trnsSales/saveSales',
      {
        tpin: TPIN,
        bhfId: BHF_ID,
        orgInvcNo: 0,
        cisInvcNo,
        custNm: 'Sandbox Walk-in',
        salesTyCd: 'N',
        rcptTyCd: 'S',
        pmtTyCd: '01',
        salesSttsCd: '02',
        cfmDt: new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14),
        salesDt: new Date().toISOString().slice(0, 10).replace(/-/g, ''),
        totItemCnt: 1,
        taxblAmtA: 10,
        taxAmtA: 1.6,
        taxRtA: 16,
        totTaxblAmt: 10,
        totTaxAmt: 1.6,
        totAmt: 11.6,
        currencyTyCd: 'ZMW',
        exchangeRt: '1',
        regrId: 'SMOKE',
        regrNm: 'SMOKE',
        modrId: 'SMOKE',
        modrNm: 'SMOKE',
        itemList: [
          {
            itemSeq: 1,
            itemCd: testItemCd,
            itemClsCd: '50100000',
            itemNm: 'Sandbox Smoke Item',
            pkgUnitCd: 'EA',
            qtyUnitCd: 'EA',
            qty: 1,
            prc: 11.6,
            splyAmt: 11.6,
            vatCatCd: 'A',
            vatTaxblAmt: 10,
            vatAmt: 1.6,
            totAmt: 11.6,
          },
        ],
      },
      token
    );
    if (sale.resultCd !== '000') fail('saveSales', sale.resultMsg || JSON.stringify(sale));
    const rcptNo = sale.rcptNo || sale.data?.rcptNo;
    const qr = sale.qrCode || sale.qrCodeUrl || sale.data?.qrCode;
    if (!rcptNo) fail('saveSales', 'missing rcptNo in response');
    ok('saveSales', `rcptNo=${rcptNo} qr=${qr ? 'yes' : 'no'}`);
  } catch (e) {
    fail('saveSales', e.message);
  }

  console.log('\n=== Sandbox smoke test PASSED ===\n');
}

main().catch((e) => fail('unhandled', e.message));
