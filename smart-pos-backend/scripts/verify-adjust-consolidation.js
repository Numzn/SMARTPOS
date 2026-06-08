/**
 * One-off verifier for the stock-adjust consolidation:
 *  - POST /api/stock-adjustments  -> 410 deprecated
 *  - GET  /api/stock-adjustments  -> still works (audit history)
 *  - POST /api/inventory/adjust   -> canonical, accepts IN/OUT and ZRA enum
 */

require('dotenv').config();
const axios = require('axios');

const BASE = process.env.API_URL || 'http://localhost:4000';

async function main() {
  const results = [];
  let token;
  let productId;

  try {
    const login = await axios.post(`${BASE}/api/users/login`, {
      email: 'admin@smartpos.com',
      password: 'admin123',
    });
    token = login.data.token;
    results.push({ step: 'login', pass: !!token });
  } catch (err) {
    results.push({ step: 'login', pass: false, detail: err.message });
    return results;
  }

  const auth = { headers: { Authorization: `Bearer ${token}` } };

  try {
    const inv = await axios.get(`${BASE}/api/inventory`, auth);
    const list = inv.data.inventory || inv.data;
    productId = list[0]?.productId;
    results.push({ step: 'inventory', pass: !!productId, detail: productId });
  } catch (err) {
    results.push({ step: 'inventory', pass: false, detail: err.message });
    return results;
  }

  // Canonical write — operational IN/OUT contract
  try {
    const op = await axios.post(
      `${BASE}/api/inventory/adjust`,
      { productId, adjustmentType: 'IN', quantity: 1, reason: 'verify IN' },
      auth
    );
    results.push({
      step: 'canonical IN',
      pass: op.data?.stockAdjustment?.id ? true : false,
      detail: op.data?.adjustmentDirection,
    });
  } catch (err) {
    results.push({ step: 'canonical IN', pass: false, detail: err.response?.data || err.message });
  }

  // Canonical write — ZRA-style enum contract
  try {
    const zra = await axios.post(
      `${BASE}/api/inventory/adjust`,
      { productId, adjustmentType: 'DAMAGED', quantity: 1, reason: 'verify DAMAGED' },
      auth
    );
    results.push({
      step: 'canonical DAMAGED',
      pass: zra.data?.stockAdjustment?.adjustmentType === 'DAMAGED',
      detail: zra.data?.stockAdjustment?.adjustmentType,
    });
  } catch (err) {
    results.push({
      step: 'canonical DAMAGED',
      pass: false,
      detail: err.response?.data || err.message,
    });
  }

  // Legacy POST should be deprecated (410)
  try {
    await axios.post(
      `${BASE}/api/stock-adjustments`,
      { productId, adjustmentType: 'INCREASE', quantity: 1, reason: 'should fail' },
      auth
    );
    results.push({ step: 'legacy POST -> 410', pass: false, detail: 'unexpectedly succeeded' });
  } catch (err) {
    const ok = err.response?.status === 410 && err.response?.data?.code === 'DEPRECATED_ENDPOINT';
    results.push({
      step: 'legacy POST -> 410',
      pass: ok,
      detail: err.response?.status + ' ' + (err.response?.data?.message || ''),
    });
  }

  // Legacy GET should still work
  try {
    const list = await axios.get(`${BASE}/api/stock-adjustments`, auth);
    results.push({
      step: 'legacy GET (audit)',
      pass: Array.isArray(list.data),
      detail: `${list.data.length} rows`,
    });
  } catch (err) {
    results.push({
      step: 'legacy GET (audit)',
      pass: false,
      detail: err.response?.data || err.message,
    });
  }

  return results;
}

main()
  .then((rows) => {
    console.log('\n=== Stock-adjust consolidation verification ===\n');
    rows.forEach((r) =>
      console.log(`${r.pass ? '[PASS]' : '[FAIL]'} ${r.step}${r.detail ? ' - ' + JSON.stringify(r.detail) : ''}`)
    );
    const failed = rows.filter((r) => !r.pass).length;
    process.exit(failed ? 1 : 0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
