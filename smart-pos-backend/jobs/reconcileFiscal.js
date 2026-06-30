#!/usr/bin/env node
/**
 * Standalone fiscal reconciliation job.
 * Cron example: */5 * * * * node jobs/reconcileFiscal.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { reconcileStuckFiscalRecords } = require('../lib/fiscalReconcile');

async function main() {
  console.log('[Fiscal Reconcile] Starting run...');
  const results = await reconcileStuckFiscalRecords({
    windowMinutes: parseInt(process.env.FISCAL_RECONCILE_WINDOW_MINUTES || '10', 10),
    batchSize: parseInt(process.env.FISCAL_RECONCILE_BATCH_SIZE || '50', 10),
  });

  if (results.actions.length === 0) {
    console.log('[Fiscal Reconcile] No stuck receipts found.');
  } else {
    console.log('[Fiscal Reconcile] Actions:', JSON.stringify(results.actions, null, 2));
  }

  const prisma = require('../lib/prisma');
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('[Fiscal Reconcile] Fatal:', err);
  process.exit(1);
});
