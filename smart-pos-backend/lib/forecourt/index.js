/**
 * Forecourt domain module — single import surface for the CRUD/orchestration
 * entry points. Mirrors lib/vsdc-gateway/index.js's pattern of hand-picking
 * only composed, high-level exports rather than re-exporting every internal
 * file: fiscalPolicy.js's determineFiscalPath and fiscalAdapter.js's
 * fiscalizeTransaction are deliberately NOT re-exported here, since only
 * fuelTransaction.js is meant to call them — import those two files
 * directly (never through this barrel) if you genuinely need to bypass
 * fuelTransaction.js's orchestration, which should be rare.
 */

module.exports = {
  ...require('./attendant'),
  ...require('./pump'),
  ...require('./fuelTransaction'),
};
